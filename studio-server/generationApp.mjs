import { GenerationError } from './generationService.mjs'
import { TaskStoreError } from './generationTaskStore.mjs'

const SESSION_COOKIE = 'nanafox_studio_session'
const CSRF_COOKIE = 'nanafox_studio_csrf'
const MAX_BODY_BYTES = 32 * 1024
const ALLOWED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])
const ALLOWED_QUALITIES = new Set(['low', 'medium', 'high'])

export function createStudioGenerationApp(options = {}) {
  const publicOrigin = normalizeOrigin(options.publicOrigin)
  const sessions = options.sessions
  const generations = options.generations
  const tasks = options.tasks
  const outputs = options.outputs
  if (!sessions || !generations || !tasks || !outputs) throw new Error('Studio generation app dependencies are required')

  return {
    async handle(request) {
      const url = new URL(request.url)
      const session = authenticate(request, sessions)
      if (!session) return jsonError(401, 'UNAUTHENTICATED', '请先登录')

      try {
        if (request.method === 'GET' && url.pathname === '/api/generations') {
          return json({ ok: true, data: tasks.listTasks(session.user.id).map(publicTask) })
        }

        const taskMatch = url.pathname.match(/^\/api\/generations\/([A-Za-z0-9_-]+)$/)
        if (request.method === 'GET' && taskMatch) {
          const task = tasks.getTask(session.user.id, taskMatch[1])
          if (!task) return jsonError(404, 'NOT_FOUND', '找不到这个创作任务')
          return json({ ok: true, data: publicTask(task) })
        }

        const artworkMatch = url.pathname.match(/^\/api\/artworks\/([A-Za-z0-9_-]+)$/)
        if (request.method === 'GET' && artworkMatch) {
          const task = tasks.getTask(session.user.id, artworkMatch[1])
          if (!task?.output || !['output_stored', 'succeeded'].includes(task.status)) {
            return jsonError(404, 'NOT_FOUND', '找不到这个作品')
          }
          try {
            const artwork = await outputs.read(task.output)
            return new Response(artwork.bytes, {
              headers: {
                'Cache-Control': 'private, max-age=3600',
                'Content-Type': artwork.mimeType,
                'Content-Length': String(artwork.bytes.length),
                'X-Content-Type-Options': 'nosniff',
              },
            })
          } catch (error) {
            if (error?.code === 'ENOENT') return jsonError(404, 'NOT_FOUND', '找不到这个作品')
            throw error
          }
        }

        if (request.method !== 'POST' || url.pathname !== '/api/generations') {
          return jsonError(404, 'NOT_FOUND', '接口不存在')
        }
        if (request.headers.get('origin') !== publicOrigin) {
          return jsonError(403, 'ORIGIN_REJECTED', '请求来源无效')
        }
        if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求格式必须为 JSON')
        }
        if (!verifyCsrf(request, sessions)) {
          return jsonError(403, 'CSRF_REJECTED', '安全校验失败，请刷新页面后重试')
        }

        const input = normalizeInput(await readJson(request))
        const key = String(request.headers.get('idempotency-key') ?? '').trim()
        if (!key || key.length > 200) return jsonError(400, 'INVALID_IDEMPOTENCY_KEY', '创作请求标识无效')
        const task = await generations.generate(session.user, input, key)
        return json({ ok: true, data: publicTask(task) }, 201)
      } catch (error) {
        if (error instanceof GenerationError) return jsonError(error.status, error.reason, error.message)
        if (error instanceof TaskStoreError) return jsonError(409, error.reason, error.message)
        if (error?.reason && error?.status) return jsonError(error.status, error.reason, error.message)
        console.error('Studio generation request failed', error)
        return jsonError(500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试')
      }
    },
  }
}

function authenticate(request, sessions) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE]
  return token ? sessions.getSession(token) : null
}

function verifyCsrf(request, sessions) {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE] ?? ''
  const csrf = cookies[CSRF_COOKIE] ?? ''
  return Boolean(token && csrf && request.headers.get('x-csrf-token') === csrf && sessions.verifyCsrf(token, csrf))
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw requestError(413, 'BODY_TOO_LARGE', '请求内容过大')
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw requestError(413, 'BODY_TOO_LARGE', '请求内容过大')
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw requestError(400, 'INVALID_JSON', '请求内容不是有效的 JSON')
  }
}

function normalizeInput(value) {
  const keys = Object.keys(value)
  if (keys.some((key) => !['prompt', 'size', 'quality'].includes(key))) throw validationError('创作参数无效')
  const input = {
    prompt: String(value.prompt ?? '').trim(),
    size: String(value.size ?? ''),
    quality: String(value.quality ?? ''),
  }
  if (!input.prompt || input.prompt.length > 10000) throw validationError('请输入有效的画面描述')
  if (!ALLOWED_SIZES.has(input.size)) throw validationError('画面比例无效')
  if (!ALLOWED_QUALITIES.has(input.quality)) throw validationError('画面质量无效')
  return input
}

function publicTask(task) {
  const value = {
    id: task.id,
    input: task.input,
    status: task.status,
    errorReason: task.errorReason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    output: null,
  }
  if (task.output) {
    value.output = { url: task.output.url }
    if (task.output.revisedPrompt) value.output.revisedPrompt = task.output.revisedPrompt
    if (task.output.usage) value.output.usage = task.output.usage
  }
  return value
}

function parseCookies(header) {
  const result = {}
  for (const part of String(header ?? '').split(';')) {
    const idx = part.indexOf('=')
    if (idx < 1) continue
    result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return result
}

function jsonError(status, reason, message) {
  return json({ ok: false, error: { reason, message } }, status)
}

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function normalizeOrigin(value) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw new Error('Studio public origin is invalid')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Studio public origin must use HTTPS')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Studio public origin must be an origin')
  }
  return url.origin
}

function requestError(status, reason, message) {
  return Object.assign(new Error(message), { status, reason })
}

function validationError(message) {
  return requestError(400, 'VALIDATION_ERROR', message)
}

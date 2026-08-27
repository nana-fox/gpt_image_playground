import { QuotaError } from './quotaStore.mjs'

const SESSION_COOKIE = 'nanafox_studio_session'
const CSRF_COOKIE = 'nanafox_studio_csrf'
const MAX_BODY_BYTES = 32 * 1024

export function createStudioAdminApp(options = {}) {
  const publicOrigin = normalizeOrigin(options.publicOrigin)
  const adminSubjects = new Set(options.adminSubjects ?? [])
  const sessions = options.sessions
  const quota = options.quota
  if (!sessions?.getSession || !sessions?.verifyCsrf || !sessions?.searchUsers || !sessions?.getUser || !quota) {
    throw new Error('Studio operations dependencies are required')
  }

  return {
    async handle(request) {
      const url = new URL(request.url)
      const cookies = parseCookies(request.headers.get('cookie'))
      const sessionToken = cookies[SESSION_COOKIE] ?? ''
      const session = sessionToken ? await sessions.getSession(sessionToken) : null
      if (!session) return jsonError(401, 'UNAUTHENTICATED', '请先登录')
      if (!adminSubjects.has(session.user.identitySubject)) {
        return jsonError(403, 'ADMIN_FORBIDDEN', '当前账户没有运营权限')
      }

      try {
        if (request.method === 'GET' && url.pathname === '/api/admin/me') {
          return json({
            ok: true,
            data: {
              admin: true,
              user: publicUser(session.user),
            },
          })
        }
        if (request.method === 'GET' && url.pathname === '/api/admin/quota-policy') {
          return json({ ok: true, data: await quota.getPolicy() })
        }
        if (request.method === 'GET' && url.pathname === '/api/admin/users') {
          const query = String(url.searchParams.get('query') ?? '').trim()
          const limit = Number(url.searchParams.get('limit') ?? 20)
          if (query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
            throw validationError('用户查询条件无效')
          }
          return json({ ok: true, data: await sessions.searchUsers(query, limit) })
        }

        if (request.method === 'PATCH' && url.pathname === '/api/admin/quota-policy') {
          await verifyWrite(request, sessions, sessionToken, cookies[CSRF_COOKIE], publicOrigin)
          const input = await readJson(request)
          const policy = normalizePolicy(input)
          return json({
            ok: true,
            data: await quota.setPolicy(policy, {
              actorSubject: session.user.identitySubject,
              action: 'quota_policy.update',
            }),
          })
        }

        const creditMatch = url.pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]{1,128})\/credits$/)
        if (request.method === 'POST' && creditMatch) {
          await verifyWrite(request, sessions, sessionToken, cookies[CSRF_COOKIE], publicOrigin)
          const user = await sessions.getUser(creditMatch[1])
          if (!user) return jsonError(404, 'USER_NOT_FOUND', '找不到这个用户')
          const grant = normalizeGrant(await readJson(request))
          return json({
            ok: true,
            data: await quota.grantCredits(user.id, grant, {
              actorSubject: session.user.identitySubject,
              action: 'credits.grant',
            }),
          }, 201)
        }

        return jsonError(404, 'NOT_FOUND', '接口不存在')
      } catch (error) {
        if (error instanceof QuotaError) return jsonError(409, error.reason, error.message)
        if (error?.reason && error?.status) return jsonError(error.status, error.reason, error.message)
        console.error('Studio operations request failed', error)
        return jsonError(500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试')
      }
    },
  }
}

async function verifyWrite(request, sessions, sessionToken, csrf, publicOrigin) {
  if (request.headers.get('origin') !== publicOrigin) {
    throw requestError(403, 'ORIGIN_REJECTED', '请求来源无效')
  }
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw requestError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求格式必须为 JSON')
  }
  if (!csrf || request.headers.get('x-csrf-token') !== csrf || !await sessions.verifyCsrf(sessionToken, csrf)) {
    throw requestError(403, 'CSRF_REJECTED', '安全校验失败，请刷新页面后重试')
  }
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
    throw validationError('请求内容不是有效的 JSON')
  }
}

function normalizePolicy(input) {
  if (Object.keys(input).some((key) => !['enabled', 'dailyLimit', 'timezone', 'expectedVersion'].includes(key))) {
    throw validationError('免费额度配置无效')
  }
  const dailyLimit = Number(input.dailyLimit)
  const expectedVersion = Number(input.expectedVersion)
  const timezone = String(input.timezone ?? '').trim()
  if (typeof input.enabled !== 'boolean' || !Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) {
    throw validationError('免费额度配置无效')
  }
  if (!timezone || timezone.length > 100 || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw validationError('免费额度配置无效')
  }
  return { enabled: input.enabled, dailyLimit, timezone, expectedVersion }
}

function normalizeGrant(input) {
  if (Object.keys(input).some((key) => !['units', 'reference', 'expiresAt'].includes(key))) {
    throw validationError('加额参数无效')
  }
  const units = Number(input.units)
  const reference = String(input.reference ?? '').trim()
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null || input.expiresAt === ''
    ? null
    : String(input.expiresAt).trim()
  if (!Number.isInteger(units) || units < 1 || units > 100000 || !reference || reference.length > 200) {
    throw validationError('加额参数无效')
  }
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw validationError('额度有效期无效')
  return { source: 'admin', units, reference, expiresAt }
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName }
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

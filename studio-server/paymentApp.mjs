import { PaymentError } from './paymentService.mjs'
import { WxpayError } from './wxpayClient.mjs'

const SESSION_COOKIE = 'nanafox_studio_session'
const CSRF_COOKIE = 'nanafox_studio_csrf'
const MAX_JSON_BYTES = 32 * 1024
const MAX_WEBHOOK_BYTES = 1024 * 1024

export function createStudioPaymentApp(options = {}) {
  const publicOrigin = normalizeOrigin(options.publicOrigin)
  const sessions = options.sessions
  const payments = options.payments
  if (!sessions?.getSession || !sessions?.verifyCsrf || !payments) throw new Error('Studio payment dependencies are required')

  return {
    async handle(request) {
      const url = new URL(request.url)
      try {
        if (request.method === 'POST' && url.pathname === '/api/payments/webhooks/wechat') {
          const rawBody = await readBody(request, MAX_WEBHOOK_BYTES)
          await payments.handleWebhook(rawBody, request.headers)
          return json({ code: 'SUCCESS', message: '成功' })
        }

        const cookies = parseCookies(request.headers.get('cookie'))
        const sessionToken = cookies[SESSION_COOKIE] ?? ''
        const session = sessionToken ? await sessions.getSession(sessionToken) : null
        if (!session) return jsonError(401, 'UNAUTHENTICATED', '请先登录')

        if (request.method === 'GET' && url.pathname === '/api/payments/plans') {
          return json({ ok: true, data: await payments.listPlans() })
        }
        if (request.method === 'POST' && url.pathname === '/api/payments/orders') {
          await verifyWrite(request, sessions, sessionToken, cookies[CSRF_COOKIE], publicOrigin)
          const input = await readJson(request)
          if (Object.keys(input).some((key) => !['planId', 'idempotencyKey'].includes(key))) throw validationError()
          const planId = String(input.planId ?? '').trim()
          const idempotencyKey = String(input.idempotencyKey ?? '').trim()
          const clientIp = getClientIp(request)
          return json({ ok: true, data: await payments.createOrder(session.user.id, planId, idempotencyKey, clientIp) }, 201)
        }
        const orderMatch = url.pathname.match(/^\/api\/payments\/orders\/([A-Za-z0-9-]{1,64})$/)
        if (request.method === 'GET' && orderMatch) {
          const order = await payments.getOrder(session.user.id, orderMatch[1])
          if (!order) return jsonError(404, 'PAYMENT_ORDER_NOT_FOUND', '找不到这个订单')
          return json({ ok: true, data: order })
        }
        return jsonError(404, 'NOT_FOUND', '接口不存在')
      } catch (error) {
        if (error instanceof PaymentError || error instanceof WxpayError || error?.reason && error?.status) {
          return jsonError(error.status ?? 400, error.reason ?? 'PAYMENT_ERROR', error.message)
        }
        console.error('Studio payment request failed', error)
        return jsonError(500, 'INTERNAL_ERROR', '支付服务暂时不可用，请稍后重试')
      }
    },
  }
}

async function verifyWrite(request, sessions, sessionToken, csrf, publicOrigin) {
  if (request.headers.get('origin') !== publicOrigin) throw requestError(403, 'ORIGIN_REJECTED', '请求来源无效')
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw requestError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求格式必须为 JSON')
  }
  if (!csrf || request.headers.get('x-csrf-token') !== csrf || !await sessions.verifyCsrf(sessionToken, csrf)) {
    throw requestError(403, 'CSRF_REJECTED', '安全校验失败，请刷新页面后重试')
  }
}

async function readJson(request) {
  const text = await readBody(request, MAX_JSON_BYTES)
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw requestError(400, 'INVALID_JSON', '请求内容不是有效的 JSON')
  }
}

async function readBody(request, maxBytes) {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw requestError(413, 'BODY_TOO_LARGE', '请求内容过大')
  const text = await request.text()
  if (Buffer.byteLength(text) > maxBytes) throw requestError(413, 'BODY_TOO_LARGE', '请求内容过大')
  return text
}

function getClientIp(request) {
  const forwarded = String(request.headers.get('x-forwarded-for') ?? '').split(',', 1)[0].trim()
  return forwarded || '127.0.0.1'
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
  const url = new URL(String(value ?? ''))
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Studio public origin is invalid')
  }
  return url.origin
}

function requestError(status, reason, message) {
  return Object.assign(new Error(message), { status, reason })
}

function validationError() {
  return requestError(400, 'VALIDATION_ERROR', '支付请求参数无效')
}

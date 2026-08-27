import { RouterAuthError } from './routerAuthClient.mjs'

const SESSION_COOKIE = 'nanafox_studio_session'
const CSRF_COOKIE = 'nanafox_studio_csrf'
const MAX_BODY_BYTES = 32 * 1024

export function createStudioAuthApp(options = {}) {
  const publicOrigin = normalizeOrigin(options.publicOrigin)
  const publicBasePath = String(options.publicBasePath ?? '/')
  if (!publicBasePath.startsWith('/') || !publicBasePath.endsWith('/') || /[\s;,]/.test(publicBasePath)) {
    throw new Error('Studio public base path is invalid')
  }
  const routerAuth = options.routerAuth
  const store = options.store
  const quota = options.quota
  if (!routerAuth || typeof routerAuth !== 'object') throw new Error('Router auth client is required')
  if (!store || typeof store !== 'object') throw new Error('Studio session store is required')

  const secure = new URL(publicOrigin).protocol === 'https:'

  return {
    async handle(request) {
      const url = new URL(request.url)

      if (request.method === 'GET' && (url.pathname === '/api/auth/session' || url.pathname === '/api/quota')) {
        const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE]
        const session = token ? await store.getSession(token) : null
        if (!session) return json({ ok: false, error: { reason: 'UNAUTHENTICATED', message: '请先登录' } }, 401)
        if (url.pathname === '/api/quota') {
          if (!quota) return json({ ok: false, error: { reason: 'QUOTA_UNAVAILABLE', message: '额度服务暂时不可用' } }, 503)
          return json({ ok: true, data: await quota.getBalance(session.user.id) })
        }
        return json({ ok: true, data: session })
      }

      if (request.method !== 'POST' || !AUTH_POST_PATHS.has(url.pathname)) {
        return json({ ok: false, error: { reason: 'NOT_FOUND', message: '接口不存在' } }, 404)
      }
      if (request.headers.get('origin') !== publicOrigin) {
        return json({ ok: false, error: { reason: 'ORIGIN_REJECTED', message: '请求来源无效' } }, 403)
      }
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return json({ ok: false, error: { reason: 'UNSUPPORTED_MEDIA_TYPE', message: '请求格式必须为 JSON' } }, 415)
      }

      let input
      try {
        input = await readJson(request)
      } catch (error) {
        return json({ ok: false, error: { reason: error.reason, message: error.message } }, error.status)
      }

      try {
        if (url.pathname === '/api/auth/send-verify-code') {
          const email = normalizeEmail(input.email)
          const data = await routerAuth.sendVerifyCode(email, request.headers.get('accept-language') ?? '')
          return json({ ok: true, data })
        }

        if (url.pathname === '/api/auth/register') {
          const registerInput = {
            email: normalizeEmail(input.email),
            password: normalizePassword(input.password),
            verifyCode: normalizeCode(input.verifyCode, '验证码'),
          }
          if (input.promoCode) registerInput.promoCode = String(input.promoCode).trim()
          if (input.invitationCode) registerInput.invitationCode = String(input.invitationCode).trim()
          if (input.affiliateCode) registerInput.affiliateCode = String(input.affiliateCode).trim()
          return authenticated(await routerAuth.register(registerInput), store, secure, publicBasePath)
        }

        if (url.pathname === '/api/auth/login') {
          const data = await routerAuth.login(normalizeEmail(input.email), normalizePassword(input.password))
          if (data.requires_2fa === true) {
            const challenge = String(data.temp_token ?? '')
            if (!challenge) throw protocolError()
            return json({ ok: true, data: { requires2FA: true, challenge } })
          }
          return authenticated(data, store, secure, publicBasePath)
        }

        if (url.pathname === '/api/auth/login/2fa') {
          const challenge = String(input.challenge ?? '').trim()
          if (!challenge || challenge.length > 4096) throw validationError('两步验证会话无效')
          const code = normalizeCode(input.code, '动态验证码')
          return authenticated(await routerAuth.login2FA(challenge, code), store, secure, publicBasePath)
        }

        const cookies = parseCookies(request.headers.get('cookie'))
        const sessionToken = cookies[SESSION_COOKIE] ?? ''
        const csrfToken = cookies[CSRF_COOKIE] ?? ''
        if (!sessionToken || !csrfToken || request.headers.get('x-csrf-token') !== csrfToken || !await store.verifyCsrf(sessionToken, csrfToken)) {
          return json({ ok: false, error: { reason: 'CSRF_REJECTED', message: '安全校验失败，请刷新页面后重试' } }, 403)
        }
        await store.deleteSession(sessionToken)
        const response = json({ ok: true, data: { loggedOut: true } })
        response.headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, true, secure, publicBasePath))
        response.headers.append('Set-Cookie', clearCookie(CSRF_COOKIE, false, secure, publicBasePath))
        return response
      } catch (error) {
        if (error instanceof RouterAuthError) {
          const status = error.status >= 400 && error.status < 500 ? error.status : 502
          const message = status === 502 ? '账户服务暂时不可用，请稍后重试' : error.message
          return json({ ok: false, error: { reason: error.reason, message } }, status)
        }
        if (error?.reason && error?.status) {
          return json({ ok: false, error: { reason: error.reason, message: error.message } }, error.status)
        }
        console.error('Studio auth request failed', error)
        return json({ ok: false, error: { reason: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } }, 500)
      }
    },
  }
}

const AUTH_POST_PATHS = new Set([
  '/api/auth/send-verify-code',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/login/2fa',
  '/api/auth/logout',
])

async function authenticated(data, store, secure, path) {
  const user = data?.user
  if (!user || typeof user !== 'object' || !user.subject || !user.email) throw protocolError()
  const session = await store.createSession(user)
  const response = json({
    ok: true,
    data: {
      user: session.user,
      expiresAt: session.expiresAt,
    },
  })
  response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, session.sessionToken, true, secure, path))
  response.headers.append('Set-Cookie', cookie(CSRF_COOKIE, session.csrfToken, false, secure, path, 'Strict'))
  return response
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

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw validationError('请输入有效的邮箱地址')
  return email
}

function normalizePassword(value) {
  const password = String(value ?? '')
  if (!password || password.length > 256) throw validationError('请输入有效的密码')
  return password
}

function normalizeCode(value, label) {
  const code = String(value ?? '').trim()
  if (!/^\d{6}$/.test(code)) throw validationError(`请输入 6 位${label}`)
  return code
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

function cookie(name, value, httpOnly, secure, path, sameSite = 'Lax') {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`, 'Max-Age=2592000']
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function clearCookie(name, httpOnly, secure, path) {
  const parts = [`${name}=`, `Path=${path}`, 'SameSite=Lax', 'Max-Age=0']
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  return parts.join('; ')
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

function protocolError() {
  return requestError(502, 'ROUTER_AUTH_PROTOCOL_ERROR', '账户服务返回了无效结果')
}

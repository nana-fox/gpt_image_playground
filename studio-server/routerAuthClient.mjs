import { createHash, createHmac, randomBytes as secureRandomBytes } from 'node:crypto'

const CLIENT_ID = 'nanafox-studio'
const INTERNAL_PREFIX = '/internal/v1/studio-auth'
const MAX_RESPONSE_BYTES = 1 << 20

export class RouterAuthError extends Error {
  constructor(message, { status = 502, reason = 'ROUTER_AUTH_ERROR' } = {}) {
    super(message)
    this.name = 'RouterAuthError'
    this.status = status
    this.reason = reason
  }
}

export function createRouterAuthClient(options = {}) {
  const url = normalizeBaseUrl(options.baseUrl)
  const keyId = String(options.keyId ?? '').trim()
  const secret = String(options.secret ?? '')
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(keyId)) throw new Error('Router auth key ID is invalid')
  if (secret.length < 32) throw new Error('Router auth signing secret must be at least 32 bytes')

  const request = options.fetch ?? globalThis.fetch
  const clock = options.clock ?? (() => new Date())
  const randomBytes = options.randomBytes ?? secureRandomBytes
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 5000

  const post = async (path, payload, locale = '') => {
    const body = JSON.stringify(payload)
    const timestamp = String(Math.floor(clock().getTime() / 1000))
    const nonce = Buffer.from(randomBytes(16)).toString('hex')
    if (nonce.length !== 32) throw new Error('Router auth nonce source must return 16 bytes')
    const endpointPath = `${INTERNAL_PREFIX}${path}`
    const bodyHash = createHash('sha256').update(body).digest('hex')
    const canonical = ['POST', endpointPath, CLIENT_ID, timestamp, nonce, bodyHash].join('\n')
    const signature = createHmac('sha256', secret).update(canonical).digest('hex')
    const headers = {
      'Content-Type': 'application/json',
      'X-NanaFox-Client': CLIENT_ID,
      'X-NanaFox-Key-ID': keyId,
      'X-NanaFox-Timestamp': timestamp,
      'X-NanaFox-Nonce': nonce,
      'X-NanaFox-Signature': signature,
    }
    if (locale) headers['Accept-Language'] = locale

    let response
    try {
      response = await request(new URL(endpointPath, url).toString(), {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new RouterAuthError('Router identity service is unavailable', {
        reason: error?.name === 'TimeoutError' ? 'ROUTER_AUTH_TIMEOUT' : 'ROUTER_AUTH_UNAVAILABLE',
      })
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new RouterAuthError('Router identity response is too large', { reason: 'ROUTER_AUTH_PROTOCOL_ERROR' })
    }
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new RouterAuthError('Router identity response is too large', { reason: 'ROUTER_AUTH_PROTOCOL_ERROR' })
    }

    let envelope
    try {
      envelope = JSON.parse(text)
    } catch {
      throw new RouterAuthError('Router identity response is invalid', { reason: 'ROUTER_AUTH_PROTOCOL_ERROR' })
    }
    if (!response.ok || envelope?.code !== 0) {
      throw new RouterAuthError(envelope?.message || 'Router identity request failed', {
        status: response.status,
        reason: envelope?.reason || 'ROUTER_AUTH_REQUEST_FAILED',
      })
    }
    if (!envelope.data || typeof envelope.data !== 'object' || 'access_token' in envelope.data || 'refresh_token' in envelope.data) {
      throw new RouterAuthError('Router identity response is invalid', { reason: 'ROUTER_AUTH_PROTOCOL_ERROR' })
    }
    return envelope.data
  }

  return {
    sendVerifyCode(email, locale = '') {
      return post('/send-verify-code', { email }, locale)
    },
    register(input) {
      return post('/register', {
        email: input.email,
        password: input.password,
        verify_code: input.verifyCode ?? '',
        promo_code: input.promoCode ?? '',
        invitation_code: input.invitationCode ?? '',
        aff_code: input.affiliateCode ?? '',
      })
    },
    login(email, password) {
      return post('/login', { email, password })
    },
    login2FA(tempToken, totpCode) {
      return post('/login/2fa', { temp_token: tempToken, totp_code: totpCode })
    },
  }
}

function normalizeBaseUrl(value) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw new Error('Router auth base URL is invalid')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Router auth base URL must use HTTPS')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Router auth base URL must be an origin without credentials, path, query, or fragment')
  }
  return url
}

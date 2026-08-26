export interface StudioUser {
  id: string
  identitySubject: string
  email: string
  displayName: string
}

export interface StudioSession {
  user: StudioUser
  expiresAt: string
}

export type StudioLoginResult = StudioSession | {
  requires2FA: true
  challenge: string
}

export class StudioAuthError extends Error {
  status: number
  reason: string

  constructor(message: string, status = 500, reason = 'STUDIO_AUTH_ERROR') {
    super(message)
    this.name = 'StudioAuthError'
    this.status = status
    this.reason = reason
  }
}

export function sendStudioVerifyCode(email: string, request: typeof fetch = fetch) {
  return post('/api/auth/send-verify-code', { email }, request)
}

export function registerStudio(input: {
  email: string
  password: string
  verifyCode: string
}, request: typeof fetch = fetch): Promise<StudioSession> {
  return post('/api/auth/register', input, request).then(normalizeSession)
}

export function loginStudio(email: string, password: string, request: typeof fetch = fetch): Promise<StudioLoginResult> {
  return post('/api/auth/login', { email, password }, request).then((data) => {
    if (data.requires2FA === true && typeof data.challenge === 'string' && data.challenge) {
      return { requires2FA: true as const, challenge: data.challenge }
    }
    return normalizeSession(data)
  })
}

export function loginStudio2FA(challenge: string, code: string, request: typeof fetch = fetch): Promise<StudioSession> {
  return post('/api/auth/login/2fa', { challenge, code }, request).then(normalizeSession)
}

export function getStudioSession(request: typeof fetch = fetch): Promise<StudioSession> {
  return call('/api/auth/session', { credentials: 'same-origin' }, request).then(normalizeSession)
}

export function logoutStudio(request: typeof fetch = fetch) {
  const csrf = readStudioCookie('nanafox_studio_csrf')
  return post('/api/auth/logout', {}, request, csrf ? { 'X-CSRF-Token': csrf } : undefined)
}

async function post(
  path: string,
  body: Record<string, unknown>,
  request: typeof fetch,
  extraHeaders?: Record<string, string>,
) {
  return call(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }, request)
}

async function call(path: string, init: RequestInit, request: typeof fetch) {
  let response
  try {
    response = await request(path, init)
  } catch {
    throw new StudioAuthError('网络连接失败，请稍后重试', 0, 'NETWORK_ERROR')
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw new StudioAuthError('账户服务返回了无效结果', 502, 'PROTOCOL_ERROR')
  }

  const record = envelope as {
    ok?: unknown
    data?: unknown
    error?: { reason?: unknown, message?: unknown }
  }
  if (!response.ok || record.ok !== true) {
    throw new StudioAuthError(
      typeof record.error?.message === 'string' ? record.error.message : '账户请求失败，请稍后重试',
      response.status,
      typeof record.error?.reason === 'string' ? record.error.reason : 'STUDIO_AUTH_ERROR',
    )
  }
  if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) {
    throw new StudioAuthError('账户服务返回了无效结果', 502, 'PROTOCOL_ERROR')
  }
  return record.data as Record<string, unknown>
}

function normalizeSession(data: Record<string, unknown>): StudioSession {
  const user = data.user as Partial<StudioUser> | undefined
  if (!user || typeof user.id !== 'string' || typeof user.identitySubject !== 'string' || typeof user.email !== 'string') {
    throw new StudioAuthError('账户服务返回了无效结果', 502, 'PROTOCOL_ERROR')
  }
  return {
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
    user: {
      id: user.id,
      identitySubject: user.identitySubject,
      email: user.email,
      displayName: typeof user.displayName === 'string' ? user.displayName : '',
    },
  }
}

export function readStudioCookie(name: string) {
  const prefix = `${name}=`
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) ?? ''
}

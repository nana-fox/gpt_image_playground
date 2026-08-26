import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioAuthApp } from './authApp.mjs'
import { RouterAuthError } from './routerAuthClient.mjs'

const origin = 'https://studio.nanafox.com'
const loginValue = ['Password', '123!'].join('')
const identity = {
  subject: '019c0000-0000-7000-8000-000000000042',
  email: 'studio@example.com',
  display_name: 'Studio User',
}

function createStore() {
  const sessions = new Map()
  let sequence = 0
  return {
    createSession(user) {
      sequence += 1
      const sessionToken = `session-${sequence}`
      const csrfToken = `csrf-${sequence}`
      const record = {
        expiresAt: '2026-09-25T12:00:00.000Z',
        user: {
          id: `local-${sequence}`,
          identitySubject: user.subject,
          email: user.email,
          displayName: user.display_name,
        },
      }
      sessions.set(sessionToken, { csrfToken, record })
      return { sessionToken, csrfToken, ...record }
    },
    getSession(token) {
      return sessions.get(token)?.record ?? null
    },
    verifyCsrf(token, csrfToken) {
      return sessions.get(token)?.csrfToken === csrfToken
    },
    deleteSession(token) {
      return sessions.delete(token)
    },
  }
}

function jsonRequest(path, body, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: origin,
    ...options.headers,
  }
  return new Request(`${origin}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function cookieValue(response, name) {
  const value = response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`))
  return value?.split(';', 1)[0] ?? ''
}

test('verification and registration stay behind the Studio backend', async () => {
  const calls = []
  const app = createStudioAuthApp({
    publicOrigin: origin,
    store: createStore(),
    routerAuth: {
      async sendVerifyCode(email, locale) {
        calls.push(['send', email, locale])
        return { sent: true }
      },
      async register(input) {
        calls.push(['register', input])
        return { user: identity }
      },
    },
  })

  const verify = await app.handle(jsonRequest('/api/auth/send-verify-code', {
    email: identity.email,
  }, { headers: { 'Accept-Language': 'zh-CN' } }))
  assert.equal(verify.status, 200)
  assert.deepEqual(await verify.json(), { ok: true, data: { sent: true } })

  const register = await app.handle(jsonRequest('/api/auth/register', {
    email: identity.email,
    password: loginValue,
    verifyCode: '246810',
  }))
  assert.equal(register.status, 200)
  assert.deepEqual(calls, [
    ['send', identity.email, 'zh-CN'],
    ['register', { email: identity.email, password: loginValue, verifyCode: '246810' }],
  ])
  assert.match(cookieValue(register, 'nanafox_studio_session'), /^nanafox_studio_session=session-1$/)
  assert.match(cookieValue(register, 'nanafox_studio_csrf'), /^nanafox_studio_csrf=csrf-1$/)
})

test('login creates only a Studio session and session lookup returns the local user', async () => {
  const store = createStore()
  const app = createStudioAuthApp({
    publicOrigin: origin,
    store,
    quota: {
      getBalance(userId) {
        assert.equal(userId, 'local-1')
        return {
          free: { eligible: true, enabled: true, limit: 3, used: 1, remaining: 2 },
          credits: 0,
          subscriber: false,
          planId: null,
        }
      },
    },
    routerAuth: {
      async login(email, password) {
        assert.equal(email, identity.email)
        assert.equal(password, loginValue)
        return { user: identity }
      },
    },
  })

  const login = await app.handle(jsonRequest('/api/auth/login', {
    email: identity.email,
    password: loginValue,
  }))
  const loginData = await login.json()
  const sessionCookie = cookieValue(login, 'nanafox_studio_session')
  assert.equal(login.status, 200)
  assert.equal(loginData.data.user.identitySubject, identity.subject)
  assert.equal(JSON.stringify(loginData).includes('access_token'), false)
  assert.match(login.headers.getSetCookie()[0], /HttpOnly/)
  assert.match(login.headers.getSetCookie()[0], /Secure/)
  assert.match(login.headers.getSetCookie()[0], /SameSite=Lax/)

  const session = await app.handle(new Request(`${origin}/api/auth/session`, {
    headers: { Cookie: sessionCookie },
  }))
  assert.equal(session.status, 200)
  assert.equal((await session.json()).data.user.email, identity.email)

  const quota = await app.handle(new Request(`${origin}/api/quota`, {
    headers: { Cookie: sessionCookie },
  }))
  assert.equal(quota.status, 200)
  assert.deepEqual(await quota.json(), {
    ok: true,
    data: {
      free: { eligible: true, enabled: true, limit: 3, used: 1, remaining: 2 },
      credits: 0,
      subscriber: false,
      planId: null,
    },
  })
})

test('quota balance requires a valid Studio session', async () => {
  const app = createStudioAuthApp({
    publicOrigin: origin,
    store: createStore(),
    routerAuth: {},
    quota: { getBalance: () => assert.fail('quota store must not be called') },
  })

  const response = await app.handle(new Request(`${origin}/api/quota`))
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error.reason, 'UNAUTHENTICATED')
})

test('2FA challenge does not create a Studio session until verification succeeds', async () => {
  const app = createStudioAuthApp({
    publicOrigin: origin,
    store: createStore(),
    routerAuth: {
      async login() {
        return { requires_2fa: true, temp_token: 'studio-challenge' }
      },
      async login2FA(tempToken, totpCode) {
        assert.equal(tempToken, 'studio-challenge')
        assert.equal(totpCode, '123456')
        return { user: identity }
      },
    },
  })

  const challenge = await app.handle(jsonRequest('/api/auth/login', {
    email: identity.email,
    password: loginValue,
  }))
  assert.deepEqual(await challenge.json(), {
    ok: true,
    data: { requires2FA: true, challenge: 'studio-challenge' },
  })
  assert.equal(challenge.headers.getSetCookie().length, 0)

  const verified = await app.handle(jsonRequest('/api/auth/login/2fa', {
    challenge: 'studio-challenge',
    code: '123456',
  }))
  assert.equal(verified.status, 200)
  assert.match(cookieValue(verified, 'nanafox_studio_session'), /session-1/)
})

test('logout requires the matching Studio session and CSRF pair', async () => {
  const store = createStore()
  const created = store.createSession(identity)
  const app = createStudioAuthApp({ publicOrigin: origin, store, routerAuth: {} })
  const cookies = `nanafox_studio_session=${created.sessionToken}; nanafox_studio_csrf=${created.csrfToken}`

  const rejected = await app.handle(jsonRequest('/api/auth/logout', {}, {
    headers: { Cookie: cookies, 'X-CSRF-Token': 'wrong' },
  }))
  assert.equal(rejected.status, 403)

  const logout = await app.handle(jsonRequest('/api/auth/logout', {}, {
    headers: { Cookie: cookies, 'X-CSRF-Token': created.csrfToken },
  }))
  assert.equal(logout.status, 200)
  assert.equal(store.getSession(created.sessionToken), null)
  assert.equal(logout.headers.getSetCookie().length, 2)
})

test('unsafe requests and Router failures return bounded errors', async () => {
  const app = createStudioAuthApp({
    publicOrigin: origin,
    store: createStore(),
    routerAuth: {
      async login() {
        throw new RouterAuthError('invalid email or password', {
          status: 401,
          reason: 'INVALID_CREDENTIALS',
        })
      },
    },
  })

  const wrongOrigin = await app.handle(jsonRequest('/api/auth/login', {}, {
    headers: { Origin: 'https://evil.example' },
  }))
  assert.equal(wrongOrigin.status, 403)

  const wrongType = await app.handle(new Request(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'text/plain' },
    body: '{}',
  }))
  assert.equal(wrongType.status, 415)

  const failure = await app.handle(jsonRequest('/api/auth/login', {
    email: identity.email,
    password: 'wrong',
  }))
  assert.equal(failure.status, 401)
  assert.deepEqual(await failure.json(), {
    ok: false,
    error: { reason: 'INVALID_CREDENTIALS', message: 'invalid email or password' },
  })

  const missing = await app.handle(new Request(`${origin}/api/auth/not-found`))
  assert.equal(missing.status, 404)
})

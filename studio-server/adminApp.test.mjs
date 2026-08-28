import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioAdminApp } from './adminApp.mjs'

const origin = 'https://studio.nanafox.com'
const adminSubject = '019c0000-0000-7000-8000-000000000001'
const userId = '019c0000-0000-7000-8000-000000000042'

function createDependencies(subject = adminSubject, role = 'admin') {
  const calls = []
  const authCalls = []
  const session = {
    expiresAt: '2026-09-27T12:00:00.000Z',
    user: {
      id: 'admin-user',
      identitySubject: subject,
      email: 'admin@nanafox.com',
      displayName: 'NanaFox Admin',
    },
  }
  return {
    calls,
    authCalls,
    routerAuth: {
      resolve: (identitySubject, email) => {
        authCalls.push([identitySubject, email])
        return { user: { subject: identitySubject, email, role } }
      },
    },
    sessions: {
      getSession: (token) => token === 'session-token' ? session : null,
      verifyCsrf: (token, csrf) => token === 'session-token' && csrf === 'csrf-token',
      searchUsers: (query, limit) => {
        calls.push(['searchUsers', query, limit])
        return [{ id: userId, email: 'member@example.com', displayName: 'Member' }]
      },
      getUser: (id) => id === userId
        ? { id: userId, email: 'member@example.com', displayName: 'Member' }
        : null,
    },
    quota: {
      getPolicy: () => ({ enabled: true, dailyLimit: 3, timezone: 'Asia/Shanghai', version: 1 }),
      setPolicy: (policy, audit) => {
        calls.push(['setPolicy', policy, audit])
        return { ...policy, version: 2 }
      },
      grantCredits: (id, grant, audit) => {
        calls.push(['grantCredits', id, grant, audit])
        return { id: 'grant-1', source: grant.source, total: grant.units, remaining: grant.units, expiresAt: grant.expiresAt, reference: grant.reference }
      },
    },
    payments: {
      listAdminPlans: () => [{ id: 'plus', name: '创作 Plus', version: 1 }],
      updatePlan: (id, plan, audit) => {
        calls.push(['updatePlan', id, plan, audit])
        return { id, ...plan, version: plan.expectedVersion + 1 }
      },
    },
    paymentChannel: {
      getChannelStatus: () => ({
        provider: 'wxpay_native',
        credentialsReady: true,
        acceptingOrders: false,
        checkoutAvailable: false,
        notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
        version: 1,
      }),
      updateChannel: (input, audit) => {
        calls.push(['updateChannel', input, audit])
        return {
          provider: 'wxpay_native',
          credentialsReady: true,
          acceptingOrders: input.acceptingOrders,
          checkoutAvailable: input.acceptingOrders,
          notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
          version: input.expectedVersion + 1,
        }
      },
    },
    inspirations: {
      listAdmin: () => [{ id: 'product', title: '产品海报', version: 1 }],
      create: (input, audit) => {
        calls.push(['createInspiration', input, audit])
        return { id: 'new-item', ...input, version: 1 }
      },
      update: (id, input, audit) => {
        calls.push(['updateInspiration', id, input, audit])
        return { id, ...input, version: input.expectedVersion + 1 }
      },
    },
  }
}

function request(path, options = {}) {
  const headers = {
    Cookie: 'nanafox_studio_session=session-token; nanafox_studio_csrf=csrf-token',
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers.Origin = origin
    headers['X-CSRF-Token'] = 'csrf-token'
  }
  Object.assign(headers, options.headers)
  return new Request(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

test('current Router administrators can access Studio operations automatically', async () => {
  const allowed = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: allowed.routerAuth,
    sessions: allowed.sessions,
    quota: allowed.quota,
    payments: allowed.payments,
    paymentChannel: allowed.paymentChannel,
  })

  const me = await app.handle(request('/api/admin/me'))
  assert.equal(me.status, 200)
  assert.deepEqual(await me.json(), {
    ok: true,
    data: {
      admin: true,
      user: { id: 'admin-user', email: 'admin@nanafox.com', displayName: 'NanaFox Admin' },
    },
  })
  assert.deepEqual(allowed.authCalls, [[adminSubject, 'admin@nanafox.com']])

  const deniedDependencies = createDependencies(adminSubject, 'user')
  const deniedApp = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: deniedDependencies.routerAuth,
    sessions: deniedDependencies.sessions,
    quota: deniedDependencies.quota,
    payments: deniedDependencies.payments,
    paymentChannel: deniedDependencies.paymentChannel,
  })
  const denied = await deniedApp.handle(request('/api/admin/me'))
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.reason, 'ADMIN_FORBIDDEN')

  const anonymous = await app.handle(new Request(`${origin}/api/admin/me`))
  assert.equal(anonymous.status, 401)
  assert.equal((await anonymous.json()).error.reason, 'UNAUTHENTICATED')
})

test('admin access follows Router demotion and fails closed when Router is unavailable', async () => {
  let role = 'admin'
  const dependencies = createDependencies()
  dependencies.routerAuth.resolve = (subject, email) => ({ user: { subject, email, role } })
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    payments: dependencies.payments,
    paymentChannel: dependencies.paymentChannel,
  })

  assert.equal((await app.handle(request('/api/admin/me'))).status, 200)
  role = 'user'
  assert.equal((await app.handle(request('/api/admin/me'))).status, 403)

  dependencies.routerAuth.resolve = () => {
    throw new Error('Router unavailable')
  }
  const unavailable = await app.handle(request('/api/admin/me'))
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).error.reason, 'ADMIN_AUTH_UNAVAILABLE')
})

test('operators can inspect and update the daily free policy', async () => {
  const dependencies = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    payments: dependencies.payments,
    paymentChannel: dependencies.paymentChannel,
  })

  const current = await app.handle(request('/api/admin/quota-policy'))
  assert.deepEqual((await current.json()).data, {
    enabled: true,
    dailyLimit: 3,
    timezone: 'Asia/Shanghai',
    version: 1,
  })

  const updated = await app.handle(request('/api/admin/quota-policy', {
    method: 'PATCH',
    body: { enabled: false, dailyLimit: 5, timezone: 'Asia/Shanghai', expectedVersion: 1 },
  }))
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).data.version, 2)
  assert.deepEqual(dependencies.calls[0], [
    'setPolicy',
    { enabled: false, dailyLimit: 5, timezone: 'Asia/Shanghai', expectedVersion: 1 },
    { actorSubject: adminSubject, action: 'quota_policy.update' },
  ])
})

test('operators can find a user and grant idempotent credits with an audit actor', async () => {
  const dependencies = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    payments: dependencies.payments,
    paymentChannel: dependencies.paymentChannel,
  })

  const users = await app.handle(request('/api/admin/users?query=member&limit=10'))
  assert.equal(users.status, 200)
  assert.deepEqual((await users.json()).data, [{ id: userId, email: 'member@example.com', displayName: 'Member' }])
  assert.deepEqual(dependencies.calls[0], ['searchUsers', 'member', 10])

  const granted = await app.handle(request(`/api/admin/users/${userId}/credits`, {
    method: 'POST',
    body: {
      units: 12,
      reference: 'manual-support-20260827-001',
      expiresAt: '2026-09-27T12:00:00.000Z',
    },
  }))
  assert.equal(granted.status, 201)
  assert.equal((await granted.json()).data.remaining, 12)
  assert.deepEqual(dependencies.calls[1], [
    'grantCredits',
    userId,
    {
      source: 'admin',
      units: 12,
      reference: 'manual-support-20260827-001',
      expiresAt: '2026-09-27T12:00:00.000Z',
    },
    { actorSubject: adminSubject, action: 'credits.grant' },
  ])
})

test('admin writes require same-origin JSON and the Studio CSRF pair', async () => {
  const dependencies = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    payments: dependencies.payments,
    paymentChannel: dependencies.paymentChannel,
  })

  const wrongOrigin = await app.handle(request('/api/admin/quota-policy', {
    method: 'PATCH',
    body: { enabled: true, dailyLimit: 3, timezone: 'Asia/Shanghai', expectedVersion: 1 },
    headers: { Origin: 'https://evil.example' },
  }))
  assert.equal(wrongOrigin.status, 403)
  assert.equal((await wrongOrigin.json()).error.reason, 'ORIGIN_REJECTED')

  const wrongCsrf = await app.handle(request(`/api/admin/users/${userId}/credits`, {
    method: 'POST',
    body: { units: 1, reference: 'manual-1' },
    headers: { 'X-CSRF-Token': 'wrong' },
  }))
  assert.equal(wrongCsrf.status, 403)
  assert.equal((await wrongCsrf.json()).error.reason, 'CSRF_REJECTED')
  assert.deepEqual(dependencies.calls, [])
})

test('operators inspect and update payment plans without changing their kind', async () => {
  const dependencies = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    payments: dependencies.payments,
    paymentChannel: dependencies.paymentChannel,
  })

  const plans = await app.handle(request('/api/admin/payment-plans'))
  assert.equal(plans.status, 200)
  assert.deepEqual((await plans.json()).data, [{ id: 'plus', name: '创作 Plus', version: 1 }])

  const input = {
    name: '创作 Plus',
    description: '适合持续内容创作',
    priceCents: 2900,
    credits: 100,
    durationDays: 30,
    enabled: true,
    sortOrder: 10,
    expectedVersion: 1,
  }
  const updated = await app.handle(request('/api/admin/payment-plans/plus', {
    method: 'PATCH',
    body: input,
  }))
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).data.version, 2)
  assert.deepEqual(dependencies.calls, [[
    'updatePlan',
    'plus',
    input,
    { actorSubject: adminSubject },
  ]])
})

test('operators inspect and switch payment checkout without receiving merchant secrets', async () => {
  const dependencies = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    payments: dependencies.payments,
    paymentChannel: dependencies.paymentChannel,
  })

  const current = await app.handle(request('/api/admin/payment-channel'))
  assert.equal(current.status, 200)
  const currentBody = await current.json()
  assert.deepEqual(currentBody.data, {
    provider: 'wxpay_native',
    credentialsReady: true,
    acceptingOrders: false,
    checkoutAvailable: false,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    version: 1,
  })

  const updated = await app.handle(request('/api/admin/payment-channel', {
    method: 'PATCH',
    body: { acceptingOrders: true, expectedVersion: 1 },
  }))
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).data.checkoutAvailable, true)
  assert.deepEqual(dependencies.calls, [[
    'updateChannel',
    { acceptingOrders: true, expectedVersion: 1 },
    { actorSubject: adminSubject },
  ]])
  assert.equal(JSON.stringify(currentBody).includes('apiV3Key'), false)
})

test('operators create and update versioned inspirations through audited writes', async () => {
  const dependencies = createDependencies()
  const app = createStudioAdminApp({
    publicOrigin: origin,
    routerAuth: dependencies.routerAuth,
    sessions: dependencies.sessions,
    quota: dependencies.quota,
    inspirations: dependencies.inspirations,
  })

  const list = await app.handle(request('/api/admin/inspirations'))
  assert.deepEqual((await list.json()).data, [{ id: 'product', title: '产品海报', version: 1 }])

  const input = {
    category: '商业',
    title: '新品海报',
    description: '快速制作新品视觉',
    prompt: '电影感新品海报',
    image: 'inspiration-product.png',
    enabled: false,
    featured: false,
    sortOrder: 60,
  }
  const created = await app.handle(request('/api/admin/inspirations', { method: 'POST', body: input }))
  assert.equal(created.status, 201)
  const updated = await app.handle(request('/api/admin/inspirations/new-item', {
    method: 'PATCH',
    body: { ...input, enabled: true, expectedVersion: 1 },
  }))
  assert.equal(updated.status, 200)
  assert.deepEqual(dependencies.calls, [
    ['createInspiration', input, { actorSubject: adminSubject }],
    ['updateInspiration', 'new-item', { ...input, enabled: true, expectedVersion: 1 }, { actorSubject: adminSubject }],
  ])
})

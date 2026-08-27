import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioPaymentApp } from './paymentApp.mjs'

const origin = 'https://studio.nanafox.com'
const session = {
  user: { id: 'user-1', identitySubject: 'router-user-1', email: 'member@example.com', displayName: 'Member' },
}

test('lists plans and creates an authenticated CSRF-protected order', async () => {
  const calls = []
  const app = createStudioPaymentApp({
    publicOrigin: origin,
    sessions: {
      getSession: (token) => token === 'session-token' ? session : null,
      verifyCsrf: (token, csrf) => token === 'session-token' && csrf === 'csrf-token',
    },
    payments: {
      listPlans: () => [{ id: 'plus', name: '创作 Plus', priceCents: 2900 }],
      createOrder: (...args) => {
        calls.push(args)
        return { id: 'order-1', status: 'pending', codeUrl: 'weixin://pay', expiresAt: '2026-08-28T08:15:00.000Z' }
      },
    },
  })

  const plans = await app.handle(request('/api/payments/plans'))
  assert.equal(plans.status, 200)
  assert.equal((await plans.json()).data[0].id, 'plus')

  const created = await app.handle(request('/api/payments/orders', {
    method: 'POST',
    body: { planId: 'plus', idempotencyKey: 'checkout-1' },
  }))
  assert.equal(created.status, 201)
  assert.deepEqual(calls, [['user-1', 'plus', 'checkout-1', '127.0.0.1']])

  const rejected = await app.handle(request('/api/payments/orders', {
    method: 'POST',
    body: { planId: 'plus', idempotencyKey: 'checkout-2' },
    headers: { 'X-CSRF-Token': 'wrong' },
  }))
  assert.equal(rejected.status, 403)
  assert.equal((await rejected.json()).error.reason, 'CSRF_REJECTED')
})

test('accepts WeChat callbacks without a Studio session but rejects oversized bodies', async () => {
  const calls = []
  const app = createStudioPaymentApp({
    publicOrigin: origin,
    sessions: { getSession: assert.fail, verifyCsrf: assert.fail },
    payments: {
      handleWebhook: (body, headers) => {
        calls.push([body, headers])
        return { id: 'order-1', status: 'completed' }
      },
    },
  })
  const callback = await app.handle(new Request(`${origin}/api/payments/webhooks/wechat`, {
    method: 'POST',
    headers: { 'Wechatpay-Signature': 'signature' },
    body: '{"event":"paid"}',
  }))
  assert.equal(callback.status, 200)
  assert.deepEqual(await callback.json(), { code: 'SUCCESS', message: '成功' })
  assert.equal(calls.length, 1)

  const oversized = await app.handle(new Request(`${origin}/api/payments/webhooks/wechat`, {
    method: 'POST',
    headers: { 'Content-Length': String(1024 * 1024 + 1) },
    body: '{}',
  }))
  assert.equal(oversized.status, 413)
})

function request(path, options = {}) {
  const headers = {
    Cookie: 'nanafox_studio_session=session-token; nanafox_studio_csrf=csrf-token',
    'X-Forwarded-For': '127.0.0.1',
    ...options.headers,
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers.Origin = origin
    headers['X-CSRF-Token'] ??= 'csrf-token'
  }
  return new Request(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

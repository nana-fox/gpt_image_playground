import assert from 'node:assert/strict'
import test from 'node:test'

import { createPaymentService, PaymentError } from './paymentService.mjs'

const now = new Date('2026-08-28T08:00:00.000Z')
const plan = {
  id: 'plus',
  kind: 'subscription',
  name: '创作 Plus',
  description: '适合持续内容创作',
  priceCents: 2900,
  currency: 'CNY',
  credits: 100,
  durationDays: 30,
  enabled: true,
  sortOrder: 10,
  version: 1,
}

test('creates one Native order from the server-side plan snapshot', async () => {
  const calls = []
  const order = {
    id: 'order-1',
    userId: 'user-1',
    outTradeNo: 'studio_20260828_order1',
    status: 'pending',
    plan,
    amountCents: 2900,
    currency: 'CNY',
    expiresAt: '2026-08-28T08:15:00.000Z',
    codeUrl: null,
  }
  const store = {
    createOrder: async (input) => {
      calls.push(['createOrder', input])
      return { created: true, order }
    },
    attachCodeUrl: async (id, codeUrl) => {
      calls.push(['attachCodeUrl', id, codeUrl])
      return { ...order, codeUrl }
    },
    failOrder: assert.fail,
  }
  const provider = {
    createNativeOrder: async (input) => {
      calls.push(['createNativeOrder', input])
      return { codeUrl: 'weixin://wxpay/bizpayurl?pr=test' }
    },
  }
  const service = createPaymentService({
    enabled: true,
    store,
    provider,
    clock: () => now,
    orderId: () => 'order-1',
    outTradeNo: () => 'studio_20260828_order1',
  })

  const result = await service.createOrder('user-1', 'plus', 'checkout-1', '203.0.113.1')

  assert.equal(result.codeUrl, 'weixin://wxpay/bizpayurl?pr=test')
  assert.deepEqual(calls[0][1], {
    id: 'order-1',
    userId: 'user-1',
    planId: 'plus',
    idempotencyKey: 'checkout-1',
    outTradeNo: 'studio_20260828_order1',
    expiresAt: '2026-08-28T08:15:00.000Z',
  })
  assert.deepEqual(calls[1][1], {
    outTradeNo: 'studio_20260828_order1',
    description: 'NanaFox Studio 创作 Plus',
    amountCents: 2900,
    expiresAt: '2026-08-28T08:15:00.000Z',
    clientIp: '203.0.113.1',
  })
})

test('never creates an order when payment is disabled', async () => {
  const service = createPaymentService({ enabled: false, store: {}, clock: () => now })
  await assert.rejects(
    () => service.createOrder('user-1', 'plus', 'checkout-1', '203.0.113.1'),
    (error) => error instanceof PaymentError && error.reason === 'PAYMENT_NOT_CONFIGURED',
  )
})

test('fulfills a paid pack exactly once through the store transaction', async () => {
  const notifications = []
  const service = createPaymentService({
    enabled: true,
    provider: {
      verifyNotification: () => ({
        eventId: 'event-1',
        outTradeNo: 'studio_order1',
        transactionId: 'wx-transaction-1',
        amountCents: 1900,
        currency: 'CNY',
        appId: 'wx-studio-app',
        mchId: '1900000001',
      }),
    },
    store: {
      fulfillOrder: async (notification) => {
        notifications.push(notification)
        return { id: 'order-1', status: 'completed' }
      },
    },
  })

  assert.deepEqual(await service.handleWebhook('{}', {}), { id: 'order-1', status: 'completed' })
  assert.deepEqual(await service.handleWebhook('{}', {}), { id: 'order-1', status: 'completed' })
  assert.equal(notifications.length, 2)
  assert.equal(notifications[0].transactionId, 'wx-transaction-1')
})

test('rejects invalid create keys before touching the store', async () => {
  const service = createPaymentService({ enabled: true, store: { createOrder: assert.fail }, provider: {} })
  await assert.rejects(
    () => service.createOrder('user-1', 'plus', '', '203.0.113.1'),
    (error) => error instanceof PaymentError && error.reason === 'VALIDATION_ERROR',
  )
})

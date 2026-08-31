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
const openChannel = { acceptingOrders: true, version: 1 }

test('lists configured plans but only marks checkout available when credentials and operations are both enabled', async () => {
  const disabled = createPaymentService({ enabled: false, store: { listPlans: () => [plan], getPaymentChannel: () => openChannel } })
  assert.equal((await disabled.listPlans())[0].purchasable, false)

  const closed = createPaymentService({
    enabled: true,
    store: { listPlans: () => [plan], getPaymentChannel: () => ({ acceptingOrders: false, version: 1 }) },
    provider: {},
  })
  assert.equal((await closed.listPlans())[0].purchasable, false)

  const enabled = createPaymentService({
    enabled: true,
    store: { listPlans: () => [plan], getPaymentChannel: () => openChannel },
    provider: {},
  })
  assert.equal((await enabled.listPlans())[0].purchasable, true)
})

test('exposes safe payment channel status and rejects opening without server credentials', async () => {
  const updates = []
  const service = createPaymentService({
    enabled: false,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    store: {
      getPaymentChannel: () => ({ acceptingOrders: false, version: 3 }),
      updatePaymentChannel: (input, audit) => {
        updates.push([input, audit])
        return { acceptingOrders: input.acceptingOrders, version: 4 }
      },
    },
  })

  assert.deepEqual(await service.getChannelStatus(), {
    provider: 'wxpay_native',
    credentialsReady: false,
    acceptingOrders: false,
    checkoutAvailable: false,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    version: 3,
  })
  await assert.rejects(
    () => service.updateChannel({ acceptingOrders: true, expectedVersion: 3 }, { actorSubject: 'admin-1' }),
    (error) => error instanceof PaymentError && error.reason === 'PAYMENT_CREDENTIALS_NOT_READY',
  )
  assert.deepEqual(updates, [])
})

test('creates one Native order from the server-side plan snapshot', async () => {
  const calls = []
  const checkoutNow = new Date('2026-08-28T08:00:00.123Z')
  const order = {
    id: 'order-1',
    userId: 'user-1',
    outTradeNo: 'studio_20260828_order1',
    status: 'pending',
    plan,
    amountCents: 2900,
    currency: 'CNY',
    expiresAt: '2026-08-28T08:15:01.000Z',
    codeUrl: null,
  }
  const store = {
    getPaymentChannel: async () => openChannel,
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
    clock: () => checkoutNow,
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
    expiresAt: '2026-08-28T08:15:01.000Z',
  })
  assert.deepEqual(calls[1][1], {
    outTradeNo: 'studio_20260828_order1',
    description: 'NanaFox Studio 创作 Plus',
    amountCents: 2900,
    expiresAt: '2026-08-28T08:15:01.000Z',
    clientIp: '203.0.113.1',
  })
})

test('never creates an order when payment is disabled', async () => {
  const service = createPaymentService({
    enabled: false,
    store: { getPaymentChannel: () => openChannel },
    clock: () => now,
  })
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
      getPaymentChannel: () => openChannel,
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
  const service = createPaymentService({
    enabled: true,
    store: { getPaymentChannel: () => openChannel, createOrder: assert.fail },
    provider: {},
  })
  await assert.rejects(
    () => service.createOrder('user-1', 'plus', '', '203.0.113.1'),
    (error) => error instanceof PaymentError && error.reason === 'VALIDATION_ERROR',
  )
})

test('polling reconciles a paid provider order when the callback was missed', async () => {
  const pending = {
    id: 'order-1',
    userId: 'user-1',
    outTradeNo: 'studio_order1',
    status: 'pending',
    provider: 'wxpay_native',
    plan,
    amountCents: 2900,
    currency: 'CNY',
    codeUrl: 'weixin://pay',
    expiresAt: '2026-08-28T08:15:00.000Z',
  }
  const calls = []
  const service = createPaymentService({
    enabled: true,
    provider: {
      queryOrder: async (outTradeNo) => {
        calls.push(['queryOrder', outTradeNo])
        return {
          status: 'success',
          outTradeNo,
          transactionId: 'wx-transaction-1',
          amountCents: 2900,
          currency: 'CNY',
          appId: 'wx-studio-app',
          mchId: '1900000001',
        }
      },
    },
    store: {
      getPaymentChannel: () => openChannel,
      getUserOrder: async () => pending,
      fulfillOrder: async (notification) => {
        calls.push(['fulfillOrder', notification])
        return { ...pending, status: 'completed', completedAt: now.toISOString() }
      },
    },
  })

  assert.equal((await service.getOrder('user-1', 'order-1')).status, 'completed')
  assert.deepEqual(calls[0], ['queryOrder', 'studio_order1'])
  assert.equal(calls[1][1].eventId, 'query:wx-transaction-1')
})

test('closing new checkout still reconciles and fulfills existing paid orders', async () => {
  const pending = {
    id: 'order-1',
    userId: 'user-1',
    outTradeNo: 'studio_order1',
    status: 'pending',
    provider: 'wxpay_native',
    plan,
    amountCents: 2900,
    currency: 'CNY',
    codeUrl: 'weixin://pay',
    expiresAt: '2026-08-28T08:15:00.000Z',
  }
  const notifications = []
  const service = createPaymentService({
    enabled: true,
    provider: {
      queryOrder: async () => ({
        status: 'success',
        outTradeNo: 'studio_order1',
        transactionId: 'wx-transaction-query',
      }),
      verifyNotification: () => ({
        eventId: 'event-1',
        outTradeNo: 'studio_order1',
        transactionId: 'wx-transaction-webhook',
      }),
    },
    store: {
      getPaymentChannel: () => ({ acceptingOrders: false, version: 2 }),
      getUserOrder: async () => pending,
      fulfillOrder: async (notification) => {
        notifications.push(notification)
        return { ...pending, status: 'completed' }
      },
    },
  })

  await assert.rejects(
    () => service.createOrder('user-1', 'plus', 'checkout-2', '203.0.113.1'),
    (error) => error instanceof PaymentError && error.reason === 'PAYMENT_NOT_ACCEPTING',
  )
  assert.equal((await service.getOrder('user-1', 'order-1')).status, 'completed')
  assert.equal((await service.handleWebhook('{}', {})).status, 'completed')
  assert.equal(notifications.length, 2)
})

test('selects the requested Studio provider and returns an Alipay checkout URL', async () => {
  const calls = []
  const alipay = {
    id: 'alipay-default',
    providerKey: 'alipay',
    identity: { appId: '2026000000000000', mchId: null },
    client: {
      createCheckoutOrder: async (input) => {
        calls.push(['createCheckoutOrder', input])
        return { payUrl: 'https://openapi.alipay.com/gateway.do?signed=true' }
      },
    },
  }
  const order = {
    id: 'order-2',
    userId: 'user-1',
    outTradeNo: 'studio_20260828_order2',
    status: 'pending',
    provider: 'alipay_page',
    providerInstanceId: 'alipay-default',
    plan,
    amountCents: 2900,
    currency: 'CNY',
    expiresAt: '2026-08-28T08:15:00.000Z',
    codeUrl: null,
    payUrl: null,
  }
  const service = createPaymentService({
    enabled: true,
    store: {
      listPlans: async () => [plan],
      getPaymentChannel: async () => openChannel,
      createOrder: async (input) => {
        calls.push(['createOrder', input])
        return { created: true, order }
      },
      attachCheckout: async (id, checkout) => ({ ...order, ...checkout }),
      failOrder: assert.fail,
    },
    providers: {
      listEnabled: async () => [{ providerKey: 'alipay', name: '支付宝' }],
      getEnabled: async (providerKey) => {
        calls.push(['getEnabled', providerKey])
        return providerKey === 'alipay' ? alipay : null
      },
    },
    clock: () => now,
    orderId: () => 'order-2',
    outTradeNo: () => 'studio_20260828_order2',
  })

  const plans = await service.listPlans()
  assert.deepEqual(plans[0].paymentMethods, [{ providerKey: 'alipay', name: '支付宝' }])
  const result = await service.createOrder('user-1', 'plus', 'checkout-2', '203.0.113.1', 'alipay')

  assert.equal(result.provider, 'alipay_page')
  assert.equal(result.payUrl, 'https://openapi.alipay.com/gateway.do?signed=true')
  assert.equal(calls[0][0], 'getEnabled')
  assert.equal(calls[1][1].providerInstanceId, 'alipay-default')
})

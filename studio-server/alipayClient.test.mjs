import assert from 'node:assert/strict'
import test from 'node:test'

import { createAlipayClient, PaymentProviderError } from './alipayClient.mjs'

test('creates a signed page checkout and validates successful notifications', async () => {
  const calls = []
  const client = createAlipayClient({
    appId: '2026000000000000',
    privateKey: 'merchant-private-key',
    publicKey: 'alipay-public-key',
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/alipay/alipay-default',
    returnUrl: 'https://studio.nanafox.com/quota',
    sdk: {
      pageExecute: async (...args) => {
        calls.push(args)
        return 'https://openapi.alipay.com/gateway.do?signed=true'
      },
      checkNotifySignV2: () => true,
    },
  })

  assert.deepEqual(await client.createCheckoutOrder({
    outTradeNo: 'studio_order2',
    description: 'NanaFox Studio 创作 Plus',
    amountCents: 2900,
    expiresAt: '2026-08-28T08:15:00.000Z',
  }), { payUrl: 'https://openapi.alipay.com/gateway.do?signed=true' })
  assert.equal(calls[0][0], 'alipay.trade.page.pay')

  const notification = client.verifyNotification(new URLSearchParams({
    app_id: '2026000000000000',
    notify_id: 'notify-1',
    out_trade_no: 'studio_order2',
    trade_no: '2026082822000000000001',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '29.00',
  }).toString())
  assert.deepEqual(notification, {
    eventId: 'notify-1',
    outTradeNo: 'studio_order2',
    transactionId: '2026082822000000000001',
    amountCents: 2900,
    currency: 'CNY',
    appId: '2026000000000000',
    mchId: null,
  })
})

test('rejects unsigned or non-successful Alipay notifications', () => {
  const client = createAlipayClient({
    appId: '2026000000000000',
    privateKey: 'merchant-private-key',
    publicKey: 'alipay-public-key',
    notifyUrl: 'https://studio.nanafox.com/callback',
    returnUrl: 'https://studio.nanafox.com/quota',
    sdk: { pageExecute: assert.fail, checkNotifySignV2: () => false },
  })
  assert.throws(
    () => client.verifyNotification('trade_status=TRADE_SUCCESS'),
    (error) => error instanceof PaymentProviderError && error.reason === 'PAYMENT_SIGNATURE_INVALID',
  )
})

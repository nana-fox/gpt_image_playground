import assert from 'node:assert/strict'
import test from 'node:test'

import { createAlipayClient, PaymentProviderError } from './alipayClient.mjs'

test('creates a signed face-to-face QR checkout and validates successful notifications', async () => {
  const calls = []
  const client = createAlipayClient({
    appId: '2026000000000000',
    privateKey: 'merchant-private-key',
    publicKey: 'alipay-public-key',
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/alipay/alipay-default',
    returnUrl: 'https://studio.nanafox.com/quota',
    sdk: {
      exec: async (...args) => {
        calls.push(args)
        return { code: '10000', qrCode: 'https://qr.alipay.com/studio-order-2' }
      },
      checkNotifySignV2: () => true,
    },
  })

  assert.deepEqual(await client.createCheckoutOrder({
    outTradeNo: 'studio_order2',
    description: 'NanaFox Studio 创作 Plus',
    amountCents: 2900,
    expiresAt: '2026-08-28T08:15:00.000Z',
  }), { codeUrl: 'https://qr.alipay.com/studio-order-2' })
  assert.equal(calls[0][0], 'alipay.trade.precreate')
  assert.equal(calls[0][1].notify_url, 'https://studio.nanafox.com/api/payments/webhooks/alipay/alipay-default')
  assert.equal(calls[0][1].bizContent.out_trade_no, 'studio_order2')
  assert.equal(calls[0][1].bizContent.total_amount, '29.00')
  assert.deepEqual(calls[0][2], { validateSign: true })

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
    sdk: { exec: assert.fail, checkNotifySignV2: () => false },
  })
  assert.throws(
    () => client.verifyNotification('trade_status=TRADE_SUCCESS'),
    (error) => error instanceof PaymentProviderError && error.reason === 'PAYMENT_SIGNATURE_INVALID',
  )
})

test('passes the complete callback payload to the Alipay SDK verifier', () => {
  let verified
  const client = createAlipayClient({
    appId: '2026000000000000',
    privateKey: 'merchant-private-key',
    publicKey: 'alipay-public-key',
    notifyUrl: 'https://studio.nanafox.com/callback',
    returnUrl: 'https://studio.nanafox.com/#/points',
    sdk: {
      exec: assert.fail,
      checkNotifySignV2: (values) => {
        verified = values
        return true
      },
    },
  })

  const notification = {
    app_id: '2026000000000000',
    notify_id: 'notify-3',
    out_trade_no: 'studio_order3',
    trade_no: 'trade-3',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '79.00',
  }
  const result = client.verifyNotification(new URLSearchParams({
    ...notification,
    sign_type: 'RSA2',
    sign: 'signed-by-alipay',
  }).toString())
  assert.equal(result.amountCents, 7900)
  assert.equal(verified.sign_type, 'RSA2')
  assert.equal(verified.sign, 'signed-by-alipay')
})

test('rejects unsuccessful or untrusted Alipay QR responses', async () => {
  const options = {
    appId: '2026000000000000',
    privateKey: 'merchant-private-key',
    publicKey: 'alipay-public-key',
    notifyUrl: 'https://studio.nanafox.com/callback',
    returnUrl: 'https://studio.nanafox.com/#/points',
  }
  const failed = createAlipayClient({
    ...options,
    sdk: { exec: async () => ({ code: '40004', msg: 'Business Failed', subMsg: 'No permission' }) },
  })
  await assert.rejects(
    () => failed.createCheckoutOrder({ outTradeNo: 'studio_order4', description: 'test', amountCents: 1 }),
    (error) => error instanceof PaymentProviderError && error.reason === 'PAYMENT_PROVIDER_ERROR',
  )

  const untrusted = createAlipayClient({
    ...options,
    sdk: { exec: async () => ({ code: '10000', qrCode: 'https://example.com/not-alipay' }) },
  })
  await assert.rejects(
    () => untrusted.createCheckoutOrder({ outTradeNo: 'studio_order5', description: 'test', amountCents: 1 }),
    (error) => error instanceof PaymentProviderError && error.reason === 'PAYMENT_PROVIDER_PROTOCOL_ERROR',
  )
})

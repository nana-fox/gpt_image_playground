import assert from 'node:assert/strict'
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto'
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
  assert.equal(calls[0][2].bizContent.qr_pay_mode, '4')
  assert.equal(calls[0][2].bizContent.qrcode_width, 220)

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

test('uses RSA2 for the real Alipay page URL and callback path', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const client = createAlipayClient({
    appId: '2026000000000000',
    privateKey,
    publicKey,
    notifyUrl: 'https://studio.nanafox.com/callback',
    returnUrl: 'https://studio.nanafox.com/#/points',
  })
  const checkout = await client.createCheckoutOrder({
    outTradeNo: 'studio_order3',
    description: 'NanaFox Studio 专业版',
    amountCents: 7900,
  })
  const query = Object.fromEntries(new URL(checkout.payUrl).searchParams)
  const verifier = createVerify('RSA-SHA256')
  verifier.update(signingText(query))
  verifier.end()
  assert.equal(verifier.verify(publicKey, query.sign, 'base64'), true)

  const notification = {
    app_id: '2026000000000000',
    notify_id: 'notify-3',
    out_trade_no: 'studio_order3',
    trade_no: 'trade-3',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '79.00',
  }
  const signer = createSign('RSA-SHA256')
  signer.update(signingText(notification))
  signer.end()
  const result = client.verifyNotification(new URLSearchParams({
    ...notification,
    sign_type: 'RSA2',
    sign: signer.sign(privateKey, 'base64'),
  }).toString())
  assert.equal(result.amountCents, 7900)
})

function signingText(values) {
  return Object.keys(values)
    .filter((key) => key !== 'sign' && key !== 'sign_type' && values[key] !== '')
    .sort()
    .map((key) => `${key}=${values[key]}`)
    .join('&')
}

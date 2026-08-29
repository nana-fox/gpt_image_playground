import assert from 'node:assert/strict'
import { createCipheriv, generateKeyPairSync, sign, verify } from 'node:crypto'
import test from 'node:test'

import { createWxpayClient, WxpayError } from './wxpayClient.mjs'

const now = new Date('2026-08-28T08:00:00.000Z')
const timestamp = String(Math.floor(now.getTime() / 1000))
const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 })
const apiV3Key = '0123456789abcdef0123456789abcdef'

test('creates a signed Native order and verifies the WeChat response', async () => {
  let requestBody
  const client = createWxpayClient({
    appId: 'wx-studio-app',
    mchId: '1900000001',
    serialNo: 'MERCHANT-SERIAL',
    privateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: platform.publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeyId: 'PUB_KEY_ID_TEST',
    apiV3Key,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    clock: () => now,
    nonce: () => 'fixed-request-nonce',
    request: async (url, init) => {
      requestBody = JSON.parse(init.body)
      const authorization = parseAuthorization(init.headers.Authorization)
      assert.equal(authorization.mchid, '1900000001')
      assert.equal(authorization.serial_no, 'MERCHANT-SERIAL')
      const path = new URL(url).pathname
      const message = `${init.method}\n${path}\n${authorization.timestamp}\n${authorization.nonce_str}\n${init.body}\n`
      assert.equal(verify('RSA-SHA256', Buffer.from(message), merchant.publicKey, Buffer.from(authorization.signature, 'base64')), true)

      const body = JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=test' })
      const nonce = 'fixed-response-nonce'
      const signature = sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), platform.privateKey).toString('base64')
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Serial': 'PUB_KEY_ID_TEST',
          'Wechatpay-Signature': signature,
        },
      })
    },
  })

  const result = await client.createNativeOrder({
    outTradeNo: 'studio_20260828_order1',
    description: 'NanaFox Studio 创作 Plus',
    amountCents: 2900,
    expiresAt: '2026-08-28T08:15:00.000Z',
    clientIp: '203.0.113.1',
  })

  assert.deepEqual(result, { codeUrl: 'weixin://wxpay/bizpayurl?pr=test' })
  assert.deepEqual(requestBody, {
    appid: 'wx-studio-app',
    mchid: '1900000001',
    description: 'NanaFox Studio 创作 Plus',
    out_trade_no: 'studio_20260828_order1',
    notify_url: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    time_expire: '2026-08-28T08:15:00+00:00',
    amount: { total: 2900, currency: 'CNY' },
    scene_info: { payer_client_ip: '203.0.113.1' },
  })
})

test('verifies and decrypts a successful WeChat callback', () => {
  const client = createClient()
  const transaction = {
    appid: 'wx-studio-app',
    mchid: '1900000001',
    out_trade_no: 'studio_20260828_order1',
    transaction_id: '4200000000202608280000000001',
    trade_state: 'SUCCESS',
    amount: { total: 2900, payer_total: 2900, currency: 'CNY', payer_currency: 'CNY' },
  }
  const resource = encryptResource(JSON.stringify(transaction), apiV3Key)
  const body = JSON.stringify({
    id: 'event-1',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource,
  })
  const nonce = 'fixed-callback-nonce'
  const signature = sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), platform.privateKey).toString('base64')

  assert.deepEqual(client.verifyNotification(body, {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-serial': 'PUB_KEY_ID_TEST',
    'wechatpay-signature': signature,
  }), {
    eventId: 'event-1',
    outTradeNo: 'studio_20260828_order1',
    transactionId: '4200000000202608280000000001',
    amountCents: 2900,
    currency: 'CNY',
    appId: 'wx-studio-app',
    mchId: '1900000001',
  })
})

test('queries a merchant order and normalizes a successful transaction', async () => {
  const body = JSON.stringify({
    appid: 'wx-studio-app',
    mchid: '1900000001',
    out_trade_no: 'studio_20260828_order1',
    transaction_id: '4200000000202608280000000001',
    trade_state: 'SUCCESS',
    amount: { total: 2900, currency: 'CNY' },
  })
  const nonce = 'fixed-query-response'
  const signature = sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), platform.privateKey).toString('base64')
  const client = createWxpayClient({
    appId: 'wx-studio-app',
    mchId: '1900000001',
    serialNo: 'MERCHANT-SERIAL',
    privateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: platform.publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeyId: 'PUB_KEY_ID_TEST',
    apiV3Key,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    clock: () => now,
    nonce: () => 'fixed-query-nonce',
    request: async (url, init) => {
      assert.equal(init.method, 'GET')
      assert.equal(new URL(url).pathname, '/v3/pay/transactions/out-trade-no/studio_20260828_order1')
      assert.equal(new URL(url).searchParams.get('mchid'), '1900000001')
      return new Response(body, {
        headers: {
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Serial': 'PUB_KEY_ID_TEST',
          'Wechatpay-Signature': signature,
        },
      })
    },
  })

  assert.deepEqual(await client.queryOrder('studio_20260828_order1'), {
    status: 'success',
    outTradeNo: 'studio_20260828_order1',
    transactionId: '4200000000202608280000000001',
    amountCents: 2900,
    currency: 'CNY',
    appId: 'wx-studio-app',
    mchId: '1900000001',
  })
})

test('rejects stale or unsigned callbacks before decrypting them', () => {
  const client = createClient()
  assert.throws(() => client.verifyNotification('{}', {}), (error) => error instanceof WxpayError && error.reason === 'PAYMENT_SIGNATURE_INVALID')
  const oldTimestamp = String(Number(timestamp) - 301)
  const signature = sign('RSA-SHA256', Buffer.from(`${oldTimestamp}\nnonce\n{}\n`), platform.privateKey).toString('base64')
  assert.throws(() => client.verifyNotification('{}', {
    'wechatpay-timestamp': oldTimestamp,
    'wechatpay-nonce': 'nonce',
    'wechatpay-serial': 'PUB_KEY_ID_TEST',
    'wechatpay-signature': signature,
  }), (error) => error instanceof WxpayError && error.reason === 'PAYMENT_SIGNATURE_EXPIRED')
})

function createClient() {
  return createWxpayClient({
    appId: 'wx-studio-app',
    mchId: '1900000001',
    serialNo: 'MERCHANT-SERIAL',
    privateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: platform.publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeyId: 'PUB_KEY_ID_TEST',
    apiV3Key,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
    clock: () => now,
  })
}

function encryptResource(plaintext, key) {
  const nonce = 'fixednonce12'
  const associatedData = 'transaction'
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce))
  cipher.setAAD(Buffer.from(associatedData))
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: encrypted.toString('base64'),
    nonce,
    associated_data: associatedData,
  }
}

function parseAuthorization(value) {
  const result = {}
  for (const match of value.matchAll(/([a-z_]+)="([^"]+)"/g)) result[match[1]] = match[2]
  return result
}

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPaymentConfigCipher,
  mergePaymentProviderConfig,
  publicPaymentProvider,
} from './paymentProviderConfig.mjs'

const key = 'oKxkmzPR9LMVDNBhbN2vfNIFKsWKUzZvWKYBlckgjko='

test('encrypts payment credentials at rest and rejects another key', () => {
  const cipher = createPaymentConfigCipher(key)
  const encrypted = cipher.encrypt({ appId: 'wx-app', privateKey: 'merchant-private-key' })

  assert.equal(encrypted.includes('merchant-private-key'), false)
  assert.deepEqual(cipher.decrypt(encrypted), { appId: 'wx-app', privateKey: 'merchant-private-key' })
  assert.throws(() => createPaymentConfigCipher('TMqPIBtqRpoP3HqFCO5TtQ0f38Kk+eqtAi6dX5ob+y8=').decrypt(encrypted))
})

test('keeps stored secrets when an operator leaves replacement fields blank', () => {
  const merged = mergePaymentProviderConfig('wxpay', {
    appId: 'wx-new',
    mchId: '1900000001',
    serialNo: 'serial-1',
    privateKey: '',
    publicKey: '',
    publicKeyId: 'PUB_KEY_ID_1',
    apiV3Key: '',
  }, {
    appId: 'wx-old',
    mchId: '1900000001',
    serialNo: 'serial-1',
    privateKey: 'old-private-key',
    publicKey: 'old-public-key',
    publicKeyId: 'PUB_KEY_ID_1',
    apiV3Key: 'old-api-v3-key',
  })

  assert.equal(merged.appId, 'wx-new')
  assert.equal(merged.privateKey, 'old-private-key')
  assert.equal(merged.publicKey, 'old-public-key')
  assert.equal(merged.apiV3Key, 'old-api-v3-key')
})

test('never returns provider secrets to the operations page', () => {
  const provider = publicPaymentProvider({
    id: 'alipay-default',
    providerKey: 'alipay',
    name: '支付宝',
    enabled: true,
    version: 2,
    config: {
      appId: '2026000000000000',
      privateKey: 'private-secret',
      publicKey: 'public-key',
    },
  }, 'https://studio.nanafox.com/api/payments/webhooks/alipay/alipay-default')

  assert.deepEqual(provider, {
    id: 'alipay-default',
    providerKey: 'alipay',
    name: '支付宝',
    enabled: true,
    configured: true,
    version: 2,
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/alipay/alipay-default',
    config: {
      appId: '2026000000000000',
      privateKeyConfigured: true,
      publicKeyConfigured: true,
    },
  })
  assert.equal(JSON.stringify(provider).includes('private-secret'), false)
  assert.equal(JSON.stringify(provider).includes('public-key'), false)
})

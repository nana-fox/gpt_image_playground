import assert from 'node:assert/strict'
import test from 'node:test'

import { createPaymentConfigCipher } from './paymentProviderConfig.mjs'
import { createPaymentProviderStore } from './paymentProviderStore.mjs'

const encryptionKey = 'oKxkmzPR9LMVDNBhbN2vfNIFKsWKUzZvWKYBlckgjko='

test('reads encrypted Studio provider credentials but only lists masked values', async () => {
  const ciphertext = createPaymentConfigCipher(encryptionKey).encrypt({
    appId: '2026000000000000',
    privateKey: 'merchant-private-key',
    publicKey: 'alipay-public-key',
  })
  const database = {
    query: async () => ({
      rowCount: 1,
      rows: [{
        id: 'alipay-default',
        provider_key: 'alipay',
        name: '支付宝',
        enabled: true,
        config_ciphertext: ciphertext,
        version: 2,
      }],
    }),
    transaction: assert.fail,
  }
  const store = createPaymentProviderStore({
    database,
    encryptionKey,
    publicOrigin: 'https://studio.nanafox.com',
    publicBasePath: '/',
  })

  const listed = await store.list()
  assert.equal(listed[0].configured, true)
  assert.equal(JSON.stringify(listed).includes('merchant-private-key'), false)
  const enabled = await store.getEnabled('alipay')
  assert.equal(enabled.config.privateKey, 'merchant-private-key')
})

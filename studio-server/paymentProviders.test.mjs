import assert from 'node:assert/strict'
import test from 'node:test'

import { createPaymentProviders } from './paymentProviders.mjs'

test('unconfigured Studio providers stay unavailable for checkout and callbacks', async () => {
  const provider = {
    id: 'wxpay-default',
    providerKey: 'wxpay',
    name: '微信支付',
    enabled: false,
    config: {},
    notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wxpay/wxpay-default',
  }
  const providers = createPaymentProviders({
    store: {
      listEnabled: async () => [provider],
      getEnabled: async () => provider,
      getById: async () => provider,
    },
    publicOrigin: 'https://studio.nanafox.com',
    publicBasePath: '/',
  })

  assert.deepEqual(await providers.listEnabled(), [])
  assert.equal(await providers.getEnabled('wxpay'), null)
  assert.equal(await providers.getById('wxpay-default'), null)
})

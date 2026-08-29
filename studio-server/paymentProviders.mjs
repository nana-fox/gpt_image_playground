import { createAlipayClient } from './alipayClient.mjs'
import { validatePaymentProviderConfig } from './paymentProviderConfig.mjs'
import { createWxpayClient } from './wxpayClient.mjs'

export function createPaymentProviders(options = {}) {
  const store = options.store
  const publicOrigin = String(options.publicOrigin ?? '').trim()
  const publicBasePath = String(options.publicBasePath ?? '/').trim()
  if (!store?.listEnabled || !store?.getEnabled || !store?.getById) throw new Error('Studio payment provider store is required')

  return {
    async listEnabled() {
      return (await store.listEnabled()).map(build).filter(Boolean).map((provider) => ({
        id: provider.id,
        providerKey: provider.providerKey,
        name: provider.name,
      }))
    },

    async getEnabled(providerKey) {
      return build(await store.getEnabled(providerKey))
    },

    async getById(id) {
      return build(await store.getById(id))
    },
  }

  function build(provider) {
    if (!provider) return null
    const config = provider.config
    let client
    try {
      validatePaymentProviderConfig(provider.providerKey, config)
      client = provider.providerKey === 'wxpay'
        ? createWxpayClient({ ...config, notifyUrl: provider.notifyUrl })
        : createAlipayClient({
            ...config,
            notifyUrl: provider.notifyUrl,
            returnUrl: `${new URL(publicBasePath, `${publicOrigin}/`).toString()}#/points`,
          })
    } catch {
      return null
    }
    return {
      id: provider.id,
      providerKey: provider.providerKey,
      name: provider.name,
      identity: { appId: config.appId, mchId: config.mchId ?? null },
      client,
    }
  }
}

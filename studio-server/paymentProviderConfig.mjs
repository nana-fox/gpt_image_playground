import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const CONFIG_FIELDS = {
  wxpay: ['appId', 'mchId', 'serialNo', 'privateKey', 'publicKey', 'publicKeyId', 'apiV3Key'],
  alipay: ['appId', 'privateKey', 'publicKey'],
}

const SECRET_FIELDS = {
  wxpay: ['privateKey', 'publicKey', 'apiV3Key'],
  alipay: ['privateKey', 'publicKey'],
}

export function createPaymentConfigCipher(encodedKey) {
  const key = Buffer.from(String(encodedKey ?? '').trim(), 'base64')
  if (key.length !== 32) throw new Error('STUDIO_PAYMENT_CONFIG_KEY must be a base64 encoded 32-byte key')

  return {
    encrypt(config) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()])
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.')
    },

    decrypt(value) {
      const [version, iv, tag, encrypted] = String(value ?? '').split('.')
      if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Payment provider configuration is invalid')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]).toString('utf8'))
    },
  }
}

export function mergePaymentProviderConfig(providerKey, input, current = {}) {
  const fields = CONFIG_FIELDS[providerKey]
  if (!fields) throw validationError('不支持这个支付供应商')
  const config = {}
  for (const field of fields) {
    const value = String(input?.[field] ?? '').trim()
    config[field] = value || (SECRET_FIELDS[providerKey].includes(field) ? String(current?.[field] ?? '').trim() : '')
    if (config[field].length > 20000) throw validationError('支付供应商配置过长')
  }
  return config
}

export function validatePaymentProviderConfig(providerKey, config) {
  const fields = CONFIG_FIELDS[providerKey]
  if (!fields || fields.some((field) => !String(config?.[field] ?? '').trim())) {
    throw validationError('请完整填写支付供应商凭证')
  }
  return config
}

export function publicPaymentProvider(provider, notifyUrl) {
  const providerKey = provider.providerKey
  const config = provider.config ?? {}
  const result = {
    id: provider.id,
    providerKey,
    name: provider.name,
    enabled: provider.enabled === true,
    configured: configured(providerKey, config),
    version: Number(provider.version),
    notifyUrl,
    config: { appId: String(config.appId ?? '') },
  }
  if (providerKey === 'wxpay') {
    Object.assign(result.config, {
      mchId: String(config.mchId ?? ''),
      serialNo: String(config.serialNo ?? ''),
      publicKeyId: String(config.publicKeyId ?? ''),
      privateKeyConfigured: Boolean(config.privateKey),
      publicKeyConfigured: Boolean(config.publicKey),
      apiV3KeyConfigured: Boolean(config.apiV3Key),
    })
  } else {
    Object.assign(result.config, {
      privateKeyConfigured: Boolean(config.privateKey),
      publicKeyConfigured: Boolean(config.publicKey),
    })
  }
  return result
}

function configured(providerKey, config) {
  return Boolean(CONFIG_FIELDS[providerKey]?.every((field) => String(config?.[field] ?? '').trim()))
}

function validationError(message) {
  const error = new Error(message)
  error.reason = 'VALIDATION_ERROR'
  error.status = 400
  return error
}

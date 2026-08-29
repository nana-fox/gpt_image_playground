import { randomUUID } from 'node:crypto'

import {
  createPaymentConfigCipher,
  mergePaymentProviderConfig,
  publicPaymentProvider,
  validatePaymentProviderConfig,
} from './paymentProviderConfig.mjs'

export class PaymentProviderStoreError extends Error {
  constructor(message, reason = 'PAYMENT_PROVIDER_STORE_ERROR', status = 400) {
    super(message)
    this.name = 'PaymentProviderStoreError'
    this.reason = reason
    this.status = status
  }
}

export function createPaymentProviderStore(options = {}) {
  const database = options.database
  if (!database?.query || !database?.transaction) throw new Error('Studio payment provider PostgreSQL database is required')
  const encryptionKey = String(options.encryptionKey ?? '').trim()
  const cipher = encryptionKey ? createPaymentConfigCipher(encryptionKey) : null
  const publicOrigin = String(options.publicOrigin ?? '').trim()
  const publicBasePath = String(options.publicBasePath ?? '/').trim()
  const clock = options.clock ?? (() => new Date())

  const select = async (where = '', values = []) => {
    const result = await database.query(`${PROVIDER_SELECT} ${where} ORDER BY id`, values)
    return result.rows.map(privateProvider)
  }

  const privateProvider = (row) => {
    const config = row.config_ciphertext ? decrypt(row.config_ciphertext) : {}
    return {
      id: row.id,
      providerKey: row.provider_key,
      name: row.name,
      enabled: row.enabled === true,
      version: Number(row.version),
      config,
      notifyUrl: notifyUrl(row.provider_key, row.id),
    }
  }

  return {
    async list() {
      return (await select()).map((provider) => publicPaymentProvider(provider, provider.notifyUrl))
    },

    async listEnabled() {
      return select('WHERE enabled = TRUE')
    },

    async getEnabled(providerKey) {
      const providers = await select('WHERE provider_key = $1 AND enabled = TRUE', [providerKey])
      return providers[0] ?? null
    },

    async getById(id) {
      const providers = await select('WHERE id = $1', [id])
      return providers[0] ?? null
    },

    async update(id, input, audit) {
      if (!cipher) throw new PaymentProviderStoreError('请先配置 STUDIO_PAYMENT_CONFIG_KEY', 'PAYMENT_CONFIG_KEY_MISSING', 503)
      const actorSubject = String(audit?.actorSubject ?? '').trim()
      if (!actorSubject || actorSubject.length > 128) throw validationError('运营身份无效')
      const expectedVersion = Number(input?.expectedVersion)
      const name = String(input?.name ?? '').trim()
      if (!name || name.length > 100 || typeof input?.enabled !== 'boolean' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw validationError('支付供应商配置无效')
      }

      return database.transaction(async (client) => {
        const current = await client.query(`${PROVIDER_SELECT} WHERE id = $1 FOR UPDATE`, [id])
        if (!current.rowCount) throw new PaymentProviderStoreError('找不到这个支付供应商', 'PAYMENT_PROVIDER_NOT_FOUND', 404)
        const before = privateProvider(current.rows[0])
        if (before.version !== expectedVersion) {
          throw new PaymentProviderStoreError('支付供应商已被其他人更新，请刷新后重试', 'PAYMENT_PROVIDER_VERSION_CONFLICT', 409)
        }
        const config = mergePaymentProviderConfig(before.providerKey, input.config, before.config)
        if (input.enabled) validatePaymentProviderConfig(before.providerKey, config)
        const now = clock().getTime()
        const updated = await client.query(`
          UPDATE studio_payment_providers
          SET name = $1, enabled = $2, config_ciphertext = $3,
            version = version + 1, updated_at = $4
          WHERE id = $5 AND version = $6
          RETURNING id, provider_key, name, enabled, config_ciphertext, version
        `, [name, input.enabled, cipher.encrypt(config), now, id, expectedVersion])
        if (!updated.rowCount) {
          throw new PaymentProviderStoreError('支付供应商已被其他人更新，请刷新后重试', 'PAYMENT_PROVIDER_VERSION_CONFLICT', 409)
        }
        const provider = privateProvider(updated.rows[0])
        await client.query(`
          INSERT INTO studio_admin_audit_log
            (id, actor_subject, action, target_user_id, reference, before_json, after_json, created_at)
          VALUES ($1, $2, 'payment_provider.update', NULL, $3, $4, $5, $6)
        `, [
          randomUUID(),
          actorSubject,
          id,
          publicPaymentProvider(before, before.notifyUrl),
          publicPaymentProvider(provider, provider.notifyUrl),
          now,
        ])
        return publicPaymentProvider(provider, provider.notifyUrl)
      })
    },
  }

  function decrypt(value) {
    if (!cipher) throw new PaymentProviderStoreError('支付供应商密钥不可用', 'PAYMENT_CONFIG_KEY_MISSING', 503)
    try {
      return cipher.decrypt(value)
    } catch {
      throw new PaymentProviderStoreError('支付供应商配置无法解密', 'PAYMENT_CONFIG_DECRYPT_FAILED', 503)
    }
  }

  function notifyUrl(providerKey, id) {
    return new URL(`${publicBasePath}api/payments/webhooks/${providerKey}/${id}`, `${publicOrigin}/`).toString()
  }
}

const PROVIDER_SELECT = `
  SELECT id, provider_key, name, enabled, config_ciphertext, version
  FROM studio_payment_providers
`

function validationError(message) {
  return new PaymentProviderStoreError(message, 'VALIDATION_ERROR')
}

import { randomUUID } from 'node:crypto'

export class PaymentStoreError extends Error {
  constructor(message, reason = 'PAYMENT_STORE_ERROR', status = 400) {
    super(message)
    this.name = 'PaymentStoreError'
    this.reason = reason
    this.status = status
  }
}

export function createPaymentStore(options = {}) {
  const database = options.database
  if (!database?.query || !database?.transaction) throw new Error('Studio payment PostgreSQL database is required')
  const clock = options.clock ?? (() => new Date())
  const appId = String(options.providerIdentity?.appId ?? '').trim()
  const mchId = String(options.providerIdentity?.mchId ?? '').trim()

  const listPlans = async (admin = false) => {
    const result = await database.query(`
      SELECT id, kind, name, description, price_cents, currency, credits,
        duration_days, enabled, sort_order, version
      FROM studio_payment_plans
      ${admin ? '' : 'WHERE enabled = TRUE'}
      ORDER BY sort_order, id
    `)
    return result.rows.map(mapPlan)
  }

  return {
    listPlans,
    listAdminPlans: () => listPlans(true),

    async getPaymentChannel() {
      const result = await database.query(`
        SELECT accepting_orders, version
        FROM studio_payment_channel
        WHERE id = 1
      `)
      if (!result.rowCount) throw new PaymentStoreError('支付渠道配置不存在', 'PAYMENT_CHANNEL_NOT_FOUND', 500)
      return mapPaymentChannel(result.rows[0])
    },

    async updatePaymentChannel(input, audit) {
      const expectedVersion = Number(input?.expectedVersion)
      if (typeof input?.acceptingOrders !== 'boolean' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw validationError('支付渠道配置无效')
      }
      const actorSubject = String(audit?.actorSubject ?? '').trim()
      if (!actorSubject || actorSubject.length > 128) throw validationError('运营身份无效')

      return database.transaction(async (client) => {
        const current = await client.query(`
          SELECT accepting_orders, version
          FROM studio_payment_channel
          WHERE id = 1
          FOR UPDATE
        `)
        if (!current.rowCount) throw new PaymentStoreError('支付渠道配置不存在', 'PAYMENT_CHANNEL_NOT_FOUND', 500)
        const before = mapPaymentChannel(current.rows[0])
        if (before.version !== expectedVersion) {
          throw new PaymentStoreError('支付渠道已被其他人更新，请刷新后重试', 'PAYMENT_CHANNEL_VERSION_CONFLICT', 409)
        }
        const now = clock().getTime()
        const result = await client.query(`
          UPDATE studio_payment_channel
          SET accepting_orders = $1, version = version + 1, updated_at = $2
          WHERE id = 1 AND version = $3
          RETURNING accepting_orders, version
        `, [input.acceptingOrders, now, expectedVersion])
        if (!result.rowCount) {
          throw new PaymentStoreError('支付渠道已被其他人更新，请刷新后重试', 'PAYMENT_CHANNEL_VERSION_CONFLICT', 409)
        }
        const updated = mapPaymentChannel(result.rows[0])
        await client.query(`
          INSERT INTO studio_admin_audit_log
            (id, actor_subject, action, target_user_id, reference, before_json, after_json, created_at)
          VALUES ($1, $2, 'payment_channel.update', NULL, 'wxpay_native', $3, $4, $5)
        `, [randomUUID(), actorSubject, before, updated, now])
        return updated
      })
    },

    async updatePlan(id, input, audit) {
      const planId = normalizePlanId(id)
      const name = String(input?.name ?? '').trim()
      const description = String(input?.description ?? '').trim()
      const priceCents = Number(input?.priceCents)
      const credits = Number(input?.credits)
      const durationDays = Number(input?.durationDays)
      const sortOrder = Number(input?.sortOrder)
      const expectedVersion = Number(input?.expectedVersion)
      if (!name || name.length > 100 || description.length > 300) throw validationError('套餐名称或说明无效')
      if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 100000000) throw validationError('套餐价格无效')
      if (!Number.isInteger(credits) || credits < 1 || credits > 100000) throw validationError('套餐额度无效')
      if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) throw validationError('套餐有效期无效')
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) throw validationError('套餐排序无效')
      if (typeof input?.enabled !== 'boolean' || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw validationError('套餐配置无效')
      const actorSubject = String(audit?.actorSubject ?? '').trim()
      if (!actorSubject || actorSubject.length > 128) throw validationError('运营身份无效')

      return database.transaction(async (client) => {
        const current = await client.query(`
          SELECT id, kind, name, description, price_cents, currency, credits,
            duration_days, enabled, sort_order, version
          FROM studio_payment_plans
          WHERE id = $1
          FOR UPDATE
        `, [planId])
        if (!current.rowCount) throw new PaymentStoreError('找不到这个套餐', 'PLAN_NOT_FOUND', 404)
        const before = mapPlan(current.rows[0])
        if (before.version !== expectedVersion) throw new PaymentStoreError('套餐已被其他人更新，请刷新后重试', 'PLAN_VERSION_CONFLICT', 409)
        const now = clock().getTime()
        const result = await client.query(`
          UPDATE studio_payment_plans
          SET name = $1, description = $2, price_cents = $3, credits = $4,
            duration_days = $5, enabled = $6, sort_order = $7,
            version = version + 1, updated_at = $8
          WHERE id = $9 AND version = $10
          RETURNING id, kind, name, description, price_cents, currency, credits,
            duration_days, enabled, sort_order, version
        `, [name, description, priceCents, credits, durationDays, input.enabled, sortOrder, now, planId, expectedVersion])
        if (!result.rowCount) throw new PaymentStoreError('套餐已被其他人更新，请刷新后重试', 'PLAN_VERSION_CONFLICT', 409)
        const updated = mapPlan(result.rows[0])
        await client.query(`
          INSERT INTO studio_admin_audit_log
            (id, actor_subject, action, target_user_id, reference, before_json, after_json, created_at)
          VALUES ($1, $2, 'payment_plan.update', NULL, $3, $4, $5, $6)
        `, [randomUUID(), actorSubject, planId, before, updated, now])
        return updated
      })
    },

    async createOrder(input) {
      const id = String(input?.id ?? '').trim()
      const userId = String(input?.userId ?? '').trim()
      const planId = normalizePlanId(input?.planId)
      const idempotencyKey = String(input?.idempotencyKey ?? '').trim()
      const outTradeNo = String(input?.outTradeNo ?? '').trim()
      const expiresAt = Date.parse(input?.expiresAt)
      if (!id || id.length > 64 || !userId || !idempotencyKey || idempotencyKey.length > 200) throw validationError('订单参数无效')
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(outTradeNo) || !Number.isFinite(expiresAt)) throw validationError('订单参数无效')
      if (!appId || !mchId) throw new PaymentStoreError('微信支付尚未配置', 'PAYMENT_NOT_CONFIGURED', 503)

      return database.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${userId}:${idempotencyKey}`])
        const existing = await client.query(`${ORDER_SELECT} WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`, [userId, idempotencyKey])
        if (existing.rowCount) {
          const order = mapOrder(existing.rows[0])
          if (order.plan.id !== planId) throw new PaymentStoreError('幂等键已用于其他套餐', 'PAYMENT_IDEMPOTENCY_CONFLICT', 409)
          return { created: false, order }
        }
        const plans = await client.query(`
          SELECT id, kind, name, description, price_cents, currency, credits,
            duration_days, enabled, sort_order, version
          FROM studio_payment_plans
          WHERE id = $1 AND enabled = TRUE
          FOR SHARE
        `, [planId])
        if (!plans.rowCount) throw new PaymentStoreError('套餐暂不可购买', 'PLAN_UNAVAILABLE', 409)
        const plan = mapPlan(plans.rows[0])
        const now = clock().getTime()
        const inserted = await client.query(`
          INSERT INTO studio_payment_orders
            (id, user_id, idempotency_key, out_trade_no, status, provider,
             provider_app_id, provider_mch_id, plan_id, plan_kind, plan_name,
             plan_description, amount_cents, currency, credits, duration_days,
             expires_at, created_at, updated_at)
          VALUES
            ($1, $2, $3, $4, 'pending', 'wxpay_native', $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, $16, $16)
          RETURNING *
        `, [
          id, userId, idempotencyKey, outTradeNo, appId, mchId, plan.id, plan.kind,
          plan.name, plan.description, plan.priceCents, plan.currency, plan.credits,
          plan.durationDays, expiresAt, now,
        ])
        return { created: true, order: mapOrder(inserted.rows[0]) }
      })
    },

    async attachCodeUrl(id, codeUrl) {
      const normalized = String(codeUrl ?? '').trim()
      if (!normalized.startsWith('weixin://') || normalized.length > 2048) throw validationError('支付二维码无效')
      const result = await database.query(`
        UPDATE studio_payment_orders
        SET code_url = $1, updated_at = $2
        WHERE id = $3 AND status = 'pending'
        RETURNING *
      `, [normalized, clock().getTime(), id])
      if (!result.rowCount) throw new PaymentStoreError('订单状态已变化', 'PAYMENT_ORDER_CONFLICT', 409)
      return mapOrder(result.rows[0])
    },

    async failOrder(id, reason) {
      const normalized = String(reason ?? 'PAYMENT_PROVIDER_ERROR').slice(0, 100)
      const result = await database.query(`
        UPDATE studio_payment_orders
        SET status = 'failed', failed_reason = $1, updated_at = $2
        WHERE id = $3 AND status = 'pending'
        RETURNING *
      `, [normalized, clock().getTime(), id])
      return result.rowCount ? mapOrder(result.rows[0]) : null
    },

    async getUserOrder(userId, id) {
      const now = clock().getTime()
      await database.query(`
        UPDATE studio_payment_orders
        SET status = 'expired', updated_at = $1
        WHERE id = $2 AND user_id = $3 AND status = 'pending' AND expires_at <= $1
      `, [now, id, userId])
      const result = await database.query(`${ORDER_SELECT} WHERE id = $1 AND user_id = $2`, [id, userId])
      return result.rowCount ? mapOrder(result.rows[0]) : null
    },

    async fulfillOrder(notification) {
      return database.transaction(async (client) => {
        const result = await client.query(`${ORDER_SELECT} WHERE out_trade_no = $1 FOR UPDATE`, [notification?.outTradeNo])
        if (!result.rowCount) return { status: 'unknown', unknown: true }
        const row = result.rows[0]
        validateNotification(row, notification)
        if (row.status === 'completed') return mapOrder(row)
        if (!['pending', 'failed', 'expired'].includes(row.status)) throw new PaymentStoreError('订单状态不能履约', 'PAYMENT_ORDER_CONFLICT', 409)
        const now = clock().getTime()
        const eventId = String(notification.eventId ?? '').trim()
        const transactionId = String(notification.transactionId ?? '').trim()
        if (!eventId || eventId.length > 128 || !transactionId || transactionId.length > 128) throw validationError('支付通知编号无效')
        const ownedTransaction = await client.query(`
          SELECT order_id FROM studio_payment_events WHERE provider_transaction_id = $1
        `, [transactionId])
        if (ownedTransaction.rowCount && ownedTransaction.rows[0].order_id !== row.id) {
          throw new PaymentStoreError('微信交易号已用于其他订单', 'PAYMENT_TRANSACTION_CONFLICT', 409)
        }
        await client.query(`
          INSERT INTO studio_payment_events (event_id, order_id, provider_transaction_id, received_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [eventId, row.id, transactionId, now])

        const periodEnd = now + Number(row.duration_days) * 24 * 60 * 60 * 1000
        if (row.plan_kind === 'subscription') {
          await client.query(`
            INSERT INTO studio_subscriptions (user_id, plan_id, status, current_period_end, updated_at)
            VALUES ($1, $2, 'active', $3, $4)
            ON CONFLICT(user_id) DO UPDATE SET
              plan_id = EXCLUDED.plan_id,
              status = 'active',
              current_period_end = EXCLUDED.current_period_end,
              updated_at = EXCLUDED.updated_at
          `, [row.user_id, row.plan_id, periodEnd, now])
        }
        await client.query(`
          INSERT INTO studio_credit_grants
            (id, user_id, source, total, remaining, expires_at, reference, created_at)
          VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
          ON CONFLICT(user_id, reference) DO NOTHING
        `, [
          randomUUID(), row.user_id, row.plan_kind === 'subscription' ? 'subscription' : 'pack',
          Number(row.credits), periodEnd, `payment:${row.id}`, now,
        ])
        const completed = await client.query(`
          UPDATE studio_payment_orders
          SET status = 'completed', provider_transaction_id = $1, paid_at = $2,
            completed_at = $2, failed_reason = NULL, updated_at = $2
          WHERE id = $3
          RETURNING *
        `, [transactionId, now, row.id])
        return mapOrder(completed.rows[0])
      })
    },
  }
}

const ORDER_SELECT = `
  SELECT id, user_id, idempotency_key, out_trade_no, status, provider,
    provider_app_id, provider_mch_id, provider_transaction_id,
    plan_id, plan_kind, plan_name, plan_description, amount_cents, currency,
    credits, duration_days, code_url, failed_reason, expires_at, paid_at,
    completed_at, created_at, updated_at
  FROM studio_payment_orders
`

function validateNotification(row, notification) {
  if (
    notification?.appId !== row.provider_app_id
    || notification?.mchId !== row.provider_mch_id
    || notification?.currency !== row.currency
  ) throw new PaymentStoreError('支付通知与商户订单不匹配', 'PAYMENT_NOTIFICATION_MISMATCH', 401)
  if (Number(notification?.amountCents) !== Number(row.amount_cents)) {
    throw new PaymentStoreError('支付金额与订单不一致', 'PAYMENT_AMOUNT_MISMATCH', 409)
  }
}

function mapPlan(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    credits: Number(row.credits),
    durationDays: Number(row.duration_days),
    enabled: row.enabled === true,
    sortOrder: Number(row.sort_order),
    version: Number(row.version),
  }
}

function mapPaymentChannel(row) {
  return {
    acceptingOrders: row.accepting_orders === true,
    version: Number(row.version),
  }
}

function mapOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    outTradeNo: row.out_trade_no,
    status: row.status,
    provider: row.provider,
    plan: {
      id: row.plan_id,
      kind: row.plan_kind,
      name: row.plan_name,
      description: row.plan_description,
      priceCents: Number(row.amount_cents),
      currency: row.currency,
      credits: Number(row.credits),
      durationDays: Number(row.duration_days),
    },
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    codeUrl: row.code_url,
    expiresAt: new Date(Number(row.expires_at)).toISOString(),
    paidAt: row.paid_at === null ? null : new Date(Number(row.paid_at)).toISOString(),
    completedAt: row.completed_at === null ? null : new Date(Number(row.completed_at)).toISOString(),
  }
}

function normalizePlanId(value) {
  const id = String(value ?? '').trim()
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) throw validationError('套餐编号无效')
  return id
}

function validationError(message) {
  return new PaymentStoreError(message, 'VALIDATION_ERROR')
}

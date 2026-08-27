import { randomUUID } from 'node:crypto'

export class QuotaError extends Error {
  constructor(message, reason = 'QUOTA_ERROR') {
    super(message)
    this.name = 'QuotaError'
    this.reason = reason
  }
}

export function createQuotaStore(options = {}) {
  const database = options.database
  if (!database?.query || !database?.transaction) throw new Error('Studio quota PostgreSQL database is required')
  const clock = options.clock ?? (() => new Date())
  const reservationTtlSeconds = options.reservationTtlSeconds === undefined ? 900 : Number(options.reservationTtlSeconds)
  if (!Number.isInteger(reservationTtlSeconds) || reservationTtlSeconds < 60 || reservationTtlSeconds > 3600) {
    throw new Error('Studio quota reservation TTL is invalid')
  }

  const getPolicy = async (client = database) => {
    const result = await client.query(`
      SELECT enabled, daily_limit, timezone, version
      FROM studio_quota_policy
      WHERE id = 1
    `)
    return mapPolicy(result.rows[0])
  }
  const getSubscription = async (client, userId, now) => {
    const result = await client.query(`
      SELECT plan_id, status, current_period_end
      FROM studio_subscriptions
      WHERE user_id = $1
    `, [userId])
    const row = result.rows[0]
    if (!row || row.status !== 'active' || Number(row.current_period_end) <= now) return null
    return { planId: row.plan_id, periodEnd: new Date(Number(row.current_period_end)).toISOString() }
  }
  const releaseExpired = async (client, now) => {
    await client.query(`
      WITH expired AS (
        SELECT id
        FROM studio_quota_reservations
        WHERE status = 'reserved' AND expires_at <= $1
        FOR UPDATE
      ), released AS (
        UPDATE studio_quota_reservations reservations
        SET status = 'released', updated_at = $1
        FROM expired
        WHERE reservations.id = expired.id
        RETURNING reservations.grant_id
      )
      UPDATE studio_credit_grants grants
      SET remaining = LEAST(grants.total, grants.remaining + 1)
      FROM released
      WHERE grants.id = released.grant_id
    `, [now])
  }

  return {
    getPolicy,

    async setPolicy(policy) {
      const enabled = policy?.enabled === true
      const dailyLimit = Number(policy?.dailyLimit)
      const timezone = String(policy?.timezone ?? '').trim()
      if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) {
        throw new Error('Studio daily free limit is invalid')
      }
      validateTimezone(timezone)
      const current = await getPolicy()
      const expectedVersion = policy.expectedVersion === undefined ? current.version : Number(policy.expectedVersion)
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('Studio quota policy version is invalid')
      const result = await database.query(`
        UPDATE studio_quota_policy
        SET enabled = $1, daily_limit = $2, timezone = $3, version = version + 1, updated_at = $4
        WHERE id = 1 AND version = $5
        RETURNING enabled, daily_limit, timezone, version
      `, [enabled, dailyLimit, timezone, clock().getTime(), expectedVersion])
      if (!result.rowCount) {
        throw new QuotaError('免费额度配置已被其他人更新，请刷新后重试', 'POLICY_VERSION_CONFLICT')
      }
      return mapPolicy(result.rows[0])
    },

    async setSubscription(userId, subscription) {
      const planId = String(subscription?.planId ?? '').trim()
      const status = String(subscription?.status ?? '').trim()
      const periodEnd = parseDate(subscription?.periodEnd, 'subscription period end')
      if (!userId || !planId || !['active', 'canceled', 'past_due', 'expired'].includes(status)) {
        throw new Error('Studio subscription is invalid')
      }
      await database.query(`
        INSERT INTO studio_subscriptions (user_id, plan_id, status, current_period_end, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(user_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          current_period_end = EXCLUDED.current_period_end,
          updated_at = EXCLUDED.updated_at
      `, [userId, planId, status, periodEnd, clock().getTime()])
      return { userId, planId, status, periodEnd: new Date(periodEnd).toISOString() }
    },

    async grantCredits(userId, grant) {
      const source = String(grant?.source ?? '').trim()
      const units = Number(grant?.units)
      const reference = String(grant?.reference ?? '').trim()
      const expiresAt = grant?.expiresAt ? parseDate(grant.expiresAt, 'credit expiry') : null
      if (!userId || !['subscription', 'pack', 'admin', 'promotion'].includes(source)) {
        throw new Error('Studio credit source is invalid')
      }
      if (!Number.isInteger(units) || units < 1 || units > 100000) throw new Error('Studio credit units are invalid')
      if (!reference || reference.length > 200) throw new Error('Studio credit reference is invalid')
      return database.transaction(async (client) => {
        await client.query(`
          INSERT INTO studio_credit_grants
            (id, user_id, source, total, remaining, expires_at, reference, created_at)
          VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
          ON CONFLICT(user_id, reference) DO NOTHING
        `, [randomUUID(), userId, source, units, expiresAt, reference, clock().getTime()])
        const result = await client.query(`
          SELECT id, source, total, remaining, expires_at, reference
          FROM studio_credit_grants
          WHERE user_id = $1 AND reference = $2
          FOR UPDATE
        `, [userId, reference])
        const row = result.rows[0]
        if (!row || row.source !== source || Number(row.total) !== units || nullableNumber(row.expires_at) !== expiresAt) {
          throw new QuotaError('额度发放记录与原订单不一致', 'CREDIT_GRANT_CONFLICT')
        }
        return mapGrant(row)
      })
    },

    async getBalance(userId) {
      const now = clock().getTime()
      return database.transaction(async (client) => {
        await releaseExpired(client, now)
        const policy = await getPolicy(client)
        const subscription = await getSubscription(client, userId, now)
        const dayKey = getDayKey(new Date(now), policy.timezone)
        const [daily, credits] = await Promise.all([
          client.query(`
            SELECT COUNT(*)::INTEGER AS used
            FROM studio_quota_reservations
            WHERE user_id = $1 AND source = 'free' AND day_key = $2
              AND status IN ('reserved', 'confirmed')
          `, [userId, dayKey]),
          client.query(`
            SELECT COALESCE(SUM(remaining), 0)::INTEGER AS credits
            FROM studio_credit_grants
            WHERE user_id = $1 AND remaining > 0 AND (expires_at IS NULL OR expires_at > $2)
          `, [userId, now]),
        ])
        const used = Number(daily.rows[0].used)
        const eligible = !subscription
        return {
          free: {
            eligible,
            enabled: policy.enabled,
            limit: policy.dailyLimit,
            used,
            remaining: eligible && policy.enabled ? Math.max(0, policy.dailyLimit - used) : 0,
          },
          credits: Number(credits.rows[0].credits),
          subscriber: Boolean(subscription),
          planId: subscription?.planId ?? null,
        }
      })
    },

    async reserve(userId, idempotencyKey) {
      const key = String(idempotencyKey ?? '').trim()
      if (!userId || !key || key.length > 200) throw new Error('Studio quota reservation key is invalid')
      const now = clock().getTime()
      return database.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId])
        await releaseExpired(client, now)
        const existing = await client.query(`
          SELECT id, source, status
          FROM studio_quota_reservations
          WHERE user_id = $1 AND idempotency_key = $2
        `, [userId, key])
        if (existing.rowCount) return mapReservation(existing.rows[0])

        const policy = await getPolicy(client)
        const subscription = await getSubscription(client, userId, now)
        const dayKey = getDayKey(new Date(now), policy.timezone)
        const daily = await client.query(`
          SELECT COUNT(*)::INTEGER AS used
          FROM studio_quota_reservations
          WHERE user_id = $1 AND source = 'free' AND day_key = $2
            AND status IN ('reserved', 'confirmed')
        `, [userId, dayKey])
        const useFree = !subscription && policy.enabled && Number(daily.rows[0].used) < policy.dailyLimit
        const grants = useFree ? { rows: [] } : await client.query(`
          SELECT id, source
          FROM studio_credit_grants
          WHERE user_id = $1 AND remaining > 0 AND (expires_at IS NULL OR expires_at > $2)
          ORDER BY (expires_at IS NULL) ASC, expires_at ASC, created_at ASC
          LIMIT 1
          FOR UPDATE
        `, [userId, now])
        const grant = grants.rows[0]
        if (!useFree && !grant) throw new QuotaError('创作额度不足', 'QUOTA_EXHAUSTED')

        if (grant) {
          const consumed = await client.query(`
            UPDATE studio_credit_grants
            SET remaining = remaining - 1
            WHERE id = $1 AND remaining > 0
          `, [grant.id])
          if (!consumed.rowCount) throw new QuotaError('创作额度不足', 'QUOTA_EXHAUSTED')
        }
        const id = randomUUID()
        const source = useFree ? 'free' : grant.source
        await client.query(`
          INSERT INTO studio_quota_reservations
            (id, user_id, idempotency_key, source, grant_id, day_key, status, expires_at, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8, $8)
        `, [
          id,
          userId,
          key,
          source,
          grant?.id ?? null,
          useFree ? dayKey : null,
          now + reservationTtlSeconds * 1000,
          now,
        ])
        return { id, source, status: 'reserved' }
      })
    },

    async getReservation(id) {
      const now = clock().getTime()
      return database.transaction(async (client) => {
        await releaseExpired(client, now)
        const result = await client.query(`
          SELECT id, source, status
          FROM studio_quota_reservations
          WHERE id = $1
        `, [String(id ?? '')])
        return result.rowCount ? mapReservation(result.rows[0]) : null
      })
    },

    async confirm(id) {
      return finishReservation(database, id, 'confirmed', clock().getTime())
    },

    async release(id) {
      return finishReservation(database, id, 'released', clock().getTime())
    },
  }
}

async function finishReservation(database, id, target, now) {
  return database.transaction(async (client) => {
    const result = await client.query(`
      SELECT id, source, status, grant_id
      FROM studio_quota_reservations
      WHERE id = $1
      FOR UPDATE
    `, [id])
    const row = result.rows[0]
    if (!row) throw new QuotaError('额度预占记录不存在', 'RESERVATION_NOT_FOUND')
    if (row.status !== 'reserved') return mapReservation(row)
    if (target === 'released' && row.grant_id) {
      await client.query(`
        UPDATE studio_credit_grants
        SET remaining = LEAST(total, remaining + 1)
        WHERE id = $1
      `, [row.grant_id])
    }
    await client.query(`
      UPDATE studio_quota_reservations
      SET status = $1, updated_at = $2
      WHERE id = $3
    `, [target, now, id])
    return { id: row.id, source: row.source, status: target }
  })
}

function mapPolicy(row) {
  return {
    enabled: row.enabled === true,
    dailyLimit: Number(row.daily_limit),
    timezone: row.timezone,
    version: Number(row.version),
  }
}

function mapGrant(row) {
  return {
    id: row.id,
    source: row.source,
    total: Number(row.total),
    remaining: Number(row.remaining),
    expiresAt: row.expires_at === null ? null : new Date(Number(row.expires_at)).toISOString(),
    reference: row.reference,
  }
}

function mapReservation(row) {
  return { id: row.id, source: row.source, status: row.status }
}

function nullableNumber(value) {
  return value === null ? null : Number(value)
}

function parseDate(value, label) {
  const timestamp = new Date(String(value ?? '')).getTime()
  if (!Number.isFinite(timestamp)) throw new Error(`Studio ${label} is invalid`)
  return timestamp
}

function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
  } catch {
    throw new Error('Studio quota timezone is invalid')
  }
}

function getDayKey(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export class QuotaError extends Error {
  constructor(message, reason = 'QUOTA_ERROR') {
    super(message)
    this.name = 'QuotaError'
    this.reason = reason
  }
}

export function createQuotaStore(options = {}) {
  const filename = String(options.filename ?? '').trim()
  if (!filename) throw new Error('Studio quota database filename is required')
  const clock = options.clock ?? (() => new Date())
  const reservationTtlSeconds = options.reservationTtlSeconds === undefined ? 900 : Number(options.reservationTtlSeconds)
  if (!Number.isInteger(reservationTtlSeconds) || reservationTtlSeconds < 60 || reservationTtlSeconds > 3600) {
    throw new Error('Studio quota reservation TTL is invalid')
  }
  const db = new DatabaseSync(filename)
  let closed = false

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS studio_quota_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL,
      daily_limit INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_subscriptions (
      user_id TEXT PRIMARY KEY REFERENCES studio_users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_credit_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      total INTEGER NOT NULL,
      remaining INTEGER NOT NULL,
      expires_at INTEGER,
      reference TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, reference)
    );
    CREATE INDEX IF NOT EXISTS idx_studio_credit_grants_available
      ON studio_credit_grants(user_id, expires_at, created_at);
    CREATE TABLE IF NOT EXISTS studio_quota_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      source TEXT NOT NULL,
      grant_id TEXT REFERENCES studio_credit_grants(id),
      day_key TEXT,
      status TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_studio_quota_reservations_daily
      ON studio_quota_reservations(user_id, source, day_key, status);
    INSERT OR IGNORE INTO studio_quota_policy
      (id, enabled, daily_limit, timezone, version, updated_at)
      VALUES (1, 1, 3, 'Asia/Shanghai', 1, 0);
  `)
  const reservationColumns = db.prepare('PRAGMA table_info(studio_quota_reservations)').all()
  if (!reservationColumns.some((column) => column.name === 'expires_at')) {
    db.exec('ALTER TABLE studio_quota_reservations ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0')
  }

  const readPolicy = db.prepare(`
    SELECT enabled, daily_limit, timezone, version
    FROM studio_quota_policy
    WHERE id = 1
  `)
  const updatePolicy = db.prepare(`
    UPDATE studio_quota_policy
    SET enabled = ?, daily_limit = ?, timezone = ?, version = version + 1, updated_at = ?
    WHERE id = 1 AND version = ?
  `)
  const readSubscription = db.prepare(`
    SELECT plan_id, status, current_period_end
    FROM studio_subscriptions
    WHERE user_id = ?
  `)
  const upsertSubscription = db.prepare(`
    INSERT INTO studio_subscriptions (user_id, plan_id, status, current_period_end, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at
  `)
  const insertGrant = db.prepare(`
    INSERT OR IGNORE INTO studio_credit_grants
      (id, user_id, source, total, remaining, expires_at, reference, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const readGrantByReference = db.prepare(`
    SELECT id, source, total, remaining, expires_at, reference
    FROM studio_credit_grants
    WHERE user_id = ? AND reference = ?
  `)
  const sumCredits = db.prepare(`
    SELECT COALESCE(SUM(remaining), 0) AS credits
    FROM studio_credit_grants
    WHERE user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)
  `)
  const countDaily = db.prepare(`
    SELECT COUNT(*) AS used
    FROM studio_quota_reservations
    WHERE user_id = ? AND source = 'free' AND day_key = ? AND status IN ('reserved', 'confirmed')
  `)
  const readReservationByKey = db.prepare(`
    SELECT id, source, status
    FROM studio_quota_reservations
    WHERE user_id = ? AND idempotency_key = ?
  `)
  const readReservation = db.prepare(`
    SELECT id, source, status, grant_id
    FROM studio_quota_reservations
    WHERE id = ?
  `)
  const insertReservation = db.prepare(`
    INSERT INTO studio_quota_reservations
      (id, user_id, idempotency_key, source, grant_id, day_key, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
  `)
  const findAvailableGrant = db.prepare(`
    SELECT id, source
    FROM studio_credit_grants
    WHERE user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY (expires_at IS NULL) ASC, expires_at ASC, created_at ASC
    LIMIT 1
  `)
  const consumeGrant = db.prepare(`
    UPDATE studio_credit_grants
    SET remaining = remaining - 1
    WHERE id = ? AND remaining > 0
  `)
  const restoreGrant = db.prepare(`
    UPDATE studio_credit_grants
    SET remaining = remaining + 1
    WHERE id = ? AND remaining < total
  `)
  const updateReservationStatus = db.prepare(`
    UPDATE studio_quota_reservations
    SET status = ?, updated_at = ?
    WHERE id = ?
  `)
  const findExpiredReservations = db.prepare(`
    SELECT id, source, status, grant_id
    FROM studio_quota_reservations
    WHERE status = 'reserved' AND expires_at <= ?
  `)

  const getPolicy = () => mapPolicy(readPolicy.get())
  const getSubscription = (userId, now) => {
    const row = readSubscription.get(userId)
    if (!row || row.status !== 'active' || row.current_period_end <= now) return null
    return { planId: row.plan_id, periodEnd: new Date(row.current_period_end).toISOString() }
  }
  const releaseExpired = (now) => {
    for (const row of findExpiredReservations.all(now)) {
      if (row.grant_id) restoreGrant.run(row.grant_id)
      updateReservationStatus.run('released', now, row.id)
    }
  }
  const recoverExpired = (now) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      releaseExpired(now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    getPolicy,

    setPolicy(policy) {
      const enabled = policy?.enabled === true
      const dailyLimit = Number(policy?.dailyLimit)
      const timezone = String(policy?.timezone ?? '').trim()
      if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) {
        throw new Error('Studio daily free limit is invalid')
      }
      validateTimezone(timezone)
      const current = getPolicy()
      const expectedVersion = policy.expectedVersion === undefined ? current.version : Number(policy.expectedVersion)
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('Studio quota policy version is invalid')
      if (updatePolicy.run(enabled ? 1 : 0, dailyLimit, timezone, clock().getTime(), expectedVersion).changes !== 1) {
        throw new QuotaError('免费额度配置已被其他人更新，请刷新后重试', 'POLICY_VERSION_CONFLICT')
      }
      return getPolicy()
    },

    setSubscription(userId, subscription) {
      const planId = String(subscription?.planId ?? '').trim()
      const status = String(subscription?.status ?? '').trim()
      const periodEnd = parseDate(subscription?.periodEnd, 'subscription period end')
      if (!userId || !planId || !['active', 'canceled', 'past_due', 'expired'].includes(status)) {
        throw new Error('Studio subscription is invalid')
      }
      upsertSubscription.run(userId, planId, status, periodEnd, clock().getTime())
      return { userId, planId, status, periodEnd: new Date(periodEnd).toISOString() }
    },

    grantCredits(userId, grant) {
      const source = String(grant?.source ?? '').trim()
      const units = Number(grant?.units)
      const reference = String(grant?.reference ?? '').trim()
      const expiresAt = grant?.expiresAt ? parseDate(grant.expiresAt, 'credit expiry') : null
      if (!userId || !['subscription', 'pack', 'admin', 'promotion'].includes(source)) {
        throw new Error('Studio credit source is invalid')
      }
      if (!Number.isInteger(units) || units < 1 || units > 100000) throw new Error('Studio credit units are invalid')
      if (!reference || reference.length > 200) throw new Error('Studio credit reference is invalid')
      const now = clock().getTime()
      insertGrant.run(randomUUID(), userId, source, units, units, expiresAt, reference, now)
      const row = readGrantByReference.get(userId, reference)
      if (row.source !== source || row.total !== units || row.expires_at !== expiresAt) {
        throw new QuotaError('额度发放记录与原订单不一致', 'CREDIT_GRANT_CONFLICT')
      }
      return mapGrant(row)
    },

    getBalance(userId) {
      const now = clock().getTime()
      recoverExpired(now)
      const policy = getPolicy()
      const subscription = getSubscription(userId, now)
      const dayKey = getDayKey(new Date(now), policy.timezone)
      const used = Number(countDaily.get(userId, dayKey).used)
      const eligible = !subscription
      return {
        free: {
          eligible,
          enabled: policy.enabled,
          limit: policy.dailyLimit,
          used,
          remaining: eligible && policy.enabled ? Math.max(0, policy.dailyLimit - used) : 0,
        },
        credits: Number(sumCredits.get(userId, now).credits),
        subscriber: Boolean(subscription),
        planId: subscription?.planId ?? null,
      }
    },

    reserve(userId, idempotencyKey) {
      const key = String(idempotencyKey ?? '').trim()
      if (!userId || !key || key.length > 200) throw new Error('Studio quota reservation key is invalid')
      const now = clock().getTime()

      db.exec('BEGIN IMMEDIATE')
      try {
        releaseExpired(now)
        const existing = readReservationByKey.get(userId, key)
        if (existing) {
          db.exec('COMMIT')
          return mapReservation(existing)
        }

        const policy = getPolicy()
        const subscription = getSubscription(userId, now)
        const dayKey = getDayKey(new Date(now), policy.timezone)
        const used = Number(countDaily.get(userId, dayKey).used)
        const useFree = !subscription && policy.enabled && used < policy.dailyLimit
        const grant = useFree ? null : findAvailableGrant.get(userId, now)
        if (!useFree && !grant) throw new QuotaError('创作额度不足', 'QUOTA_EXHAUSTED')

        if (grant && consumeGrant.run(grant.id).changes !== 1) {
          throw new QuotaError('创作额度不足', 'QUOTA_EXHAUSTED')
        }
        const id = randomUUID()
        const source = useFree ? 'free' : grant.source
        insertReservation.run(
          id,
          userId,
          key,
          source,
          grant?.id ?? null,
          useFree ? dayKey : null,
          now + reservationTtlSeconds * 1000,
          now,
          now,
        )
        db.exec('COMMIT')
        return { id, source, status: 'reserved' }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    confirm(id) {
      return finishReservation(db, readReservation, updateReservationStatus, restoreGrant, id, 'confirmed', clock().getTime())
    },

    release(id) {
      return finishReservation(db, readReservation, updateReservationStatus, restoreGrant, id, 'released', clock().getTime())
    },

    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}

function finishReservation(db, readReservation, updateStatus, restoreGrant, id, target, now) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = readReservation.get(id)
    if (!row) throw new QuotaError('额度预占记录不存在', 'RESERVATION_NOT_FOUND')
    if (row.status !== 'reserved') {
      db.exec('COMMIT')
      return mapReservation(row)
    }
    if (target === 'released' && row.grant_id) restoreGrant.run(row.grant_id)
    updateStatus.run(target, now, id)
    db.exec('COMMIT')
    return { id: row.id, source: row.source, status: target }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function mapPolicy(row) {
  return {
    enabled: row.enabled === 1,
    dailyLimit: row.daily_limit,
    timezone: row.timezone,
    version: row.version,
  }
}

function mapGrant(row) {
  return {
    id: row.id,
    source: row.source,
    total: row.total,
    remaining: row.remaining,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    reference: row.reference,
  }
}

function mapReservation(row) {
  return { id: row.id, source: row.source, status: row.status }
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

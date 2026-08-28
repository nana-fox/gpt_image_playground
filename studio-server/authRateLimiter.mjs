import { createHmac } from 'node:crypto'

export class AuthRateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super('请求过于频繁，请稍后再试')
    this.name = 'AuthRateLimitError'
    this.reason = 'RATE_LIMITED'
    this.status = 429
    this.retryAfterSeconds = Math.max(1, Number(retryAfterSeconds) || 1)
  }
}

export function createAuthRateLimiter(options = {}) {
  const database = options.database
  const secret = String(options.secret ?? '')
  const clock = options.clock ?? (() => new Date())
  if (!database?.transaction) throw new Error('Studio auth rate limit PostgreSQL database is required')
  if (secret.length < 32) throw new Error('Studio auth rate limit secret must be at least 32 bytes')

  return {
    async consume(buckets) {
      if (!Array.isArray(buckets) || buckets.length < 1 || buckets.length > 4) {
        throw new Error('Studio auth rate limit buckets are invalid')
      }
      const normalized = buckets.map((bucket) => normalizeBucket(bucket, secret))
      const now = clock().getTime()

      return database.transaction(async (client) => {
        await client.query('DELETE FROM studio_auth_rate_limits WHERE updated_at < $1', [now - 24 * 60 * 60 * 1000])
        for (const bucket of normalized) {
          const result = await client.query(`
            INSERT INTO studio_auth_rate_limits (scope, key_hash, window_start, count, updated_at)
            VALUES ($1, $2, $3, 1, $3)
            ON CONFLICT(scope, key_hash) DO UPDATE SET
              window_start = CASE
                WHEN studio_auth_rate_limits.window_start <= $4 THEN $3
                ELSE studio_auth_rate_limits.window_start
              END,
              count = CASE
                WHEN studio_auth_rate_limits.window_start <= $4 THEN 1
                ELSE studio_auth_rate_limits.count + 1
              END,
              updated_at = $3
            RETURNING window_start, count
          `, [bucket.scope, bucket.keyHash, now, now - bucket.windowMs])
          const row = result.rows[0]
          if (Number(row.count) <= bucket.limit) continue
          const retryAfter = Math.ceil((Number(row.window_start) + bucket.windowMs - now) / 1000)
          throw new AuthRateLimitError(retryAfter)
        }
        return { allowed: true }
      })
    },
  }
}

function normalizeBucket(bucket, secret) {
  const scope = String(bucket?.scope ?? '').trim()
  const key = String(bucket?.key ?? '').trim()
  const limit = Number(bucket?.limit)
  const windowMs = Number(bucket?.windowMs)
  if (!/^[a-z0-9-]{1,64}$/.test(scope) || !key || key.length > 4096) {
    throw new Error('Studio auth rate limit bucket is invalid')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Studio auth rate limit limit is invalid')
  if (!Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 24 * 60 * 60 * 1000) {
    throw new Error('Studio auth rate limit window is invalid')
  }
  return {
    scope,
    keyHash: createHmac('sha256', secret).update(`${scope}\0${key}`).digest('hex'),
    limit,
    windowMs,
  }
}

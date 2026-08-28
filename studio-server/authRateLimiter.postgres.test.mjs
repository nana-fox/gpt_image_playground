import assert from 'node:assert/strict'
import test from 'node:test'

import { AuthRateLimitError, createAuthRateLimiter } from './authRateLimiter.mjs'
import { testConnectionString, withPostgres } from './postgresTest.mjs'

test('PostgreSQL rate limits atomically and stores only HMAC keys', { skip: !testConnectionString }, async (t) => {
  const database = await withPostgres(t)
  let now = new Date('2026-08-28T08:00:00.000Z')
  const limiter = createAuthRateLimiter({
    database,
    secret: ['studio', 'rate', 'limit', 'test', 'key'].join('-').repeat(2),
    clock: () => now,
  })
  const buckets = [
    { scope: 'verify-email', key: 'member@example.com', limit: 2, windowMs: 60000 },
    { scope: 'verify-ip', key: '203.0.113.10', limit: 10, windowMs: 60000 },
  ]

  await limiter.consume(buckets)
  await limiter.consume(buckets)
  await assert.rejects(
    () => limiter.consume(buckets),
    (error) => error instanceof AuthRateLimitError && error.reason === 'RATE_LIMITED' && error.retryAfterSeconds === 60,
  )

  const rows = await database.query('SELECT scope, key_hash, count FROM studio_auth_rate_limits ORDER BY scope')
  assert.deepEqual(rows.rows.map((row) => [row.scope, Number(row.count)]), [['verify-email', 2], ['verify-ip', 2]])
  assert.equal(JSON.stringify(rows.rows).includes('member@example.com'), false)
  assert.equal(JSON.stringify(rows.rows).includes('203.0.113.10'), false)

  now = new Date('2026-08-28T08:01:00.000Z')
  await limiter.consume(buckets)
  const reset = await database.query('SELECT count FROM studio_auth_rate_limits WHERE scope = $1', ['verify-email'])
  assert.equal(Number(reset.rows[0].count), 1)
})

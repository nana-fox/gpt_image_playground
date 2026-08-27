import assert from 'node:assert/strict'
import test from 'node:test'

import { testConnectionString, withPostgres } from './postgresTest.mjs'
import { createQuotaStore, QuotaError } from './quotaStore.mjs'
import { createSessionStore } from './sessionStore.mjs'

const identity = {
  subject: '019c0000-0000-7000-8000-000000000099',
  email: 'quota@example.com',
  display_name: 'Quota User',
}

async function withQuota(t, options = {}) {
  const database = await withPostgres(t)
  const sessions = createSessionStore({ database })
  const user = (await sessions.createSession(identity)).user
  return { database, quota: createQuotaStore({ database, ...options }), user }
}

test('PostgreSQL preserves the configurable daily free allowance', { skip: !testConnectionString }, async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })

  assert.deepEqual(await quota.getBalance(user.id), {
    free: { eligible: true, enabled: true, limit: 3, used: 0, remaining: 3 },
    credits: 0,
    subscriber: false,
    planId: null,
  })
  await quota.reserve(user.id, 'free-1')
  await quota.reserve(user.id, 'free-2')
  await quota.reserve(user.id, 'free-3')
  await assert.rejects(
    () => quota.reserve(user.id, 'free-4'),
    (error) => error instanceof QuotaError && error.reason === 'QUOTA_EXHAUSTED',
  )
})

test('PostgreSQL does not overspend the last paid credit concurrently', { skip: !testConnectionString }, async (t) => {
  const { quota, user } = await withQuota(t)
  await quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  await quota.grantCredits(user.id, { source: 'pack', units: 1, reference: 'last-credit' })

  const results = await Promise.allSettled([
    quota.reserve(user.id, 'concurrent-a'),
    quota.reserve(user.id, 'concurrent-b'),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected.reason instanceof QuotaError, true)
  assert.equal(rejected.reason.reason, 'QUOTA_EXHAUSTED')
  assert.equal((await quota.getBalance(user.id)).credits, 0)
})

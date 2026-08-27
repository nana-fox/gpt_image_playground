import assert from 'node:assert/strict'
import test from 'node:test'

import { testConnectionString, withPostgres } from './postgresTest.mjs'
import { createQuotaStore, QuotaError } from './quotaStore.mjs'
import { createSessionStore } from './sessionStore.mjs'

const identity = {
  subject: '019c0000-0000-7000-8000-000000000042',
  email: 'studio@example.com',
  display_name: 'Studio User',
}

async function withQuota(t, options = {}) {
  const database = await withPostgres(t)
  const user = (await createSessionStore({ database }).createSession(identity)).user
  return { quota: createQuotaStore({ database, ...options }), user }
}

test('free users receive three configurable daily generations by default', { skip: !testConnectionString }, async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })

  assert.deepEqual(await quota.getPolicy(), {
    enabled: true,
    dailyLimit: 3,
    timezone: 'Asia/Shanghai',
    version: 1,
  })
  assert.deepEqual(await quota.getBalance(user.id), {
    free: { eligible: true, enabled: true, limit: 3, used: 0, remaining: 3 },
    credits: 0,
    subscriber: false,
    planId: null,
  })
  assert.equal((await quota.reserve(user.id, 'generation-1')).source, 'free')
  assert.equal((await quota.reserve(user.id, 'generation-2')).source, 'free')
  assert.equal((await quota.reserve(user.id, 'generation-3')).source, 'free')
  await assert.rejects(
    () => quota.reserve(user.id, 'generation-4'),
    (error) => error instanceof QuotaError && error.reason === 'QUOTA_EXHAUSTED',
  )
})

test('operators can disable or change the daily free policy', { skip: !testConnectionString }, async (t) => {
  const { quota, user } = await withQuota(t)
  const updated = await quota.setPolicy({ enabled: false, dailyLimit: 5, timezone: 'Asia/Shanghai', expectedVersion: 1 })
  assert.equal(updated.version, 2)
  assert.deepEqual((await quota.getBalance(user.id)).free, {
    eligible: true,
    enabled: false,
    limit: 5,
    used: 0,
    remaining: 0,
  })
  await assert.rejects(() => quota.reserve(user.id, 'disabled-free'), /额度不足/)
  await assert.rejects(
    () => quota.setPolicy({ enabled: true, dailyLimit: 9, timezone: 'Asia/Shanghai', expectedVersion: 1 }),
    (error) => error instanceof QuotaError && error.reason === 'POLICY_VERSION_CONFLICT',
  )
  assert.equal((await quota.getPolicy()).dailyLimit, 5)
})

test('active subscribers consume subscription credits without stacking daily free uses', { skip: !testConnectionString }, async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })
  await quota.setSubscription(user.id, {
    planId: 'plus',
    status: 'active',
    periodEnd: '2026-09-26T12:00:00.000Z',
  })
  await quota.grantCredits(user.id, {
    source: 'subscription',
    units: 40,
    expiresAt: '2026-09-26T12:00:00.000Z',
    reference: 'plus-2026-08',
  })
  assert.deepEqual(await quota.getBalance(user.id), {
    free: { eligible: false, enabled: true, limit: 3, used: 0, remaining: 0 },
    credits: 40,
    subscriber: true,
    planId: 'plus',
  })
  assert.equal((await quota.reserve(user.id, 'subscriber-generation')).source, 'subscription')
  assert.equal((await quota.getBalance(user.id)).credits, 39)
})

test('free users use a purchased pack only after the daily allowance', { skip: !testConnectionString }, async (t) => {
  const { quota, user } = await withQuota(t)
  await quota.setPolicy({ enabled: true, dailyLimit: 1, timezone: 'Asia/Shanghai' })
  await quota.grantCredits(user.id, { source: 'pack', units: 10, reference: 'pack-order-42' })
  assert.equal((await quota.reserve(user.id, 'free-first')).source, 'free')
  assert.equal((await quota.reserve(user.id, 'pack-second')).source, 'pack')
  assert.equal((await quota.getBalance(user.id)).credits, 9)
})

test('reservations are idempotent and release restores the exact source', { skip: !testConnectionString }, async (t) => {
  const { quota, user } = await withQuota(t)
  await quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  await quota.grantCredits(user.id, { source: 'pack', units: 2, reference: 'pack-order-43' })

  const first = await quota.reserve(user.id, 'same-generation')
  assert.deepEqual(await quota.reserve(user.id, 'same-generation'), first)
  assert.equal((await quota.getBalance(user.id)).credits, 1)
  assert.equal((await quota.release(first.id)).status, 'released')
  assert.equal((await quota.release(first.id)).status, 'released')
  assert.equal((await quota.getBalance(user.id)).credits, 2)

  const confirmed = await quota.reserve(user.id, 'confirmed-generation')
  assert.equal((await quota.confirm(confirmed.id)).status, 'confirmed')
  assert.equal((await quota.release(confirmed.id)).status, 'confirmed')
  assert.equal((await quota.getBalance(user.id)).credits, 1)
})

test('credit references are idempotent but reject conflicting payment data', { skip: !testConnectionString }, async (t) => {
  const { quota, user } = await withQuota(t)
  const first = await quota.grantCredits(user.id, { source: 'pack', units: 10, reference: 'payment-order-42' })
  assert.deepEqual(
    await quota.grantCredits(user.id, { source: 'pack', units: 10, reference: 'payment-order-42' }),
    first,
  )
  assert.equal((await quota.getBalance(user.id)).credits, 10)
  await assert.rejects(
    () => quota.grantCredits(user.id, { source: 'pack', units: 60, reference: 'payment-order-42' }),
    (error) => error instanceof QuotaError && error.reason === 'CREDIT_GRANT_CONFLICT',
  )
})

test('expired subscriptions and grants do not authorize a generation', { skip: !testConnectionString }, async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })
  await quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  await quota.setSubscription(user.id, {
    planId: 'pro',
    status: 'active',
    periodEnd: '2026-08-25T12:00:00.000Z',
  })
  await quota.grantCredits(user.id, {
    source: 'subscription',
    units: 100,
    expiresAt: '2026-08-25T12:00:00.000Z',
    reference: 'expired-pro',
  })
  assert.equal((await quota.getBalance(user.id)).subscriber, false)
  assert.equal((await quota.getBalance(user.id)).credits, 0)
  await assert.rejects(() => quota.reserve(user.id, 'expired-generation'), /额度不足/)
})

test('abandoned reservations expire and restore paid credits automatically', { skip: !testConnectionString }, async (t) => {
  let now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now, reservationTtlSeconds: 900 })
  await quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  await quota.grantCredits(user.id, { source: 'pack', units: 2, reference: 'timeout-pack' })
  const abandoned = await quota.reserve(user.id, 'abandoned-generation')
  assert.equal((await quota.getBalance(user.id)).credits, 1)

  now = new Date('2026-08-26T12:15:01.000Z')
  assert.equal((await quota.getBalance(user.id)).credits, 2)
  assert.equal((await quota.release(abandoned.id)).status, 'released')
  assert.equal((await quota.reserve(user.id, 'next-generation')).source, 'pack')
})

test('reservation lookup applies expiry before generation recovery', { skip: !testConnectionString }, async (t) => {
  let now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now, reservationTtlSeconds: 900 })
  await quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  await quota.grantCredits(user.id, { source: 'pack', units: 1, reference: 'recovery-pack' })
  const reservation = await quota.reserve(user.id, 'recovery-generation')
  assert.equal((await quota.getReservation(reservation.id)).status, 'reserved')

  now = new Date('2026-08-26T12:15:01.000Z')
  assert.equal((await quota.getReservation(reservation.id)).status, 'released')
  assert.equal((await quota.getBalance(user.id)).credits, 1)
})

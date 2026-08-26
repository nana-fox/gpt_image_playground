import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createQuotaStore, QuotaError } from './quotaStore.mjs'
import { createSessionStore } from './sessionStore.mjs'

const identity = {
  subject: '019c0000-0000-7000-8000-000000000042',
  email: 'studio@example.com',
  display_name: 'Studio User',
}

async function withQuota(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nanafox-studio-quota-'))
  const filename = join(dir, 'studio.db')
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const sessionStore = createSessionStore({ filename })
  const user = sessionStore.createSession(identity).user
  sessionStore.close()
  const quota = createQuotaStore({ filename, ...options })
  t.after(() => quota.close())
  return { quota, user }
}

test('free users receive three configurable daily generations by default', async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })

  assert.deepEqual(quota.getPolicy(), {
    enabled: true,
    dailyLimit: 3,
    timezone: 'Asia/Shanghai',
    version: 1,
  })
  assert.deepEqual(quota.getBalance(user.id), {
    free: { eligible: true, enabled: true, limit: 3, used: 0, remaining: 3 },
    credits: 0,
    subscriber: false,
    planId: null,
  })

  assert.equal(quota.reserve(user.id, 'generation-1').source, 'free')
  assert.equal(quota.reserve(user.id, 'generation-2').source, 'free')
  assert.equal(quota.reserve(user.id, 'generation-3').source, 'free')
  assert.throws(
    () => quota.reserve(user.id, 'generation-4'),
    (error) => error instanceof QuotaError && error.reason === 'QUOTA_EXHAUSTED',
  )
})

test('operators can disable or change the daily free policy', async (t) => {
  const { quota, user } = await withQuota(t)

  const updated = quota.setPolicy({ enabled: false, dailyLimit: 5, timezone: 'Asia/Shanghai' })
  assert.equal(updated.version, 2)
  assert.deepEqual(quota.getBalance(user.id).free, {
    eligible: true,
    enabled: false,
    limit: 5,
    used: 0,
    remaining: 0,
  })
  assert.throws(() => quota.reserve(user.id, 'disabled-free'), /额度不足/)
})

test('active subscribers consume subscription credits without stacking daily free uses', async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })
  quota.setSubscription(user.id, {
    planId: 'plus',
    status: 'active',
    periodEnd: '2026-09-26T12:00:00.000Z',
  })
  quota.grantCredits(user.id, {
    source: 'subscription',
    units: 40,
    expiresAt: '2026-09-26T12:00:00.000Z',
    reference: 'plus-2026-08',
  })

  assert.deepEqual(quota.getBalance(user.id), {
    free: { eligible: false, enabled: true, limit: 3, used: 0, remaining: 0 },
    credits: 40,
    subscriber: true,
    planId: 'plus',
  })
  assert.equal(quota.reserve(user.id, 'subscriber-generation').source, 'subscription')
  assert.equal(quota.getBalance(user.id).credits, 39)
})

test('free users use a purchased pack only after the daily allowance', async (t) => {
  const { quota, user } = await withQuota(t)
  quota.setPolicy({ enabled: true, dailyLimit: 1, timezone: 'Asia/Shanghai' })
  quota.grantCredits(user.id, {
    source: 'pack',
    units: 10,
    reference: 'pack-order-42',
  })

  assert.equal(quota.reserve(user.id, 'free-first').source, 'free')
  assert.equal(quota.reserve(user.id, 'pack-second').source, 'pack')
  assert.equal(quota.getBalance(user.id).credits, 9)
})

test('reservations are idempotent and release restores the exact source', async (t) => {
  const { quota, user } = await withQuota(t)
  quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  quota.grantCredits(user.id, {
    source: 'pack',
    units: 2,
    reference: 'pack-order-43',
  })

  const first = quota.reserve(user.id, 'same-generation')
  const again = quota.reserve(user.id, 'same-generation')
  assert.deepEqual(again, first)
  assert.equal(quota.getBalance(user.id).credits, 1)

  assert.equal(quota.release(first.id).status, 'released')
  assert.equal(quota.release(first.id).status, 'released')
  assert.equal(quota.getBalance(user.id).credits, 2)

  const confirmed = quota.reserve(user.id, 'confirmed-generation')
  assert.equal(quota.confirm(confirmed.id).status, 'confirmed')
  assert.equal(quota.release(confirmed.id).status, 'confirmed')
  assert.equal(quota.getBalance(user.id).credits, 1)
})

test('expired subscriptions and grants do not authorize a generation', async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { quota, user } = await withQuota(t, { clock: () => now })
  quota.setPolicy({ enabled: false, dailyLimit: 3, timezone: 'Asia/Shanghai' })
  quota.setSubscription(user.id, {
    planId: 'pro',
    status: 'active',
    periodEnd: '2026-08-25T12:00:00.000Z',
  })
  quota.grantCredits(user.id, {
    source: 'subscription',
    units: 100,
    expiresAt: '2026-08-25T12:00:00.000Z',
    reference: 'expired-pro',
  })

  assert.equal(quota.getBalance(user.id).subscriber, false)
  assert.equal(quota.getBalance(user.id).credits, 0)
  assert.throws(() => quota.reserve(user.id, 'expired-generation'), /额度不足/)
})

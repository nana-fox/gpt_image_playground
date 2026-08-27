import assert from 'node:assert/strict'
import test from 'node:test'

import { createPaymentStore, PaymentStoreError } from './paymentStore.mjs'
import { testConnectionString, withPostgres } from './postgresTest.mjs'
import { createQuotaStore } from './quotaStore.mjs'
import { createSessionStore } from './sessionStore.mjs'

const now = new Date('2026-08-28T08:00:00.000Z')
const identity = {
  subject: '019c0000-0000-7000-8000-000000000199',
  email: 'payment@example.com',
  display_name: 'Payment User',
}

async function withPayments(t) {
  const database = await withPostgres(t)
  const sessions = createSessionStore({ database })
  const user = (await sessions.createSession(identity)).user
  const store = createPaymentStore({
    database,
    clock: () => now,
    providerIdentity: { appId: 'wx-studio-app', mchId: '1900000001' },
  })
  return { database, store, user, quota: createQuotaStore({ database, clock: () => now }) }
}

test('operators configure draft plans with optimistic versions', { skip: !testConnectionString }, async (t) => {
  const { store } = await withPayments(t)
  assert.deepEqual(await store.listPlans(), [])
  const drafts = await store.listAdminPlans()
  assert.deepEqual(drafts.map((plan) => plan.id), ['plus', 'pro', 'pack-60'])

  const plus = await store.updatePlan('plus', {
    name: '创作 Plus',
    description: '适合持续内容创作',
    priceCents: 2900,
    credits: 100,
    durationDays: 30,
    enabled: true,
    sortOrder: 10,
    expectedVersion: 1,
  }, { actorSubject: identity.subject })
  assert.equal(plus.version, 2)
  assert.deepEqual((await store.listPlans()).map((plan) => plan.id), ['plus'])

  await assert.rejects(
    () => store.updatePlan('plus', { ...plus, expectedVersion: 1 }, { actorSubject: identity.subject }),
    (error) => error instanceof PaymentStoreError && error.reason === 'PLAN_VERSION_CONFLICT',
  )
})

test('pack fulfillment is atomic and duplicate callbacks never duplicate credits', { skip: !testConnectionString }, async (t) => {
  const { database, store, user, quota } = await withPayments(t)
  const pack = (await store.listAdminPlans()).find((plan) => plan.id === 'pack-60')
  await store.updatePlan('pack-60', { ...pack, enabled: true, expectedVersion: pack.version }, { actorSubject: identity.subject })

  const created = await store.createOrder({
    id: 'order-pack-1',
    userId: user.id,
    planId: 'pack-60',
    idempotencyKey: 'checkout-pack-1',
    outTradeNo: 'studio_pack_1',
    expiresAt: '2026-08-28T08:15:00.000Z',
  })
  assert.equal(created.created, true)
  const replay = await store.createOrder({
    id: 'unused-order-id',
    userId: user.id,
    planId: 'pack-60',
    idempotencyKey: 'checkout-pack-1',
    outTradeNo: 'unused_out_trade_no',
    expiresAt: '2026-08-28T08:15:00.000Z',
  })
  assert.equal(replay.created, false)
  assert.equal(replay.order.id, 'order-pack-1')

  const notification = {
    eventId: 'wx-event-pack-1',
    outTradeNo: 'studio_pack_1',
    transactionId: 'wx-transaction-pack-1',
    amountCents: created.order.amountCents,
    currency: 'CNY',
    appId: 'wx-studio-app',
    mchId: '1900000001',
  }
  assert.equal((await store.fulfillOrder(notification)).status, 'completed')
  assert.equal((await store.fulfillOrder(notification)).status, 'completed')
  assert.equal((await quota.getBalance(user.id)).credits, created.order.plan.credits)
  const grants = await database.query('SELECT COUNT(*)::INTEGER AS count FROM studio_credit_grants WHERE reference = $1', ['payment:order-pack-1'])
  assert.equal(Number(grants.rows[0].count), 1)
})

test('subscription fulfillment activates the plan and rejects changed amounts', { skip: !testConnectionString }, async (t) => {
  const { database, store, user, quota } = await withPayments(t)
  const plus = (await store.listAdminPlans()).find((plan) => plan.id === 'plus')
  await store.updatePlan('plus', { ...plus, enabled: true, expectedVersion: plus.version }, { actorSubject: identity.subject })
  const created = await store.createOrder({
    id: 'order-subscription-1',
    userId: user.id,
    planId: 'plus',
    idempotencyKey: 'checkout-subscription-1',
    outTradeNo: 'studio_subscription_1',
    expiresAt: '2026-08-28T08:15:00.000Z',
  })
  const notification = {
    eventId: 'wx-event-subscription-1',
    outTradeNo: 'studio_subscription_1',
    transactionId: 'wx-transaction-subscription-1',
    amountCents: created.order.amountCents + 1,
    currency: 'CNY',
    appId: 'wx-studio-app',
    mchId: '1900000001',
  }
  await assert.rejects(
    () => store.fulfillOrder(notification),
    (error) => error instanceof PaymentStoreError && error.reason === 'PAYMENT_AMOUNT_MISMATCH',
  )
  assert.equal((await quota.getBalance(user.id)).subscriber, false)

  const completed = await store.fulfillOrder({ ...notification, amountCents: created.order.amountCents })
  assert.equal(completed.status, 'completed')
  const balance = await quota.getBalance(user.id)
  assert.equal(balance.subscriber, true)
  assert.equal(balance.planId, 'plus')
  assert.equal(balance.credits, created.order.plan.credits)
  const subscription = await database.query('SELECT current_period_end FROM studio_subscriptions WHERE user_id = $1', [user.id])
  assert.equal(Number(subscription.rows[0].current_period_end), Date.parse('2026-09-27T08:00:00.000Z'))
})

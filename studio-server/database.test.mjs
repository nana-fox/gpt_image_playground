import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioDatabase } from './database.mjs'
import { createPostgresTestConnection } from './postgresTest.mjs'

const connectionString = process.env.STUDIO_TEST_DATABASE_URL

test('migrates a PostgreSQL database with the Studio defaults', { skip: !connectionString }, async (t) => {
  const postgres = await createPostgresTestConnection()
  const database = createStudioDatabase({ connectionString: postgres.connectionString })
  t.after(async () => {
    await database.close()
    await postgres.cleanup()
  })
  await database.ready

  const tables = await database.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema() AND tablename LIKE 'studio_%'
    ORDER BY tablename
  `)
  assert.deepEqual(tables.rows.map((row) => row.tablename), [
    'studio_admin_audit_log',
    'studio_credit_grants',
    'studio_generation_tasks',
    'studio_payment_events',
    'studio_payment_orders',
    'studio_payment_plans',
    'studio_quota_policy',
    'studio_quota_reservations',
    'studio_schema_migrations',
    'studio_sessions',
    'studio_subscriptions',
    'studio_users',
  ])

  const policy = await database.query(`
    SELECT enabled, daily_limit, timezone, version
    FROM studio_quota_policy
    WHERE id = 1
  `)
  assert.deepEqual(policy.rows, [{ enabled: true, daily_limit: 3, timezone: 'Asia/Shanghai', version: 1 }])

  const plans = await database.query('SELECT id, enabled FROM studio_payment_plans ORDER BY sort_order')
  assert.deepEqual(plans.rows, [
    { id: 'plus', enabled: false },
    { id: 'pro', enabled: false },
    { id: 'pack-60', enabled: false },
  ])
})

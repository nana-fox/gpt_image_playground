import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import pg from 'pg'

import { createStudioDatabase } from './database.mjs'
import { createPostgresTestConnection } from './postgresTest.mjs'

const { Pool } = pg
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
    'studio_auth_rate_limits',
    'studio_credit_grants',
    'studio_generation_channel',
    'studio_generation_tasks',
    'studio_inspirations',
    'studio_payment_channel',
    'studio_payment_events',
    'studio_payment_orders',
    'studio_payment_plans',
    'studio_payment_providers',
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

  const channel = await database.query('SELECT accepting_orders, version FROM studio_payment_channel WHERE id = 1')
  assert.deepEqual(channel.rows, [{ accepting_orders: false, version: 1 }])

  const generationChannel = await database.query('SELECT accepting_generations, version FROM studio_generation_channel WHERE id = 1')
  assert.deepEqual(generationChannel.rows, [{ accepting_generations: true, version: 1 }])

  const providers = await database.query('SELECT id, provider_key, enabled FROM studio_payment_providers ORDER BY id')
  assert.deepEqual(providers.rows, [
    { id: 'alipay-default', provider_key: 'alipay', enabled: false },
    { id: 'wxpay-default', provider_key: 'wxpay', enabled: false },
  ])

  const retentionColumns = await database.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'studio_generation_tasks'
      AND column_name IN ('deleted_at', 'purge_after', 'purged_at')
    ORDER BY column_name
  `)
  assert.deepEqual(retentionColumns.rows.map((row) => row.column_name), ['deleted_at', 'purge_after', 'purged_at'])

  const inspirations = await database.query(`
    SELECT id, enabled, featured
    FROM studio_inspirations
    ORDER BY sort_order, id
  `)
  assert.deepEqual(inspirations.rows.map((row) => row.id), [
    'product', 'portrait', 'social', 'illustration', 'interior', 'perfume', 'alley', 'flowers', 'cat',
  ])
  assert.equal(inspirations.rows.every((row) => row.enabled), true)
  assert.deepEqual(inspirations.rows.filter((row) => row.featured).map((row) => row.id), [
    'product', 'portrait', 'social', 'illustration', 'interior',
  ])
})

test('generation reliability migration reconciles duplicate active tasks without touching stored outputs', { skip: !connectionString }, async (t) => {
  const postgres = await createPostgresTestConnection()
  const pool = new Pool({ connectionString: postgres.connectionString })
  t.after(async () => {
    await pool.end().catch(() => {})
    await postgres.cleanup()
  })
  await pool.query(`
    CREATE TABLE studio_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `)
  for (const migration of ['001_initial.sql', '002_admin_operations.sql', '003_payments.sql', '004_payment_channel.sql', '005_auth_rate_limits.sql', '006_artwork_retention.sql', '007_inspirations.sql']) {
    await pool.query(await readFile(new URL(`./migrations/${migration}`, import.meta.url), 'utf8'))
    await pool.query('INSERT INTO studio_schema_migrations (version, applied_at) VALUES ($1, 0)', [Number(migration.slice(0, 3))])
  }
  await pool.query(`
    INSERT INTO studio_users (id, identity_subject, email, display_name, created_at, updated_at)
    VALUES ('migration-user', 'migration-subject', 'migration@example.com', 'Migration', 0, 0);

    INSERT INTO studio_credit_grants (id, user_id, source, total, remaining, expires_at, reference, created_at)
    VALUES ('migration-grant', 'migration-user', 'pack', 2, 0, NULL, 'migration-pack', 0);

    INSERT INTO studio_quota_reservations
      (id, user_id, idempotency_key, source, grant_id, day_key, status, expires_at, created_at, updated_at)
    VALUES
      ('reservation-running', 'migration-user', 'running', 'pack', 'migration-grant', NULL, 'reserved', 999999, 0, 0),
      ('reservation-extra', 'migration-user', 'reserved', 'pack', 'migration-grant', NULL, 'reserved', 999999, 0, 0),
      ('reservation-output-a', 'migration-user', 'output-a', 'free', NULL, '2026-08-28', 'confirmed', 999999, 0, 0),
      ('reservation-output-b', 'migration-user', 'output-b', 'free', NULL, '2026-08-28', 'confirmed', 999999, 0, 0);

    INSERT INTO studio_generation_tasks
      (id, user_id, idempotency_key, prompt, size, quality, status, reservation_id, output_json, created_at, updated_at)
    VALUES
      ('task-created', 'migration-user', 'created', 'created', '1024x1024', 'high', 'created', NULL, NULL, 1000, 1000),
      ('task-reserved', 'migration-user', 'reserved', 'reserved', '1024x1024', 'high', 'reserved', 'reservation-extra', NULL, 2000, 2000),
      ('task-running', 'migration-user', 'running', 'running', '1024x1024', 'high', 'running', 'reservation-running', NULL, 3000, 3000),
      ('task-output-a', 'migration-user', 'output-a', 'output-a', '1024x1024', 'high', 'output_stored', 'reservation-output-a', '{"key":"a.png"}', 4000, 4000),
      ('task-output-b', 'migration-user', 'output-b', 'output-b', '1024x1024', 'high', 'output_stored', 'reservation-output-b', '{"key":"b.png"}', 5000, 5000);
  `)
  await pool.end()

  const database = createStudioDatabase({ connectionString: postgres.connectionString })
  t.after(() => database.close())
  await database.ready

  const tasks = await database.query(`
    SELECT id, status, error_reason
    FROM studio_generation_tasks
    ORDER BY id
  `)
  assert.deepEqual(tasks.rows, [
    { id: 'task-created', status: 'failed', error_reason: 'GENERATION_RECOVERY_TIMEOUT' },
    { id: 'task-output-a', status: 'output_stored', error_reason: null },
    { id: 'task-output-b', status: 'output_stored', error_reason: null },
    { id: 'task-reserved', status: 'failed', error_reason: 'GENERATION_RECOVERY_TIMEOUT' },
    { id: 'task-running', status: 'running', error_reason: null },
  ])
  const reservations = await database.query(`
    SELECT id, status
    FROM studio_quota_reservations
    WHERE id IN ('reservation-running', 'reservation-extra')
    ORDER BY id
  `)
  assert.deepEqual(reservations.rows, [
    { id: 'reservation-extra', status: 'released' },
    { id: 'reservation-running', status: 'reserved' },
  ])
  assert.equal((await database.query("SELECT remaining FROM studio_credit_grants WHERE id = 'migration-grant'")).rows[0].remaining, 1)
})

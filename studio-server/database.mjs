import { readFile } from 'node:fs/promises'

import pg from 'pg'

const { Pool } = pg

export function createStudioDatabase(options = {}) {
  const connectionString = String(options.connectionString ?? '').trim()
  if (!connectionString) throw new Error('Studio PostgreSQL connection string is required')
  const protocol = new URL(connectionString).protocol
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('Studio PostgreSQL connection string is invalid')
  }
  const max = options.max === undefined ? 10 : Number(options.max)
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('Studio PostgreSQL pool size is invalid')

  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
    ssl: options.ssl ?? false,
  })
  const ready = migrate(pool)

  return {
    ready,

    async query(text, values) {
      await ready
      return pool.query(text, values)
    },

    async transaction(run) {
      await ready
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await run(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async close() {
      await ready.catch(() => {})
      await pool.end()
    },
  }
}

async function migrate(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [20260827, 1])
    await client.query(`
      CREATE TABLE IF NOT EXISTS studio_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )
    `)
    for (const migration of ['001_initial.sql', '002_admin_operations.sql', '003_payments.sql']) {
      const version = Number(migration.slice(0, 3))
      const applied = await client.query('SELECT version FROM studio_schema_migrations WHERE version = $1', [version])
      if (applied.rowCount) continue
      const sql = await readFile(new URL(`./migrations/${migration}`, import.meta.url), 'utf8')
      await client.query(sql)
      await client.query(
        'INSERT INTO studio_schema_migrations (version, applied_at) VALUES ($1, $2)',
        [version, Date.now()],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

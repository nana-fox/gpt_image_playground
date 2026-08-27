import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { createStudioDatabase } from './database.mjs'

const { Pool } = pg

export const testConnectionString = process.env.STUDIO_TEST_DATABASE_URL

export async function withPostgres(t) {
  if (!testConnectionString) throw new Error('STUDIO_TEST_DATABASE_URL is required')
  const schema = `studio_test_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: testConnectionString })
  await admin.query(`CREATE SCHEMA ${schema}`)

  const url = new URL(testConnectionString)
  url.searchParams.set('options', `-csearch_path=${schema}`)
  const database = createStudioDatabase({ connectionString: url.toString() })
  await database.ready
  t.after(async () => {
    await database.close()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  })
  return database
}

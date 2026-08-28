import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioDatabase } from './database.mjs'
import { createInspirationStore } from './inspirationStore.mjs'
import { createPostgresTestConnection } from './postgresTest.mjs'

const connectionString = process.env.STUDIO_TEST_DATABASE_URL

test('inspirations are seeded, versioned and audited in PostgreSQL', { skip: !connectionString }, async (t) => {
  const postgres = await createPostgresTestConnection()
  const database = createStudioDatabase({ connectionString: postgres.connectionString })
  t.after(async () => {
    await database.close()
    await postgres.cleanup()
  })
  await database.ready
  const store = createInspirationStore({ database, clock: () => new Date('2026-08-28T12:00:00.000Z') })

  const seeded = await store.listPublished()
  assert.deepEqual(seeded.map((item) => item.id), ['product', 'portrait', 'social', 'illustration', 'interior'])

  const created = await store.create({
    category: '萌宠',
    title: '午后猫咪',
    description: '温暖居家瞬间',
    prompt: '午后阳光里的橘猫',
    image: 'inspiration-interior.png',
    enabled: false,
    featured: false,
    sortOrder: 60,
  }, { actorSubject: 'admin-1' })
  assert.equal(created.version, 1)
  assert.equal((await store.listPublished()).some((item) => item.id === created.id), false)

  const updated = await store.update(created.id, {
    ...created,
    enabled: true,
    featured: true,
    expectedVersion: 1,
  }, { actorSubject: 'admin-1' })
  assert.equal(updated.version, 2)
  assert.equal((await store.listPublished()).some((item) => item.id === created.id), true)
  await assert.rejects(() => store.update(created.id, {
    ...updated,
    expectedVersion: 1,
  }, { actorSubject: 'admin-1' }), (error) => error.reason === 'INSPIRATION_VERSION_CONFLICT')

  const audit = await database.query(`
    SELECT action, reference
    FROM studio_admin_audit_log
    WHERE reference = $1
    ORDER BY created_at, action
  `, [created.id])
  assert.deepEqual(audit.rows, [
    { action: 'inspiration.create', reference: created.id },
    { action: 'inspiration.update', reference: created.id },
  ])
})

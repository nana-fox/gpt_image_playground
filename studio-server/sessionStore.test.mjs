import assert from 'node:assert/strict'
import test from 'node:test'

import { testConnectionString, withPostgres } from './postgresTest.mjs'
import { createSessionStore } from './sessionStore.mjs'

const identity = {
  subject: '019c0000-0000-7000-8000-000000000042',
  email: 'studio@example.com',
  display_name: 'Studio User',
}

async function withStore(t, options = {}) {
  const database = await withPostgres(t)
  const store = createSessionStore({
    database,
    ...options,
  })
  return { database, store }
}

test('Studio creates its own durable session keyed by the Router subject', { skip: !testConnectionString }, async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { store } = await withStore(t, {
    clock: () => now,
    randomBytes: (size) => Buffer.alloc(size, 7),
  })

  const created = await store.createSession(identity)
  const session = await store.getSession(created.sessionToken)

  assert.equal(created.sessionToken.length, 64)
  assert.equal(created.csrfToken.length, 64)
  assert.deepEqual(session.user, {
    id: created.user.id,
    identitySubject: identity.subject,
    email: identity.email,
    displayName: identity.display_name,
  })
  assert.equal(session.expiresAt, '2026-09-25T12:00:00.000Z')
  assert.equal(await store.verifyCsrf(created.sessionToken, created.csrfToken), true)
  assert.equal(await store.verifyCsrf(created.sessionToken, '0'.repeat(64)), false)
})

test('Studio stores only hashes of session and CSRF credentials', { skip: !testConnectionString }, async (t) => {
  const { database, store } = await withStore(t, {
    randomBytes: (size) => Buffer.alloc(size, 9),
  })
  const created = await store.createSession(identity)

  const rows = await database.query('SELECT token_hash, csrf_hash FROM studio_sessions')
  assert.equal(rows.rows[0].token_hash.includes(created.sessionToken), false)
  assert.equal(rows.rows[0].csrf_hash.includes(created.csrfToken), false)
})

test('Studio updates identity metadata without duplicating the local user', { skip: !testConnectionString }, async (t) => {
  const { store } = await withStore(t)
  const first = await store.createSession(identity)
  const second = await store.createSession({
    ...identity,
    email: 'new-address@example.com',
    display_name: 'Updated Name',
  })

  assert.equal(second.user.id, first.user.id)
  assert.equal((await store.getSession(second.sessionToken)).user.email, 'new-address@example.com')
  assert.equal((await store.getSession(second.sessionToken)).user.displayName, 'Updated Name')
})

test('expired and deleted Studio sessions cannot be used', { skip: !testConnectionString }, async (t) => {
  let now = new Date('2026-08-26T12:00:00.000Z')
  const { store } = await withStore(t, {
    clock: () => now,
    ttlSeconds: 60,
  })
  const expired = await store.createSession(identity)
  now = new Date('2026-08-26T12:01:01.000Z')

  assert.equal(await store.getSession(expired.sessionToken), null)
  assert.equal(await store.verifyCsrf(expired.sessionToken, expired.csrfToken), false)

  const active = await store.createSession(identity)
  assert.equal(await store.deleteSession(active.sessionToken), true)
  assert.equal(await store.getSession(active.sessionToken), null)
})

test('invalid Router identity data is rejected before persistence', { skip: !testConnectionString }, async (t) => {
  const { store } = await withStore(t)

  await assert.rejects(() => store.createSession({ ...identity, subject: '' }), /subject/)
  await assert.rejects(() => store.createSession({ ...identity, email: 'not-an-email' }), /email/)
})

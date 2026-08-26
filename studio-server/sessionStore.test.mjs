import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createSessionStore } from './sessionStore.mjs'

const identity = {
  subject: '019c0000-0000-7000-8000-000000000042',
  email: 'studio@example.com',
  display_name: 'Studio User',
}

async function withStore(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nanafox-studio-session-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = createSessionStore({
    filename: join(dir, 'studio.db'),
    ...options,
  })
  t.after(() => store.close())
  return { store, filename: join(dir, 'studio.db') }
}

test('Studio creates its own durable session keyed by the Router subject', async (t) => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const { store } = await withStore(t, {
    clock: () => now,
    randomBytes: (size) => Buffer.alloc(size, 7),
  })

  const created = store.createSession(identity)
  const session = store.getSession(created.sessionToken)

  assert.equal(created.sessionToken.length, 64)
  assert.equal(created.csrfToken.length, 64)
  assert.deepEqual(session.user, {
    id: created.user.id,
    identitySubject: identity.subject,
    email: identity.email,
    displayName: identity.display_name,
  })
  assert.equal(session.expiresAt, '2026-09-25T12:00:00.000Z')
  assert.equal(store.verifyCsrf(created.sessionToken, created.csrfToken), true)
  assert.equal(store.verifyCsrf(created.sessionToken, '0'.repeat(64)), false)
})

test('Studio stores only hashes of session and CSRF credentials', async (t) => {
  const { store, filename } = await withStore(t, {
    randomBytes: (size) => Buffer.alloc(size, 9),
  })
  const created = store.createSession(identity)

  store.close()
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(filename))
  assert.equal(bytes.includes(Buffer.from(created.sessionToken)), false)
  assert.equal(bytes.includes(Buffer.from(created.csrfToken)), false)
})

test('Studio updates identity metadata without duplicating the local user', async (t) => {
  const { store } = await withStore(t)
  const first = store.createSession(identity)
  const second = store.createSession({
    ...identity,
    email: 'new-address@example.com',
    display_name: 'Updated Name',
  })

  assert.equal(second.user.id, first.user.id)
  assert.equal(store.getSession(second.sessionToken).user.email, 'new-address@example.com')
  assert.equal(store.getSession(second.sessionToken).user.displayName, 'Updated Name')
})

test('expired and deleted Studio sessions cannot be used', async (t) => {
  let now = new Date('2026-08-26T12:00:00.000Z')
  const { store } = await withStore(t, {
    clock: () => now,
    ttlSeconds: 60,
  })
  const expired = store.createSession(identity)
  now = new Date('2026-08-26T12:01:01.000Z')

  assert.equal(store.getSession(expired.sessionToken), null)
  assert.equal(store.verifyCsrf(expired.sessionToken, expired.csrfToken), false)

  const active = store.createSession(identity)
  assert.equal(store.deleteSession(active.sessionToken), true)
  assert.equal(store.getSession(active.sessionToken), null)
})

test('invalid Router identity data is rejected before persistence', async (t) => {
  const { store } = await withStore(t)

  assert.throws(() => store.createSession({ ...identity, subject: '' }), /subject/)
  assert.throws(() => store.createSession({ ...identity, email: 'not-an-email' }), /email/)
})

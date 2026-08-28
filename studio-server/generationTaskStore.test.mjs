import assert from 'node:assert/strict'
import test from 'node:test'

import { createGenerationTaskStore, TaskStoreError } from './generationTaskStore.mjs'
import { testConnectionString, withPostgres } from './postgresTest.mjs'
import { createSessionStore } from './sessionStore.mjs'

const input = {
  prompt: '月光下的银色狐狸',
  size: '1024x1024',
  quality: 'high',
}

async function withDatabase(t) {
  const database = await withPostgres(t)
  const sessions = createSessionStore({ database })
  const user = (await sessions.createSession({
    subject: '019c0000-0000-7000-8000-000000000051',
    email: 'creator@example.com',
    display_name: 'Creator',
  })).user
  const other = (await sessions.createSession({
    subject: '019c0000-0000-7000-8000-000000000052',
    email: 'other@example.com',
    display_name: 'Other',
  })).user
  return { database, sessions, user, other }
}

test('generation tasks persist the successful lifecycle without image bytes', { skip: !testConnectionString }, async (t) => {
  const { database, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ database })
  const created = await tasks.createTask(user.id, input, 'request-51')
  assert.equal(created.created, true)
  assert.equal(created.task.status, 'created')
  assert.equal(created.task.userId, user.id)
  assert.deepEqual(created.task.input, input)

  await tasks.markReserved(created.task.id, 'reservation-51')
  await tasks.markRunning(created.task.id)
  await tasks.storeOutput(created.task.id, {
    key: `${user.id}/${created.task.id}.png`,
    url: `/api/artworks/${created.task.id}`,
    revisedPrompt: '银色狐狸站在月光下',
    usage: { inputTokens: 9, outputTokens: 42 },
  })
  const succeeded = await tasks.succeed(created.task.id)
  assert.equal(succeeded.status, 'succeeded')
  assert.equal(succeeded.reservationId, 'reservation-51')
  assert.equal(succeeded.output.url, `/api/artworks/${created.task.id}`)
  assert.equal(JSON.stringify(succeeded).includes('base64'), false)
})

test('R2 output metadata survives a PostgreSQL JSONB round trip', { skip: !testConnectionString }, async (t) => {
  const { database, user } = await withDatabase(t)
  const first = createGenerationTaskStore({ database })
  const task = (await first.createTask(user.id, input, 'r2-metadata')).task
  await first.markReserved(task.id, 'reservation-r2-metadata')
  await first.markRunning(task.id)
  const output = {
    key: `${user.id}/${task.id}.png`,
    url: `/api/artworks/${task.id}`,
    etag: '68b329da9893e34099c7d8ad5cb9c940',
    sha256: 'a'.repeat(64),
    bytes: 1024,
    mimeType: 'image/png',
  }
  await first.storeOutput(task.id, output)

  const reopened = createGenerationTaskStore({ database })
  assert.deepEqual((await reopened.getTask(user.id, task.id)).output, output)
})

test('R2 output metadata is validated before persistence', () => {
  const tasks = createGenerationTaskStore({ database: { query() {} } })
  const output = {
    key: 'user/task.png',
    url: '/api/artworks/task',
    etag: 'etag-1',
    sha256: 'a'.repeat(64),
    bytes: 1024,
    mimeType: 'image/png',
  }

  assert.throws(() => tasks.storeOutput('task', { ...output, sha256: 'not-a-hash' }), /output metadata/)
  assert.throws(() => tasks.storeOutput('task', { ...output, bytes: 0 }), /output metadata/)
  assert.throws(() => tasks.storeOutput('task', { ...output, mimeType: 'image/jpeg' }), /output metadata/)
  assert.throws(() => tasks.storeOutput('task', { ...output, etag: ' '.repeat(3) }), /output metadata/)
})

test('generation task idempotency rejects a changed request', { skip: !testConnectionString }, async (t) => {
  const { database, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ database })
  const first = await tasks.createTask(user.id, input, 'same-request')
  const replay = await tasks.createTask(user.id, { ...input }, 'same-request')
  assert.equal(replay.created, false)
  assert.deepEqual(replay.task, first.task)
  await assert.rejects(
    () => tasks.createTask(user.id, { ...input, prompt: '另一张图' }, 'same-request'),
    (error) => error instanceof TaskStoreError && error.reason === 'IDEMPOTENCY_CONFLICT',
  )
})

test('PostgreSQL allows only one active generation per user under concurrency', { skip: !testConnectionString }, async (t) => {
  const { database, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ database })
  const results = await Promise.allSettled([
    tasks.createTask(user.id, input, 'concurrent-a'),
    tasks.createTask(user.id, { ...input, prompt: '另一张并发图片' }, 'concurrent-b'),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')

  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason instanceof TaskStoreError, true)
  assert.equal(rejected[0].reason.reason, 'GENERATION_BUSY')

  await tasks.fail(fulfilled[0].value.task.id, 'IMAGE_PROVIDER_TIMEOUT')
  assert.equal((await tasks.createTask(user.id, input, 'after-terminal')).created, true)
})

test('task reads and lists are scoped to their owner', { skip: !testConnectionString }, async (t) => {
  const { database, user, other } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ database })
  const mine = (await tasks.createTask(user.id, input, 'mine')).task
  await tasks.createTask(other.id, input, 'theirs')

  assert.equal((await tasks.getTask(user.id, mine.id)).id, mine.id)
  assert.equal(await tasks.getTask(other.id, mine.id), null)
  assert.deepEqual((await tasks.listTasks(user.id)).map((task) => task.id), [mine.id])
  assert.equal((await tasks.listTasks(other.id)).length, 1)
})

test('task state transitions reject skipped or terminal rewrites', { skip: !testConnectionString }, async (t) => {
  const { database, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ database })
  const task = (await tasks.createTask(user.id, input, 'state-machine')).task
  await assert.rejects(
    () => tasks.markRunning(task.id),
    (error) => error instanceof TaskStoreError && error.reason === 'INVALID_TASK_STATE',
  )
  await tasks.fail(task.id, 'IMAGE_PROVIDER_TIMEOUT')
  await assert.rejects(
    () => tasks.markReserved(task.id, 'too-late'),
    (error) => error instanceof TaskStoreError && error.reason === 'INVALID_TASK_STATE',
  )
})

test('tasks survive a store restart and expose pending finalization', { skip: !testConnectionString }, async (t) => {
  const { database, user } = await withDatabase(t)
  const first = createGenerationTaskStore({ database })
  const task = (await first.createTask(user.id, input, 'durable')).task
  await first.markReserved(task.id, 'reservation-durable')
  await first.markRunning(task.id)
  await first.storeOutput(task.id, {
    key: `${user.id}/${task.id}.png`,
    url: `/api/artworks/${task.id}`,
  })

  const reopened = createGenerationTaskStore({ database })
  assert.equal((await reopened.getTask(user.id, task.id)).status, 'output_stored')
  assert.deepEqual((await reopened.listFinalizationPending()).map((item) => item.id), [task.id])
})

test('stale active recovery excludes fresh and output-stored tasks', { skip: !testConnectionString }, async (t) => {
  const { database, sessions, user, other } = await withDatabase(t)
  let now = new Date('2026-08-28T12:00:00.000Z')
  const tasks = createGenerationTaskStore({ database, clock: () => now })
  const extraUsers = []
  for (let idx = 0; idx < 3; idx += 1) {
    extraUsers.push((await sessions.createSession({
      subject: `019c0000-0000-7000-8000-00000000006${idx}`,
      email: `creator-${idx}@example.com`,
      display_name: `Creator ${idx}`,
    })).user)
  }

  const created = (await tasks.createTask(user.id, input, 'stale-created')).task
  const reserved = (await tasks.createTask(other.id, input, 'stale-reserved')).task
  await tasks.markReserved(reserved.id, 'reservation-stale')
  const running = (await tasks.createTask(extraUsers[0].id, input, 'stale-running')).task
  await tasks.markReserved(running.id, 'reservation-running')
  await tasks.markRunning(running.id)
  const output = (await tasks.createTask(extraUsers[1].id, input, 'output-stored')).task
  await tasks.markReserved(output.id, 'reservation-output')
  await tasks.markRunning(output.id)
  await tasks.storeOutput(output.id, { key: `${extraUsers[1].id}/${output.id}.png`, url: `/api/artworks/${output.id}` })

  now = new Date('2026-08-28T12:16:00.000Z')
  const fresh = (await tasks.createTask(extraUsers[2].id, input, 'fresh-created')).task
  const stale = await tasks.listStaleActive(now.getTime() - 900_000)

  assert.deepEqual(new Set(stale.map((task) => task.id)), new Set([created.id, reserved.id, running.id]))
  assert.equal(stale.some((task) => task.id === output.id), false)
  assert.equal(stale.some((task) => task.id === fresh.id), false)
})

test('soft-deleted tasks are owner-scoped, restorable for seven days, and purge safely', { skip: !testConnectionString }, async (t) => {
  const { database, user, other } = await withDatabase(t)
  let now = new Date('2026-08-28T12:00:00.000Z')
  const tasks = createGenerationTaskStore({ database, clock: () => now })
  const task = (await tasks.createTask(user.id, input, 'retention')).task
  await tasks.markReserved(task.id, 'reservation-retention')
  await tasks.markRunning(task.id)
  await tasks.storeOutput(task.id, { key: `${user.id}/${task.id}.png`, url: `/api/artworks/${task.id}` })
  await tasks.succeed(task.id)

  assert.equal(await tasks.deleteTask(other.id, task.id), null)
  const deleted = await tasks.deleteTask(user.id, task.id)
  assert.equal(deleted.deletedAt, now.toISOString())
  assert.equal(deleted.purgeAt, '2026-09-04T12:00:00.000Z')
  assert.deepEqual(await tasks.listTasks(user.id), [])
  assert.deepEqual((await tasks.listTasks(user.id, { deleted: true })).map((item) => item.id), [task.id])
  assert.equal((await tasks.getTask(user.id, task.id, { includeDeleted: true })).id, task.id)
  assert.equal(await tasks.getTask(user.id, task.id), null)

  const restored = await tasks.restoreTask(user.id, task.id)
  assert.equal(restored.deletedAt, null)
  assert.deepEqual((await tasks.listTasks(user.id)).map((item) => item.id), [task.id])

  await tasks.deleteTask(user.id, task.id)
  now = new Date('2026-09-04T12:00:00.001Z')
  assert.equal(await tasks.restoreTask(user.id, task.id), null)
  assert.deepEqual((await tasks.listPurgePending()).map((item) => item.id), [task.id])
  const purged = await tasks.purgeTask(task.id, async (output) => {
    assert.equal(output.key, `${user.id}/${task.id}.png`)
  })
  assert.equal(purged.output, null)
  assert.equal(purged.purgedAt, now.toISOString())
  assert.deepEqual(await tasks.listPurgePending(), [])
})

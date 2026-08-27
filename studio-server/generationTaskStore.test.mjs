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
  return { database, user, other }
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

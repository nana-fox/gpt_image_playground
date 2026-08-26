import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createGenerationTaskStore, TaskStoreError } from './generationTaskStore.mjs'
import { createSessionStore } from './sessionStore.mjs'

const input = {
  prompt: '月光下的银色狐狸',
  size: '1024x1024',
  quality: 'high',
}

async function withDatabase(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nanafox-studio-tasks-'))
  const filename = join(dir, 'studio.db')
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const sessions = createSessionStore({ filename })
  const user = sessions.createSession({
    subject: '019c0000-0000-7000-8000-000000000051',
    email: 'creator@example.com',
    display_name: 'Creator',
  }).user
  const other = sessions.createSession({
    subject: '019c0000-0000-7000-8000-000000000052',
    email: 'other@example.com',
    display_name: 'Other',
  }).user
  sessions.close()
  return { filename, user, other }
}

test('generation tasks persist the successful lifecycle without image bytes', async (t) => {
  const { filename, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ filename })
  t.after(() => tasks.close())

  const created = tasks.createTask(user.id, input, 'request-51')
  assert.equal(created.created, true)
  assert.equal(created.task.status, 'created')
  assert.equal(created.task.userId, user.id)
  assert.deepEqual(created.task.input, input)

  tasks.markReserved(created.task.id, 'reservation-51')
  tasks.markRunning(created.task.id)
  tasks.storeOutput(created.task.id, {
    key: `${user.id}/${created.task.id}.png`,
    url: `/api/artworks/${created.task.id}`,
    revisedPrompt: '银色狐狸站在月光下',
    usage: { inputTokens: 9, outputTokens: 42 },
  })
  const succeeded = tasks.succeed(created.task.id)

  assert.equal(succeeded.status, 'succeeded')
  assert.equal(succeeded.reservationId, 'reservation-51')
  assert.equal(succeeded.output.url, `/api/artworks/${created.task.id}`)
  assert.equal(JSON.stringify(succeeded).includes('base64'), false)
})

test('generation task idempotency rejects a changed request', async (t) => {
  const { filename, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ filename })
  t.after(() => tasks.close())

  const first = tasks.createTask(user.id, input, 'same-request')
  const replay = tasks.createTask(user.id, { ...input }, 'same-request')
  assert.equal(replay.created, false)
  assert.deepEqual(replay.task, first.task)
  assert.throws(
    () => tasks.createTask(user.id, { ...input, prompt: '另一张图' }, 'same-request'),
    (error) => error instanceof TaskStoreError && error.reason === 'IDEMPOTENCY_CONFLICT',
  )
})

test('task reads and lists are scoped to their owner', async (t) => {
  const { filename, user, other } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ filename })
  t.after(() => tasks.close())

  const mine = tasks.createTask(user.id, input, 'mine').task
  tasks.createTask(other.id, input, 'theirs')

  assert.equal(tasks.getTask(user.id, mine.id).id, mine.id)
  assert.equal(tasks.getTask(other.id, mine.id), null)
  assert.deepEqual(tasks.listTasks(user.id).map((task) => task.id), [mine.id])
  assert.equal(tasks.listTasks(other.id).length, 1)
})

test('task state transitions reject skipped or terminal rewrites', async (t) => {
  const { filename, user } = await withDatabase(t)
  const tasks = createGenerationTaskStore({ filename })
  t.after(() => tasks.close())

  const task = tasks.createTask(user.id, input, 'state-machine').task
  assert.throws(
    () => tasks.markRunning(task.id),
    (error) => error instanceof TaskStoreError && error.reason === 'INVALID_TASK_STATE',
  )
  tasks.fail(task.id, 'IMAGE_PROVIDER_TIMEOUT')
  assert.throws(
    () => tasks.markReserved(task.id, 'too-late'),
    (error) => error instanceof TaskStoreError && error.reason === 'INVALID_TASK_STATE',
  )
})

test('tasks survive a store restart and expose pending finalization', async (t) => {
  const { filename, user } = await withDatabase(t)
  const first = createGenerationTaskStore({ filename })
  const task = first.createTask(user.id, input, 'durable').task
  first.markReserved(task.id, 'reservation-durable')
  first.markRunning(task.id)
  first.storeOutput(task.id, {
    key: `${user.id}/${task.id}.png`,
    url: `/api/artworks/${task.id}`,
  })
  first.close()

  const reopened = createGenerationTaskStore({ filename })
  t.after(() => reopened.close())
  assert.equal(reopened.getTask(user.id, task.id).status, 'output_stored')
  assert.deepEqual(reopened.listFinalizationPending().map((item) => item.id), [task.id])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { createGenerationService, GenerationError } from './generationService.mjs'

const user = { id: 'local-user' }
const input = {
  prompt: '月光下的银色狐狸',
  size: '1024x1024',
  quality: 'high',
}

function createTaskStore(existing = null, events = []) {
  let task = existing
  return {
    createTask(userId, request, idempotencyKey) {
      events.push(['createTask', userId, idempotencyKey])
      if (task) return { created: false, task }
      task = { id: 'task-1', userId, idempotencyKey, status: 'created', ...request }
      return { created: true, task }
    },
    markReserved(id, reservationId) {
      events.push(['markReserved', id, reservationId])
      task = { ...task, status: 'reserved', reservationId }
      return task
    },
    markRunning(id) {
      events.push(['markRunning', id])
      task = { ...task, status: 'running' }
      return task
    },
    storeOutput(id, output) {
      events.push(['storeOutput', id, output.key])
      task = { ...task, status: 'output_stored', output }
      return task
    },
    succeed(id) {
      events.push(['succeed', id])
      task = { ...task, status: 'succeeded' }
      return task
    },
    fail(id, reason) {
      events.push(['fail', id, reason])
      task = { ...task, status: 'failed', errorReason: reason }
      return task
    },
  }
}

test('generation service reserves, stores, confirms, then exposes a successful task', async () => {
  const events = []
  const service = createGenerationService({
    tasks: createTaskStore(null, events),
    quota: {
      reserve(userId, key) {
        events.push(['reserve', userId, key])
        return { id: 'reservation-1', source: 'free', status: 'reserved' }
      },
      confirm(id) {
        events.push(['confirm', id])
      },
      release: () => assert.fail('successful generation must not release quota'),
    },
    images: {
      async generate(request) {
        events.push(['generate', request.prompt])
        return { images: [{ base64: 'aW1hZ2U=', mimeType: 'image/png' }] }
      },
    },
    outputs: {
      async save(taskId, image) {
        events.push(['save', taskId, image.mimeType])
        return { key: 'local-user/task-1.png', url: '/api/artworks/task-1' }
      },
    },
  })

  const result = await service.generate(user, input, 'request-1')

  assert.equal(result.status, 'succeeded')
  assert.equal(result.output.url, '/api/artworks/task-1')
  assert.deepEqual(events.map((event) => event[0]), [
    'createTask',
    'reserve',
    'markReserved',
    'markRunning',
    'generate',
    'save',
    'storeOutput',
    'confirm',
    'succeed',
  ])
})

test('generation failure releases the reservation and stores only a bounded reason', async () => {
  const events = []
  const service = createGenerationService({
    tasks: createTaskStore(null, events),
    quota: {
      reserve: () => ({ id: 'reservation-2', source: 'pack', status: 'reserved' }),
      confirm: () => assert.fail('failed generation must not confirm quota'),
      release(id) {
        events.push(['release', id])
      },
    },
    images: {
      async generate() {
        throw Object.assign(new Error('upstream internal details'), { reason: 'IMAGE_PROVIDER_TIMEOUT' })
      },
    },
    outputs: { save: () => assert.fail('failed generation must not store output') },
  })

  await assert.rejects(
    service.generate(user, input, 'request-2'),
    (error) => error instanceof GenerationError
      && error.reason === 'IMAGE_PROVIDER_TIMEOUT'
      && !error.message.includes('internal details'),
  )
  assert.equal(events.some((event) => event[0] === 'release' && event[1] === 'reservation-2'), true)
  assert.equal(events.some((event) => event[0] === 'fail' && event[2] === 'IMAGE_PROVIDER_TIMEOUT'), true)
})

test('successful idempotent replays never reserve quota or call the provider twice', async () => {
  const existing = {
    id: 'task-existing',
    userId: user.id,
    idempotencyKey: 'request-existing',
    status: 'succeeded',
    output: { key: 'local-user/task-existing.png', url: '/api/artworks/task-existing' },
  }
  const service = createGenerationService({
    tasks: createTaskStore(existing),
    quota: {
      reserve: () => assert.fail('replay must not reserve quota'),
      confirm: () => {},
      release: () => {},
    },
    images: { generate: () => assert.fail('replay must not call provider') },
    outputs: { save: () => assert.fail('replay must not store output') },
  })

  assert.deepEqual(await service.generate(user, input, 'request-existing'), existing)
})

test('in-flight and failed idempotent replays return stable task errors', async () => {
  for (const [status, reason] of [['running', 'GENERATION_IN_PROGRESS'], ['failed', 'GENERATION_FAILED']]) {
    const service = createGenerationService({
      tasks: createTaskStore({
        id: `task-${status}`,
        userId: user.id,
        idempotencyKey: `request-${status}`,
        status,
        errorReason: status === 'failed' ? 'IMAGE_PROVIDER_TIMEOUT' : null,
      }),
      quota: {},
      images: {},
      outputs: {},
    })

    await assert.rejects(
      service.generate(user, input, `request-${status}`),
      (error) => error instanceof GenerationError && error.reason === reason,
    )
  }
})

test('quota confirmation failure removes the orphaned output and releases the reservation', async () => {
  const events = []
  const service = createGenerationService({
    tasks: createTaskStore(null, events),
    quota: {
      reserve: () => ({ id: 'reservation-confirm-failure', source: 'pack', status: 'reserved' }),
      confirm() {
        throw new Error('database unavailable')
      },
      release(id) {
        events.push(['release', id])
      },
    },
    images: {
      async generate() {
        return { images: [{ base64: 'aW1hZ2U=', mimeType: 'image/png' }] }
      },
    },
    outputs: {
      async save() {
        return { key: 'local-user/orphan.png', url: '/api/artworks/orphan' }
      },
      async remove(output) {
        events.push(['remove', output.key])
      },
    },
  })

  await assert.rejects(service.generate(user, input, 'confirm-failure'), /没有扣除额度/)
  assert.equal(events.some((event) => event[0] === 'release'), true)
  assert.equal(events.some((event) => event[0] === 'remove'), true)
  assert.equal(events.some((event) => event[0] === 'fail'), true)
})

test('post-confirmation finalization failure never refunds a successful generation', async () => {
  const events = []
  const tasks = createTaskStore(null, events)
  tasks.succeed = () => {
    events.push(['succeed-failed'])
    throw new Error('temporary finalization failure')
  }
  const service = createGenerationService({
    tasks,
    quota: {
      reserve: () => ({ id: 'reservation-confirmed', source: 'free', status: 'reserved' }),
      confirm(id) {
        events.push(['confirm', id])
      },
      release: () => assert.fail('confirmed generation must not be refunded'),
    },
    images: {
      async generate() {
        return { images: [{ base64: 'aW1hZ2U=', mimeType: 'image/png' }] }
      },
    },
    outputs: {
      async save() {
        return { key: 'local-user/recoverable.png', url: '/api/artworks/recoverable' }
      },
      remove: () => assert.fail('confirmed output must not be removed'),
    },
  })

  await assert.rejects(
    service.generate(user, input, 'finalization-failure'),
    (error) => error instanceof GenerationError && error.reason === 'GENERATION_FINALIZATION_PENDING',
  )
  assert.equal(events.some((event) => event[0] === 'fail'), false)
})

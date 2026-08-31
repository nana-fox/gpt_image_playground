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
        return { id, source: 'free', status: 'confirmed' }
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

test('paused generation rejects before every side effect', async () => {
  const events = []
  const service = createGenerationService({
    control: {
      assertAccepting() {
        events.push(['assertAccepting'])
        throw new GenerationError('创作服务已暂停接收新任务', {
          status: 503,
          reason: 'GENERATION_NOT_ACCEPTING',
        })
      },
    },
    tasks: { createTask: () => assert.fail('paused generation must not create a task') },
    quota: { reserve: () => assert.fail('paused generation must not reserve quota') },
    images: { generate: () => assert.fail('paused generation must not call the provider') },
    outputs: { save: () => assert.fail('paused generation must not store output') },
  })

  await assert.rejects(
    service.generate(user, input, 'paused-request'),
    (error) => error instanceof GenerationError
      && error.status === 503
      && error.reason === 'GENERATION_NOT_ACCEPTING',
  )
  assert.deepEqual(events, [['assertAccepting']])
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

test('in-flight idempotent replays return the existing task without starting another generation', async () => {
  const existing = {
    id: 'task-running',
    userId: user.id,
    idempotencyKey: 'request-running',
    status: 'running',
    errorReason: null,
  }
  const service = createGenerationService({
    tasks: createTaskStore(existing),
    quota: { reserve: () => assert.fail('replay must not reserve quota') },
    images: { generate: () => assert.fail('replay must not call provider') },
    outputs: { save: () => assert.fail('replay must not store output') },
  })

  assert.deepEqual(await service.generate(user, input, 'request-running'), existing)
})

test('failed idempotent replays return the stable failure', async () => {
  const service = createGenerationService({
    tasks: createTaskStore({
      id: 'task-failed',
      userId: user.id,
      idempotencyKey: 'request-failed',
      status: 'failed',
      errorReason: 'IMAGE_PROVIDER_TIMEOUT',
    }),
    quota: {},
    images: {},
    outputs: {},
  })

  await assert.rejects(
    service.generate(user, input, 'request-failed'),
    (error) => error instanceof GenerationError
      && error.reason === 'IMAGE_PROVIDER_TIMEOUT'
      && error.status === 502,
  )
})

test('ambiguous quota confirmation preserves the output for recovery', async () => {
  const events = []
  const service = createGenerationService({
    tasks: createTaskStore(null, events),
    quota: {
      reserve: () => ({ id: 'reservation-confirm-failure', source: 'pack', status: 'reserved' }),
      confirm() {
        throw new Error('database unavailable')
      },
      getReservation(id) {
        events.push(['getReservation', id])
        return { id, source: 'pack', status: 'reserved' }
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

  await assert.rejects(
    service.generate(user, input, 'confirm-failure'),
    (error) => error instanceof GenerationError && error.reason === 'GENERATION_FINALIZATION_PENDING',
  )
  assert.equal(events.some((event) => event[0] === 'getReservation'), true)
  assert.equal(events.some((event) => ['release', 'remove', 'fail'].includes(event[0])), false)
})

test('an expired reservation cannot publish an uncharged artwork', async () => {
  const events = []
  const service = createGenerationService({
    tasks: createTaskStore(null, events),
    quota: {
      reserve: () => ({ id: 'reservation-expired', source: 'free', status: 'reserved' }),
      confirm: () => ({ id: 'reservation-expired', source: 'free', status: 'released' }),
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
        return { key: 'local-user/expired.png', url: '/api/artworks/expired' }
      },
      async remove(output) {
        events.push(['remove', output.key])
      },
    },
  })

  await assert.rejects(service.generate(user, input, 'expired-reservation'), /没有扣除额度/)
  assert.equal(events.some((event) => event[0] === 'remove'), true)
  assert.equal(events.some((event) => event[0] === 'fail'), true)
  assert.equal(events.some((event) => event[0] === 'succeed'), false)
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
        return { id, source: 'free', status: 'confirmed' }
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

test('startup recovery finalizes charged outputs and removes released ones', async () => {
  const events = []
  const pending = [
    { id: 'task-confirmed', reservationId: 'confirmed', output: { key: 'confirmed.png' } },
    { id: 'task-reserved', reservationId: 'reserved', output: { key: 'reserved.png' } },
    { id: 'task-released', reservationId: 'released', output: { key: 'released.png' } },
  ]
  const service = createGenerationService({
    tasks: {
      listStaleActive: () => [],
      listFinalizationPending: () => pending,
      succeed(id) {
        events.push(['succeed', id])
      },
      fail(id, reason) {
        events.push(['fail', id, reason])
      },
    },
    quota: {
      getReservation(id) {
        return { id, source: 'free', status: id }
      },
      confirm(id) {
        events.push(['confirm', id])
        return { id, source: 'free', status: 'confirmed' }
      },
    },
    images: {},
    outputs: {
      async remove(output) {
        events.push(['remove', output.key])
      },
    },
  })

  await service.recoverPending()
  assert.deepEqual(events, [
    ['succeed', 'task-confirmed'],
    ['confirm', 'reserved'],
    ['succeed', 'task-reserved'],
    ['remove', 'released.png'],
    ['fail', 'task-released', 'GENERATION_FINALIZATION_EXPIRED'],
  ])
})

test('startup recovery expires only stale active tasks and preserves output finalization', async () => {
  const events = []
  const now = new Date('2026-08-28T12:30:00.000Z')
  const service = createGenerationService({
    activeTaskTtlSeconds: 900,
    clock: () => now,
    tasks: {
      listStaleActive(cutoff) {
        events.push(['listStaleActive', cutoff])
        return [
          { id: 'task-created', status: 'created', reservationId: null },
          { id: 'task-reserved', status: 'reserved', reservationId: 'reservation-reserved' },
          { id: 'task-running', status: 'running', reservationId: 'reservation-running' },
        ]
      },
      listFinalizationPending() {
        return [{ id: 'task-output', status: 'output_stored', reservationId: 'reservation-confirmed', output: { key: 'output.png' } }]
      },
      fail(id, reason) {
        events.push(['fail', id, reason])
      },
      succeed(id) {
        events.push(['succeed', id])
      },
    },
    quota: {
      release(id) {
        events.push(['release', id])
        return { id, source: 'free', status: 'released' }
      },
      getReservation(id) {
        events.push(['getReservation', id])
        return { id, source: 'free', status: 'confirmed' }
      },
    },
    images: {},
    outputs: { remove: () => assert.fail('confirmed output must be preserved') },
  })

  await service.recoverPending()

  assert.deepEqual(events, [
    ['listStaleActive', now.getTime() - 900_000],
    ['fail', 'task-created', 'GENERATION_RECOVERY_TIMEOUT'],
    ['release', 'reservation-reserved'],
    ['fail', 'task-reserved', 'GENERATION_RECOVERY_TIMEOUT'],
    ['release', 'reservation-running'],
    ['fail', 'task-running', 'GENERATION_RECOVERY_TIMEOUT'],
    ['getReservation', 'reservation-confirmed'],
    ['succeed', 'task-output'],
  ])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioGenerationApp } from './generationApp.mjs'
import { GenerationError } from './generationService.mjs'
import { TaskStoreError } from './generationTaskStore.mjs'

const origin = 'https://studio.nanafox.com'
const user = { id: 'local-user', email: 'creator@example.com', displayName: 'Creator' }
const cookie = 'nanafox_studio_session=session-1; nanafox_studio_csrf=csrf-1'
const task = {
  id: 'task-1',
  userId: user.id,
  idempotencyKey: 'request-1',
  input: { prompt: '月光下的银色狐狸', size: '1024x1024', quality: 'high' },
  status: 'succeeded',
  reservationId: 'reservation-1',
  output: { key: `${user.id}/task-1.png`, url: '/api/artworks/task-1' },
  errorReason: null,
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:01:00.000Z',
}

function createSessions() {
  return {
    getSession(token) {
      return token === 'session-1' ? { user, expiresAt: '2026-09-26T12:00:00.000Z' } : null
    },
    verifyCsrf(token, value) {
      return token === 'session-1' && value === 'csrf-1'
    },
  }
}

function createApp(overrides = {}) {
  return createStudioGenerationApp({
    publicOrigin: origin,
    sessions: createSessions(),
    generations: { generate: async () => task },
    tasks: {
      getTask: (userId, id) => userId === user.id && id === task.id ? task : null,
      listTasks: (userId) => userId === user.id ? [task] : [],
    },
    outputs: {
      read: async () => ({ bytes: Buffer.from('png-bytes'), mimeType: 'image/png' }),
    },
    ...overrides,
  })
}

function request(path, options = {}) {
  const headers = {
    Cookie: cookie,
    ...options.headers,
  }
  if (options.body !== undefined) {
    headers.Origin = options.origin ?? origin
    headers['Content-Type'] = 'application/json'
    headers['X-CSRF-Token'] = options.csrf ?? 'csrf-1'
  }
  return new Request(`${origin}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

test('authenticated generation requests enforce CSRF and idempotency', async () => {
  let captured
  const app = createApp({
    generations: {
      async generate(actualUser, input, key) {
        captured = { actualUser, input, key }
        return task
      },
    },
  })
  const response = await app.handle(request('/api/generations', {
    headers: { 'Idempotency-Key': 'request-1' },
    body: task.input,
  }))

  assert.equal(response.status, 201)
  assert.deepEqual(captured, { actualUser: user, input: task.input, key: 'request-1' })
  const payload = await response.json()
  assert.equal(payload.data.id, task.id)
  assert.equal(JSON.stringify(payload).includes('reservation-1'), false)
  assert.equal(JSON.stringify(payload).includes('local-user/task-1.png'), false)

  const rejected = await app.handle(request('/api/generations', {
    csrf: 'wrong',
    headers: { 'Idempotency-Key': 'request-2' },
    body: task.input,
  }))
  assert.equal(rejected.status, 403)
})

test('generation inputs and errors are bounded before reaching the provider', async () => {
  const app = createApp({
    generations: {
      generate: async () => {
        throw new GenerationError('额度不足', { status: 402, reason: 'QUOTA_EXHAUSTED' })
      },
    },
  })

  const invalid = await app.handle(request('/api/generations', {
    headers: { 'Idempotency-Key': 'request-invalid' },
    body: { prompt: 'test', size: '2048x2048', quality: 'high', model: 'browser-model' },
  }))
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.reason, 'VALIDATION_ERROR')

  const exhausted = await app.handle(request('/api/generations', {
    headers: { 'Idempotency-Key': 'request-exhausted' },
    body: task.input,
  }))
  assert.equal(exhausted.status, 402)
  assert.deepEqual(await exhausted.json(), {
    ok: false,
    error: { reason: 'QUOTA_EXHAUSTED', message: '额度不足' },
  })
})

test('a concurrent generation returns a stable busy response without leaking database details', async () => {
  const app = createApp({
    generations: {
      generate: async () => {
        throw new TaskStoreError('已有创作任务正在处理中，请稍后再试', 'GENERATION_BUSY')
      },
    },
  })

  const response = await app.handle(request('/api/generations', {
    headers: { 'Idempotency-Key': 'request-concurrent' },
    body: task.input,
  }))

  assert.equal(response.status, 429)
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { reason: 'GENERATION_BUSY', message: '已有创作任务正在处理中，请稍后再试' },
  })
})

test('task history and details expose only the authenticated user view', async () => {
  const app = createApp()
  const list = await app.handle(request('/api/generations'))
  assert.equal(list.status, 200)
  assert.deepEqual((await list.json()).data.map((item) => item.id), [task.id])

  const detail = await app.handle(request('/api/generations/task-1'))
  assert.equal(detail.status, 200)
  assert.equal((await detail.json()).data.output.url, '/api/artworks/task-1')

  const missing = await app.handle(request('/api/generations/task-other'))
  assert.equal(missing.status, 404)
})

test('public artwork URLs stay inside the Studio deployment path', async () => {
  const app = createApp({ publicBasePath: '/tools/image-studio/' })
  const detail = await app.handle(request('/api/generations/task-1'))

  assert.equal((await detail.json()).data.output.url, '/tools/image-studio/api/artworks/task-1')
})

test('artwork bytes require ownership and a completed output', async () => {
  let readOutput
  const app = createApp({
    outputs: {
      async read(output) {
        readOutput = output
        return { bytes: Buffer.from('png-bytes'), mimeType: 'image/png' }
      },
    },
  })
  const response = await app.handle(request('/api/artworks/task-1'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'png-bytes')
  assert.deepEqual(readOutput, task.output)

  const missing = await app.handle(request('/api/artworks/task-other'))
  assert.equal(missing.status, 404)
})

test('an output waiting for quota finalization is never exposed as an artwork', async () => {
  const pending = { ...task, status: 'output_stored' }
  const app = createApp({
    tasks: {
      getTask: (userId, id) => userId === user.id && id === pending.id ? pending : null,
      listTasks: (userId) => userId === user.id ? [pending] : [],
    },
    outputs: { read: () => assert.fail('pending output must not be read') },
  })

  const detail = await app.handle(request('/api/generations/task-1'))
  assert.equal((await detail.json()).data.output, null)

  const list = await app.handle(request('/api/generations'))
  assert.equal((await list.json()).data[0].output, null)

  const artwork = await app.handle(request('/api/artworks/task-1'))
  assert.equal(artwork.status, 404)
})

test('soft deletes and restores only the owner completed artwork', async () => {
  const deleted = { ...task, deletedAt: '2026-08-28T12:00:00.000Z', purgeAt: '2026-09-04T12:00:00.000Z' }
  const calls = []
  const app = createApp({
    tasks: {
      getTask: (userId, id, options) => {
        calls.push(['get', userId, id, options])
        return userId === user.id && id === task.id ? deleted : null
      },
      listTasks: (userId, options) => {
        calls.push(['list', userId, options])
        return userId === user.id && options?.deleted ? [deleted] : []
      },
      deleteTask: (userId, id) => {
        calls.push(['delete', userId, id])
        return userId === user.id && id === task.id ? deleted : null
      },
      restoreTask: (userId, id) => {
        calls.push(['restore', userId, id])
        return userId === user.id && id === task.id ? task : null
      },
    },
  })
  const mutation = (path, method, csrf = 'csrf-1') => new Request(`${origin}${path}`, {
    method,
    headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf },
  })

  const removed = await app.handle(mutation('/api/generations/task-1', 'DELETE'))
  assert.equal(removed.status, 200)
  assert.equal((await removed.json()).data.deletedAt, deleted.deletedAt)

  const trash = await app.handle(request('/api/generations?view=deleted'))
  assert.deepEqual((await trash.json()).data.map((item) => item.id), [task.id])
  const artwork = await app.handle(request('/api/artworks/task-1'))
  assert.equal(artwork.status, 200)
  assert.deepEqual(calls.find((call) => call[0] === 'get')?.[3], { includeDeleted: true })

  const restored = await app.handle(mutation('/api/generations/task-1/restore', 'POST'))
  assert.equal(restored.status, 200)
  assert.equal((await restored.json()).data.deletedAt, null)

  const rejected = await app.handle(mutation('/api/generations/task-1', 'DELETE', 'wrong'))
  assert.equal(rejected.status, 403)
  assert.equal(calls.filter((call) => call[0] === 'delete').length, 1)

  const missing = await app.handle(mutation('/api/generations/task-other', 'DELETE'))
  assert.equal(missing.status, 404)
})

test('generation routes require a valid Studio session', async () => {
  const app = createApp()
  const response = await app.handle(new Request(`${origin}/api/generations`))
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error.reason, 'UNAUTHENTICATED')
})

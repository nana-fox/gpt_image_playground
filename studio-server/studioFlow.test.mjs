import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createStudioRuntime } from './server.mjs'

const origin = 'http://127.0.0.1'
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const loginValue = ['Password', '123!'].join('')

test('real HTTP flow logs in, consumes quota once, persists and serves the artwork', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'nanafox-studio-flow-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  let imageCalls = 0
  const upstream = createServer((request, response) => {
    if (request.url === '/internal/v1/studio-auth/login') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        code: 0,
        data: {
          user: {
            subject: '019c0000-0000-7000-8000-000000000071',
            email: 'flow@example.com',
            display_name: 'Flow User',
          },
        },
      }))
      return
    }
    if (request.url === '/v1/images/generations') {
      imageCalls += 1
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => upstream.close(resolve)))
  const upstreamAddress = upstream.address()
  const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`

  const runtime = createStudioRuntime({
    routerBaseUrl: upstreamOrigin,
    routerKeyId: 'studio-test',
    routerSecret: 's'.repeat(48),
    publicOrigin: origin,
    database: join(dir, 'studio.db'),
    generationEnabled: true,
    generation: {
      baseUrl: `${upstreamOrigin}/v1`,
      apiKey: ['sk', 'studio', 'flow', 'material'].join('-'),
      model: 'gpt-image-2',
      artworkRoot: join(dir, 'artworks'),
    },
  })
  assert.equal(runtime.ready instanceof Promise, true)
  await runtime.ready
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => runtime.close(resolve)))
  const address = runtime.server.address()
  const serverOrigin = `http://127.0.0.1:${address.port}`

  const login = await fetch(`${serverOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'flow@example.com', password: loginValue }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
  const csrf = /nanafox_studio_csrf=([^;]+)/.exec(cookie)?.[1]
  assert.ok(csrf)

  const create = () => fetch(`${serverOrigin}/api/generations`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'flow-request-1',
      Origin: origin,
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ prompt: '月光下的银色狐狸', size: '1024x1024', quality: 'medium' }),
  })
  const generated = await create()
  assert.equal(generated.status, 201)
  const task = (await generated.json()).data
  assert.equal(task.status, 'succeeded')

  const replay = await create()
  assert.equal((await replay.json()).data.id, task.id)
  assert.equal(imageCalls, 1)

  const quota = await fetch(`${serverOrigin}/api/quota`, { headers: { Cookie: cookie } })
  assert.equal((await quota.json()).data.free.remaining, 2)
  const history = await fetch(`${serverOrigin}/api/generations`, { headers: { Cookie: cookie } })
  assert.deepEqual((await history.json()).data.map((item) => item.id), [task.id])
  const artwork = await fetch(`${serverOrigin}${task.output.url}`, { headers: { Cookie: cookie } })
  assert.equal(artwork.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await artwork.arrayBuffer()), png)
})

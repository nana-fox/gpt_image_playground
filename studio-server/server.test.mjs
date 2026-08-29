import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createStudioApp, createStudioHttpServer, readStudioServerConfig } from './server.mjs'

const signingMaterial = 's'.repeat(48)
const imageApiKey = ['sk', 'studio', 'provider', 'material'].join('-')

test('Studio server configuration fails closed and keeps secrets server-side', () => {
  assert.throws(() => readStudioServerConfig({}), /ROUTER_AUTH_BASE_URL/)
  assert.throws(() => readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
  }), /STUDIO_DATABASE_URL/)

  const config = readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
  })

  assert.deepEqual(config, {
    routerBaseUrl: 'https://router.nanafox.com',
    routerKeyId: 'studio-current',
    routerSecret: signingMaterial,
    publicOrigin: 'https://studio.nanafox.com',
    publicBasePath: '/',
    databaseUrl: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
    generationEnabled: false,
    paymentEnabled: false,
    host: '127.0.0.1',
    port: 8788,
  })
  assert.equal('VITE_ROUTER_AUTH_CURRENT_SECRET' in config, false)
})

test('Studio server accepts an isolated public base path', () => {
  const config = readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://router-test.nanafox.com',
    STUDIO_PUBLIC_BASE_PATH: '/tools/image-studio/',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
  })

  assert.equal(config.publicBasePath, '/tools/image-studio/')
  assert.throws(() => readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://router-test.nanafox.com',
    STUDIO_PUBLIC_BASE_PATH: 'tools/image-studio',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
  }), /STUDIO_PUBLIC_BASE_PATH/)
})

test('WeChat payment is disabled by default and enabled only with server-side credentials', () => {
  const base = {
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
    STUDIO_PAYMENT_ENABLED: 'true',
  }
  assert.throws(() => readStudioServerConfig(base), /STUDIO_WXPAY_APP_ID/)
  const config = readStudioServerConfig({
    ...base,
    STUDIO_PUBLIC_BASE_PATH: '/tools/image-studio/',
    STUDIO_WXPAY_APP_ID: 'wx-studio-app',
    STUDIO_WXPAY_MCH_ID: '1900000001',
    STUDIO_WXPAY_MERCHANT_SERIAL_NO: 'MERCHANT-SERIAL',
    STUDIO_WXPAY_PRIVATE_KEY_FILE: '/run/secrets/wxpay-private-key.pem',
    STUDIO_WXPAY_PUBLIC_KEY_FILE: '/run/secrets/wxpay-public-key.pem',
    STUDIO_WXPAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST',
    STUDIO_WXPAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  })
  assert.equal(config.paymentEnabled, true)
  assert.deepEqual(config.payment, {
    appId: 'wx-studio-app',
    mchId: '1900000001',
    serialNo: 'MERCHANT-SERIAL',
    privateKeyFile: '/run/secrets/wxpay-private-key.pem',
    publicKeyFile: '/run/secrets/wxpay-public-key.pem',
    publicKeyId: 'PUB_KEY_ID_TEST',
    apiV3Key: '0123456789abcdef0123456789abcdef',
    notifyUrl: 'https://studio.nanafox.com/tools/image-studio/api/payments/webhooks/wechat',
  })
})

test('legacy WeChat payment public key environment names remain compatible', () => {
  const config = readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
    STUDIO_PAYMENT_ENABLED: 'true',
    STUDIO_WXPAY_APP_ID: 'wx-studio-app',
    STUDIO_WXPAY_MCH_ID: '1900000001',
    STUDIO_WXPAY_MERCHANT_SERIAL_NO: 'MERCHANT-SERIAL',
    STUDIO_WXPAY_PRIVATE_KEY_FILE: '/run/secrets/wxpay-private-key.pem',
    STUDIO_WXPAY_PLATFORM_PUBLIC_KEY_FILE: '/run/secrets/wxpay-public-key.pem',
    STUDIO_WXPAY_PLATFORM_SERIAL_NO: 'PUB_KEY_ID_TEST',
    STUDIO_WXPAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  })
  assert.equal(config.payment.publicKeyFile, '/run/secrets/wxpay-public-key.pem')
  assert.equal(config.payment.publicKeyId, 'PUB_KEY_ID_TEST')
})

test('enabled generation configuration fails closed without provider storage settings', () => {
  const base = {
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
    STUDIO_GENERATION_ENABLED: 'true',
  }
  assert.throws(() => readStudioServerConfig(base), /ROUTER_IMAGE_BASE_URL/)

  const config = readStudioServerConfig({
    ...base,
    ROUTER_IMAGE_BASE_URL: 'https://router.nanafox.com/v1',
    ROUTER_IMAGE_API_KEY: imageApiKey,
    STUDIO_ARTWORK_ROOT: '/var/lib/nanafox-studio/artworks',
  })
  assert.deepEqual(config.generation, {
    baseUrl: 'https://router.nanafox.com/v1',
    apiKey: imageApiKey,
    model: 'gpt-image-2',
    storage: {
      type: 'filesystem',
      root: '/var/lib/nanafox-studio/artworks',
    },
  })
  assert.equal(config.generationEnabled, true)
})

test('R2 generation configuration requires isolated private storage credentials', () => {
  const base = {
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
    STUDIO_DATABASE_URL: 'postgresql://studio:secret@postgres:5432/nanafox_studio',
    STUDIO_GENERATION_ENABLED: 'true',
    ROUTER_IMAGE_BASE_URL: 'https://router.nanafox.com/v1',
    ROUTER_IMAGE_API_KEY: imageApiKey,
    STUDIO_OBJECT_STORAGE: 'r2',
  }
  assert.throws(() => readStudioServerConfig(base), /STUDIO_R2_ENDPOINT/)

  const config = readStudioServerConfig({
    ...base,
    STUDIO_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    STUDIO_R2_BUCKET: 'nanafox-studio-artworks-test',
    STUDIO_R2_ACCESS_KEY_ID: 'access-key-id',
    STUDIO_R2_SECRET_ACCESS_KEY: 'secret-access-key',
  })
  assert.deepEqual(config.generation.storage, {
    type: 'r2',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    bucket: 'nanafox-studio-artworks-test',
    accessKeyId: 'access-key-id',
    secretAccessKey: 'secret-access-key',
    region: 'auto',
  })
})

test('Studio app routes generation endpoints separately from account endpoints', async () => {
  const calls = []
  const app = createStudioApp({
    authApp: { handle: async () => { calls.push('auth'); return new Response('auth') } },
    generationApp: { handle: async () => { calls.push('generation'); return new Response('generation') } },
    inspirationApp: { handle: async () => { calls.push('inspiration'); return new Response('inspiration') } },
    adminApp: { handle: async () => { calls.push('admin'); return new Response('admin') } },
    paymentApp: { handle: async () => { calls.push('payment'); return new Response('payment') } },
  })

  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/auth/session'))).text(), 'auth')
  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/quota'))).text(), 'auth')
  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/generations'))).text(), 'generation')
  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/artworks/task-1'))).text(), 'generation')
  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/inspirations'))).text(), 'inspiration')
  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/admin/me'))).text(), 'admin')
  assert.equal(await (await app.handle(new Request('https://studio.nanafox.com/api/payments/plans'))).text(), 'payment')
  assert.deepEqual(calls, ['auth', 'auth', 'generation', 'generation', 'inspiration', 'admin', 'payment'])
})

test('Studio app exposes an unauthenticated health endpoint for deployment probes', async () => {
  const app = createStudioApp({
    authApp: { handle: async () => assert.fail('health must not reach account routes') },
  })
  const response = await app.handle(new Request('https://studio.nanafox.com/api/health'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: 'nanafox-studio' })
})

test('Studio readiness reflects PostgreSQL availability', async () => {
  const ready = createStudioApp({
    authApp: { handle: async () => assert.fail('readiness must not reach account routes') },
    readiness: async () => {},
  })
  const readyResponse = await ready.handle(new Request('https://studio.nanafox.com/api/ready'))
  assert.equal(readyResponse.status, 200)
  assert.deepEqual(await readyResponse.json(), { ok: true, service: 'nanafox-studio' })

  const unavailable = createStudioApp({
    authApp: { handle: async () => assert.fail('readiness must not reach account routes') },
    readiness: async () => { throw new Error('database unavailable') },
  })
  const unavailableResponse = await unavailable.handle(new Request('https://studio.nanafox.com/api/ready'))
  assert.equal(unavailableResponse.status, 503)
  assert.deepEqual(await unavailableResponse.json(), {
    ok: false,
    service: 'nanafox-studio',
    error: { reason: 'DATABASE_UNAVAILABLE' },
  })
})

test('HTTP adapter preserves Studio cookies and delegates the request', async (t) => {
  let captured
  const server = createStudioHttpServer({
    publicOrigin: 'http://127.0.0.1',
    app: {
      async handle(request) {
        captured = {
          method: request.method,
          path: new URL(request.url).pathname,
          origin: request.headers.get('origin'),
          body: await request.json(),
        }
        const response = Response.json({ ok: true })
        response.headers.append('Set-Cookie', 'first=one; Path=/; HttpOnly')
        response.headers.append('Set-Cookie', 'second=two; Path=/')
        return response
      },
    },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()

  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1',
    },
    body: JSON.stringify({ email: 'studio@example.com' }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(captured, {
    method: 'POST',
    path: '/api/auth/login',
    origin: 'http://127.0.0.1',
    body: { email: 'studio@example.com' },
  })
  assert.deepEqual(response.headers.getSetCookie(), [
    'first=one; Path=/; HttpOnly',
    'second=two; Path=/',
  ])
})

test('HTTP adapter serves the built Studio frontend with SPA fallback', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nanafox-studio-static-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<main>NanaFox Studio</main>')
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("studio")')
  t.after(async () => rm(root, { recursive: true, force: true }))
  const server = createStudioHttpServer({
    publicOrigin: 'http://127.0.0.1',
    staticRoot: root,
    app: { handle: async () => assert.fail('frontend requests must not reach the API app') },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  const home = await fetch(`${base}/`)
  assert.equal(await home.text(), '<main>NanaFox Studio</main>')
  assert.match(home.headers.get('content-type'), /text\/html/)
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer')
  const asset = await fetch(`${base}/assets/app.js`)
  assert.equal(await asset.text(), 'console.log("studio")')
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(await (await fetch(`${base}/works/task-1`)).text(), '<main>NanaFox Studio</main>')
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404)
})

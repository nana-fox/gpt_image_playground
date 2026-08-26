import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioHttpServer, readStudioServerConfig } from './server.mjs'

const signingMaterial = 's'.repeat(48)

test('Studio server configuration fails closed and keeps secrets server-side', () => {
  assert.throws(() => readStudioServerConfig({}), /ROUTER_AUTH_BASE_URL/)
  assert.throws(() => readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
  }), /STUDIO_SESSION_DATABASE/)

  const config = readStudioServerConfig({
    ROUTER_AUTH_BASE_URL: 'https://router.nanafox.com',
    ROUTER_AUTH_KEY_ID: 'studio-current',
    ROUTER_AUTH_CURRENT_SECRET: signingMaterial,
    STUDIO_PUBLIC_ORIGIN: 'https://studio.nanafox.com',
    STUDIO_SESSION_DATABASE: '/var/lib/nanafox-studio/session.db',
  })

  assert.deepEqual(config, {
    routerBaseUrl: 'https://router.nanafox.com',
    routerKeyId: 'studio-current',
    routerSecret: signingMaterial,
    publicOrigin: 'https://studio.nanafox.com',
    database: '/var/lib/nanafox-studio/session.db',
    host: '127.0.0.1',
    port: 8788,
  })
  assert.equal('VITE_ROUTER_AUTH_CURRENT_SECRET' in config, false)
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

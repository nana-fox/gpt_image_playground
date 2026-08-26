import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'

import { createStudioAuthApp } from './authApp.mjs'
import { createQuotaStore } from './quotaStore.mjs'
import { createRouterAuthClient } from './routerAuthClient.mjs'
import { createSessionStore } from './sessionStore.mjs'

export function readStudioServerConfig(env = process.env) {
  const routerBaseUrl = required(env.ROUTER_AUTH_BASE_URL, 'ROUTER_AUTH_BASE_URL')
  const routerKeyId = required(env.ROUTER_AUTH_KEY_ID, 'ROUTER_AUTH_KEY_ID')
  const routerSecret = required(env.ROUTER_AUTH_CURRENT_SECRET, 'ROUTER_AUTH_CURRENT_SECRET')
  const publicOrigin = required(env.STUDIO_PUBLIC_ORIGIN, 'STUDIO_PUBLIC_ORIGIN')
  const database = required(env.STUDIO_SESSION_DATABASE, 'STUDIO_SESSION_DATABASE')
  const port = env.STUDIO_PORT ? Number(env.STUDIO_PORT) : 8788
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STUDIO_PORT is invalid')

  return {
    routerBaseUrl,
    routerKeyId,
    routerSecret,
    publicOrigin,
    database,
    host: String(env.STUDIO_HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    port,
  }
}

export function createStudioHttpServer(options) {
  const app = options.app
  const publicOrigin = new URL(options.publicOrigin).origin

  return createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers()
      for (let idx = 0; idx < incoming.rawHeaders.length; idx += 2) {
        headers.append(incoming.rawHeaders[idx], incoming.rawHeaders[idx + 1])
      }
      const method = incoming.method ?? 'GET'
      const request = new Request(new URL(incoming.url ?? '/', publicOrigin), {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(incoming),
        duplex: method === 'GET' || method === 'HEAD' ? undefined : 'half',
      })
      const response = await app.handle(request)
      outgoing.statusCode = response.status
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') outgoing.setHeader(name, value)
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) outgoing.setHeader('Set-Cookie', cookies)
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error('Studio HTTP request failed', error)
      outgoing.statusCode = 500
      outgoing.setHeader('Cache-Control', 'no-store')
      outgoing.setHeader('Content-Type', 'application/json; charset=utf-8')
      outgoing.end(JSON.stringify({
        ok: false,
        error: { reason: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' },
      }))
    }
  })
}

export function createStudioRuntime(config = readStudioServerConfig()) {
  mkdirSync(dirname(config.database), { recursive: true })
  const store = createSessionStore({ filename: config.database })
  const quota = createQuotaStore({ filename: config.database })
  const routerAuth = createRouterAuthClient({
    baseUrl: config.routerBaseUrl,
    keyId: config.routerKeyId,
    secret: config.routerSecret,
  })
  const app = createStudioAuthApp({
    publicOrigin: config.publicOrigin,
    routerAuth,
    store,
    quota,
  })
  const server = createStudioHttpServer({ publicOrigin: config.publicOrigin, app })

  return {
    server,
    close(callback) {
      server.close(() => {
        quota.close()
        store.close()
        callback?.()
      })
    },
  }
}

function required(value, name) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readStudioServerConfig()
  const runtime = createStudioRuntime(config)
  runtime.server.listen(config.port, config.host, () => {
    console.log(`NanaFox Studio auth server listening on ${config.host}:${config.port}`)
  })
}

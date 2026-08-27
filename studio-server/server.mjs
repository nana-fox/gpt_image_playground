import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'

import { createArtworkStore } from './artworkStore.mjs'
import { createStudioAdminApp } from './adminApp.mjs'
import { createStudioAuthApp } from './authApp.mjs'
import { createStudioDatabase } from './database.mjs'
import { createStudioGenerationApp } from './generationApp.mjs'
import { createGenerationService } from './generationService.mjs'
import { createGenerationTaskStore } from './generationTaskStore.mjs'
import { createImageProviderClient } from './imageProviderClient.mjs'
import { createStudioPaymentApp } from './paymentApp.mjs'
import { createPaymentService } from './paymentService.mjs'
import { createPaymentStore } from './paymentStore.mjs'
import { createQuotaStore } from './quotaStore.mjs'
import { createR2ArtworkStore } from './r2ArtworkStore.mjs'
import { createRouterAuthClient } from './routerAuthClient.mjs'
import { createSessionStore } from './sessionStore.mjs'
import { createWxpayClient } from './wxpayClient.mjs'

export function readStudioServerConfig(env = process.env) {
  const routerBaseUrl = required(env.ROUTER_AUTH_BASE_URL, 'ROUTER_AUTH_BASE_URL')
  const routerKeyId = required(env.ROUTER_AUTH_KEY_ID, 'ROUTER_AUTH_KEY_ID')
  const routerSecret = required(env.ROUTER_AUTH_CURRENT_SECRET, 'ROUTER_AUTH_CURRENT_SECRET')
  const publicOrigin = required(env.STUDIO_PUBLIC_ORIGIN, 'STUDIO_PUBLIC_ORIGIN')
  const publicBasePath = normalizeBasePath(env.STUDIO_PUBLIC_BASE_PATH ?? '/', 'STUDIO_PUBLIC_BASE_PATH')
  const databaseUrl = required(env.STUDIO_DATABASE_URL, 'STUDIO_DATABASE_URL')
  const generationEnabled = parseBoolean(env.STUDIO_GENERATION_ENABLED, 'STUDIO_GENERATION_ENABLED')
  const paymentEnabled = parseBoolean(env.STUDIO_PAYMENT_ENABLED, 'STUDIO_PAYMENT_ENABLED')
  const port = env.STUDIO_PORT ? Number(env.STUDIO_PORT) : 8788
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STUDIO_PORT is invalid')

  const config = {
    routerBaseUrl,
    routerKeyId,
    routerSecret,
    publicOrigin,
    publicBasePath,
    databaseUrl,
    generationEnabled,
    paymentEnabled,
    adminSubjects: parseAdminSubjects(env.STUDIO_ADMIN_SUBJECTS),
    host: String(env.STUDIO_HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    port,
  }
  if (generationEnabled) {
    const storageType = String(env.STUDIO_OBJECT_STORAGE ?? 'filesystem').trim().toLowerCase()
    if (!['filesystem', 'r2'].includes(storageType)) throw new Error('STUDIO_OBJECT_STORAGE must be filesystem or r2')
    config.generation = {
      baseUrl: required(env.ROUTER_IMAGE_BASE_URL, 'ROUTER_IMAGE_BASE_URL'),
      apiKey: required(env.ROUTER_IMAGE_API_KEY, 'ROUTER_IMAGE_API_KEY'),
      model: String(env.STUDIO_IMAGE_MODEL ?? 'gpt-image-2').trim() || 'gpt-image-2',
      storage: storageType === 'r2'
        ? {
            type: 'r2',
            endpoint: normalizeR2Endpoint(required(env.STUDIO_R2_ENDPOINT, 'STUDIO_R2_ENDPOINT')),
            bucket: required(env.STUDIO_R2_BUCKET, 'STUDIO_R2_BUCKET'),
            accessKeyId: required(env.STUDIO_R2_ACCESS_KEY_ID, 'STUDIO_R2_ACCESS_KEY_ID'),
            secretAccessKey: required(env.STUDIO_R2_SECRET_ACCESS_KEY, 'STUDIO_R2_SECRET_ACCESS_KEY'),
            region: String(env.STUDIO_R2_REGION ?? 'auto').trim() || 'auto',
          }
        : {
            type: 'filesystem',
            root: required(env.STUDIO_ARTWORK_ROOT, 'STUDIO_ARTWORK_ROOT'),
          },
    }
  }
  if (paymentEnabled) {
    config.payment = {
      appId: required(env.STUDIO_WXPAY_APP_ID, 'STUDIO_WXPAY_APP_ID'),
      mchId: required(env.STUDIO_WXPAY_MCH_ID, 'STUDIO_WXPAY_MCH_ID'),
      serialNo: required(env.STUDIO_WXPAY_MERCHANT_SERIAL_NO, 'STUDIO_WXPAY_MERCHANT_SERIAL_NO'),
      privateKeyFile: required(env.STUDIO_WXPAY_PRIVATE_KEY_FILE, 'STUDIO_WXPAY_PRIVATE_KEY_FILE'),
      platformPublicKeyFile: required(env.STUDIO_WXPAY_PLATFORM_PUBLIC_KEY_FILE, 'STUDIO_WXPAY_PLATFORM_PUBLIC_KEY_FILE'),
      platformSerialNo: required(env.STUDIO_WXPAY_PLATFORM_SERIAL_NO, 'STUDIO_WXPAY_PLATFORM_SERIAL_NO'),
      apiV3Key: required(env.STUDIO_WXPAY_API_V3_KEY, 'STUDIO_WXPAY_API_V3_KEY'),
      notifyUrl: new URL(`${publicBasePath}api/payments/webhooks/wechat`, `${publicOrigin}/`).toString(),
    }
  }
  if (String(env.STUDIO_STATIC_ROOT ?? '').trim()) config.staticRoot = String(env.STUDIO_STATIC_ROOT).trim()
  return config
}

export function createStudioApp(options) {
  const authApp = options.authApp
  const adminApp = options.adminApp
  const generationApp = options.generationApp
  const paymentApp = options.paymentApp
  const readiness = options.readiness
  if (!authApp) throw new Error('Studio auth app is required')

  return {
    async handle(request) {
      const path = new URL(request.url).pathname
      if (request.method === 'GET' && path === '/api/health') {
        return Response.json({ ok: true, service: 'nanafox-studio' }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      }
      if (request.method === 'GET' && path === '/api/ready') {
        try {
          if (!readiness) throw new Error('Readiness check is missing')
          await readiness()
          return Response.json({ ok: true, service: 'nanafox-studio' }, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch {
          return Response.json({
            ok: false,
            service: 'nanafox-studio',
            error: { reason: 'DATABASE_UNAVAILABLE' },
          }, {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          })
        }
      }
      if (path === '/api/admin' || path.startsWith('/api/admin/')) {
        if (adminApp) return adminApp.handle(request)
        return Response.json({
          ok: false,
          error: { reason: 'ADMIN_UNAVAILABLE', message: '运营服务暂时不可用' },
        }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        })
      }
      if (path === '/api/payments' || path.startsWith('/api/payments/')) {
        if (paymentApp) return paymentApp.handle(request)
        return Response.json({
          ok: false,
          error: { reason: 'PAYMENT_UNAVAILABLE', message: '支付服务暂时不可用' },
        }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        })
      }
      const generationPath = path === '/api/generations'
        || path.startsWith('/api/generations/')
        || path.startsWith('/api/artworks/')
      if (!generationPath) return authApp.handle(request)
      if (generationApp) return generationApp.handle(request)
      return Response.json({
        ok: false,
        error: { reason: 'GENERATION_UNAVAILABLE', message: '创作服务暂时不可用' },
      }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      })
    },
  }
}

export function createStudioHttpServer(options) {
  const app = options.app
  const publicOrigin = new URL(options.publicOrigin).origin
  const staticRoot = options.staticRoot ? resolve(options.staticRoot) : null

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
      const path = new URL(request.url).pathname
      const response = staticRoot && (method === 'GET' || method === 'HEAD') && !path.startsWith('/api/')
        ? await serveStatic(staticRoot, path, method)
        : await app.handle(request)
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
  const database = createStudioDatabase({ connectionString: config.databaseUrl })
  const store = createSessionStore({ database })
  const quota = createQuotaStore({ database })
  const paymentStore = createPaymentStore({
    database,
    providerIdentity: config.payment
      ? { appId: config.payment.appId, mchId: config.payment.mchId }
      : {},
  })
  const tasks = createGenerationTaskStore({ database })
  const routerAuth = createRouterAuthClient({
    baseUrl: config.routerBaseUrl,
    keyId: config.routerKeyId,
    secret: config.routerSecret,
  })
  const authApp = createStudioAuthApp({
    publicOrigin: config.publicOrigin,
    publicBasePath: config.publicBasePath,
    routerAuth,
    store,
    quota,
  })
  const paymentProvider = config.paymentEnabled
    ? createWxpayClient({
        appId: config.payment.appId,
        mchId: config.payment.mchId,
        serialNo: config.payment.serialNo,
        privateKey: readFileSync(config.payment.privateKeyFile, 'utf8'),
        platformPublicKey: readFileSync(config.payment.platformPublicKeyFile, 'utf8'),
        platformSerialNo: config.payment.platformSerialNo,
        apiV3Key: config.payment.apiV3Key,
        notifyUrl: config.payment.notifyUrl,
      })
    : null
  const payments = createPaymentService({
    enabled: config.paymentEnabled,
    store: paymentStore,
    provider: paymentProvider,
  })
  const paymentApp = createStudioPaymentApp({
    publicOrigin: config.publicOrigin,
    sessions: store,
    payments,
  })
  const adminApp = createStudioAdminApp({
    publicOrigin: config.publicOrigin,
    adminSubjects: config.adminSubjects,
    sessions: store,
    quota,
    payments: paymentStore,
  })
  const generationRuntime = config.generationEnabled
    ? createGenerationRuntime(config, store, quota, tasks)
    : null
  const app = createStudioApp({
    authApp,
    adminApp,
    paymentApp,
    generationApp: generationRuntime?.app,
    readiness: async () => database.query('SELECT 1'),
  })
  const server = createStudioHttpServer({ publicOrigin: config.publicOrigin, app, staticRoot: config.staticRoot })

  return {
    server,
    ready: Promise.all([database.ready, generationRuntime?.ready ?? Promise.resolve()]),
    close(callback) {
      server.close(async () => {
        await database.close()
        callback?.()
      })
    },
  }
}

function createGenerationRuntime(config, sessions, quota, tasks) {
  const outputs = config.generation.storage.type === 'r2'
    ? createR2ArtworkStore(config.generation.storage)
    : createArtworkStore({ root: config.generation.storage.root })
  const images = createImageProviderClient({
    baseUrl: config.generation.baseUrl,
    apiKey: config.generation.apiKey,
    model: config.generation.model,
  })
  const generations = createGenerationService({ tasks, quota, images, outputs })
  return {
    app: createStudioGenerationApp({
      publicOrigin: config.publicOrigin,
      publicBasePath: config.publicBasePath,
      sessions,
      generations,
      tasks,
      outputs,
    }),
    ready: generations.recoverPending(),
  }
}

function required(value, name) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function parseBoolean(value, name) {
  const normalized = String(value ?? 'false').trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function parseAdminSubjects(value) {
  const subjects = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (subjects.some((subject) => !/^[A-Za-z0-9._:@/-]{1,128}$/.test(subject))) {
    throw new Error('STUDIO_ADMIN_SUBJECTS is invalid')
  }
  return [...new Set(subjects)]
}

function normalizeBasePath(value, name) {
  const path = String(value).trim()
  if (!path.startsWith('/') || !path.endsWith('/') || path.includes('//') || path.includes('?') || path.includes('#')) {
    throw new Error(`${name} must start and end with /`)
  }
  return path
}

function normalizeR2Endpoint(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('STUDIO_R2_ENDPOINT is invalid')
  }
  if (!url.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('STUDIO_R2_ENDPOINT must use Cloudflare R2')
  return url.origin
}

async function serveStatic(root, pathname, method) {
  let relative
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return new Response('Not found', { status: 404 })

  try {
    const bytes = await readFile(target)
    return staticResponse(bytes, target, method)
  } catch (error) {
    if (error?.code !== 'ENOENT' || extname(relative)) return new Response('Not found', { status: 404 })
    const index = resolve(root, 'index.html')
    return staticResponse(await readFile(index), index, method)
  }
}

function staticResponse(bytes, filename, method) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  const immutable = filename.includes(`${sep}assets${sep}`)
  return new Response(method === 'HEAD' ? null : bytes, {
    headers: {
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      'Content-Type': types[extname(filename).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readStudioServerConfig()
  const runtime = createStudioRuntime(config)
  await runtime.ready
  runtime.server.listen(config.port, config.host, () => {
    console.log(`NanaFox Studio server listening on ${config.host}:${config.port}`)
  })
}

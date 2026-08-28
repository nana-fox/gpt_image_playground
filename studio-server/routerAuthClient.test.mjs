import assert from 'node:assert/strict'
import { createHmac, createHash } from 'node:crypto'
import test from 'node:test'

import { createRouterAuthClient, RouterAuthError } from './routerAuthClient.mjs'

const baseUrl = 'https://router.example.test'
const keyId = 'studio-current'
const signingMaterial = 's'.repeat(48)
const loginValue = ['Password', '123!'].join('')
const resetToken = ['single', 'use', 'token'].join('-')
const now = new Date('2026-08-26T12:00:00.000Z')
const nonceBytes = Buffer.from('00112233445566778899aabbccddeeff', 'hex')

test('Router auth client signs login requests and returns only identity data', async () => {
  let captured
  const client = createRouterAuthClient({
    baseUrl,
    keyId,
    secret: signingMaterial,
    clock: () => now,
    randomBytes: () => nonceBytes,
    fetch: async (url, options) => {
      captured = { url, options }
      return Response.json({
        code: 0,
        message: 'success',
        data: {
          user: {
            subject: '019c0000-0000-7000-8000-000000000042',
            email: 'studio@example.com',
          },
        },
      })
    },
  })

  const result = await client.login('studio@example.com', loginValue)

  assert.deepEqual(result, {
    user: {
      subject: '019c0000-0000-7000-8000-000000000042',
      email: 'studio@example.com',
    },
  })
  assert.equal(captured.url, `${baseUrl}/internal/v1/studio-auth/login`)
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.headers['Content-Type'], 'application/json')
  assert.equal(captured.options.headers['X-NanaFox-Client'], 'nanafox-studio')
  assert.equal(captured.options.headers['X-NanaFox-Key-ID'], keyId)
  assert.equal(captured.options.headers['X-NanaFox-Timestamp'], String(now.getTime() / 1000))
  assert.equal(captured.options.headers['X-NanaFox-Nonce'], nonceBytes.toString('hex'))

  const bodyHash = createHash('sha256').update(captured.options.body).digest('hex')
  const canonical = [
    'POST',
    '/internal/v1/studio-auth/login',
    'nanafox-studio',
    String(now.getTime() / 1000),
    nonceBytes.toString('hex'),
    bodyHash,
  ].join('\n')
  assert.equal(
    captured.options.headers['X-NanaFox-Signature'],
    createHmac('sha256', signingMaterial).update(canonical).digest('hex'),
  )
  assert.equal('access_token' in result, false)
  assert.equal('refresh_token' in result, false)
})

test('Router auth client exposes account operations and current identity resolution', async () => {
  const paths = []
  const bodies = []
  const client = createRouterAuthClient({
    baseUrl,
    keyId,
    secret: signingMaterial,
    frontendBaseUrl: 'https://studio.nanafox.com/tools/image-studio',
    clock: () => now,
    randomBytes: () => nonceBytes,
    fetch: async (url, options) => {
      paths.push(new URL(url).pathname)
      bodies.push(JSON.parse(options.body))
      return Response.json({ code: 0, message: 'success', data: {} })
    },
  })

  await client.sendVerifyCode('studio@example.com', 'zh-CN')
  await client.forgotPassword('studio@example.com', 'zh-CN')
  await client.resetPassword('studio@example.com', resetToken, 'NewPassword123!')
  await client.register({ email: 'studio@example.com', password: loginValue, verifyCode: '246810' })
  await client.login('studio@example.com', loginValue)
  await client.login2FA('studio-challenge', '123456')
  await client.resolve('019c0000-0000-7000-8000-000000000042', 'studio@example.com')

  assert.deepEqual(paths, [
    '/internal/v1/studio-auth/send-verify-code',
    '/internal/v1/studio-auth/forgot-password',
    '/internal/v1/studio-auth/reset-password',
    '/internal/v1/studio-auth/register',
    '/internal/v1/studio-auth/login',
    '/internal/v1/studio-auth/login/2fa',
    '/internal/v1/studio-auth/resolve',
  ])
  assert.deepEqual(bodies[1], {
    email: 'studio@example.com',
    frontend_base_url: 'https://studio.nanafox.com/tools/image-studio',
  })
  assert.deepEqual(bodies[2], {
    email: 'studio@example.com',
    token: resetToken,
    new_password: 'NewPassword123!',
  })
})

test('Router auth client rejects unsafe configuration and preserves upstream errors', async () => {
  assert.throws(() => createRouterAuthClient({ baseUrl, keyId, secret: 's'.repeat(5) }), /at least 32 bytes/)
  assert.throws(() => createRouterAuthClient({ baseUrl: 'http://router.example.test', keyId, secret: signingMaterial }), /HTTPS/)
  assert.throws(() => createRouterAuthClient({ baseUrl, keyId, secret: signingMaterial, frontendBaseUrl: 'http://studio.example.test' }), /HTTPS/)

  const client = createRouterAuthClient({
    baseUrl,
    keyId,
    secret: signingMaterial,
    clock: () => now,
    randomBytes: () => nonceBytes,
    fetch: async () => Response.json({
      code: 401,
      message: 'invalid email or password',
      reason: 'INVALID_CREDENTIALS',
    }, { status: 401 }),
  })

  await assert.rejects(
    client.login('studio@example.com', 'wrong'),
    (error) => error instanceof RouterAuthError
      && error.status === 401
      && error.reason === 'INVALID_CREDENTIALS'
      && error.message === 'invalid email or password',
  )
})

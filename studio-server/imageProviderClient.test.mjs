import assert from 'node:assert/strict'
import test from 'node:test'

import { createImageProviderClient, ImageProviderError } from './imageProviderClient.mjs'

const apiKey = ['sk', 'studio', 'runtime', 'material'].join('-')

test('image provider client keeps model and credentials under server control', async () => {
  let captured
  const client = createImageProviderClient({
    baseUrl: 'https://router.nanafox.com/v1',
    apiKey,
    model: 'gpt-image-2',
    fetch: async (url, options) => {
      captured = { url, options }
      return Response.json({
        created: 1787760000,
        data: [{ b64_json: 'aW1hZ2UtYnl0ZXM=', revised_prompt: 'revised prompt' }],
        usage: { total_tokens: 1200 },
      })
    },
  })

  const result = await client.generate({
    prompt: '一只在月光下的银色狐狸',
    size: '1536x1024',
    quality: 'medium',
  })

  assert.equal(captured.url, 'https://router.nanafox.com/v1/images/generations')
  assert.equal(captured.options.headers.Authorization, `Bearer ${apiKey}`)
  assert.deepEqual(JSON.parse(captured.options.body), {
    model: 'gpt-image-2',
    prompt: '一只在月光下的银色狐狸',
    size: '1536x1024',
    quality: 'medium',
    output_format: 'png',
    n: 1,
  })
  assert.deepEqual(result, {
    images: [{ base64: 'aW1hZ2UtYnl0ZXM=', mimeType: 'image/png', revisedPrompt: 'revised prompt' }],
    usage: { total_tokens: 1200 },
  })
  assert.equal(JSON.stringify(result).includes(apiKey), false)
})

test('image provider client rejects browser-controlled models and unsupported parameters', () => {
  const client = createImageProviderClient({
    baseUrl: 'https://router.nanafox.com/v1',
    apiKey,
    model: 'gpt-image-2',
    fetch: async () => assert.fail('invalid requests must not reach Router'),
  })

  assert.throws(() => client.generate({ prompt: '', size: '1024x1024', quality: 'high' }), /prompt/)
  assert.throws(() => client.generate({ prompt: 'test', size: '2048x2048', quality: 'high' }), /size/)
  assert.throws(() => client.generate({ prompt: 'test', size: '1024x1024', quality: 'auto' }), /quality/)
  assert.throws(() => client.generate({ prompt: 'test', size: '1024x1024', quality: 'high', model: 'other-model' }), /model/)
})

test('image provider client bounds upstream failures without leaking credentials', async () => {
  const client = createImageProviderClient({
    baseUrl: 'https://router.nanafox.com/v1',
    apiKey,
    model: 'gpt-image-2',
    fetch: async () => Response.json({
      error: { message: `provider rejected ${apiKey}` },
    }, { status: 429 }),
  })

  await assert.rejects(
    client.generate({ prompt: 'test', size: '1024x1024', quality: 'high' }),
    (error) => error instanceof ImageProviderError
      && error.status === 429
      && error.reason === 'IMAGE_PROVIDER_REJECTED'
      && !error.message.includes(apiKey),
  )
})

test('image provider client rejects invalid configurations and malformed results', async () => {
  assert.throws(() => createImageProviderClient({
    baseUrl: 'http://router.nanafox.com/v1',
    apiKey,
    model: 'gpt-image-2',
  }), /HTTPS/)

  const client = createImageProviderClient({
    baseUrl: 'https://router.nanafox.com/v1',
    apiKey,
    model: 'gpt-image-2',
    fetch: async () => Response.json({ data: [{ url: 'https://temporary.example/image.png' }] }),
  })
  await assert.rejects(
    client.generate({ prompt: 'test', size: '1024x1024', quality: 'high' }),
    (error) => error instanceof ImageProviderError && error.reason === 'IMAGE_PROVIDER_PROTOCOL_ERROR',
  )
})

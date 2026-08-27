import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { ArtworkStoreError } from './artworkStore.mjs'
import { createR2ArtworkStore } from './r2ArtworkStore.mjs'

const userId = '019c0000-0000-7000-8000-000000000071'
const taskId = '019c0000-0000-7000-8000-000000000072'
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

test('R2 artworks use private conditional writes and server-side reads', async () => {
  const commands = []
  const client = {
    async send(command) {
      commands.push(command)
      if (command.input.IfNoneMatch === '*') return { ETag: '"etag-1"' }
      return { Body: { transformToByteArray: async () => png }, ContentType: 'image/png' }
    },
  }
  const store = createR2ArtworkStore({
    bucket: 'nanafox-studio-artworks-test',
    client,
  })

  const output = await store.save(taskId, {
    base64: png.toString('base64'),
    mimeType: 'image/png',
  }, userId)

  assert.equal(commands.length, 1)
  assert.equal(commands[0].input.Bucket, 'nanafox-studio-artworks-test')
  assert.equal(commands[0].input.Key, `${userId}/${taskId}.png`)
  assert.equal(commands[0].input.IfNoneMatch, '*')
  assert.equal(commands[0].input.ContentType, 'image/png')
  assert.deepEqual(Buffer.from(commands[0].input.Body), png)
  assert.deepEqual(output, {
    key: `${userId}/${taskId}.png`,
    url: `/api/artworks/${taskId}`,
    etag: 'etag-1',
    sha256: createHash('sha256').update(png).digest('hex'),
    bytes: png.length,
    mimeType: 'image/png',
  })
  assert.deepEqual(await store.read(output), { bytes: png, mimeType: 'image/png' })
  assert.equal(commands[1].input.Bucket, 'nanafox-studio-artworks-test')
  assert.equal(commands[1].input.Key, `${userId}/${taskId}.png`)
})

test('R2 artwork retries accept identical bytes but reject different output', async () => {
  const client = {
    async send(command) {
      if (command.input.IfNoneMatch === '*') {
        throw Object.assign(new Error('precondition failed'), { $metadata: { httpStatusCode: 412 } })
      }
      return { Body: { transformToByteArray: async () => png } }
    },
  }
  const store = createR2ArtworkStore({ bucket: 'nanafox-studio-artworks-test', client })
  const image = { base64: png.toString('base64'), mimeType: 'image/png' }

  assert.equal((await store.save(taskId, image, userId)).key, `${userId}/${taskId}.png`)
  const changed = Buffer.concat([png, Buffer.from([0x02])])
  await assert.rejects(
    store.save(taskId, { base64: changed.toString('base64'), mimeType: 'image/png' }, userId),
    (error) => error instanceof ArtworkStoreError && error.reason === 'OUTPUT_CONFLICT',
  )
})

test('R2 artwork references and bucket names fail closed', async () => {
  assert.throws(() => createR2ArtworkStore({ bucket: '../unsafe', client: { send() {} } }), /bucket/)
  const store = createR2ArtworkStore({ bucket: 'nanafox-studio-artworks-test', client: { send() {} } })
  await assert.rejects(store.read({ key: '../../private.png' }), /reference/)
})

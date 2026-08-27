import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { ArtworkStoreError } from './artworkStore.mjs'
import { createR2ArtworkStore } from './r2ArtworkStore.mjs'

const live = process.env.STUDIO_TEST_R2_LIVE === 'true'

test('private R2 bucket satisfies the Studio artwork contract', { skip: !live }, async (t) => {
  const store = createR2ArtworkStore({
    endpoint: required('STUDIO_R2_ENDPOINT'),
    bucket: required('STUDIO_R2_BUCKET'),
    accessKeyId: required('STUDIO_R2_ACCESS_KEY_ID'),
    secretAccessKey: required('STUDIO_R2_SECRET_ACCESS_KEY'),
    region: process.env.STUDIO_R2_REGION ?? 'auto',
  })
  const userId = randomUUID()
  const taskId = randomUUID()
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
  const image = { base64: png.toString('base64'), mimeType: 'image/png' }
  let output = await store.save(taskId, image, userId)
  t.after(async () => {
    if (output) await store.remove(output).catch(() => {})
  })

  assert.deepEqual(await store.read(output), { bytes: png, mimeType: 'image/png' })
  assert.equal((await store.save(taskId, image, userId)).key, output.key)
  await assert.rejects(
    store.save(taskId, { ...image, base64: Buffer.concat([png, Buffer.from([0x02])]).toString('base64') }, userId),
    (error) => error instanceof ArtworkStoreError && error.reason === 'OUTPUT_CONFLICT',
  )
  assert.equal(await store.remove(output), true)
  output = null
  await assert.rejects(store.read({ key: `${userId}/${taskId}.png` }), (error) => error.code === 'ENOENT')
})

function required(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required for live R2 tests`)
  return value
}

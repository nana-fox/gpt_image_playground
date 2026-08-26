import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ArtworkStoreError, createArtworkStore } from './artworkStore.mjs'

const userId = '019c0000-0000-7000-8000-000000000061'
const taskId = '019c0000-0000-7000-8000-000000000062'
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

async function withStore(t) {
  const root = await mkdtemp(join(tmpdir(), 'nanafox-studio-artworks-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return { root, store: createArtworkStore({ root }) }
}

test('artworks are stored as opaque PNG files and can be read back', async (t) => {
  const { root, store } = await withStore(t)
  const output = await store.save(taskId, {
    base64: png.toString('base64'),
    mimeType: 'image/png',
  }, userId)

  assert.deepEqual(output, {
    key: `${userId}/${taskId}.png`,
    url: `/api/artworks/${taskId}`,
  })
  assert.deepEqual(await store.read(output), {
    bytes: png,
    mimeType: 'image/png',
  })
  assert.deepEqual(await readdir(join(root, userId)), [`${taskId}.png`])
})

test('an identical retry is idempotent but cannot overwrite different bytes', async (t) => {
  const { store } = await withStore(t)
  const image = { base64: png.toString('base64'), mimeType: 'image/png' }
  const first = await store.save(taskId, image, userId)
  assert.deepEqual(await store.save(taskId, image, userId), first)

  const changed = Buffer.concat([png, Buffer.from([0x02])])
  await assert.rejects(
    store.save(taskId, { base64: changed.toString('base64'), mimeType: 'image/png' }, userId),
    (error) => error instanceof ArtworkStoreError && error.reason === 'OUTPUT_CONFLICT',
  )
  assert.deepEqual((await store.read(first)).bytes, png)
})

test('artwork validation rejects malformed images and unsafe references', async (t) => {
  const { store } = await withStore(t)

  await assert.rejects(
    store.save('../escape', { base64: png.toString('base64'), mimeType: 'image/png' }, userId),
    /task id/,
  )
  await assert.rejects(
    store.save(taskId, { base64: Buffer.from('not-png').toString('base64'), mimeType: 'image/png' }, userId),
    (error) => error instanceof ArtworkStoreError && error.reason === 'OUTPUT_STORAGE_FAILED',
  )
  await assert.rejects(
    store.read({ key: '../../private.png' }),
    /reference/,
  )
})

test('artwork cleanup removes only the referenced output', async (t) => {
  const { store } = await withStore(t)
  const output = await store.save(taskId, {
    base64: png.toString('base64'),
    mimeType: 'image/png',
  }, userId)

  assert.equal(await store.remove(output), true)
  assert.equal(await store.remove(output), false)
  await assert.rejects(store.read(output), (error) => error?.code === 'ENOENT')
})

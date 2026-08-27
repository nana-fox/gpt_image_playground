import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { artworkMetadata, decodeArtworkImage, validateArtworkId, validateArtworkKey } from './artworkValidation.mjs'

export class ArtworkStoreError extends Error {
  constructor(message, reason = 'OUTPUT_STORAGE_FAILED') {
    super(message)
    this.name = 'ArtworkStoreError'
    this.reason = reason
  }
}

export function createArtworkStore(options = {}) {
  const root = resolve(String(options.root ?? '').trim())
  if (!String(options.root ?? '').trim()) throw new Error('Studio artwork root is required')
  const maxBytes = options.maxBytes === undefined ? 50 * 1024 * 1024 : Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 100 * 1024 * 1024) {
    throw new Error('Studio artwork size limit is invalid')
  }

  return {
    async save(taskId, image, userId) {
      const task = validateArtworkId(taskId, 'task id')
      const user = validateArtworkId(userId, 'user id')
      const bytes = decodeArtworkImage(image, maxBytes, ArtworkStoreError)
      const key = `${user}/${task}.png`
      const dir = resolve(root, user)
      const target = resolveKey(root, key)
      const temporary = resolve(dir, `.${task}.${randomUUID()}.tmp`)

      try {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        try {
          await link(temporary, target)
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
          const existing = await readFile(target)
          if (!existing.equals(bytes)) {
            throw new ArtworkStoreError('同一创作任务不能覆盖不同作品', 'OUTPUT_CONFLICT')
          }
        } finally {
          await unlink(temporary).catch((error) => {
            if (error?.code !== 'ENOENT') throw error
          })
        }
        return artworkMetadata(key, task, bytes)
      } catch (error) {
        if (error instanceof ArtworkStoreError) throw error
        throw new ArtworkStoreError('作品保存失败')
      }
    },

    async read(output) {
      const target = resolveKey(root, output?.key)
      const bytes = await readFile(target)
      return { bytes, mimeType: 'image/png' }
    },

    async remove(output) {
      const target = resolveKey(root, output?.key)
      try {
        await unlink(target)
        return true
      } catch (error) {
        if (error?.code === 'ENOENT') return false
        throw error
      }
    },
  }
}

function resolveKey(root, value) {
  const key = validateArtworkKey(value)
  const target = resolve(root, key)
  if (!target.startsWith(`${root}${sep}`)) throw new Error('Studio artwork reference is invalid')
  return target
}

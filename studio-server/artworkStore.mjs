import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

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
      const task = validateId(taskId, 'task id')
      const user = validateId(userId, 'user id')
      const bytes = decodeImage(image, maxBytes)
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
        return { key, url: `/api/artworks/${task}` }
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

function validateId(value, label) {
  const id = String(value ?? '').trim()
  if (!SAFE_ID.test(id)) throw new Error(`Studio artwork ${label} is invalid`)
  return id
}

function resolveKey(root, value) {
  const key = String(value ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.png$/.test(key)) {
    throw new Error('Studio artwork reference is invalid')
  }
  const target = resolve(root, key)
  if (!target.startsWith(`${root}${sep}`)) throw new Error('Studio artwork reference is invalid')
  return target
}

function decodeImage(image, maxBytes) {
  const base64 = String(image?.base64 ?? '').trim()
  if (image?.mimeType !== 'image/png' || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new ArtworkStoreError('图像结果格式无效')
  }
  const bytes = Buffer.from(base64, 'base64')
  const canonical = bytes.toString('base64').replace(/=+$/, '')
  if (canonical !== base64.replace(/=+$/, '') || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ArtworkStoreError('图像结果格式无效')
  }
  if (bytes.length > maxBytes) throw new ArtworkStoreError('图像结果超过存储限制')
  return bytes
}

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { ArtworkStoreError } from './artworkStore.mjs'
import { artworkMetadata, decodeArtworkImage, validateArtworkId, validateArtworkKey } from './artworkValidation.mjs'

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

export function createR2ArtworkStore(options = {}) {
  const bucket = String(options.bucket ?? '').trim()
  if (!BUCKET_NAME.test(bucket) || bucket.includes('..')) throw new Error('Studio R2 bucket is invalid')
  const maxBytes = options.maxBytes === undefined ? 50 * 1024 * 1024 : Number(options.maxBytes)
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 100 * 1024 * 1024) {
    throw new Error('Studio artwork size limit is invalid')
  }
  const client = options.client ?? new S3Client({
    endpoint: options.endpoint,
    region: options.region ?? 'auto',
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  })

  return {
    async save(taskId, image, userId) {
      const task = validateArtworkId(taskId, 'task id')
      const user = validateArtworkId(userId, 'user id')
      const bytes = decodeArtworkImage(image, maxBytes, ArtworkStoreError)
      const key = `${user}/${task}.png`

      try {
        const result = await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: 'image/png',
          IfNoneMatch: '*',
          Metadata: { sha256: artworkMetadata(key, task, bytes).sha256 },
        }))
        return artworkMetadata(key, task, bytes, normalizeEtag(result.ETag))
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 412) throw storageError(error)
        const existing = await readObject(client, bucket, key, maxBytes)
        if (!existing.bytes.equals(bytes)) {
          throw new ArtworkStoreError('同一创作任务不能覆盖不同作品', 'OUTPUT_CONFLICT')
        }
        return artworkMetadata(key, task, bytes, existing.etag)
      }
    },

    async read(output) {
      const result = await readObject(client, bucket, validateArtworkKey(output?.key), maxBytes)
      return { bytes: result.bytes, mimeType: result.mimeType }
    },

    async remove(output) {
      const key = validateArtworkKey(output?.key)
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch (error) {
        throw storageError(error)
      }
    },
  }
}

async function readObject(client, bucket, key, maxBytes) {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body?.transformToByteArray) throw new Error('R2 object body is missing')
    if (Number(result.ContentLength) > maxBytes) throw new ArtworkStoreError('作品大小超出限制')
    const bytes = Buffer.from(await result.Body.transformToByteArray())
    if (bytes.length > maxBytes) throw new ArtworkStoreError('作品大小超出限制')
    return {
      bytes,
      mimeType: result.ContentType === 'image/png' ? result.ContentType : 'image/png',
      etag: normalizeEtag(result.ETag),
    }
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      throw Object.assign(new Error('Studio artwork not found'), { code: 'ENOENT' })
    }
    if (error instanceof ArtworkStoreError || error?.code === 'ENOENT') throw error
    throw storageError(error)
  }
}

function normalizeEtag(value) {
  return String(value ?? '').replace(/^"|"$/g, '') || null
}

function storageError(error) {
  if (error instanceof ArtworkStoreError) return error
  return new ArtworkStoreError('作品保存失败')
}

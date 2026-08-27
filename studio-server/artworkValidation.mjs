import { createHash } from 'node:crypto'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function validateArtworkId(value, label) {
  const id = String(value ?? '').trim()
  if (!SAFE_ID.test(id)) throw new Error(`Studio artwork ${label} is invalid`)
  return id
}

export function validateArtworkKey(value) {
  const key = String(value ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.png$/.test(key)) {
    throw new Error('Studio artwork reference is invalid')
  }
  return key
}

export function decodeArtworkImage(image, maxBytes, ErrorType) {
  const base64 = String(image?.base64 ?? '').trim()
  if (image?.mimeType !== 'image/png' || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new ErrorType('图像结果格式无效')
  }
  const bytes = Buffer.from(base64, 'base64')
  const canonical = bytes.toString('base64').replace(/=+$/, '')
  if (canonical !== base64.replace(/=+$/, '') || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ErrorType('图像结果格式无效')
  }
  if (bytes.length > maxBytes) throw new ErrorType('图像结果超过存储限制')
  return bytes
}

export function artworkMetadata(key, taskId, bytes, etag = null) {
  return {
    key,
    url: `/api/artworks/${taskId}`,
    etag,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mimeType: 'image/png',
  }
}

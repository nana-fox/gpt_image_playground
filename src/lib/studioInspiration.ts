import { studioApiPath } from './studioApi'

export type StudioInspiration = {
  id: string
  category: string
  title: string
  description: string
  prompt: string
  image: string
  featured: boolean
  sortOrder: number
  version: number
}

export async function listStudioInspirations(request: typeof fetch = fetch): Promise<StudioInspiration[]> {
  let response
  try {
    response = await request(studioApiPath('inspirations'), { credentials: 'same-origin' })
  } catch {
    throw new Error('灵感暂时无法读取，请稍后重试')
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw new Error('灵感服务返回了无法识别的数据')
  }
  const record = envelope as { ok?: unknown, data?: unknown, error?: { message?: unknown } }
  if (!response.ok || record.ok !== true) {
    throw new Error(typeof record.error?.message === 'string' ? record.error.message : '灵感暂时无法读取，请稍后重试')
  }
  if (!Array.isArray(record.data)) throw new Error('灵感服务返回了无法识别的数据')
  return record.data.map(normalizeStudioInspiration)
}

export function normalizeStudioInspiration(value: unknown): StudioInspiration {
  const item = value as Partial<StudioInspiration> | undefined
  if (
    !item
    || typeof item.id !== 'string'
    || typeof item.category !== 'string'
    || typeof item.title !== 'string'
    || typeof item.description !== 'string'
    || typeof item.prompt !== 'string'
    || typeof item.image !== 'string'
    || typeof item.featured !== 'boolean'
    || !Number.isInteger(item.sortOrder)
    || !Number.isInteger(item.version)
  ) throw new Error('灵感服务返回了无法识别的数据')
  return item as StudioInspiration
}

import type { InputImage, StoredImage, TaskRecord } from '../types'
import { hashDataUrl, storeImage } from './db'
import { cacheImage, ensureImageCached } from './imageCache'
import { isNanafoxEmbedded } from './deploymentFlavor'
import { isEmbeddedSessionActive } from './embeddedSession'

export const EPHEMERAL_INPUT_UNAVAILABLE_MESSAGE = '原参考图仅在创建任务的页面会话中可用，刷新后无法重试或复用。'

const ephemeralImages = new Map<string, string>()

function usesEphemeralInputs() {
  return isNanafoxEmbedded() || isEmbeddedSessionActive()
}

export async function retainInputImage(
  dataUrl: string,
  source: NonNullable<StoredImage['source']> = 'upload',
): Promise<InputImage> {
  const ephemeral = usesEphemeralInputs()
  const id = ephemeral ? await hashDataUrl(dataUrl) : await storeImage(dataUrl, source)
  if (ephemeral) ephemeralImages.set(id, dataUrl)
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

export function isEphemeralImage(id: string) {
  return ephemeralImages.has(id)
}

export function deleteEphemeralImage(id: string) {
  ephemeralImages.delete(id)
}

export function clearEphemeralImages() {
  ephemeralImages.clear()
}

export async function resolveRetainedImage(id: string) {
  return ephemeralImages.get(id) ?? await ensureImageCached(id)
}

export function hasUnavailableEphemeralInputs(task: TaskRecord) {
  if (task.ephemeralInputImageIds?.some((id) => !ephemeralImages.has(id))) return true
  return Boolean(task.ephemeralMaskImage && task.maskImageId && !ephemeralImages.has(task.maskImageId))
}

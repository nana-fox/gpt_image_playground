import { readStudioCookie } from './studioAuth'
import { studioApiPath } from './studioApi'

export type StudioGenerationInput = {
  prompt: string
  size: '1024x1024' | '1536x1024' | '1024x1536'
  quality: 'low' | 'medium' | 'high'
}

export type StudioGenerationTask = {
  id: string
  input: StudioGenerationInput
  status: 'created' | 'reserved' | 'running' | 'output_stored' | 'succeeded' | 'failed'
  errorReason: string | null
  createdAt: string
  updatedAt: string
  output: null | {
    url: string
    revisedPrompt?: string
    usage?: Record<string, unknown>
  }
}

export class StudioGenerationError extends Error {
  status: number
  reason: string

  constructor(message: string, status = 500, reason = 'GENERATION_ERROR') {
    super(message)
    this.name = 'StudioGenerationError'
    this.status = status
    this.reason = reason
  }
}

export function createStudioGeneration(
  input: StudioGenerationInput,
  idempotencyKey: string,
  request: typeof fetch = fetch,
) {
  return call(studioApiPath('generations'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-CSRF-Token': readStudioCookie('nanafox_studio_csrf'),
    },
    body: JSON.stringify(input),
  }, request).then(normalizeTask)
}

export function listStudioGenerations(request: typeof fetch = fetch) {
  return call(studioApiPath('generations'), { credentials: 'same-origin' }, request).then((data) => {
    if (!Array.isArray(data)) throw protocolError()
    return data.map(normalizeTask)
  })
}

async function call(path: string, init: RequestInit, request: typeof fetch) {
  let response
  try {
    response = await request(path, init)
  } catch {
    throw new StudioGenerationError('网络连接失败，请稍后重试', 0, 'NETWORK_ERROR')
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw protocolError()
  }
  const record = envelope as {
    ok?: unknown
    data?: unknown
    error?: { reason?: unknown, message?: unknown }
  }
  if (!response.ok || record.ok !== true) {
    throw new StudioGenerationError(
      typeof record.error?.message === 'string' ? record.error.message : '创作请求失败，请稍后重试',
      response.status,
      typeof record.error?.reason === 'string' ? record.error.reason : 'GENERATION_ERROR',
    )
  }
  return record.data
}

function normalizeTask(value: unknown): StudioGenerationTask {
  const task = value as Partial<StudioGenerationTask> | undefined
  const input = task?.input as Partial<StudioGenerationInput> | undefined
  const output = task?.output as Partial<NonNullable<StudioGenerationTask['output']>> | null | undefined
  const statuses = new Set<StudioGenerationTask['status']>(['created', 'reserved', 'running', 'output_stored', 'succeeded', 'failed'])
  const sizes = new Set<StudioGenerationInput['size']>(['1024x1024', '1536x1024', '1024x1536'])
  const qualities = new Set<StudioGenerationInput['quality']>(['low', 'medium', 'high'])
  if (
    !task
    || typeof task.id !== 'string'
    || !input
    || typeof input.prompt !== 'string'
    || !sizes.has(input.size as StudioGenerationInput['size'])
    || !qualities.has(input.quality as StudioGenerationInput['quality'])
    || !statuses.has(task.status as StudioGenerationTask['status'])
    || !(task.errorReason === null || typeof task.errorReason === 'string')
    || typeof task.createdAt !== 'string'
    || typeof task.updatedAt !== 'string'
    || !(output === null || (output && typeof output.url === 'string' && output.url.startsWith(studioApiPath('artworks/'))))
  ) {
    throw protocolError()
  }
  return task as StudioGenerationTask
}

function protocolError() {
  return new StudioGenerationError('创作服务返回了无效结果', 502, 'PROTOCOL_ERROR')
}

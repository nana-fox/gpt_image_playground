import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createStudioGeneration,
  listStudioGenerations,
  StudioGenerationError,
} from './studioGeneration'

const task = {
  id: 'task-1',
  input: { prompt: '月光下的银色狐狸', size: '1024x1024', quality: 'high' },
  status: 'succeeded',
  errorReason: null,
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:01:00.000Z',
  output: { url: '/api/artworks/task-1', revisedPrompt: '银色狐狸站在月光下' },
}

beforeEach(() => {
  document.cookie = 'nanafox_studio_csrf=csrf-token; Path=/'
})

describe('Studio generation client', () => {
  it('creates through the same-origin backend with CSRF and idempotency', async () => {
    const request = vi.fn(async () => Response.json({ ok: true, data: task }, { status: 201 }))
    await expect(createStudioGeneration(task.input, 'request-1', request)).resolves.toEqual(task)

    expect(request).toHaveBeenCalledWith('/api/generations', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-1',
        'X-CSRF-Token': 'csrf-token',
      },
      body: JSON.stringify(task.input),
    })
  })

  it('loads only validated generation history', async () => {
    const request = vi.fn(async () => Response.json({ ok: true, data: [task] }))
    await expect(listStudioGenerations(request)).resolves.toEqual([task])

    const malformed = vi.fn(async () => Response.json({ ok: true, data: [{ ...task, status: 'unknown' }] }))
    await expect(listStudioGenerations(malformed)).rejects.toMatchObject({ reason: 'PROTOCOL_ERROR' })
  })

  it('preserves bounded API errors for quota and retry handling', async () => {
    const request = vi.fn(async () => Response.json({
      ok: false,
      error: { reason: 'QUOTA_EXHAUSTED', message: '创作额度不足' },
    }, { status: 402 }))

    await expect(createStudioGeneration(task.input, 'request-2', request)).rejects.toEqual(
      new StudioGenerationError('创作额度不足', 402, 'QUOTA_EXHAUSTED'),
    )
  })
})

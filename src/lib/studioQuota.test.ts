import { describe, expect, it, vi } from 'vitest'

import { getStudioQuota } from './studioQuota'

describe('Studio quota client', () => {
  it('loads only the authenticated same-origin balance', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: {
        free: { eligible: true, enabled: true, limit: 3, used: 1, remaining: 2 },
        credits: 10,
        subscriber: false,
        planId: null,
      },
    }))

    await expect(getStudioQuota(request)).resolves.toEqual({
      free: { eligible: true, enabled: true, limit: 3, used: 1, remaining: 2 },
      credits: 10,
      subscriber: false,
      planId: null,
    })
    expect(request).toHaveBeenCalledWith('/api/quota', { credentials: 'same-origin' })
  })

  it('rejects malformed or failed balance responses', async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: { message: '请先登录' },
    }, { status: 401 }))
    await expect(getStudioQuota(failed)).rejects.toThrow('请先登录')

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: { free: { remaining: -1 } },
    }))
    await expect(getStudioQuota(malformed)).rejects.toThrow('额度数据无效')
  })
})

import { describe, expect, it, vi } from 'vitest'

import { getStudioQuota, quotaDescription, quotaHeader, quotaUsageText } from './studioQuota'

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

  it('keeps quota copy consistent across the header, composer, and plans page', () => {
    const quota = {
      free: { eligible: true, enabled: true, limit: 3, used: 1, remaining: 2 },
      credits: 1,
      subscriber: false,
      planId: null,
    }

    expect(quotaHeader(quota)).toBe('今日 2/3 次')
    expect(quotaDescription(quota)).toBe('今天还剩 2 次，明天自动恢复。另有 1 次购买或订阅额度。')
    expect(quotaUsageText(quota)).toBe('使用 1 次今日免费额度')
  })
})

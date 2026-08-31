import { studioApiPath } from './studioApi'

export interface StudioQuotaBalance {
  free: {
    eligible: boolean
    enabled: boolean
    limit: number
    used: number
    remaining: number
  }
  credits: number
  subscriber: boolean
  planId: string | null
}

export async function getStudioQuota(request: typeof fetch = fetch): Promise<StudioQuotaBalance> {
  let response
  try {
    response = await request(studioApiPath('quota'), { credentials: 'same-origin' })
  } catch {
    throw new Error('额度服务暂时不可用')
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw new Error('额度数据无效')
  }
  const record = envelope as {
    ok?: unknown
    data?: unknown
    error?: { message?: unknown }
  }
  if (!response.ok || record.ok !== true) {
    throw new Error(typeof record.error?.message === 'string' ? record.error.message : '额度加载失败')
  }

  const data = record.data as Partial<StudioQuotaBalance> | undefined
  const free = data?.free
  if (
    !free
    || typeof free.eligible !== 'boolean'
    || typeof free.enabled !== 'boolean'
    || !validCount(free.limit)
    || !validCount(free.used)
    || !validCount(free.remaining)
    || !validCount(data.credits)
    || typeof data.subscriber !== 'boolean'
    || !(data.planId === null || typeof data.planId === 'string')
  ) {
    throw new Error('额度数据无效')
  }
  return {
    free: {
      eligible: free.eligible,
      enabled: free.enabled,
      limit: free.limit,
      used: free.used,
      remaining: free.remaining,
    },
    credits: data.credits,
    subscriber: data.subscriber,
    planId: data.planId,
  }
}

export function quotaHeader(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '额度读取中'
  if (quota === null) return '额度暂不可用'
  if (quota.free.enabled && quota.free.eligible) return `今日 ${quota.free.remaining}/${quota.free.limit} 次`
  return `${quota.credits} 次可用`
}

export function quotaDescription(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '正在读取你的真实额度。'
  if (quota === null) return '额度服务暂时不可用，请稍后重试。'
  if (quota.free.enabled && quota.free.eligible) return `今天还剩 ${quota.free.remaining} 次，明天自动恢复。${quota.credits ? `另有 ${quota.credits} 次购买或订阅额度。` : ''}`
  return quota.credits ? `当前有 ${quota.credits} 次购买或订阅额度。` : '当前没有可用额度。'
}

export function quotaUsageText(quota: StudioQuotaBalance | null | undefined) {
  if (quota === undefined) return '正在确认本次额度'
  if (quota === null) return '额度暂时无法读取'
  if (quota.free.enabled && quota.free.remaining > 0) return '使用 1 次今日免费额度'
  if (quota.credits > 0) return '使用 1 次购买或订阅额度'
  return '当前没有可用额度'
}

function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

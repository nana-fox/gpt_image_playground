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
    response = await request('/api/quota', { credentials: 'same-origin' })
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

function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

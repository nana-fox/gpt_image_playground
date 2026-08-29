import { readStudioCookie } from './studioAuth'
import { studioApiPath } from './studioApi'

export type StudioPaymentPlan = {
  id: string
  kind: 'subscription' | 'pack'
  name: string
  description: string
  priceCents: number
  currency: 'CNY'
  credits: number
  durationDays: number
  purchasable: boolean
  paymentMethods: StudioPaymentMethod[]
}

export type StudioPaymentMethod = {
  providerKey: 'wxpay' | 'alipay'
  name: string
}

export type StudioPaymentOrder = {
  id: string
  status: 'pending' | 'completed' | 'expired' | 'failed'
  provider: 'wxpay_native' | 'alipay_page'
  plan: Omit<StudioPaymentPlan, 'purchasable'>
  amountCents: number
  currency: 'CNY'
  codeUrl: string | null
  payUrl: string | null
  expiresAt: string
  paidAt: string | null
  completedAt: string | null
}

export class StudioPaymentError extends Error {
  status: number
  reason: string

  constructor(message: string, status = 500, reason = 'PAYMENT_ERROR') {
    super(message)
    this.name = 'StudioPaymentError'
    this.status = status
    this.reason = reason
  }
}

export async function listStudioPaymentPlans(request: typeof fetch = fetch): Promise<StudioPaymentPlan[]> {
  const data = await call('payments/plans', { credentials: 'same-origin' }, request)
  if (!Array.isArray(data)) throw protocolError()
  return data.map(normalizePlan)
}

export async function createStudioPaymentOrder(planId: string, idempotencyKey: string, providerKey: StudioPaymentMethod['providerKey'], request: typeof fetch = fetch) {
  return normalizeOrder(await call('payments/orders', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': readStudioCookie('nanafox_studio_csrf'),
    },
    body: JSON.stringify({ planId, idempotencyKey, providerKey }),
  }, request))
}

export async function getStudioPaymentOrder(id: string, request: typeof fetch = fetch) {
  return normalizeOrder(await call(`payments/orders/${encodeURIComponent(id)}`, { credentials: 'same-origin' }, request))
}

async function call(path: string, init: RequestInit, request: typeof fetch) {
  let response
  try {
    response = await request(studioApiPath(path), init)
  } catch {
    throw new StudioPaymentError('支付服务暂时无法连接', 0, 'NETWORK_ERROR')
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw protocolError()
  }
  const record = envelope as { ok?: unknown, data?: unknown, error?: { reason?: unknown, message?: unknown } }
  if (!response.ok || record.ok !== true) {
    throw new StudioPaymentError(
      typeof record.error?.message === 'string' ? record.error.message : '支付请求失败',
      response.status,
      typeof record.error?.reason === 'string' ? record.error.reason : 'PAYMENT_ERROR',
    )
  }
  return record.data
}

function normalizePlan(value: unknown): StudioPaymentPlan {
  const plan = value as Partial<StudioPaymentPlan> | undefined
  if (
    !plan
    || typeof plan.id !== 'string'
    || (plan.kind !== 'subscription' && plan.kind !== 'pack')
    || typeof plan.name !== 'string'
    || typeof plan.description !== 'string'
    || !positiveInteger(plan.priceCents)
    || plan.currency !== 'CNY'
    || !positiveInteger(plan.credits)
    || !positiveInteger(plan.durationDays)
    || typeof plan.purchasable !== 'boolean'
    || !Array.isArray(plan.paymentMethods)
    || plan.paymentMethods.some((method) => (
      !method
      || (method.providerKey !== 'wxpay' && method.providerKey !== 'alipay')
      || typeof method.name !== 'string'
    ))
  ) throw protocolError()
  return plan as StudioPaymentPlan
}

function normalizeOrder(value: unknown): StudioPaymentOrder {
  const order = value as Partial<StudioPaymentOrder> | undefined
  if (
    !order
    || typeof order.id !== 'string'
    || !['pending', 'completed', 'expired', 'failed'].includes(String(order.status))
    || (order.provider !== 'wxpay_native' && order.provider !== 'alipay_page')
    || !order.plan
    || !positiveInteger(order.amountCents)
    || order.currency !== 'CNY'
    || !(order.codeUrl === null || typeof order.codeUrl === 'string')
    || !(order.payUrl === null || typeof order.payUrl === 'string')
    || typeof order.expiresAt !== 'string'
    || !(order.paidAt === null || typeof order.paidAt === 'string')
    || !(order.completedAt === null || typeof order.completedAt === 'string')
  ) throw protocolError()
  normalizePlan({ ...order.plan, purchasable: true, paymentMethods: [] })
  return order as StudioPaymentOrder
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function protocolError() {
  return new StudioPaymentError('支付服务返回了无效结果', 502, 'PROTOCOL_ERROR')
}

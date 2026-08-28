import { readStudioCookie } from './studioAuth'
import { studioApiPath } from './studioApi'
import { normalizeStudioInspiration, type StudioInspiration } from './studioInspiration'

export type StudioAdminUser = {
  id: string
  email: string
  displayName: string
}

export type StudioAdminSession = {
  admin: true
  user: StudioAdminUser
}

export type StudioQuotaPolicy = {
  enabled: boolean
  dailyLimit: number
  timezone: string
  version: number
}

export type StudioCreditGrant = {
  id: string
  source: string
  total: number
  remaining: number
  expiresAt: string | null
  reference: string
}

export type StudioAdminPaymentPlan = {
  id: string
  kind: 'subscription' | 'pack'
  name: string
  description: string
  priceCents: number
  currency: 'CNY'
  credits: number
  durationDays: number
  enabled: boolean
  sortOrder: number
  version: number
}

export type StudioPaymentChannel = {
  provider: 'wxpay_native'
  credentialsReady: boolean
  acceptingOrders: boolean
  checkoutAvailable: boolean
  notifyUrl: string
  version: number
}

export type StudioAdminInspiration = StudioInspiration & {
  enabled: boolean
}

export class StudioAdminError extends Error {
  status: number
  reason: string

  constructor(message: string, status = 500, reason = 'ADMIN_ERROR') {
    super(message)
    this.name = 'StudioAdminError'
    this.status = status
    this.reason = reason
  }
}

export async function getStudioAdminSession(request: typeof fetch = fetch): Promise<StudioAdminSession | null> {
  const response = await request(studioApiPath('admin/me'), { credentials: 'same-origin' })
  if (response.status === 401 || response.status === 403) return null
  const data = await readData(response)
  const record = data as Partial<StudioAdminSession>
  if (record.admin !== true || !validUser(record.user)) throw protocolError()
  return { admin: true, user: record.user }
}

export async function getStudioQuotaPolicy(request: typeof fetch = fetch): Promise<StudioQuotaPolicy> {
  return normalizePolicy(await call('admin/quota-policy', { credentials: 'same-origin' }, request))
}

export async function updateStudioQuotaPolicy(policy: StudioQuotaPolicy, request: typeof fetch = fetch): Promise<StudioQuotaPolicy> {
  return normalizePolicy(await call('admin/quota-policy', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: writeHeaders(),
    body: JSON.stringify({
      enabled: policy.enabled,
      dailyLimit: policy.dailyLimit,
      timezone: policy.timezone,
      expectedVersion: policy.version,
    }),
  }, request))
}

export async function searchStudioUsers(query: string, request: typeof fetch = fetch): Promise<StudioAdminUser[]> {
  const params = new URLSearchParams({ query: query.trim(), limit: '20' })
  const data = await call(`admin/users?${params}`, { credentials: 'same-origin' }, request)
  if (!Array.isArray(data) || data.some((user) => !validUser(user))) throw protocolError()
  return data
}

export async function grantStudioCredits(
  userId: string,
  grant: { units: number, reference: string, expiresAt: string | null },
  request: typeof fetch = fetch,
): Promise<StudioCreditGrant> {
  return normalizeGrant(await call(`admin/users/${encodeURIComponent(userId)}/credits`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: writeHeaders(),
    body: JSON.stringify(grant),
  }, request))
}

export async function getStudioPaymentPlans(request: typeof fetch = fetch): Promise<StudioAdminPaymentPlan[]> {
  const data = await call('admin/payment-plans', { credentials: 'same-origin' }, request)
  if (!Array.isArray(data)) throw protocolError()
  return data.map(normalizePaymentPlan)
}

export async function getStudioPaymentChannel(request: typeof fetch = fetch): Promise<StudioPaymentChannel> {
  return normalizePaymentChannel(await call('admin/payment-channel', { credentials: 'same-origin' }, request))
}

export async function updateStudioPaymentChannel(channel: StudioPaymentChannel, request: typeof fetch = fetch): Promise<StudioPaymentChannel> {
  return normalizePaymentChannel(await call('admin/payment-channel', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: writeHeaders(),
    body: JSON.stringify({ acceptingOrders: channel.acceptingOrders, expectedVersion: channel.version }),
  }, request))
}

export async function updateStudioPaymentPlan(plan: StudioAdminPaymentPlan, request: typeof fetch = fetch) {
  return normalizePaymentPlan(await call(`admin/payment-plans/${encodeURIComponent(plan.id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: writeHeaders(),
    body: JSON.stringify({
      name: plan.name,
      description: plan.description,
      priceCents: plan.priceCents,
      credits: plan.credits,
      durationDays: plan.durationDays,
      enabled: plan.enabled,
      sortOrder: plan.sortOrder,
      expectedVersion: plan.version,
    }),
  }, request))
}

export async function getStudioAdminInspirations(request: typeof fetch = fetch): Promise<StudioAdminInspiration[]> {
  const data = await call('admin/inspirations', { credentials: 'same-origin' }, request)
  if (!Array.isArray(data)) throw protocolError()
  return data.map(normalizeAdminInspiration)
}

export async function createStudioInspiration(inspiration: StudioAdminInspiration, request: typeof fetch = fetch) {
  return normalizeAdminInspiration(await call('admin/inspirations', {
    method: 'POST',
    credentials: 'same-origin',
    headers: writeHeaders(),
    body: JSON.stringify(inspirationInput(inspiration)),
  }, request))
}

export async function updateStudioInspiration(inspiration: StudioAdminInspiration, request: typeof fetch = fetch) {
  return normalizeAdminInspiration(await call(`admin/inspirations/${encodeURIComponent(inspiration.id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: writeHeaders(),
    body: JSON.stringify({ ...inspirationInput(inspiration), expectedVersion: inspiration.version }),
  }, request))
}

async function call(path: string, init: RequestInit, request: typeof fetch) {
  let response
  try {
    response = await request(studioApiPath(path), init)
  } catch {
    throw new StudioAdminError('运营服务暂时不可用', 0, 'NETWORK_ERROR')
  }
  return readData(response)
}

async function readData(response: Response) {
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
    throw new StudioAdminError(
      typeof record.error?.message === 'string' ? record.error.message : '运营请求失败',
      response.status,
      typeof record.error?.reason === 'string' ? record.error.reason : 'ADMIN_ERROR',
    )
  }
  return record.data
}

function normalizePolicy(value: unknown): StudioQuotaPolicy {
  const policy = value as Partial<StudioQuotaPolicy> | undefined
  if (
    !policy
    || typeof policy.enabled !== 'boolean'
    || !validCount(policy.dailyLimit)
    || typeof policy.timezone !== 'string'
    || !Number.isInteger(policy.version)
    || Number(policy.version) < 1
  ) throw protocolError()
  return policy as StudioQuotaPolicy
}

function normalizeGrant(value: unknown): StudioCreditGrant {
  const grant = value as Partial<StudioCreditGrant> | undefined
  if (
    !grant
    || typeof grant.id !== 'string'
    || typeof grant.source !== 'string'
    || !validCount(grant.total)
    || !validCount(grant.remaining)
    || !(grant.expiresAt === null || typeof grant.expiresAt === 'string')
    || typeof grant.reference !== 'string'
  ) throw protocolError()
  return grant as StudioCreditGrant
}

function normalizePaymentPlan(value: unknown): StudioAdminPaymentPlan {
  const plan = value as Partial<StudioAdminPaymentPlan> | undefined
  if (
    !plan
    || typeof plan.id !== 'string'
    || (plan.kind !== 'subscription' && plan.kind !== 'pack')
    || typeof plan.name !== 'string'
    || typeof plan.description !== 'string'
    || !positiveCount(plan.priceCents)
    || plan.currency !== 'CNY'
    || !positiveCount(plan.credits)
    || !positiveCount(plan.durationDays)
    || typeof plan.enabled !== 'boolean'
    || !validCount(plan.sortOrder)
    || !positiveCount(plan.version)
  ) throw protocolError()
  return plan as StudioAdminPaymentPlan
}

function normalizePaymentChannel(value: unknown): StudioPaymentChannel {
  const channel = value as Partial<StudioPaymentChannel> | undefined
  if (
    !channel
    || channel.provider !== 'wxpay_native'
    || typeof channel.credentialsReady !== 'boolean'
    || typeof channel.acceptingOrders !== 'boolean'
    || typeof channel.checkoutAvailable !== 'boolean'
    || typeof channel.notifyUrl !== 'string'
    || !positiveCount(channel.version)
  ) throw protocolError()
  return channel as StudioPaymentChannel
}

function normalizeAdminInspiration(value: unknown): StudioAdminInspiration {
  const item = normalizeStudioInspiration(value)
  if (typeof (value as Partial<StudioAdminInspiration>).enabled !== 'boolean') throw protocolError()
  return { ...item, enabled: (value as StudioAdminInspiration).enabled }
}

function inspirationInput(inspiration: StudioAdminInspiration) {
  return {
    category: inspiration.category,
    title: inspiration.title,
    description: inspiration.description,
    prompt: inspiration.prompt,
    image: inspiration.image,
    enabled: inspiration.enabled,
    featured: inspiration.featured,
    sortOrder: inspiration.sortOrder,
  }
}

function validUser(value: unknown): value is StudioAdminUser {
  const user = value as Partial<StudioAdminUser> | undefined
  return Boolean(user && typeof user.id === 'string' && typeof user.email === 'string' && typeof user.displayName === 'string')
}

function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function positiveCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function writeHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': readStudioCookie('nanafox_studio_csrf'),
  }
}

function protocolError() {
  return new StudioAdminError('运营服务返回了无效结果', 502, 'PROTOCOL_ERROR')
}

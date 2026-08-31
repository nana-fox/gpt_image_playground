// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getStudioAdminSession,
  createStudioInspiration,
  getStudioAdminInspirations,
  getStudioGenerationChannel,
  getStudioPaymentChannel,
  getStudioPaymentProviders,
  getStudioPaymentPlans,
  getStudioQuotaPolicy,
  grantStudioCredits,
  searchStudioUsers,
  updateStudioQuotaPolicy,
  updateStudioPaymentPlan,
  updateStudioPaymentChannel,
  updateStudioPaymentProvider,
  updateStudioInspiration,
  updateStudioGenerationChannel,
} from './studioAdmin'

beforeEach(() => {
  document.cookie = 'nanafox_studio_csrf=csrf-token; Path=/'
})

describe('Studio operations client', () => {
  it('detects operations access without treating ordinary users as errors', async () => {
    const allowed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: { admin: true, user: { id: 'admin-1', email: 'admin@nanafox.com', displayName: 'Admin' } },
    }))
    await expect(getStudioAdminSession(allowed)).resolves.toEqual({
      admin: true,
      user: { id: 'admin-1', email: 'admin@nanafox.com', displayName: 'Admin' },
    })
    expect(allowed).toHaveBeenCalledWith('/api/admin/me', { credentials: 'same-origin' })

    const denied = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: { reason: 'ADMIN_FORBIDDEN', message: '没有权限' },
    }, { status: 403 }))
    await expect(getStudioAdminSession(denied)).resolves.toBeNull()
  })

  it('loads and updates the versioned daily free policy', async () => {
    const policy = { enabled: true, dailyLimit: 3, timezone: 'Asia/Shanghai', version: 4 }
    const load = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: policy }))
    await expect(getStudioQuotaPolicy(load)).resolves.toEqual(policy)

    const updated = { ...policy, dailyLimit: 5, version: 5 }
    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: updated }))
    await expect(updateStudioQuotaPolicy({ ...policy, dailyLimit: 5 }, save)).resolves.toEqual(updated)
    expect(save).toHaveBeenCalledWith('/api/admin/quota-policy', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      body: JSON.stringify({ enabled: true, dailyLimit: 5, timezone: 'Asia/Shanghai', expectedVersion: 4 }),
    })
  })

  it('finds users and grants credits through audited same-origin writes', async () => {
    const user = { id: 'user-1', email: 'member@example.com', displayName: 'Member' }
    const search = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: [user] }))
    await expect(searchStudioUsers('member@example.com', search)).resolves.toEqual([user])
    expect(search).toHaveBeenCalledWith('/api/admin/users?query=member%40example.com&limit=20', { credentials: 'same-origin' })

    const grant = { id: 'grant-1', source: 'admin', total: 10, remaining: 10, expiresAt: null, reference: 'support-001' }
    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: grant }, { status: 201 }))
    await expect(grantStudioCredits(user.id, { units: 10, reference: 'support-001', expiresAt: null }, save)).resolves.toEqual(grant)
    expect(save).toHaveBeenCalledWith('/api/admin/users/user-1/credits', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      body: JSON.stringify({ units: 10, reference: 'support-001', expiresAt: null }),
    })
  })

  it('loads and updates versioned payment plans', async () => {
    const plan = {
      id: 'plus',
      kind: 'subscription' as const,
      name: '创作 Plus',
      description: '适合持续内容创作',
      priceCents: 2900,
      currency: 'CNY' as const,
      credits: 100,
      durationDays: 30,
      enabled: false,
      sortOrder: 10,
      version: 1,
    }
    const load = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: [plan] }))
    await expect(getStudioPaymentPlans(load)).resolves.toEqual([plan])

    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: { ...plan, enabled: true, version: 2 } }))
    await expect(updateStudioPaymentPlan({ ...plan, enabled: true }, save)).resolves.toEqual({ ...plan, enabled: true, version: 2 })
    expect(save).toHaveBeenCalledWith('/api/admin/payment-plans/plus', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      body: JSON.stringify({
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        credits: plan.credits,
        durationDays: plan.durationDays,
        enabled: true,
        sortOrder: plan.sortOrder,
        expectedVersion: plan.version,
      }),
    })
  })

  it('loads and switches the safe payment channel status', async () => {
    const channel = {
      provider: 'wxpay_native' as const,
      credentialsReady: true,
      acceptingOrders: false,
      checkoutAvailable: false,
      notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/wechat',
      version: 1,
    }
    const load = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: channel }))
    await expect(getStudioPaymentChannel(load)).resolves.toEqual(channel)

    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: { ...channel, acceptingOrders: true, checkoutAvailable: true, version: 2 },
    }))
    await expect(updateStudioPaymentChannel({ ...channel, acceptingOrders: true }, save)).resolves.toEqual({
      ...channel,
      acceptingOrders: true,
      checkoutAvailable: true,
      version: 2,
    })
    expect(save).toHaveBeenCalledWith('/api/admin/payment-channel', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      body: JSON.stringify({ acceptingOrders: true, expectedVersion: 1 }),
    })
  })

  it('loads and switches only the safe generation channel status', async () => {
    const channel = {
      masterEnabled: true,
      acceptingGenerations: true,
      providerKeyConfigured: true,
      available: true,
      model: 'gpt-image-2',
      storage: 'r2' as const,
      version: 1,
    }
    const load = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: channel }))
    await expect(getStudioGenerationChannel(load)).resolves.toEqual(channel)

    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: { ...channel, acceptingGenerations: false, available: false, version: 2 },
    }))
    await expect(updateStudioGenerationChannel({ ...channel, acceptingGenerations: false }, save)).resolves.toEqual({
      ...channel,
      acceptingGenerations: false,
      available: false,
      version: 2,
    })
    expect(save).toHaveBeenCalledWith('/api/admin/generation-channel', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      body: JSON.stringify({ acceptingGenerations: false, expectedVersion: 1 }),
    })
  })

  it('loads and updates masked Studio payment providers', async () => {
    const provider = {
      id: 'alipay-default',
      providerKey: 'alipay' as const,
      name: '支付宝',
      enabled: false,
      configured: false,
      notifyUrl: 'https://studio.nanafox.com/api/payments/webhooks/alipay/alipay-default',
      version: 1,
      config: { appId: '', privateKeyConfigured: false, publicKeyConfigured: false },
    }
    const load = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: [provider] }))
    await expect(getStudioPaymentProviders(load)).resolves.toEqual([provider])

    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: { ...provider, enabled: true, configured: true, version: 2 } }))
    await updateStudioPaymentProvider({
      ...provider,
      enabled: true,
      config: { ...provider.config, appId: '2026000000000000', privateKey: 'private', publicKey: 'public' },
    }, save)
    expect(save).toHaveBeenCalledWith('/api/admin/payment-providers/alipay-default', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        name: '支付宝',
        enabled: true,
        expectedVersion: 1,
        config: { appId: '2026000000000000', privateKey: 'private', publicKey: 'public' },
      }),
    }))
  })

  it('loads, creates and updates versioned inspirations', async () => {
    const inspiration = {
      id: 'product',
      category: '商业',
      title: '产品海报',
      description: '打造质感产品视觉',
      prompt: '电影感产品海报',
      image: 'inspiration-product.png',
      enabled: true,
      featured: true,
      sortOrder: 10,
      version: 1,
    }
    const load = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: [inspiration] }))
    await expect(getStudioAdminInspirations(load)).resolves.toEqual([inspiration])

    const create = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: inspiration }, { status: 201 }))
    await createStudioInspiration(inspiration, create)
    expect(create).toHaveBeenCalledWith('/api/admin/inspirations', expect.objectContaining({ method: 'POST' }))

    const save = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: { ...inspiration, version: 2 } }))
    await updateStudioInspiration(inspiration, save)
    expect(save).toHaveBeenCalledWith('/api/admin/inspirations/product', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        category: inspiration.category,
        title: inspiration.title,
        description: inspiration.description,
        prompt: inspiration.prompt,
        image: inspiration.image,
        enabled: inspiration.enabled,
        featured: inspiration.featured,
        sortOrder: inspiration.sortOrder,
        expectedVersion: inspiration.version,
      }),
    }))
  })
})

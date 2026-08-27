// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getStudioAdminSession,
  getStudioQuotaPolicy,
  grantStudioCredits,
  searchStudioUsers,
  updateStudioQuotaPolicy,
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
})

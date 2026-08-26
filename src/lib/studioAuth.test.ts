// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  StudioAuthError,
  getStudioSession,
  loginStudio,
  loginStudio2FA,
  logoutStudio,
  registerStudio,
  sendStudioVerifyCode,
} from './studioAuth'

const loginValue = ['Password', '123!'].join('')
const user = {
  id: 'local-user',
  identitySubject: '019c0000-0000-7000-8000-000000000042',
  email: 'studio@example.com',
  displayName: 'Studio User',
}

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = 'nanafox_studio_csrf=; Max-Age=0; Path=/'
})

describe('Studio auth client', () => {
  it('uses only same-origin Studio auth endpoints', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      ok: true,
      data: { user, expiresAt: '2026-09-25T12:00:00.000Z' },
    }))

    await sendStudioVerifyCode('studio@example.com', request)
    await registerStudio({ email: 'studio@example.com', password: loginValue, verifyCode: '246810' }, request)
    await loginStudio('studio@example.com', loginValue, request)
    await loginStudio2FA('studio-challenge', '123456', request)
    await getStudioSession(request)

    expect(request.mock.calls.map((call) => call[0])).toEqual([
      '/api/auth/send-verify-code',
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/login/2fa',
      '/api/auth/session',
    ])
    for (const call of request.mock.calls) {
      expect(call[1]?.credentials).toBe('same-origin')
      expect(String(call[0])).not.toContain('router')
    }
  })

  it('returns an in-memory 2FA challenge without treating it as a session', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: { requires2FA: true, challenge: 'studio-challenge' },
    }))

    await expect(loginStudio('studio@example.com', loginValue, request)).resolves.toEqual({
      requires2FA: true,
      challenge: 'studio-challenge',
    })
  })

  it('sends the CSRF cookie only when logging out', async () => {
    document.cookie = 'nanafox_studio_csrf=csrf-token; Path=/'
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      data: { loggedOut: true },
    }))

    await logoutStudio(request)

    expect(new Headers(request.mock.calls[0][1]?.headers).get('X-CSRF-Token')).toBe('csrf-token')
  })

  it('normalizes API failures and malformed responses', async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: { reason: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' },
    }, { status: 401 }))
    await expect(loginStudio('studio@example.com', 'wrong', denied)).rejects.toMatchObject({
      name: 'StudioAuthError',
      status: 401,
      reason: 'INVALID_CREDENTIALS',
      message: '邮箱或密码错误',
    })

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, data: null }))
    await expect(getStudioSession(malformed)).rejects.toBeInstanceOf(StudioAuthError)
  })
})

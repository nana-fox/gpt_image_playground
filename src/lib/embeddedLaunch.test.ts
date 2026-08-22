import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapEmbeddedSession,
  clearEmbeddedSession,
  getEmbeddedContext,
  getEmbeddedSessionState,
  initializeEmbeddedContext,
  resolveEmbeddedApiProfile,
} from './embeddedSession'
import { createDefaultOpenAIProfile } from './apiProfiles'

const ROOT = {
  lang: '',
  classList: { toggle: vi.fn() },
}

afterEach(() => {
  clearEmbeddedSession()
  ROOT.lang = ''
  ROOT.classList.toggle.mockReset()
})

describe('embedded launch ticket', () => {
  it('scrubs the fragment before exchanging a ticket and trusts only the returned viewer', async () => {
    const replaceState = vi.fn()
    initializeEmbeddedContext(
      'https://app.example.com/tools/image-playground/?token=legacy-jwt&user_id=666#launch=one-time-ticket&theme=dark&lang=zh-CN&ui_mode=embedded',
      replaceState,
      ROOT,
      true,
    )
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: 'success',
      data: {
        session_token: 'scoped-session',
        expires_in: 7200,
        viewer: { id: '9', role: 'user', scope: 'user' },
        api_keys: [{ id: '1', name: 'Key 1', key: 'sk-runtime' }],
      },
    }), { headers: { 'Content-Type': 'application/json' } }))

    const state = await bootstrapEmbeddedSession(null, request)

    expect(replaceState).toHaveBeenCalledWith(null, '', '/tools/image-playground/')
    expect(request).toHaveBeenCalledWith('/api/v1/image-creation/sessions', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: 'one-time-ticket' }),
      cache: 'no-store',
    })
    expect(getEmbeddedContext()?.userId).toBe('9')
    expect(state).toMatchObject({ status: 'ready', selectedKeyId: '1' })
    expect(JSON.stringify(getEmbeddedContext())).not.toContain('legacy-jwt')
    expect(JSON.stringify(getEmbeddedSessionState())).not.toContain('scoped-session')
    expect(resolveEmbeddedApiProfile(createDefaultOpenAIProfile()).apiKey).toBe('sk-runtime')
  })

  it('does not trust legacy query identity when no launch ticket exists', async () => {
    initializeEmbeddedContext(
      'https://app.example.com/tools/image-playground/?token=legacy-jwt&user_id=666',
      vi.fn(),
      ROOT,
      true,
    )
    const request = vi.fn<typeof fetch>()

    await expect(bootstrapEmbeddedSession(null, request)).resolves.toMatchObject({ status: 'auth-error' })
    expect(getEmbeddedContext()?.userId).toBe('')
    expect(request).not.toHaveBeenCalled()
  })
})

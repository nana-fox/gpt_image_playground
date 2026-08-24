import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import {
  bootstrapEmbeddedSession,
  clearEmbeddedSession,
  getEmbeddedReopenUrl,
  getEmbeddedSessionState,
  hasEmbeddedRuntimeKey,
  initializeEmbeddedContext,
  invalidateEmbeddedSelectedKey,
  loadEmbeddedKeys,
  resolveEmbeddedApiProfile,
  selectEmbeddedKey,
} from './embeddedSession'

const ROOT = {
  lang: '',
  classList: { toggle: vi.fn() },
}

function key(id: number) {
  return { id, key: `sk-key-${id}`, name: `Key ${id}` }
}

function session(apiKeys: unknown[], status = 200) {
  return new Response(JSON.stringify({
    code: status >= 400 ? status : 0,
    message: status >= 400 ? 'request failed' : 'success',
    data: status >= 400 ? null : {
      session_token: 'scoped-session',
      expires_in: 7200,
      viewer: { id: '9', role: 'user', scope: 'user' },
      api_keys: apiKeys,
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function boot(fragment = 'launch=one-time-ticket&theme=dark&lang=zh-CN&ui_mode=embedded&src_host=https%3A%2F%2Fapp.example.com&src_url=https%3A%2F%2Fapp.example.com%2Fuser%2Fcustom') {
  const replaceState = vi.fn()
  const context = initializeEmbeddedContext(
    `https://app.example.com/tools/image-playground/?token=legacy-jwt&user_id=666&keep=1#${fragment}`,
    replaceState,
    ROOT,
    true,
  )
  return { context, replaceState }
}

afterEach(() => {
  clearEmbeddedSession()
  ROOT.lang = ''
  ROOT.classList.toggle.mockReset()
})

describe('embedded session', () => {
  it('captures public launch context and scrubs credentials before exchange', () => {
    const { context, replaceState } = boot()

    expect(context).toEqual({
      theme: 'dark',
      lang: 'zh-CN',
      uiMode: 'embedded',
      userId: '',
      srcHost: 'https://app.example.com',
      srcUrl: 'https://app.example.com/user/custom',
      origin: 'https://app.example.com',
    })
    expect(replaceState).toHaveBeenCalledWith({
      nanafoxEmbeddedSource: {
        srcHost: 'https://app.example.com',
        srcUrl: 'https://app.example.com/user/custom',
      },
    }, '', '/tools/image-playground/?keep=1')
    expect(ROOT.classList.toggle).toHaveBeenCalledWith('dark', true)
    expect(ROOT.lang).toBe('zh-CN')
    expect(JSON.stringify(context)).not.toContain('legacy-jwt')
    expect(JSON.stringify(context)).not.toContain('one-time-ticket')
  })

  it('restores a same-origin reopen URL after reload without restoring credentials', async () => {
    initializeEmbeddedContext(
      'https://app.example.com/tools/image-playground/',
      vi.fn(),
      ROOT,
      true,
      {
        nanafoxEmbeddedSource: {
          srcHost: 'https://app.example.com',
          srcUrl: 'https://app.example.com/user/custom',
        },
      },
    )
    const request = vi.fn<typeof fetch>()

    await bootstrapEmbeddedSession(null, request)

    expect(getEmbeddedSessionState()).toMatchObject({ status: 'auth-error' })
    expect(getEmbeddedReopenUrl()).toBe('https://app.example.com/user/custom')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects cross-origin reopen metadata', () => {
    const replaceState = vi.fn()
    initializeEmbeddedContext(
      'https://app.example.com/tools/image-playground/#launch=ticket&src_host=https%3A%2F%2Fevil.example&src_url=https%3A%2F%2Fevil.example%2Fcustom',
      replaceState,
      ROOT,
      true,
    )

    expect(replaceState).toHaveBeenCalledWith(null, '', '/tools/image-playground/')
    expect(getEmbeddedReopenUrl()).toBeNull()
  })

  it('reports an auth error without fetching when the launch ticket is missing', async () => {
    boot('theme=light&ui_mode=embedded')
    const request = vi.fn<typeof fetch>()

    await bootstrapEmbeddedSession(null, request)

    expect(getEmbeddedSessionState()).toMatchObject({ status: 'auth-error' })
    expect(request).not.toHaveBeenCalled()
  })

  it('exchanges the one-time ticket for trusted viewer and runtime keys', async () => {
    boot()
    const request = vi.fn<typeof fetch>().mockResolvedValue(session([key(1), key(2)]))

    const state = await loadEmbeddedKeys('2', request)

    expect(state).toMatchObject({
      status: 'ready',
      selectedKeyId: '2',
      keys: [{ id: '1', name: 'Key 1' }, { id: '2', name: 'Key 2' }],
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('/api/v1/image-creation/sessions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ticket: 'one-time-ticket' }),
    }))
    expect(JSON.stringify(state)).not.toContain('sk-key-')
    expect(JSON.stringify(state)).not.toContain('scoped-session')
  })

  it('distinguishes zero keys and automatically selects the first eligible key', async () => {
    boot()
    await expect(loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(session([])))).resolves.toMatchObject({ status: 'no-eligible-key' })

    boot()
    await expect(loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(session([key(1)])))).resolves.toMatchObject({ status: 'ready', selectedKeyId: '1' })

    boot()
    await expect(loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(session([key(1), key(2)])))).resolves.toMatchObject({ status: 'ready', selectedKeyId: '1' })
  })

  it('restores a persisted selection after trusted user storage loads without reusing the ticket', async () => {
    boot()
    const request = vi.fn<typeof fetch>().mockResolvedValue(session([key(1), key(2)]))
    await loadEmbeddedKeys(null, request)

    await expect(loadEmbeddedKeys('2', request)).resolves.toMatchObject({ status: 'ready', selectedKeyId: '2' })
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps runtime credentials out of public state', async () => {
    boot()
    expect(hasEmbeddedRuntimeKey()).toBe(false)

    await loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(session([key(1)])))

    expect(hasEmbeddedRuntimeKey()).toBe(true)
    expect(JSON.stringify(getEmbeddedSessionState())).not.toContain('sk-key-1')
    clearEmbeddedSession()
    expect(hasEmbeddedRuntimeKey()).toBe(false)
  })

  it('removes a rejected key and selects the sole remaining in-memory key', async () => {
    boot()
    await loadEmbeddedKeys('1', vi.fn<typeof fetch>().mockResolvedValue(session([key(1), key(2)])))

    expect(invalidateEmbeddedSelectedKey()).toBe(true)
    expect(getEmbeddedSessionState()).toEqual({
      status: 'ready',
      keys: [{ id: '2', name: 'Key 2' }],
      selectedKeyId: '2',
    })
  })

  it.each([401, 403])('classifies HTTP %s as a session auth error', async (status) => {
    boot()
    const request = vi.fn<typeof fetch>().mockResolvedValue(session([], status))

    await expect(loadEmbeddedKeys(null, request)).resolves.toMatchObject({ status: 'auth-error' })
  })

  it('discards credentials when exchange fails or returns malformed data', async () => {
    boot()
    await expect(loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(new Response('bad gateway', { status: 502 })))).resolves.toMatchObject({ status: 'load-error', keys: [] })

    boot()
    await expect(loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { api_keys: 'invalid' } }))))).resolves.toMatchObject({ status: 'load-error', keys: [] })
  })

  it('resolves the selected raw key into an ephemeral same-origin profile', async () => {
    boot()
    await loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(session([key(1), key(2)])))
    expect(selectEmbeddedKey('2')).toBe(true)

    const profile = resolveEmbeddedApiProfile(createDefaultOpenAIProfile({ apiKey: '', model: 'old-model' }))

    expect(profile).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://app.example.com/v1',
      apiKey: 'sk-key-2',
      model: 'gpt-image-2',
      apiMode: 'images',
      codexCli: false,
      apiProxy: false,
    })
    expect(getEmbeddedSessionState()).not.toHaveProperty('rawKey')
  })

  it('fails before request construction when no runtime key is selected', async () => {
    boot()
    await loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(session([])))

    expect(() => resolveEmbeddedApiProfile(createDefaultOpenAIProfile())).toThrow('请选择一个可用的 Sub2API API Key')
  })
})

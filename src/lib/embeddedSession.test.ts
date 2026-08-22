import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import {
  clearEmbeddedSession,
  getEmbeddedReopenUrl,
  getEmbeddedSessionState,
  hasEmbeddedRuntimeKey,
  initializeEmbeddedContext,
  loadEmbeddedKeys,
  resolveEmbeddedApiProfile,
  selectEmbeddedKey,
} from './embeddedSession'

const ROOT = {
  lang: '',
  classList: { toggle: vi.fn() },
}

function key(id: number, patch: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 9,
    key: `sk-key-${id}`,
    name: `Key ${id}`,
    status: 'active',
    ...patch,
  }
}

function page(items: unknown[], current = 1, pages = 1, status = 200) {
  return new Response(JSON.stringify({
    code: status >= 400 ? status : 0,
    message: status >= 400 ? 'request failed' : 'success',
    data: { items, total: items.length, page: current, page_size: 2, pages },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function boot(search = '?token=iframe-jwt&theme=dark&lang=zh-CN&ui_mode=embedded&user_id=9&src_host=https%3A%2F%2Fapp.example.com&src_url=https%3A%2F%2Fapp.example.com%2Fuser%2Fcustom') {
  const replaceState = vi.fn()
  const context = initializeEmbeddedContext(
    `https://app.example.com/tools/image-playground/${search}#result`,
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
  it('captures iframe context once and scrubs it from the visible URL', () => {
    const { context, replaceState } = boot('?token=jwt-secret&theme=dark&lang=zh-CN&ui_mode=embedded&user_id=9&src_host=https%3A%2F%2Fapp.example.com&src_url=https%3A%2F%2Fapp.example.com%2Fuser%2Fcustom&keep=1')

    expect(context).toEqual({
      theme: 'dark',
      lang: 'zh-CN',
      uiMode: 'embedded',
      userId: '9',
      srcHost: 'https://app.example.com',
      srcUrl: 'https://app.example.com/user/custom',
      origin: 'https://app.example.com',
    })
    expect(replaceState).toHaveBeenCalledWith({
      nanafoxEmbeddedSource: {
        srcHost: 'https://app.example.com',
        srcUrl: 'https://app.example.com/user/custom',
      },
    }, '', '/tools/image-playground/?keep=1#result')
    expect(ROOT.classList.toggle).toHaveBeenCalledWith('dark', true)
    expect(ROOT.lang).toBe('zh-CN')
    expect(JSON.stringify(context)).not.toContain('jwt-secret')
  })

  it('restores a same-origin reopen URL after reload without restoring credentials', async () => {
    const historyState = {
      nanafoxEmbeddedSource: {
        srcHost: 'https://app.example.com',
        srcUrl: 'https://app.example.com/user/custom',
      },
    }

    initializeEmbeddedContext(
      'https://app.example.com/tools/image-playground/',
      vi.fn(),
      ROOT,
      true,
      historyState,
    )
    const request = vi.fn<typeof fetch>()
    await loadEmbeddedKeys(null, request)

    expect(getEmbeddedSessionState()).toMatchObject({ status: 'auth-error' })
    expect(getEmbeddedReopenUrl()).toBe('https://app.example.com/user/custom')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects cross-origin reopen metadata', () => {
    const replaceState = vi.fn()

    initializeEmbeddedContext(
      'https://app.example.com/tools/image-playground/?token=jwt-secret&src_host=https%3A%2F%2Fevil.example&src_url=https%3A%2F%2Fevil.example%2Fcustom',
      replaceState,
      ROOT,
      true,
    )

    expect(replaceState).toHaveBeenCalledWith(null, '', '/tools/image-playground/')
    expect(getEmbeddedReopenUrl()).toBeNull()
  })

  it('reports a session auth error without fetching when the token is missing', async () => {
    boot('?theme=light&ui_mode=embedded')
    const request = vi.fn<typeof fetch>()

    await loadEmbeddedKeys(null, request)

    expect(getEmbeddedSessionState()).toMatchObject({ status: 'auth-error' })
    expect(request).not.toHaveBeenCalled()
  })

  it('loads every page with the iframe JWT only on the keys endpoint', async () => {
    boot()
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([key(1)], 1, 2))
      .mockResolvedValueOnce(page([key(2)], 2, 2))

    const state = await loadEmbeddedKeys('2', request)

    expect(state).toMatchObject({
      status: 'ready',
      selectedKeyId: '2',
      keys: [{ id: '1', name: 'Key 1' }, { id: '2', name: 'Key 2' }],
    })
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/keys?page=1&page_size=100', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer iframe-jwt' }),
    }))
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/keys?page=2&page_size=100', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer iframe-jwt' }),
    }))
    expect(JSON.stringify(state)).not.toContain('sk-key-')
    expect(JSON.stringify(state)).not.toContain('iframe-jwt')
  })

  it('distinguishes zero, one, and multiple eligible keys', async () => {
    boot()
    const request = vi.fn<typeof fetch>()

    request.mockResolvedValueOnce(page([]))
    await expect(loadEmbeddedKeys(null, request)).resolves.toMatchObject({ status: 'no-eligible-key', keys: [] })

    request.mockResolvedValueOnce(page([key(1)]))
    await expect(loadEmbeddedKeys(null, request)).resolves.toMatchObject({ status: 'ready', selectedKeyId: '1' })

    request.mockResolvedValueOnce(page([key(1), key(2)]))
    await expect(loadEmbeddedKeys(null, request)).resolves.toMatchObject({ status: 'selection-required', selectedKeyId: null })
  })

  it('reports runtime credential readiness without exposing the raw key', async () => {
    boot()
    expect(hasEmbeddedRuntimeKey()).toBe(false)

    await loadEmbeddedKeys(null, vi.fn<typeof fetch>().mockResolvedValue(page([key(1)])))

    expect(hasEmbeddedRuntimeKey()).toBe(true)
    expect(JSON.stringify(getEmbeddedSessionState())).not.toContain('sk-key-1')
    clearEmbeddedSession()
    expect(hasEmbeddedRuntimeKey()).toBe(false)
  })

  it('does not reuse a deleted or disabled saved key', async () => {
    boot()
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([key(1), key(2)], 1, 1))
      .mockResolvedValueOnce(page([key(1, { status: 'inactive' }), key(2, { status: 'expired' })], 1, 1))
      .mockResolvedValueOnce(page([key(2)], 1, 1))

    await expect(loadEmbeddedKeys('deleted-key', request)).resolves.toMatchObject({
      status: 'selection-required',
      selectedKeyId: null,
    })
    await expect(loadEmbeddedKeys('1', request)).resolves.toMatchObject({
      status: 'no-eligible-key',
      selectedKeyId: null,
    })
    await expect(loadEmbeddedKeys('1', request)).resolves.toMatchObject({
      status: 'selection-required',
      selectedKeyId: null,
    })
  })

  it.each([401, 403])('classifies HTTP %s as an iframe session auth error', async (status) => {
    boot()
    const request = vi.fn<typeof fetch>().mockResolvedValue(page([], 1, 1, status))

    await expect(loadEmbeddedKeys(null, request)).resolves.toMatchObject({ status: 'auth-error' })
  })

  it('discards partial keys when a later page fails', async () => {
    boot()
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page([key(1)], 1, 2))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))

    const state = await loadEmbeddedKeys(null, request)

    expect(state).toMatchObject({ status: 'load-error', keys: [] })
    expect(JSON.stringify(state)).not.toContain('sk-key-1')
  })

  it('rejects malformed key responses instead of silently selecting partial data', async () => {
    boot()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { items: 'invalid' } })))

    await expect(loadEmbeddedKeys(null, request)).resolves.toMatchObject({ status: 'load-error', keys: [] })
  })

  it('resolves the selected raw key into an ephemeral same-origin profile', async () => {
    boot()
    const request = vi.fn<typeof fetch>().mockResolvedValue(page([key(1), key(2)]))
    await loadEmbeddedKeys(null, request)
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
    const request = vi.fn<typeof fetch>().mockResolvedValue(page([key(1), key(2)]))
    await loadEmbeddedKeys(null, request)

    expect(() => resolveEmbeddedApiProfile(createDefaultOpenAIProfile())).toThrow('请选择一个可用的 Sub2API API Key')
  })
})

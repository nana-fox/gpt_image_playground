import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapEmbeddedSession, clearEmbeddedSession, getEmbeddedSessionState, initializeEmbeddedContext } from './embeddedSession'
import { applyImageCreationTemplate, listAllImageCreationAdminTemplates, listImageCreationTemplates } from './imageCreationApi'

const ROOT = { lang: '', classList: { toggle: vi.fn() } }

async function startSession(scope: 'user' | 'admin' = 'user') {
  initializeEmbeddedContext(
    'https://router-test.nanafox.com/tools/image-playground/#launch=one-time-ticket',
    () => {},
    ROOT,
    true,
  )
  await bootstrapEmbeddedSession(null, vi.fn().mockResolvedValue(new Response(JSON.stringify({
    code: 0,
    data: {
      session_token: 'scoped-session',
      viewer: { id: 9, role: scope, scope },
      api_keys: [{ id: 7, name: '测试 Key', key: 'sk-selected' }],
    },
  }), { status: 200 })))
}

afterEach(() => {
  clearEmbeddedSession()
  vi.restoreAllMocks()
})

describe('image creation API', () => {
  it('uses the scoped session and omits prompt from template list handling', async () => {
    await startSession()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        items: [{
          id: 3,
          title: '柔光人像',
          summary: '自然柔光',
          category: 'portrait',
          tags: ['人像'],
          published_version: 2,
          defaults: { size: '1024x1024', quality: 'high', output_format: 'png' },
          input_mode: 'text',
          favorited: false,
        }],
        total: 1,
        page: 1,
        page_size: 24,
        pages: 1,
      },
    }), { status: 200 }))

    const result = await listImageCreationTemplates({ home: true, pageSize: 24 }, request)

    expect(request.mock.calls[0][0]).toBe('/api/v1/image-creation/templates?home=true&page=1&page_size=24')
    expect(new Headers(request.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer scoped-session')
    expect(result.items[0]).not.toHaveProperty('prompt')
  })

  it('invalidates the in-memory session after a scoped API rejection', async () => {
    await startSession()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 401,
      message: 'Invalid image creation session',
      reason: 'IMAGE_CREATION_SESSION_INVALID',
    }), { status: 401 }))

    await expect(applyImageCreationTemplate(3, 2, request)).rejects.toThrow('Invalid image creation session')
    expect(getEmbeddedSessionState().status).toBe('auth-error')
  })

  it('rejects malformed pagination data from the API boundary', async () => {
    await startSession()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { items: null, total: 1 },
    }), { status: 200 }))

    await expect(listImageCreationTemplates({}, request)).rejects.toMatchObject({ status: 502 })
  })

  it('loads every admin template page when the result exceeds the API page limit', async () => {
    await startSession('admin')
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })),
          total: 101,
          page: 1,
          page_size: 100,
          pages: 2,
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ id: 101 }],
          total: 101,
          page: 2,
          page_size: 100,
          pages: 2,
        },
      }), { status: 200 }))

    const result = await listAllImageCreationAdminTemplates({}, request)

    expect(result).toHaveLength(101)
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/admin/image-creation/templates?page=1&page_size=100',
      '/api/v1/admin/image-creation/templates?page=2&page_size=100',
    ])
  })
})

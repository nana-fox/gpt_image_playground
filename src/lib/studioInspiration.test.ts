import { describe, expect, it, vi } from 'vitest'

import { listStudioInspirations } from './studioInspiration'

describe('Studio inspiration client', () => {
  it('loads published inspirations from the Studio backend', async () => {
    const request = vi.fn(async () => Response.json({
      ok: true,
      data: [{
        id: 'product',
        category: '商业',
        title: '产品海报',
        description: '打造质感产品视觉',
        prompt: '电影感产品海报',
        image: 'inspiration-product.png',
        featured: true,
        sortOrder: 10,
        version: 1,
      }],
    }))

    await expect(listStudioInspirations(request)).resolves.toHaveLength(1)
    expect(request).toHaveBeenCalledWith('/api/inspirations', { credentials: 'same-origin' })
  })
})

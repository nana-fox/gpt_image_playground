import assert from 'node:assert/strict'
import test from 'node:test'

import { createStudioInspirationApp } from './inspirationApp.mjs'

const origin = 'https://studio.nanafox.com'
const item = {
  id: 'product',
  category: '商业',
  title: '产品海报',
  description: '打造质感产品视觉',
  prompt: '为一款高端无线耳机制作电影感产品海报',
  image: 'inspiration-product.png',
  featured: true,
  sortOrder: 10,
  version: 1,
}

test('authenticated users read only published inspirations', async () => {
  const app = createStudioInspirationApp({
    sessions: {
      getSession: (token) => token === 'session-1' ? { user: { id: 'user-1' } } : null,
    },
    inspirations: {
      listPublished: () => [item],
    },
  })
  const response = await app.handle(new Request(`${origin}/api/inspirations`, {
    headers: { Cookie: 'nanafox_studio_session=session-1' },
  }))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, [item])
  assert.equal((await app.handle(new Request(`${origin}/api/inspirations`))).status, 401)
})

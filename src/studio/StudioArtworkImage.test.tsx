// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { StudioArtworkImage } from './StudioArtworkImage'

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
})

it('retries a failed artwork twice before showing a readable fallback', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)

  await act(async () => root.render(<StudioArtworkImage src="/api/artworks/task-1" alt="测试作品" />))
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/artworks/task-1')

  await failImage(container)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/artworks/task-1?retry=1')

  await failImage(container)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/artworks/task-1?retry=2')

  await failImage(container)
  expect(container.querySelector('[role="status"]')?.textContent).toContain('作品暂时无法显示')
  expect(container.querySelector('img')).toBeNull()

  await act(async () => root.unmount())
})

async function failImage(container: HTMLElement) {
  await act(async () => {
    container.querySelector('img')!.dispatchEvent(new Event('error'))
  })
}

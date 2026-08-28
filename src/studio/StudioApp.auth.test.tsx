// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import StudioApp from './StudioApp'

const resetToken = ['single', 'use', 'token'].join('-')

beforeEach(() => {
  window.history.replaceState(null, '', `/reset-password?email=studio%40example.com&token=${resetToken}`)
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path.endsWith('/api/auth/reset-password')) {
      return Response.json({ ok: true, data: { reset: true } })
    }
    if (path.endsWith('/api/auth/login')) {
      return Response.json({
        ok: true,
        data: {
          expiresAt: '2026-09-25T12:00:00.000Z',
          user: {
            id: 'local-user',
            identitySubject: '019c0000-0000-7000-8000-000000000042',
            email: 'studio@example.com',
            displayName: 'Studio User',
          },
        },
      })
    }
    return Response.json({ ok: false, error: { reason: 'UNAUTHENTICATED', message: '请先登录' } }, { status: 401 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

it('enters the Studio workspace after resetting and logging in', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)

  await act(async () => root.render(<StudioApp />))
  const resetInputs = container.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]')
  change(resetInputs[0], 'NewPassword123!')
  change(resetInputs[1], 'NewPassword123!')
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

  const password = container.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!
  change(password, 'NewPassword123!')
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

  expect(container.querySelector('[data-studio-workspace]')).not.toBeNull()
  await act(async () => root.unmount())
})

function change(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

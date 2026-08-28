// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import StudioApp from './StudioApp'

const resetToken = ['single', 'use', 'token'].join('-')
const newPassword = ['New', 'Password', '123!'].join('')

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

it('enters the Studio workspace after resetting and logging in', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)

  await act(async () => root.render(<StudioApp />))
  const resetInputs = container.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]')
  await act(async () => {
    change(resetInputs[0], newPassword)
    change(resetInputs[1], newPassword)
  })
  await submit(container)

  const password = container.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!
  await act(async () => change(password, newPassword))
  await submit(container)

  expect(container.querySelector('[data-studio-workspace]')).not.toBeNull()
  const requests = vi.mocked(fetch).mock.calls
  expect(JSON.parse(String(requests[0][1]?.body))).toEqual({
    email: 'studio@example.com',
    token: resetToken,
    newPassword,
  })
  expect(JSON.parse(String(requests[1][1]?.body))).toEqual({
    email: 'studio@example.com',
    password: newPassword,
  })
  await act(async () => root.unmount())
})

function change(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function submit(container: HTMLElement) {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

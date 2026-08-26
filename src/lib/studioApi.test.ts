import { describe, expect, it } from 'vitest'

import { studioApiPath } from './studioApi'

describe('Studio API path', () => {
  it('keeps Studio requests inside the configured deployment base path', () => {
    expect(studioApiPath('auth/login', '/')).toBe('/api/auth/login')
    expect(studioApiPath('generations', '/tools/image-studio/')).toBe('/tools/image-studio/api/generations')
  })
})

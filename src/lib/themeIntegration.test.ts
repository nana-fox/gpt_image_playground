import { describe, expect, it } from 'vitest'

import mainSource from '../main.tsx?raw'
import tailwindSource from '../../tailwind.config.js?raw'

describe('主题集成', () => {
  it('让宿主显式主题覆盖系统主题，同时让普通版继续跟随系统变化', () => {
    expect(tailwindSource).toContain("darkMode: 'selector'")
    expect(mainSource).toContain("window.matchMedia('(prefers-color-scheme: dark)')")
    expect(mainSource).toContain("addEventListener('change'")
  })
})

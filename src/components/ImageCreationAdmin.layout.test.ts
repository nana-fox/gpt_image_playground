import { describe, expect, it } from 'vitest'

import source from './ImageCreationAdmin.tsx?raw'

describe('融合版 1.1 首页精选管理', () => {
  it('只允许配置首页实际展示的四个精选位置', () => {
    expect(source).toContain('最多 4 个')
    expect(source).toContain('selected.length >= 4')
    expect(source).not.toContain('今日灵感')
  })
})

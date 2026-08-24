import { describe, expect, it } from 'vitest'

import source from './HelpModal.tsx?raw'

describe('嵌入版图像创作指南', () => {
  it('优先说明 API Key、灵感模板和生成流程', () => {
    expect(source).toContain('embedded')
    expect(source).toContain('系统会自动选中可用于图像生成的 API Key')
    expect(source).toContain('去创建 API Key')
    expect(source).toContain('从灵感开始')
  })
})

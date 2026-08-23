import { describe, expect, it } from 'vitest'

import source from './ImageCreationUser.tsx?raw'

describe('融合版 1.1 创作首页', () => {
  it('首页按灵感、最近创作和创作框的顺序组织，不显示双页签', () => {
    expect(source).toContain('data-image-creation-home')
    expect(source).toContain('从灵感开始')
    expect(source).toContain('最近创作')
    expect(source).not.toContain('aria-label="图像创作视图"')
    expect(source).not.toContain('今日灵感')
  })

  it('精选区有主卡，全部灵感以覆盖层打开', () => {
    expect(source).toContain('data-featured-primary')
    expect(source).toContain('探索全部灵感')
    expect(source).toContain('data-inspiration-overlay')
  })

  it('只有一个精选模板时也限制主卡高度', () => {
    expect(source).toContain('sm:h-52')
    expect(source).toContain('sm:h-full')
  })
})

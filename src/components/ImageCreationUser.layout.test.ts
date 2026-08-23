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

  it('首页使用一张主视觉和三张统一次卡，标题覆盖在图片内', () => {
    expect(source).toContain('data-featured-secondary')
    expect(source).toContain('bg-gradient-to-t from-black/80')
    expect(source).not.toContain('group-hover:-translate-y-0.5')
  })

  it('完整显示封面时使用同图柔化背景，不拉伸海报', () => {
    expect(source).toContain('data-template-cover')
    expect(source).toContain("template.cover_fit === 'contain'")
    expect(source).toContain('blur-xl')
    expect(source).toContain('object-contain')
  })

  it('全部灵感使用固定比例响应式网格', () => {
    expect(source).toContain('aspect-[4/5]')
    expect(source).toContain('xl:grid-cols-4')
  })
})

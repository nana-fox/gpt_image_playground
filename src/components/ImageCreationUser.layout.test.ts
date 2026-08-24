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

  it('精选区按原图比例等高横滑，灵感画廊以覆盖层打开', () => {
    expect(source).toContain('data-featured-shelf')
    expect(source).toContain('data-auto-aspect')
    expect(source).toContain('snap-x snap-mandatory')
    expect(source).toContain('onCoverLoad')
    expect(source).toContain('浏览全部')
    expect(source).toContain('灵感画廊')
    expect(source).toContain('data-inspiration-overlay')
    expect(source).not.toContain('lg:grid-cols-[minmax(0,1.9fr)_repeat(3,minmax(0,1fr))]')
  })

  it('首页横滑区展示全部精选，不在前端截断成四个', () => {
    expect(source).toContain('pageSize: 20')
    expect(source).toContain('templates.map((template, index)')
    expect(source).not.toContain('templates.slice(0, 4)')
  })

  it('精选模板不区分固定横竖槽位，标题覆盖在图片内', () => {
    expect(source).toContain('data-featured-card')
    expect(source).toContain('bg-gradient-to-t from-black/80')
    expect(source).not.toContain('data-featured-primary')
    expect(source).not.toContain('data-featured-secondary')
    expect(source).not.toContain('group-hover:-translate-y-0.5')
  })

  it('比例自适应卡片完整显示原图，不使用柔化背景填充', () => {
    expect(source).toContain('data-template-cover')
    expect(source).toContain('natural')
    expect(source).toContain('object-contain')
  })

  it('全部灵感使用等宽且高度随原图变化的响应式瀑布流', () => {
    expect(source).toContain('data-inspiration-masonry')
    expect(source).toContain('distributeGalleryItems')
    expect(source).toContain('grid-cols-1')
    expect(source).toContain('pageSize: 20')
    expect(source).not.toContain('data-inspiration-page')
  })

  it('懒加载封面在图片到达前预留卡片高度，避免增量内容出现空白', () => {
    const cardSource = source.slice(source.indexOf('function TemplateCard'), source.indexOf('function FeaturedCard'))
    expect(cardSource).toContain('useState(4 / 5)')
    expect(cardSource).toContain('style={{ aspectRatio }}')
    expect(cardSource).toContain('onCoverLoad={onCoverLoad}')
  })

  it('详情页按封面原始比例展示，不再套用固定 4:5 画框', () => {
    expect(source).toContain('data-template-detail-cover')
    expect(source).not.toContain('className="aspect-[4/5] w-full rounded-2xl"')
  })

  it('增量加载保留已有卡片并提供明确进度和错误重试', () => {
    expect(source).toContain('已显示')
    expect(source).toContain('重新加载')
    expect(source).toContain('aria-live="polite"')
  })

  it('最近创作放在独立的轻量内容容器中', () => {
    expect(source).toContain('data-recent-creations')
    expect(source).toContain('bg-white/40')
  })
})

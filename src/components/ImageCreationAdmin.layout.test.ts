import { describe, expect, it } from 'vitest'

import source from './ImageCreationAdmin.tsx?raw'

describe('融合版 1.1 首页精选管理', () => {
  it('首页精选支持一页候选的二十个位置', () => {
    expect(source).toContain('FEATURED_LIMIT = 20')
    expect(source).toContain('selected.length >= FEATURED_LIMIT')
    expect(source).not.toContain('最多 4 个')
    expect(source).not.toContain('今日灵感')
  })

  it('管理员可选择封面裁切或完整显示', () => {
    expect(source).toContain('封面展示')
    expect(source).toContain("cover_fit: 'cover'")
    expect(source).toContain("cover_fit: 'contain'")
  })

  it('模板与精选候选都按每页 20 条加载，不一次请求全部模板', () => {
    expect(source).toContain('data-admin-pagination')
    expect(source).toContain('pageSize: 20')
    expect(source).not.toContain('listAllImageCreationAdminTemplates')
  })

  it('已发布模板可直接加入首页精选，并在精选页调整顺序', () => {
    expect(source).toContain('加入精选')
    expect(source).toContain('data-featured-candidate')
    expect(source).toContain('aria-label="上移"')
    expect(source).toContain('aria-label="下移"')
  })

  it('增加、移除和排序都立即保存，不再要求二次点击发布', () => {
    expect(source).toContain('persistFeatured')
    expect(source).toContain('已移出首页精选')
    expect(source).toContain('精选顺序已更新')
    expect(source).not.toContain('发布首页')
  })

  it('详情预览和管理缩略图尊重封面展示方式', () => {
    expect(source).toContain('data-admin-template-cover')
    expect(source).toContain('natural')
  })
})

import { describe, expect, it } from 'vitest'

import { distributeGalleryItems } from './galleryColumns'

describe('distributeGalleryItems', () => {
  it('增量追加时保留已有卡片的列，不以分页创建新瀑布流', () => {
    expect(distributeGalleryItems([1, 2, 3, 4], 3)).toEqual([[1, 4], [2], [3]])
    expect(distributeGalleryItems([1, 2, 3, 4, 5, 6], 3)).toEqual([[1, 4], [2, 5], [3, 6]])
  })

  it('列数无效时仍至少返回一列', () => {
    expect(distributeGalleryItems([1, 2], 0)).toEqual([[1, 2]])
  })
})

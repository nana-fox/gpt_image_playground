import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import type { TaskRecord } from '../types'
import { getTaskParamMismatchSummary } from './paramMismatch'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: '生成广告图',
    params: { ...DEFAULT_PARAMS, size: '3840x2160', quality: 'high' },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    createdAt: 1,
    ...overrides,
  }
}

describe('getTaskParamMismatchSummary', () => {
  it('explains explicit image parameters changed by the upstream model', () => {
    expect(getTaskParamMismatchSummary(task({
      actualParams: { size: '1122x1402', quality: 'auto' },
    }))).toBe('尺寸 3840x2160 → 1122x1402；质量 high → auto')
  })

  it('does not warn when auto parameters resolve to concrete values', () => {
    expect(getTaskParamMismatchSummary(task({
      params: { ...DEFAULT_PARAMS, size: 'auto', quality: 'auto' },
      actualParams: { size: '1024x1536', quality: 'medium' },
    }))).toBe('')
  })
})

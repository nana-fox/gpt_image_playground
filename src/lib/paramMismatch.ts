import type { TaskParams, TaskRecord } from '../types'

const PARAM_LABELS: Partial<Record<keyof TaskParams, string>> = {
  size: '尺寸',
  quality: '质量',
  output_format: '格式',
  output_compression: '压缩',
  moderation: '审核',
  n: '数量',
}

export function getTaskParamMismatchSummary(task: TaskRecord, actualParams = task.actualParams) {
  if (!actualParams) return ''

  const mismatches: string[] = []
  for (const key of Object.keys(PARAM_LABELS) as Array<keyof TaskParams>) {
    const requested = task.params[key]
    const actual = actualParams[key]
    if (requested === 'auto' || actual === undefined || actual === null || String(requested) === String(actual)) continue
    mismatches.push(`${PARAM_LABELS[key]} ${requested} → ${actual}`)
  }
  return mismatches.join('；')
}

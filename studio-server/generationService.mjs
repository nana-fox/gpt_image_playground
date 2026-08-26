export class GenerationError extends Error {
  constructor(message, { status = 500, reason = 'GENERATION_ERROR' } = {}) {
    super(message)
    this.name = 'GenerationError'
    this.status = status
    this.reason = reason
  }
}

export function createGenerationService(options = {}) {
  const tasks = options.tasks
  const quota = options.quota
  const images = options.images
  const outputs = options.outputs
  if (!tasks || !quota || !images || !outputs) throw new Error('Studio generation dependencies are required')

  return {
    async generate(user, input, idempotencyKey) {
      const userId = String(user?.id ?? '').trim()
      const key = String(idempotencyKey ?? '').trim()
      if (!userId) throw new GenerationError('请先登录', { status: 401, reason: 'UNAUTHENTICATED' })
      if (!key || key.length > 200) throw new GenerationError('创作请求标识无效', { status: 400, reason: 'INVALID_IDEMPOTENCY_KEY' })

      const created = tasks.createTask(userId, input, key)
      if (!created.created) return replay(created.task)

      let reservation = null
      let output = null
      let confirmed = false
      try {
        reservation = quota.reserve(userId, key)
        tasks.markReserved(created.task.id, reservation.id)
        tasks.markRunning(created.task.id)

        const result = await images.generate(input)
        if (!Array.isArray(result?.images) || result.images.length !== 1) {
          throw Object.assign(new Error('invalid image result'), { reason: 'IMAGE_PROVIDER_PROTOCOL_ERROR' })
        }
        output = await outputs.save(created.task.id, result.images[0], userId)
        tasks.storeOutput(created.task.id, {
          ...output,
          revisedPrompt: result.images[0].revisedPrompt,
          usage: result.usage,
        })
        const confirmation = quota.confirm(reservation.id)
        if (confirmation?.status !== 'confirmed') throw new Error('quota reservation was not confirmed')
        confirmed = true
        return tasks.succeed(created.task.id)
      } catch (error) {
        if (confirmed) {
          throw new GenerationError('作品已生成，正在完成入库，请稍后刷新', {
            status: 503,
            reason: 'GENERATION_FINALIZATION_PENDING',
          })
        }
        if (reservation) {
          try {
            quota.release(reservation.id)
          } catch (releaseError) {
            console.error('Studio quota release failed', releaseError)
          }
        }
        if (output && typeof outputs.remove === 'function') {
          try {
            await outputs.remove(output)
          } catch (removeError) {
            console.error('Studio generation output cleanup failed', removeError)
          }
        }
        const reason = normalizeReason(error?.reason)
        tasks.fail(created.task.id, reason)
        throw new GenerationError(publicMessage(reason), {
          status: reason === 'QUOTA_EXHAUSTED' ? 402 : 502,
          reason,
        })
      }
    },

    async recoverPending() {
      for (const task of tasks.listFinalizationPending()) {
        try {
          const current = quota.getReservation(task.reservationId)
          const reservation = current?.status === 'reserved'
            ? quota.confirm(task.reservationId)
            : current
          if (reservation?.status === 'confirmed') {
            tasks.succeed(task.id)
            continue
          }
          await outputs.remove(task.output)
          tasks.fail(task.id, 'GENERATION_FINALIZATION_EXPIRED')
        } catch (error) {
          console.error('Studio generation recovery failed', error)
        }
      }
    },
  }
}

function replay(task) {
  if (task.status === 'succeeded') return task
  if (task.status === 'failed') {
    throw new GenerationError(publicMessage(task.errorReason), {
      status: task.errorReason === 'QUOTA_EXHAUSTED' ? 402 : 502,
      reason: 'GENERATION_FAILED',
    })
  }
  throw new GenerationError('创作任务正在处理中', {
    status: 409,
    reason: 'GENERATION_IN_PROGRESS',
  })
}

function normalizeReason(reason) {
  const allowed = new Set([
    'QUOTA_EXHAUSTED',
    'IMAGE_PROVIDER_TIMEOUT',
    'IMAGE_PROVIDER_UNAVAILABLE',
    'IMAGE_PROVIDER_REJECTED',
    'IMAGE_PROVIDER_PROTOCOL_ERROR',
    'OUTPUT_STORAGE_FAILED',
  ])
  return allowed.has(reason) ? reason : 'GENERATION_FAILED'
}

function publicMessage(reason) {
  if (reason === 'QUOTA_EXHAUSTED') return '创作额度不足'
  if (reason === 'IMAGE_PROVIDER_TIMEOUT') return '这次生成超时了，没有扣除额度，请稍后重试'
  if (reason === 'IMAGE_PROVIDER_REJECTED') return '当前描述无法生成，没有扣除额度，请调整后重试'
  if (reason === 'OUTPUT_STORAGE_FAILED') return '作品保存失败，没有扣除额度，请稍后重试'
  return '这次没有生成成功，也没有扣除额度，请稍后重试'
}

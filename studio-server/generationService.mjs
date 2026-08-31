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
  const control = options.control
  if (!tasks || !quota || !images || !outputs || !control?.assertAccepting) throw new Error('Studio generation dependencies are required')
  const clock = options.clock ?? (() => new Date())
  const activeTaskTtlSeconds = options.activeTaskTtlSeconds === undefined ? 900 : Number(options.activeTaskTtlSeconds)
  if (!Number.isInteger(activeTaskTtlSeconds) || activeTaskTtlSeconds < 60 || activeTaskTtlSeconds > 3600) {
    throw new Error('Studio active generation TTL is invalid')
  }

  return {
    async generate(user, input, idempotencyKey) {
      const userId = String(user?.id ?? '').trim()
      const key = String(idempotencyKey ?? '').trim()
      if (!userId) throw new GenerationError('请先登录', { status: 401, reason: 'UNAUTHENTICATED' })
      if (!key || key.length > 200) throw new GenerationError('创作请求标识无效', { status: 400, reason: 'INVALID_IDEMPOTENCY_KEY' })

      await control.assertAccepting()
      const created = await tasks.createTask(userId, input, key)
      if (!created.created) return replay(created.task)

      let reservation = null
      let output = null
      let confirmed = false
      let finalizationPending = false
      try {
        reservation = await quota.reserve(userId, key)
        await tasks.markReserved(created.task.id, reservation.id)
        await tasks.markRunning(created.task.id)

        const result = await images.generate(input)
        if (!Array.isArray(result?.images) || result.images.length !== 1) {
          throw Object.assign(new Error('invalid image result'), { reason: 'IMAGE_PROVIDER_PROTOCOL_ERROR' })
        }
        output = await outputs.save(created.task.id, result.images[0], userId)
        await tasks.storeOutput(created.task.id, {
          ...output,
          revisedPrompt: result.images[0].revisedPrompt,
          usage: result.usage,
        })
        let confirmation
        try {
          confirmation = await quota.confirm(reservation.id)
        } catch (error) {
          let current = null
          try {
            current = await quota.getReservation(reservation.id)
          } catch (lookupError) {
            console.error('Studio quota confirmation lookup failed', lookupError)
          }
          if (current?.status === 'confirmed') {
            confirmation = current
          } else {
            finalizationPending = !['released', 'expired'].includes(current?.status)
            throw error
          }
        }
        if (confirmation?.status !== 'confirmed') throw new Error('quota reservation was not confirmed')
        confirmed = true
        return await tasks.succeed(created.task.id)
      } catch (error) {
        if (confirmed || finalizationPending) {
          throw new GenerationError('作品已生成，正在完成入库，请稍后刷新', {
            status: 503,
            reason: 'GENERATION_FINALIZATION_PENDING',
          })
        }
        if (reservation) {
          try {
            await quota.release(reservation.id)
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
        await tasks.fail(created.task.id, reason)
        throw generationFailure(reason)
      }
    },

    async recoverPending() {
      const cutoff = clock().getTime() - activeTaskTtlSeconds * 1000
      for (const task of await tasks.listStaleActive(cutoff)) {
        if (task.reservationId) await quota.release(task.reservationId)
        await tasks.fail(task.id, 'GENERATION_RECOVERY_TIMEOUT')
      }
      for (const task of await tasks.listFinalizationPending()) {
        try {
          const current = await quota.getReservation(task.reservationId)
          const reservation = current?.status === 'reserved'
            ? await quota.confirm(task.reservationId)
            : current
          if (reservation?.status === 'confirmed') {
            await tasks.succeed(task.id)
            continue
          }
          await outputs.remove(task.output)
          await tasks.fail(task.id, 'GENERATION_FINALIZATION_EXPIRED')
        } catch (error) {
          console.error('Studio generation recovery failed', error)
        }
      }
    },
  }
}

function replay(task) {
  if (task.status !== 'failed') return task
  throw generationFailure(task.errorReason)
}

function normalizeReason(reason) {
  const allowed = new Set([
    'QUOTA_EXHAUSTED',
    'IMAGE_PROVIDER_TIMEOUT',
    'IMAGE_PROVIDER_UNAVAILABLE',
    'IMAGE_PROVIDER_REJECTED',
    'IMAGE_PROVIDER_PROTOCOL_ERROR',
    'OUTPUT_STORAGE_FAILED',
    'GENERATION_RECOVERY_TIMEOUT',
  ])
  return allowed.has(reason) ? reason : 'GENERATION_FAILED'
}

function publicMessage(reason) {
  if (reason === 'QUOTA_EXHAUSTED') return '创作额度不足'
  if (reason === 'GENERATION_RECOVERY_TIMEOUT') return '上次创作因处理超时而中止，没有扣除额度，请重新生成'
  if (reason === 'IMAGE_PROVIDER_TIMEOUT') return '这次生成超时了，没有扣除额度，请稍后重试'
  if (reason === 'IMAGE_PROVIDER_REJECTED') return '当前描述无法生成，没有扣除额度，请调整后重试'
  if (reason === 'OUTPUT_STORAGE_FAILED') return '作品保存失败，没有扣除额度，请稍后重试'
  return '这次没有生成成功，也没有扣除额度，请稍后重试'
}

function generationFailure(reason) {
  const value = normalizeReason(reason)
  const status = value === 'QUOTA_EXHAUSTED' ? 402 : value === 'GENERATION_RECOVERY_TIMEOUT' ? 503 : 502
  return new GenerationError(publicMessage(value), { status, reason: value })
}

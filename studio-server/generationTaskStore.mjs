import { randomUUID } from 'node:crypto'

export class TaskStoreError extends Error {
  constructor(message, reason = 'TASK_STORE_ERROR') {
    super(message)
    this.name = 'TaskStoreError'
    this.reason = reason
  }
}

export function createGenerationTaskStore(options = {}) {
  const database = options.database
  if (!database?.query) throw new Error('Studio task PostgreSQL database is required')
  const clock = options.clock ?? (() => new Date())

  const transition = async (id, status, next, values = []) => {
    const assignments = next === 'output_stored'
      ? 'status = $1, output_json = $2, updated_at = $3'
      : next === 'failed'
        ? 'status = $1, error_reason = $2, updated_at = $3'
        : next === 'reserved'
          ? 'status = $1, reservation_id = $2, updated_at = $3'
          : 'status = $1, updated_at = $2'
    const params = [next, ...values, clock().getTime(), id]
    const result = await database.query(`
      UPDATE studio_generation_tasks
      SET ${assignments}
      WHERE id = $${params.length} AND status = $${params.length + 1}
      RETURNING *
    `, [...params, status])
    if (!result.rowCount) {
      throw new TaskStoreError('创作任务状态已变化，请刷新后重试', 'INVALID_TASK_STATE')
    }
    return mapTask(result.rows[0])
  }

  return {
    async createTask(userId, input, idempotencyKey) {
      const normalized = normalizeInput(userId, input, idempotencyKey)
      const id = randomUUID()
      const now = clock().getTime()
      const inserted = await database.query(`
        INSERT INTO studio_generation_tasks
          (id, user_id, idempotency_key, prompt, size, quality, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'created', $7, $7)
        ON CONFLICT(user_id, idempotency_key) DO NOTHING
        RETURNING *
      `, [
        id,
        normalized.userId,
        normalized.idempotencyKey,
        normalized.prompt,
        normalized.size,
        normalized.quality,
        now,
      ])
      if (inserted.rowCount) return { created: true, task: mapTask(inserted.rows[0]) }

      const existing = await database.query(`
        SELECT *
        FROM studio_generation_tasks
        WHERE user_id = $1 AND idempotency_key = $2
      `, [normalized.userId, normalized.idempotencyKey])
      const row = existing.rows[0]
      if (!row) throw new TaskStoreError('创作任务创建冲突，请重试', 'TASK_CREATE_CONFLICT')
      if (row.prompt !== normalized.prompt || row.size !== normalized.size || row.quality !== normalized.quality) {
        throw new TaskStoreError('相同创作请求标识不能用于不同内容', 'IDEMPOTENCY_CONFLICT')
      }
      return { created: false, task: mapTask(row) }
    },

    markReserved(id, reservationId) {
      const value = String(reservationId ?? '').trim()
      if (!value || value.length > 200) throw new Error('Studio quota reservation id is invalid')
      return transition(id, 'created', 'reserved', [value])
    },

    markRunning(id) {
      return transition(id, 'reserved', 'running')
    },

    storeOutput(id, output) {
      return transition(id, 'running', 'output_stored', [normalizeOutput(output)])
    },

    succeed(id) {
      return transition(id, 'output_stored', 'succeeded')
    },

    fail(id, reason) {
      const value = String(reason ?? '').trim()
      if (!value || value.length > 100) throw new Error('Studio generation failure reason is invalid')
      return transitionFromMany(id, ['created', 'reserved', 'running', 'output_stored'], value, clock, database)
    },

    async getTask(userId, id) {
      const result = await database.query(`
        SELECT *
        FROM studio_generation_tasks
        WHERE user_id = $1 AND id = $2
      `, [String(userId ?? ''), String(id ?? '')])
      return mapTask(result.rows[0])
    },

    async listTasks(userId, options = {}) {
      const requested = options.limit === undefined ? 50 : Number(options.limit)
      const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 50
      const result = await database.query(`
        SELECT *
        FROM studio_generation_tasks
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `, [String(userId ?? ''), limit])
      return result.rows.map(mapTask)
    },

    async listFinalizationPending() {
      const result = await database.query(`
        SELECT *
        FROM studio_generation_tasks
        WHERE status = 'output_stored'
        ORDER BY updated_at ASC, id ASC
      `)
      return result.rows.map(mapTask)
    },
  }
}

async function transitionFromMany(id, statuses, reason, clock, database) {
  const result = await database.query(`
    UPDATE studio_generation_tasks
    SET status = 'failed', error_reason = $1, updated_at = $2
    WHERE id = $3 AND status = ANY($4::TEXT[])
    RETURNING *
  `, [reason, clock().getTime(), id, statuses])
  if (!result.rowCount) {
    throw new TaskStoreError('创作任务状态已变化，请刷新后重试', 'INVALID_TASK_STATE')
  }
  return mapTask(result.rows[0])
}

function normalizeInput(userId, input, idempotencyKey) {
  const normalized = {
    userId: String(userId ?? '').trim(),
    idempotencyKey: String(idempotencyKey ?? '').trim(),
    prompt: String(input?.prompt ?? '').trim(),
    size: String(input?.size ?? '').trim(),
    quality: String(input?.quality ?? '').trim(),
  }
  if (!normalized.userId || normalized.userId.length > 128) throw new Error('Studio generation user id is invalid')
  if (!normalized.idempotencyKey || normalized.idempotencyKey.length > 200) {
    throw new Error('Studio generation idempotency key is invalid')
  }
  if (!normalized.prompt || normalized.prompt.length > 10000) throw new Error('Studio generation prompt is invalid')
  if (!normalized.size || normalized.size.length > 32) throw new Error('Studio generation size is invalid')
  if (!normalized.quality || normalized.quality.length > 32) throw new Error('Studio generation quality is invalid')
  return normalized
}

function normalizeOutput(output) {
  const value = {
    key: String(output?.key ?? '').trim(),
    url: String(output?.url ?? '').trim(),
  }
  if (!value.key || value.key.length > 500 || !value.url.startsWith('/api/artworks/')) {
    throw new Error('Studio generation output reference is invalid')
  }
  const revisedPrompt = String(output?.revisedPrompt ?? '').trim()
  if (revisedPrompt) value.revisedPrompt = revisedPrompt.slice(0, 10000)
  if (output?.usage !== undefined) {
    const usage = JSON.parse(JSON.stringify(output.usage))
    if (JSON.stringify(usage).length > 50000) throw new Error('Studio generation usage is too large')
    value.usage = usage
  }
  const hasMetadata = ['etag', 'sha256', 'bytes', 'mimeType'].some((key) => output?.[key] !== undefined)
  if (hasMetadata) {
    const etag = output.etag === null ? null : String(output.etag ?? '').trim()
    const sha256 = String(output.sha256 ?? '').trim()
    const bytes = output.bytes
    const mimeType = String(output.mimeType ?? '').trim()
    if (
      (etag !== null && (!etag || etag.length > 200 || /\s/.test(etag)))
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !Number.isInteger(bytes)
      || bytes < 1
      || bytes > 100 * 1024 * 1024
      || mimeType !== 'image/png'
    ) {
      throw new Error('Studio generation output metadata is invalid')
    }
    Object.assign(value, { etag, sha256, bytes, mimeType })
  }
  return value
}

function mapTask(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    input: {
      prompt: row.prompt,
      size: row.size,
      quality: row.quality,
    },
    status: row.status,
    reservationId: row.reservation_id ?? null,
    output: typeof row.output_json === 'string' ? JSON.parse(row.output_json) : row.output_json,
    errorReason: row.error_reason ?? null,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  }
}

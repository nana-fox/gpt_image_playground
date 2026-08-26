import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export class TaskStoreError extends Error {
  constructor(message, reason = 'TASK_STORE_ERROR') {
    super(message)
    this.name = 'TaskStoreError'
    this.reason = reason
  }
}

export function createGenerationTaskStore(options = {}) {
  const filename = String(options.filename ?? '').trim()
  if (!filename) throw new Error('Studio task database filename is required')
  const clock = options.clock ?? (() => new Date())
  const db = new DatabaseSync(filename)
  let closed = false

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS studio_generation_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      prompt TEXT NOT NULL,
      size TEXT NOT NULL,
      quality TEXT NOT NULL,
      status TEXT NOT NULL,
      reservation_id TEXT,
      output_json TEXT,
      error_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_studio_generation_tasks_user_created
      ON studio_generation_tasks(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_studio_generation_tasks_status
      ON studio_generation_tasks(status, updated_at);
  `)

  const readByKey = db.prepare(`
    SELECT * FROM studio_generation_tasks
    WHERE user_id = ? AND idempotency_key = ?
  `)
  const readById = db.prepare('SELECT * FROM studio_generation_tasks WHERE id = ?')
  const readForUser = db.prepare('SELECT * FROM studio_generation_tasks WHERE user_id = ? AND id = ?')
  const listForUser = db.prepare(`
    SELECT * FROM studio_generation_tasks
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `)
  const listPending = db.prepare(`
    SELECT * FROM studio_generation_tasks
    WHERE status = 'output_stored'
    ORDER BY updated_at ASC, id ASC
  `)
  const insertTask = db.prepare(`
    INSERT INTO studio_generation_tasks
      (id, user_id, idempotency_key, prompt, size, quality, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?)
  `)
  const reserveTask = db.prepare(`
    UPDATE studio_generation_tasks
    SET status = 'reserved', reservation_id = ?, updated_at = ?
    WHERE id = ? AND status = 'created'
  `)
  const runTask = db.prepare(`
    UPDATE studio_generation_tasks
    SET status = 'running', updated_at = ?
    WHERE id = ? AND status = 'reserved'
  `)
  const outputTask = db.prepare(`
    UPDATE studio_generation_tasks
    SET status = 'output_stored', output_json = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `)
  const succeedTask = db.prepare(`
    UPDATE studio_generation_tasks
    SET status = 'succeeded', updated_at = ?
    WHERE id = ? AND status = 'output_stored'
  `)
  const failTask = db.prepare(`
    UPDATE studio_generation_tasks
    SET status = 'failed', error_reason = ?, updated_at = ?
    WHERE id = ? AND status IN ('created', 'reserved', 'running', 'output_stored')
  `)

  const transition = (statement, id, ...params) => {
    if (statement.run(...params, clock().getTime(), id).changes !== 1) {
      throw new TaskStoreError('创作任务状态已变化，请刷新后重试', 'INVALID_TASK_STATE')
    }
    return mapTask(readById.get(id))
  }

  return {
    createTask(userId, input, idempotencyKey) {
      const normalized = normalizeInput(userId, input, idempotencyKey)
      const existing = readByKey.get(normalized.userId, normalized.idempotencyKey)
      if (existing) {
        if (existing.prompt !== normalized.prompt || existing.size !== normalized.size || existing.quality !== normalized.quality) {
          throw new TaskStoreError('相同创作请求标识不能用于不同内容', 'IDEMPOTENCY_CONFLICT')
        }
        return { created: false, task: mapTask(existing) }
      }

      const id = randomUUID()
      const now = clock().getTime()
      try {
        insertTask.run(
          id,
          normalized.userId,
          normalized.idempotencyKey,
          normalized.prompt,
          normalized.size,
          normalized.quality,
          now,
          now,
        )
      } catch (error) {
        const raced = readByKey.get(normalized.userId, normalized.idempotencyKey)
        if (!raced) throw error
        if (raced.prompt !== normalized.prompt || raced.size !== normalized.size || raced.quality !== normalized.quality) {
          throw new TaskStoreError('相同创作请求标识不能用于不同内容', 'IDEMPOTENCY_CONFLICT')
        }
        return { created: false, task: mapTask(raced) }
      }
      return { created: true, task: mapTask(readById.get(id)) }
    },

    markReserved(id, reservationId) {
      const value = String(reservationId ?? '').trim()
      if (!value || value.length > 200) throw new Error('Studio quota reservation id is invalid')
      return transition(reserveTask, id, value)
    },

    markRunning(id) {
      return transition(runTask, id)
    },

    storeOutput(id, output) {
      const value = normalizeOutput(output)
      return transition(outputTask, id, JSON.stringify(value))
    },

    succeed(id) {
      return transition(succeedTask, id)
    },

    fail(id, reason) {
      const value = String(reason ?? '').trim()
      if (!value || value.length > 100) throw new Error('Studio generation failure reason is invalid')
      return transition(failTask, id, value)
    },

    getTask(userId, id) {
      return mapTask(readForUser.get(String(userId ?? ''), String(id ?? '')))
    },

    listTasks(userId, options = {}) {
      const requested = options.limit === undefined ? 50 : Number(options.limit)
      const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 50
      return listForUser.all(String(userId ?? ''), limit).map(mapTask)
    },

    listFinalizationPending() {
      return listPending.all().map(mapTask)
    },

    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
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
    output: row.output_json ? JSON.parse(row.output_json) : null,
    errorReason: row.error_reason ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

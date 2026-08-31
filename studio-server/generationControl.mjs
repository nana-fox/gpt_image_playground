import { randomUUID } from 'node:crypto'

export class GenerationControlError extends Error {
  constructor(message, reason = 'GENERATION_CONTROL_ERROR', status = 400) {
    super(message)
    this.name = 'GenerationControlError'
    this.reason = reason
    this.status = status
  }
}

export function createGenerationControl(options = {}) {
  const database = options.database
  if (!database?.query || !database?.transaction) throw new Error('Studio generation control PostgreSQL database is required')
  const clock = options.clock ?? (() => new Date())
  const masterEnabled = options.masterEnabled === true
  const providerKeyConfigured = options.providerKeyConfigured === true
  const model = options.model ? String(options.model) : null
  const storage = ['filesystem', 'r2'].includes(options.storage) ? options.storage : null

  const getChannel = async () => {
    const result = await database.query(`
      SELECT accepting_generations, version
      FROM studio_generation_channel
      WHERE id = 1
    `)
    if (!result.rowCount) throw new GenerationControlError('生图服务配置不存在', 'GENERATION_CHANNEL_NOT_FOUND', 500)
    return mapChannel(result.rows[0])
  }

  const getStatus = async () => publicStatus(await getChannel())

  return {
    getStatus,

    async assertAccepting() {
      const status = await getStatus()
      if (!status.masterEnabled) {
        throw new GenerationControlError('创作服务暂时不可用', 'GENERATION_UNAVAILABLE', 503)
      }
      if (!status.acceptingGenerations) {
        throw new GenerationControlError('创作服务已暂停接收新任务', 'GENERATION_NOT_ACCEPTING', 503)
      }
    },

    async updateStatus(input, audit) {
      const expectedVersion = Number(input?.expectedVersion)
      if (typeof input?.acceptingGenerations !== 'boolean' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw validationError()
      }
      if (input.acceptingGenerations && !masterEnabled) {
        throw new GenerationControlError('部署配置尚未启用生图服务', 'GENERATION_DEPLOYMENT_DISABLED', 409)
      }
      const actorSubject = String(audit?.actorSubject ?? '').trim()
      if (!actorSubject || actorSubject.length > 128) throw validationError()

      const channel = await database.transaction(async (client) => {
        const current = await client.query(`
          SELECT accepting_generations, version
          FROM studio_generation_channel
          WHERE id = 1
          FOR UPDATE
        `)
        if (!current.rowCount) throw new GenerationControlError('生图服务配置不存在', 'GENERATION_CHANNEL_NOT_FOUND', 500)
        const before = mapChannel(current.rows[0])
        if (before.version !== expectedVersion) {
          throw new GenerationControlError('生图服务已被其他人更新，请刷新后重试', 'GENERATION_CHANNEL_VERSION_CONFLICT', 409)
        }
        const now = clock().getTime()
        const result = await client.query(`
          UPDATE studio_generation_channel
          SET accepting_generations = $1, version = version + 1, updated_at = $2
          WHERE id = 1 AND version = $3
          RETURNING accepting_generations, version
        `, [input.acceptingGenerations, now, expectedVersion])
        if (!result.rowCount) {
          throw new GenerationControlError('生图服务已被其他人更新，请刷新后重试', 'GENERATION_CHANNEL_VERSION_CONFLICT', 409)
        }
        const updated = mapChannel(result.rows[0])
        await client.query(`
          INSERT INTO studio_admin_audit_log
            (id, actor_subject, action, target_user_id, reference, before_json, after_json, created_at)
          VALUES ($1, $2, 'generation_channel.update', NULL, 'studio_generation', $3, $4, $5)
        `, [randomUUID(), actorSubject, before, updated, now])
        return updated
      })
      return publicStatus(channel)
    },
  }

  function publicStatus(channel) {
    return {
      masterEnabled,
      acceptingGenerations: channel.acceptingGenerations,
      providerKeyConfigured,
      available: masterEnabled && channel.acceptingGenerations && providerKeyConfigured,
      model,
      storage,
      version: channel.version,
    }
  }
}

function mapChannel(row) {
  return {
    acceptingGenerations: row.accepting_generations === true,
    version: Number(row.version),
  }
}

function validationError() {
  return new GenerationControlError('生图服务配置无效', 'VALIDATION_ERROR')
}

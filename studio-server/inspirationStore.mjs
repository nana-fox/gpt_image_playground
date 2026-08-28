import { randomUUID } from 'node:crypto'

const ALLOWED_IMAGES = new Set([
  'inspiration-product.png',
  'inspiration-portrait.png',
  'inspiration-social.png',
  'inspiration-illustration.png',
  'inspiration-interior.png',
  'recent-perfume.png',
  'recent-alley.png',
  'recent-flowers.png',
  'recent-cat.png',
])

export class InspirationStoreError extends Error {
  constructor(message, reason = 'INSPIRATION_STORE_ERROR', status = 400) {
    super(message)
    this.name = 'InspirationStoreError'
    this.reason = reason
    this.status = status
  }
}

export function createInspirationStore(options = {}) {
  const database = options.database
  if (!database?.query || !database?.transaction) throw new Error('Studio inspiration PostgreSQL database is required')
  const clock = options.clock ?? (() => new Date())

  const list = async (admin = false) => {
    const result = await database.query(`
      SELECT id, category, title, description, prompt, image_asset,
        enabled, featured, sort_order, version
      FROM studio_inspirations
      ${admin ? '' : 'WHERE enabled = TRUE'}
      ORDER BY sort_order, id
    `)
    return result.rows.map(mapInspiration)
  }

  return {
    listPublished: () => list(false),
    listAdmin: () => list(true),

    async create(input, audit) {
      const inspiration = normalizeInput(input)
      const actorSubject = normalizeActor(audit)
      const id = randomUUID()
      const now = clock().getTime()
      return database.transaction(async (client) => {
        const result = await client.query(`
          INSERT INTO studio_inspirations
            (id, category, title, description, prompt, image_asset, enabled,
             featured, sort_order, version, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)
          RETURNING id, category, title, description, prompt, image_asset,
            enabled, featured, sort_order, version
        `, [
          id, inspiration.category, inspiration.title, inspiration.description,
          inspiration.prompt, inspiration.image, inspiration.enabled,
          inspiration.featured, inspiration.sortOrder, now,
        ])
        const created = mapInspiration(result.rows[0])
        await client.query(`
          INSERT INTO studio_admin_audit_log
            (id, actor_subject, action, target_user_id, reference, before_json, after_json, created_at)
          VALUES ($1, $2, 'inspiration.create', NULL, $3, NULL, $4, $5)
        `, [randomUUID(), actorSubject, id, created, now])
        return created
      })
    },

    async update(id, input, audit) {
      const inspirationId = normalizeId(id)
      const inspiration = normalizeInput(input)
      const expectedVersion = Number(input?.expectedVersion)
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw validationError('灵感版本无效')
      const actorSubject = normalizeActor(audit)
      return database.transaction(async (client) => {
        const current = await client.query(`
          SELECT id, category, title, description, prompt, image_asset,
            enabled, featured, sort_order, version
          FROM studio_inspirations
          WHERE id = $1
          FOR UPDATE
        `, [inspirationId])
        if (!current.rowCount) throw new InspirationStoreError('找不到这个灵感', 'INSPIRATION_NOT_FOUND', 404)
        const before = mapInspiration(current.rows[0])
        if (before.version !== expectedVersion) {
          throw new InspirationStoreError('灵感已被其他人更新，请刷新后重试', 'INSPIRATION_VERSION_CONFLICT', 409)
        }
        const now = clock().getTime()
        const result = await client.query(`
          UPDATE studio_inspirations
          SET category = $1, title = $2, description = $3, prompt = $4,
            image_asset = $5, enabled = $6, featured = $7, sort_order = $8,
            version = version + 1, updated_at = $9
          WHERE id = $10 AND version = $11
          RETURNING id, category, title, description, prompt, image_asset,
            enabled, featured, sort_order, version
        `, [
          inspiration.category, inspiration.title, inspiration.description,
          inspiration.prompt, inspiration.image, inspiration.enabled,
          inspiration.featured, inspiration.sortOrder, now, inspirationId, expectedVersion,
        ])
        if (!result.rowCount) {
          throw new InspirationStoreError('灵感已被其他人更新，请刷新后重试', 'INSPIRATION_VERSION_CONFLICT', 409)
        }
        const updated = mapInspiration(result.rows[0])
        await client.query(`
          INSERT INTO studio_admin_audit_log
            (id, actor_subject, action, target_user_id, reference, before_json, after_json, created_at)
          VALUES ($1, $2, 'inspiration.update', NULL, $3, $4, $5, $6)
        `, [randomUUID(), actorSubject, inspirationId, before, updated, now])
        return updated
      })
    },
  }
}

function normalizeInput(input) {
  const value = {
    category: String(input?.category ?? '').trim(),
    title: String(input?.title ?? '').trim(),
    description: String(input?.description ?? '').trim(),
    prompt: String(input?.prompt ?? '').trim(),
    image: String(input?.image ?? '').trim(),
    enabled: input?.enabled,
    featured: input?.featured,
    sortOrder: Number(input?.sortOrder),
  }
  if (!value.category || value.category.length > 30 || !value.title || value.title.length > 100) throw validationError('灵感分类或标题无效')
  if (!value.description || value.description.length > 300 || !value.prompt || value.prompt.length > 10000) throw validationError('灵感说明或提示词无效')
  if (!ALLOWED_IMAGES.has(value.image)) throw validationError('灵感封面无效')
  if (typeof value.enabled !== 'boolean' || typeof value.featured !== 'boolean') throw validationError('灵感状态无效')
  if (!Number.isInteger(value.sortOrder) || value.sortOrder < 0 || value.sortOrder > 100000) throw validationError('灵感排序无效')
  return value
}

function normalizeId(value) {
  const id = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw validationError('灵感编号无效')
  return id
}

function normalizeActor(audit) {
  const actorSubject = String(audit?.actorSubject ?? '').trim()
  if (!actorSubject || actorSubject.length > 128) throw validationError('运营身份无效')
  return actorSubject
}

function mapInspiration(row) {
  if (!row) return null
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    image: row.image_asset,
    enabled: row.enabled,
    featured: row.featured,
    sortOrder: Number(row.sort_order),
    version: Number(row.version),
  }
}

function validationError(message) {
  return new InspirationStoreError(message, 'INSPIRATION_VALIDATION_ERROR', 400)
}

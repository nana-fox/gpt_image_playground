import { createHash, randomBytes as secureRandomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60

export function createSessionStore(options = {}) {
  const database = options.database
  if (!database?.query || !database?.transaction) throw new Error('Studio session PostgreSQL database is required')

  const clock = options.clock ?? (() => new Date())
  const randomBytes = options.randomBytes ?? secureRandomBytes
  const ttlSeconds = Number.isInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_TTL_SECONDS

  return {
    async createSession(identity) {
      const subject = String(identity?.subject ?? '').trim()
      const email = String(identity?.email ?? '').trim().toLowerCase()
      const displayName = String(identity?.display_name ?? identity?.displayName ?? '').trim()
      if (!subject || subject.length > 128) throw new Error('Router identity subject is invalid')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
        throw new Error('Router identity email is invalid')
      }

      const now = clock().getTime()
      const sessionToken = Buffer.from(randomBytes(32)).toString('hex')
      const csrfToken = Buffer.from(randomBytes(32)).toString('hex')
      if (sessionToken.length !== 64 || csrfToken.length !== 64) {
        throw new Error('Studio session random source must return 32 bytes')
      }

      return database.transaction(async (client) => {
        const users = await client.query(`
          INSERT INTO studio_users (id, identity_subject, email, display_name, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $5)
          ON CONFLICT(identity_subject) DO UPDATE SET
            email = EXCLUDED.email,
            display_name = EXCLUDED.display_name,
            updated_at = EXCLUDED.updated_at
          RETURNING id, identity_subject, email, display_name
        `, [randomUUID(), subject, email, displayName, now])
        const user = users.rows[0]
        await client.query(`
          INSERT INTO studio_sessions (token_hash, csrf_hash, user_id, expires_at, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [hash(sessionToken), hash(csrfToken), user.id, now + ttlSeconds * 1000, now])
        return {
          sessionToken,
          csrfToken,
          expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
          user: mapUser(user),
        }
      })
    },

    async getSession(sessionToken) {
      const result = await database.query(`
        SELECT
          s.expires_at,
          u.id,
          u.identity_subject,
          u.email,
          u.display_name
        FROM studio_sessions s
        JOIN studio_users u ON u.id = s.user_id
        WHERE s.token_hash = $1
      `, [hash(sessionToken)])
      const row = result.rows[0]
      if (!row) return null
      if (Number(row.expires_at) <= clock().getTime()) {
        await database.query('DELETE FROM studio_sessions WHERE token_hash = $1', [hash(sessionToken)])
        return null
      }
      return {
        expiresAt: new Date(Number(row.expires_at)).toISOString(),
        user: mapUser(row),
      }
    },

    async verifyCsrf(sessionToken, csrfToken) {
      const result = await database.query(`
        SELECT csrf_hash, expires_at
        FROM studio_sessions
        WHERE token_hash = $1
      `, [hash(sessionToken)])
      const row = result.rows[0]
      if (!row || Number(row.expires_at) <= clock().getTime()) return false
      const actual = Buffer.from(row.csrf_hash, 'hex')
      const expected = Buffer.from(hash(csrfToken), 'hex')
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    },

    async deleteSession(sessionToken) {
      const result = await database.query('DELETE FROM studio_sessions WHERE token_hash = $1', [hash(sessionToken)])
      return result.rowCount > 0
    },

    async deleteSessionsByEmail(email) {
      const result = await database.query(`
        DELETE FROM studio_sessions s
        USING studio_users u
        WHERE s.user_id = u.id AND LOWER(u.email) = LOWER($1)
      `, [String(email ?? '').trim()])
      return result.rowCount
    },

    async getUser(userId) {
      const result = await database.query(`
        SELECT id, email, display_name
        FROM studio_users
        WHERE id = $1
      `, [String(userId ?? '')])
      return result.rowCount ? mapPublicUser(result.rows[0]) : null
    },

    async searchUsers(query, limit = 20) {
      const value = String(query ?? '').trim()
      const size = Number(limit)
      if (value.length > 200 || !Number.isInteger(size) || size < 1 || size > 50) {
        throw new Error('Studio user search is invalid')
      }
      const result = await database.query(`
        SELECT id, email, display_name
        FROM studio_users
        WHERE $1 = '' OR email ILIKE $2 OR display_name ILIKE $2
        ORDER BY updated_at DESC
        LIMIT $3
      `, [value, `%${value}%`, size])
      return result.rows.map(mapPublicUser)
    },
  }
}

function hash(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex')
}

function mapUser(row) {
  return {
    id: row.id,
    identitySubject: row.identity_subject,
    email: row.email,
    displayName: row.display_name,
  }
}

function mapPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  }
}

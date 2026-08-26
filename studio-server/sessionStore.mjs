import { createHash, randomBytes as secureRandomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60

export function createSessionStore(options = {}) {
  const filename = String(options.filename ?? '').trim()
  if (!filename) throw new Error('Studio session database filename is required')

  const clock = options.clock ?? (() => new Date())
  const randomBytes = options.randomBytes ?? secureRandomBytes
  const ttlSeconds = Number.isInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_TTL_SECONDS
  const db = new DatabaseSync(filename)
  let closed = false

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS studio_users (
      id TEXT PRIMARY KEY,
      identity_subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_studio_sessions_expires_at
      ON studio_sessions(expires_at);
  `)

  const findUser = db.prepare(`
    SELECT id, identity_subject, email, display_name
    FROM studio_users
    WHERE identity_subject = ?
  `)
  const insertUser = db.prepare(`
    INSERT INTO studio_users (id, identity_subject, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(identity_subject) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `)
  const insertSession = db.prepare(`
    INSERT INTO studio_sessions (token_hash, csrf_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const findSession = db.prepare(`
    SELECT
      s.csrf_hash,
      s.expires_at,
      u.id,
      u.identity_subject,
      u.email,
      u.display_name
    FROM studio_sessions s
    JOIN studio_users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `)
  const deleteSession = db.prepare('DELETE FROM studio_sessions WHERE token_hash = ?')

  return {
    createSession(identity) {
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

      db.exec('BEGIN IMMEDIATE')
      try {
        insertUser.run(randomUUID(), subject, email, displayName, now, now)
        const row = findUser.get(subject)
        insertSession.run(hash(sessionToken), hash(csrfToken), row.id, now + ttlSeconds * 1000, now)
        db.exec('COMMIT')
        return {
          sessionToken,
          csrfToken,
          expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
          user: mapUser(row),
        }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    getSession(sessionToken) {
      const row = findSession.get(hash(sessionToken))
      if (!row) return null
      if (row.expires_at <= clock().getTime()) {
        deleteSession.run(hash(sessionToken))
        return null
      }
      return {
        expiresAt: new Date(row.expires_at).toISOString(),
        user: mapUser(row),
      }
    },

    verifyCsrf(sessionToken, csrfToken) {
      const row = findSession.get(hash(sessionToken))
      if (!row || row.expires_at <= clock().getTime()) return false
      const actual = Buffer.from(row.csrf_hash, 'hex')
      const expected = Buffer.from(hash(csrfToken), 'hex')
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    },

    deleteSession(sessionToken) {
      return deleteSession.run(hash(sessionToken)).changes > 0
    },

    close() {
      if (closed) return
      closed = true
      db.close()
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

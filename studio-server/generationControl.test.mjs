import assert from 'node:assert/strict'
import test from 'node:test'

import { createGenerationControl, GenerationControlError } from './generationControl.mjs'

function createDatabase(row = { accepting_generations: true, version: 1 }) {
  const calls = []
  return {
    calls,
    query(sql) {
      calls.push(['query', sql])
      return { rowCount: 1, rows: [row] }
    },
    transaction(run) {
      return run({
        query(sql, values) {
          calls.push(['transaction', sql, values])
          if (sql.includes('SELECT accepting_generations')) return { rowCount: 1, rows: [row] }
          if (sql.includes('UPDATE studio_generation_channel')) {
            row = { accepting_generations: values[0], version: row.version + 1 }
            return { rowCount: 1, rows: [row] }
          }
          return { rowCount: 1, rows: [] }
        },
      })
    },
  }
}

test('generation control exposes only safe runtime status and audits updates', async () => {
  const database = createDatabase()
  const control = createGenerationControl({
    database,
    masterEnabled: true,
    model: 'gpt-image-2',
    storage: 'r2',
    providerKeyConfigured: true,
    clock: () => new Date('2026-08-31T12:00:00.000Z'),
  })

  assert.deepEqual(await control.getStatus(), {
    masterEnabled: true,
    acceptingGenerations: true,
    providerKeyConfigured: true,
    available: true,
    model: 'gpt-image-2',
    storage: 'r2',
    version: 1,
  })
  assert.deepEqual(await control.updateStatus({ acceptingGenerations: false, expectedVersion: 1 }, {
    actorSubject: 'router-admin',
  }), {
    masterEnabled: true,
    acceptingGenerations: false,
    providerKeyConfigured: true,
    available: false,
    model: 'gpt-image-2',
    storage: 'r2',
    version: 2,
  })
  assert.equal(database.calls.some((call) => String(call[1]).includes('studio_admin_audit_log')), true)
})

test('deployment master cannot be bypassed by operations', async () => {
  const control = createGenerationControl({
    database: createDatabase({ accepting_generations: false, version: 3 }),
    masterEnabled: false,
    model: null,
    storage: null,
    providerKeyConfigured: false,
  })

  await assert.rejects(
    control.updateStatus({ acceptingGenerations: true, expectedVersion: 3 }, { actorSubject: 'router-admin' }),
    (error) => error instanceof GenerationControlError
      && error.status === 409
      && error.reason === 'GENERATION_DEPLOYMENT_DISABLED',
  )
})

test('generation channel rejects stale updates without writing an audit record', async () => {
  const database = createDatabase()
  const control = createGenerationControl({
    database,
    masterEnabled: true,
    model: 'gpt-image-2',
    storage: 'r2',
    providerKeyConfigured: true,
  })

  await assert.rejects(
    control.updateStatus({ acceptingGenerations: false, expectedVersion: 2 }, { actorSubject: 'router-admin' }),
    (error) => error instanceof GenerationControlError
      && error.status === 409
      && error.reason === 'GENERATION_CHANNEL_VERSION_CONFLICT',
  )
  assert.equal(database.calls.some((call) => String(call[1]).includes('studio_admin_audit_log')), false)
})

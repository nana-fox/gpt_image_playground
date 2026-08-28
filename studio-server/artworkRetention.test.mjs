import assert from 'node:assert/strict'
import test from 'node:test'

import { purgeExpiredArtworks } from './artworkRetention.mjs'

test('purges expired outputs only after storage deletion', async () => {
  const events = []
  const task = { id: 'task-1', output: { key: 'user-1/task-1.png' } }
  const result = await purgeExpiredArtworks({
    tasks: {
      listPurgePending: () => [task],
      async purgeTask(id, removeOutput) {
        await removeOutput(task.output)
        events.push(['purged', id])
        return { id }
      },
    },
    outputs: {
      remove(output) {
        events.push(['removed', output.key])
      },
    },
  })

  assert.deepEqual(events, [['removed', task.output.key], ['purged', task.id]])
  assert.deepEqual(result, { purged: 1, failed: 0 })
})

test('keeps failed storage deletions pending', async () => {
  let marked = false
  const original = console.error
  console.error = () => {}
  try {
    const result = await purgeExpiredArtworks({
      tasks: {
        listPurgePending: () => [{ id: 'task-2', output: { key: 'user-1/task-2.png' } }],
        async purgeTask(_id, removeOutput) {
          await removeOutput({ key: 'user-1/task-2.png' })
          marked = true
        },
      },
      outputs: { remove: () => { throw new Error('R2 unavailable') } },
    })
    assert.deepEqual(result, { purged: 0, failed: 1 })
    assert.equal(marked, false)
  } finally {
    console.error = original
  }
})

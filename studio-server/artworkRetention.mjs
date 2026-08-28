export async function purgeExpiredArtworks(options = {}) {
  const tasks = options.tasks
  const outputs = options.outputs
  if (!tasks?.listPurgePending || !tasks?.purgeTask || !outputs?.remove) {
    throw new Error('Studio artwork retention dependencies are required')
  }

  let purged = 0
  let failed = 0
  for (const task of await tasks.listPurgePending()) {
    try {
      const result = await tasks.purgeTask(task.id, (output) => outputs.remove(output))
      if (result) purged += 1
    } catch (error) {
      failed += 1
      console.error('Studio artwork retention cleanup failed', {
        taskId: task.id,
        reason: String(error?.reason ?? error?.name ?? 'UNKNOWN'),
      })
    }
  }
  return { purged, failed }
}

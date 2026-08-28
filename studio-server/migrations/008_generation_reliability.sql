WITH migration AS (
  SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT AS now
), ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY
      CASE status WHEN 'running' THEN 1 WHEN 'reserved' THEN 2 ELSE 3 END,
      updated_at DESC,
      id
  ) AS position
  FROM studio_generation_tasks
  WHERE status IN ('created', 'reserved', 'running')
), failed AS (
  UPDATE studio_generation_tasks tasks
  SET status = 'failed', error_reason = 'GENERATION_RECOVERY_TIMEOUT', updated_at = migration.now
  FROM ranked, migration
  WHERE tasks.id = ranked.id AND ranked.position > 1
  RETURNING tasks.reservation_id
), released AS (
  UPDATE studio_quota_reservations reservations
  SET status = 'released', updated_at = migration.now
  FROM failed, migration
  WHERE reservations.id = failed.reservation_id AND reservations.status = 'reserved'
  RETURNING reservations.grant_id
), restored AS (
  SELECT grant_id, COUNT(*)::INTEGER AS units
  FROM released
  WHERE grant_id IS NOT NULL
  GROUP BY grant_id
)
UPDATE studio_credit_grants grants
SET remaining = LEAST(grants.total, grants.remaining + restored.units)
FROM restored
WHERE grants.id = restored.grant_id;

CREATE UNIQUE INDEX idx_studio_generation_tasks_one_active_per_user
  ON studio_generation_tasks(user_id)
  WHERE status IN ('created', 'reserved', 'running');

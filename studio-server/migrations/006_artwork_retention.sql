ALTER TABLE studio_generation_tasks
  ADD COLUMN deleted_at BIGINT,
  ADD COLUMN purge_after BIGINT,
  ADD COLUMN purged_at BIGINT;

CREATE INDEX idx_studio_generation_tasks_purge
  ON studio_generation_tasks(purge_after, id)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

CREATE TABLE studio_admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  reference TEXT,
  before_json JSONB,
  after_json JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_studio_admin_audit_actor_created
  ON studio_admin_audit_log(actor_subject, created_at DESC);

CREATE INDEX idx_studio_admin_audit_target_created
  ON studio_admin_audit_log(target_user_id, created_at DESC);

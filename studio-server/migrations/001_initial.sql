CREATE TABLE studio_users (
  id TEXT PRIMARY KEY,
  identity_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE studio_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_studio_sessions_expires_at
  ON studio_sessions(expires_at);

CREATE TABLE studio_quota_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL,
  daily_limit INTEGER NOT NULL CHECK (daily_limit BETWEEN 0 AND 1000),
  timezone TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);

INSERT INTO studio_quota_policy
  (id, enabled, daily_limit, timezone, version, updated_at)
VALUES (1, TRUE, 3, 'Asia/Shanghai', 1, 0);

CREATE TABLE studio_subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES studio_users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE studio_credit_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total > 0),
  remaining INTEGER NOT NULL CHECK (remaining BETWEEN 0 AND total),
  expires_at BIGINT,
  reference TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, reference)
);

CREATE INDEX idx_studio_credit_grants_available
  ON studio_credit_grants(user_id, expires_at, created_at);

CREATE TABLE studio_quota_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  source TEXT NOT NULL,
  grant_id TEXT REFERENCES studio_credit_grants(id),
  day_key TEXT,
  status TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_studio_quota_reservations_daily
  ON studio_quota_reservations(user_id, source, day_key, status);

CREATE TABLE studio_generation_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  prompt TEXT NOT NULL,
  size TEXT NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL,
  reservation_id TEXT,
  output_json JSONB,
  error_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_studio_generation_tasks_user_created
  ON studio_generation_tasks(user_id, created_at DESC);

CREATE INDEX idx_studio_generation_tasks_status
  ON studio_generation_tasks(status, updated_at);

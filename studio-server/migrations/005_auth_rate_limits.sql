CREATE TABLE studio_auth_rate_limits (
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (scope, key_hash)
);

CREATE INDEX idx_studio_auth_rate_limits_updated
  ON studio_auth_rate_limits(updated_at);

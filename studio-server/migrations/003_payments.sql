CREATE TABLE studio_payment_plans (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'pack')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 100000),
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  enabled BOOLEAN NOT NULL,
  sort_order INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);

INSERT INTO studio_payment_plans
  (id, kind, name, description, price_cents, currency, credits, duration_days, enabled, sort_order, version, updated_at)
VALUES
  ('plus', 'subscription', '创作 Plus', '适合持续内容创作', 2900, 'CNY', 100, 30, FALSE, 10, 1, 0),
  ('pro', 'subscription', '专业版', '适合高频商业产出', 7900, 'CNY', 350, 30, FALSE, 20, 1, 0),
  ('pack-60', 'pack', '60 次加量包', '按需增加创作次数', 1900, 'CNY', 60, 180, FALSE, 30, 1, 0);

CREATE TABLE studio_payment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES studio_users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  out_trade_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  provider TEXT NOT NULL CHECK (provider = 'wxpay_native'),
  provider_app_id TEXT NOT NULL,
  provider_mch_id TEXT NOT NULL,
  provider_transaction_id TEXT UNIQUE,
  plan_id TEXT NOT NULL,
  plan_kind TEXT NOT NULL CHECK (plan_kind IN ('subscription', 'pack')),
  plan_name TEXT NOT NULL,
  plan_description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  credits INTEGER NOT NULL CHECK (credits > 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  code_url TEXT,
  failed_reason TEXT,
  expires_at BIGINT NOT NULL,
  paid_at BIGINT,
  completed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_studio_payment_orders_user_created
  ON studio_payment_orders(user_id, created_at DESC);

CREATE INDEX idx_studio_payment_orders_status_expires
  ON studio_payment_orders(status, expires_at);

CREATE TABLE studio_payment_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES studio_payment_orders(id) ON DELETE RESTRICT,
  provider_transaction_id TEXT NOT NULL UNIQUE,
  received_at BIGINT NOT NULL
);

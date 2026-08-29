CREATE TABLE studio_payment_providers (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE CHECK (provider_key IN ('wxpay', 'alipay')),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config_ciphertext TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL DEFAULT 0
);

INSERT INTO studio_payment_providers (id, provider_key, name)
VALUES
  ('wxpay-default', 'wxpay', '微信支付'),
  ('alipay-default', 'alipay', '支付宝');

ALTER TABLE studio_payment_orders
  DROP CONSTRAINT studio_payment_orders_provider_check,
  ADD CONSTRAINT studio_payment_orders_provider_check CHECK (provider IN ('wxpay_native', 'alipay_page')),
  ALTER COLUMN provider_app_id DROP NOT NULL,
  ALTER COLUMN provider_mch_id DROP NOT NULL,
  ADD COLUMN provider_instance_id TEXT REFERENCES studio_payment_providers(id) ON DELETE RESTRICT,
  ADD COLUMN pay_url TEXT;

CREATE TABLE studio_payment_channel (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accepting_orders BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at BIGINT NOT NULL
);

INSERT INTO studio_payment_channel (id, accepting_orders, version, updated_at)
VALUES (1, FALSE, 1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);

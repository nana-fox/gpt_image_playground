CREATE TABLE studio_generation_channel (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accepting_generations BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at BIGINT NOT NULL
);

INSERT INTO studio_generation_channel (id, accepting_generations, version, updated_at)
VALUES (1, TRUE, 1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);

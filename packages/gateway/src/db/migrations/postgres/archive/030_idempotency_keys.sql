-- Idempotency keys for API-level duplicate request handling.
-- Prevents re-execution of retried requests (mobile network, webhook redelivery).
-- TTL-based expiry keeps the table bounded.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT        PRIMARY KEY,
  result       JSONB       NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at
  ON idempotency_keys (expires_at);
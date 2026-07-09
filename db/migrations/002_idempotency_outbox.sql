-- Phase 2: idempotency keys + transactional outbox. Idempotent DDL.

-- Client-supplied idempotency keys. A dedicated table (rather than a column on
-- transactions) so it is generic across operations and stores both the request
-- fingerprint and the cached result to replay.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             UUID PRIMARY KEY,
    request_hash    TEXT NOT NULL,
    transaction_id  UUID,                    -- the cached result; NULL only mid-transaction
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox. Rows are written in the SAME transaction as the business
-- write, then a relay publishes them to the broker and flips `published`.
CREATE TABLE IF NOT EXISTS outbox_events (
    id            UUID PRIMARY KEY,
    aggregate_id  UUID NOT NULL,
    event_type    TEXT NOT NULL,
    payload       JSONB NOT NULL,
    published     BOOLEAN NOT NULL DEFAULT FALSE,
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

-- The relay only ever scans for unpublished rows; index for that access path.
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
    ON outbox_events (created_at)
    WHERE published = FALSE;

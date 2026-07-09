-- Transaction Orchestrator — owns saga state and drives the TCC flow. Its own
-- schema. idempotency_key is unique so the same request maps to one saga.
CREATE SCHEMA IF NOT EXISTS orchestrator;

CREATE TABLE IF NOT EXISTS orchestrator.transactions (
    id              UUID PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('TRANSFER', 'FUND')),
    from_wallet     UUID,
    to_wallet       UUID,
    amount          BIGINT NOT NULL CHECK (amount > 0),
    idempotency_key UUID NOT NULL UNIQUE,
    status          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orch_tx_status ON orchestrator.transactions (status);

-- Append-only audit of every state transition, so a saga is fully recoverable.
CREATE TABLE IF NOT EXISTS orchestrator.transaction_steps (
    id              UUID PRIMARY KEY,
    transaction_id  UUID NOT NULL REFERENCES orchestrator.transactions (id),
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox for saga-completion events (transfer.confirmed / .cancelled).
CREATE TABLE IF NOT EXISTS orchestrator.outbox_events (
    id            UUID PRIMARY KEY,
    aggregate_id  UUID NOT NULL,
    event_type    TEXT NOT NULL,
    payload       JSONB NOT NULL,
    published     BOOLEAN NOT NULL DEFAULT FALSE,
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orch_outbox_unpub
    ON orchestrator.outbox_events (created_at)
    WHERE published = FALSE;

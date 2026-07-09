-- Phase 1 schema. Idempotent so it can run on every boot / test setup.
-- Money is stored as BIGINT minor units (cents). Never floats.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS wallets (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL,
    balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    version     INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id);

-- Immutable, append-only double-entry journal.
CREATE TABLE IF NOT EXISTS ledger_entries (
    id              UUID PRIMARY KEY,
    transaction_id  UUID NOT NULL,
    wallet_id       UUID NOT NULL REFERENCES wallets (id),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    type            TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_id ON ledger_entries (wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries (transaction_id);

CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY,
    from_wallet     UUID,            -- nullable: deposits / genesis have no source in Phase 1
    to_wallet       UUID,
    amount          BIGINT NOT NULL CHECK (amount > 0),
    status          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce append-only at the database layer, not just by convention.
-- Row-level UPDATE/DELETE on the journal is always an error.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only; % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_mutation ON ledger_entries;
CREATE TRIGGER ledger_entries_no_mutation
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

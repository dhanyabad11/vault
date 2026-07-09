-- Ledger Service — immutable, append-only double-entry journal. Its own schema.
-- No foreign key to wallet.wallets: that would cross a service boundary.
CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE IF NOT EXISTS ledger.ledger_entries (
    id              UUID PRIMARY KEY,
    transaction_id  UUID NOT NULL,
    wallet_id       UUID NOT NULL,
    amount          BIGINT NOT NULL CHECK (amount > 0),
    type            TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Idempotent append: re-appending the same leg is a no-op via ON CONFLICT.
    UNIQUE (transaction_id, wallet_id, type)
);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger.ledger_entries (wallet_id);

CREATE OR REPLACE FUNCTION ledger.prevent_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only; % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_mutation ON ledger.ledger_entries;
CREATE TRIGGER ledger_entries_no_mutation
    BEFORE UPDATE OR DELETE ON ledger.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger.prevent_mutation();

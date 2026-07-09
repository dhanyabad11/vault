-- Wallet Service — owns balances and reservation holds. Its own schema simulates
-- a separate database: no other service may reference these tables.
CREATE SCHEMA IF NOT EXISTS wallet;

CREATE TABLE IF NOT EXISTS wallet.wallets (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL,
    balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    version     INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_wallets_user ON wallet.wallets (user_id);

-- A hold is one TCC leg against a wallet. Available balance for a debit is
-- balance - SUM(HELD debit holds). Confirm settles the hold into balance; cancel
-- releases it. The (transaction_id, wallet_id, type) unique key makes reserve
-- idempotent.
CREATE TABLE IF NOT EXISTS wallet.holds (
    id              UUID PRIMARY KEY,
    wallet_id       UUID NOT NULL REFERENCES wallet.wallets (id),
    transaction_id  UUID NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
    status          TEXT NOT NULL CHECK (status IN ('HELD', 'CONFIRMED', 'CANCELLED')),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (transaction_id, wallet_id, type)
);
CREATE INDEX IF NOT EXISTS idx_wallet_holds_active
    ON wallet.holds (wallet_id)
    WHERE status = 'HELD';

-- One-time cleanup of the Phase 1/2 monolith tables that lived in the public
-- schema. Safe & idempotent: everything is IF EXISTS, and Phase 3 uses dedicated
-- per-service schemas instead. Does not touch the new wallet/ledger/orchestrator
-- schemas.
DROP TABLE IF EXISTS public.outbox_events,
                     public.idempotency_keys,
                     public.transactions,
                     public.ledger_entries,
                     public.wallets CASCADE;
DROP FUNCTION IF EXISTS public.prevent_ledger_mutation() CASCADE;

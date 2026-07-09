# Distributed Payment Wallet

A portfolio project demonstrating distributed transaction handling. Built incrementally.

## Phase 3 — split services + orchestrator + TCC (current)

The monolith is now three services, each with its **own Postgres schema and connection
pool** (`wallet`, `ledger`, `orchestrator`) — no cross-schema SQL and no transaction can
span services, which is exactly why TCC is required instead of one ACID transaction.

- **Wallet Service** (`wallet` schema) — owns `wallets` + a `holds` table. Available balance
  = `balance − SUM(HELD debit holds)`. Try/Confirm/Cancel operate on holds.
- **Ledger Service** (`ledger` schema) — the immutable journal; idempotent append
  (`ON CONFLICT DO NOTHING` on `(transaction_id, wallet_id, type)`).
- **Transaction Orchestrator** (`orchestrator` schema) — drives the TCC saga, tracks status
  (`STARTED→RESERVING→RESERVED→CONFIRMING→CONFIRMED` / `CANCELLING→CANCELLED`), logs every
  transition to `transaction_steps`, and emits saga-completion events via its outbox.

**TCC flow** for A→B: reserve a DEBIT hold on A (checks available funds, serialized by an
optimistic version bump) and a CREDIT hold on B → confirm both (settle into balances) → append
the ledger pair. A failed Try triggers Cancel of all legs. **Every downstream step is
idempotent** (hold status transitions guard confirm/cancel; ledger append dedupes), so
`resumePending()` recovery just re-drives an interrupted saga to a terminal state — money
neither lost nor duplicated. Services talk through in-process client interfaces that simulate
synchronous RPC (swappable to HTTP/RabbitMQ later).

Tests: `tcc-happy`, `tcc-cancel`, `reserve-concurrency` (50 concurrent transfers, exactly 10
settle), `tcc-recovery` (crash mid-CONFIRMING and mid-RESERVING → resume completes exactly
once), plus re-pointed `idempotency`, `immutability`, `invariant`, `outbox`.

## Phase 2 — idempotency keys + transactional outbox

Makes writes safe to retry, on the same single service.

- **Idempotency**: client-supplied UUID per write, deduped inside the *same* transaction
  as the write via `INSERT ... ON CONFLICT DO NOTHING` on a dedicated `idempotency_keys`
  table. A replay returns the cached `transactionId`; concurrent duplicates block on the
  first and return the same result; a key reused with different params is a `422`. Failures
  roll the key back (option A) so they are never cached — a retry re-attempts.
- **Transactional outbox**: the event-to-publish is written as an `outbox_events` row in the
  same transaction as the ledger write (solves the dual-write problem). A separate **relay**
  polls with `SELECT ... FOR UPDATE SKIP LOCKED`, publishes to the broker, and flips
  `published`. Delivery is **at-least-once**, so consumers dedupe on `event.id`.
- **Broker** is an in-memory `EventBus` stub for now; swapped for RabbitMQ in Phase 3+.

Tests: `idempotency.spec.ts` (replay, concurrent duplicates, param-reuse `422`, key-not-burned-on-failure)
and `outbox.spec.ts` (event only on commit, no event on rollback, no double-delivery, at-least-once
crash recovery with an idempotent consumer).

## Phase 1 — single-service wallet + ledger correctness

Proves double-entry bookkeeping and concurrency control work under load, before any
distribution is introduced.

- **Money** is stored as `BIGINT` minor units (cents). No floats.
- **Double-entry**: a transfer writes one `DEBIT` and one `CREDIT` ledger row sharing a
  `transaction_id`, inside a single DB transaction (atomic).
- **Ledger is append-only**, enforced by a database trigger that rejects `UPDATE`/`DELETE`.
- **Balance is a derived cache.** The source of truth is `SUM(CREDIT) - SUM(DEBIT)` over
  `ledger_entries`; every test asserts the cache reconciles to it.
- **Two locking strategies**, both proven correct by the same test suite:
  - *Optimistic* (default): conditional `UPDATE ... WHERE version = $expected AND balance >= $amt`,
    re-read on conflict to distinguish insufficient-funds (terminal) from a lost race (retry
    with bounded exponential backoff).
  - *Pessimistic*: `SELECT ... FOR UPDATE` in deterministic id order, then mutate — no retry
    needed. Included so the benchmark can compare contention behavior.

## Run it

```bash
npm install
docker compose up -d db      # Postgres 15 on :5432 (or use a local Postgres — see below)
npm run migrate              # apply all schema migrations (idempotent)
npm test                     # runs the full suite against a real Postgres
npm start                    # HTTP API on :3000
```

`DATABASE_URL` defaults to `postgres://vault:vault@localhost:5432/vault` (see `.env.example`).
If you use a local Postgres instead of Docker, point it there, e.g.
`export DATABASE_URL=postgres://<user>@localhost:5432/vault`.

HTTP endpoints: `POST /wallets`, `GET /wallets/:id`, `POST /wallets/:id/fund`,
`POST /transfers`, `GET /transactions/:id`. Write endpoints require an `Idempotency-Key` header.

## Known limitations (deliberate shortcuts)

Intentional and addressed in later phases — worth naming in an interview:

1. **In-process service clients, not real network RPC.** Schema + pool isolation forbids a
   shared transaction, but there's no true process boundary yet, so network partitions can't be
   simulated. → deployment step / RabbitMQ transport.
2. **Confirm retries are naive**; a persistently failing Confirm just leaves the saga
   recoverable — no timeout auto-cancel, DLQ, or alerting. → Phase 4.
3. **Recovery is manual/on-boot** (`resumePending()`); a stuck reservation locks funds until it
   runs. → Phase 4 adds timeout-driven auto-cancel; Phase 5 the scheduled reconciliation + chaos test.
4. **In-memory event bus, not RabbitMQ.** Outbox rows survive a crash; the bus is process-local.
5. **Single-sided funding.** `fund` credits with no counterparty debit, so cross-wallet
   conservation isn't globally enforced. → Phase 5 reconciliation job.
6. **`BIGINT` parsed to JS `number`.** Safe below 2^53 minor units; production would use
   `BigInt`/decimal.

## Build order

- Phase 1 — wallet + ledger correctness under concurrency ✅
- Phase 2 — idempotency keys + outbox pattern ✅
- Phase 3 — split services + Transaction Orchestrator + TCC (Try/Confirm/Cancel) ✅ (this)
- Phase 4 — timeouts, auto-cancel, exponential backoff, dead-letter queue
- Phase 5 — reconciliation job + chaos test (kill orchestrator mid-transaction)

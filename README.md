# Distributed Payment Wallet

A portfolio project demonstrating distributed transaction handling. Built incrementally.

## Phase 2 — idempotency keys + transactional outbox (current)

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

### Run it

```bash
npm install
docker compose up -d db      # Postgres 15 on :5432
npm run migrate              # apply schema (idempotent)
npm test                     # runs the concurrency / invariant / immutability / benchmark suites
npm start                    # optional: HTTP API on :3000
```

`DATABASE_URL` defaults to `postgres://vault:vault@localhost:5432/vault` (see `.env.example`).

### Tests (the actual point)

- `concurrency.spec.ts` — 50 simultaneous transfers from a wallet funded for 10; asserts
  exactly 10 succeed, 40 fail with `InsufficientFundsError`, balance ends at 0, never negative,
  and cache == ledger. Runs under **both** locking strategies.
- `lost-update.spec.ts` — 50 concurrent credits; version bumped exactly 50 times, no lost writes.
- `immutability.spec.ts` — `UPDATE`/`DELETE` on the journal are rejected by the DB.
- `invariant.spec.ts` — cache reconciles to the ledger after mixed transfers.
- `benchmark.spec.ts` — prints optimistic vs pessimistic timings under hot-wallet contention.

## Known limitations (deliberate Phase 1 shortcuts)

These are intentional and addressed in later phases — worth naming in an interview:

1. **In-memory event bus, not RabbitMQ.** Outbox rows survive a crash, but the bus itself is
   process-local. → Phase 3+ swaps in RabbitMQ.
2. **Relay rolls back the whole batch on a publish error** (at-least-once, but no per-event
   isolation). → Phase 4 adds per-event retry + dead-letter queue.
3. **Single database and schema.** No real service isolation. → Phase 3 splits Wallet / Ledger /
   Orchestrator with the TCC flow.
4. **Single-sided funding.** Deposits and opening balances create money from "equity" with no
   counterparty debit, so cross-wallet conservation is not globally enforced. → Phase 5
   reconciliation job adds the global check.
5. **`BIGINT` parsed to JS `number`.** Safe below 2^53 minor units; a real system would use
   `BigInt`/decimal.
6. **Backoff/retry is naive** and `MAX_ATTEMPTS` is generous to keep the hot-wallet test
   deterministic. Production would tune these and add metrics.

## Build order

- Phase 1 — wallet + ledger correctness under concurrency ✅
- Phase 2 — idempotency keys + outbox pattern ✅ (this)
- Phase 3 — split services + Transaction Orchestrator + TCC (Try/Confirm/Cancel)
- Phase 4 — timeouts, auto-cancel, exponential backoff, dead-letter queue
- Phase 5 — reconciliation job + chaos test (kill orchestrator mid-transaction)

import { randomUUID } from 'crypto';
import { createHarness, Harness, randomUserId } from './harness';
import { IdempotencyConflictError } from '../src/common/errors';

describe('idempotency keys dedupe write endpoints', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
  });

  it('replaying the same key applies the transfer exactly once', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 500 });
    const b = await h.wallets.create({ userId: randomUserId() });
    const key = randomUUID();

    const first = await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
      idempotencyKey: key,
    });
    const second = await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
      idempotencyKey: key,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    // Same result surfaced, not a new transaction.
    expect(second.transactionId).toBe(first.transactionId);

    // Money moved exactly once.
    expect((await h.wallets.getById(a.id)).balance).toBe(400);
    expect((await h.wallets.getById(b.id)).balance).toBe(100);

    // Exactly one transfer transaction and one pair of ledger rows exist.
    const txCount = await h.db.query<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM transactions WHERE status = 'COMPLETED'",
    );
    expect(Number(txCount.rows[0].count)).toBe(1);
  });

  it('serialized concurrent duplicates apply exactly once', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 500 });
    const b = await h.wallets.create({ userId: randomUserId() });
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        h.transactions.transfer({
          fromWallet: a.id,
          toWallet: b.id,
          amount: 100,
          idempotencyKey: key,
        }),
      ),
    );

    // All 10 concurrent calls return the SAME transaction id...
    const ids = new Set(results.map((r) => r.transactionId));
    expect(ids.size).toBe(1);
    // ...and the money moved only once.
    expect((await h.wallets.getById(a.id)).balance).toBe(400);
    expect((await h.wallets.getById(b.id)).balance).toBe(100);
  });

  it('rejects the same key reused with different parameters', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 500 });
    const b = await h.wallets.create({ userId: randomUserId() });
    const key = randomUUID();

    await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
      idempotencyKey: key,
    });

    await expect(
      h.transactions.transfer({
        fromWallet: a.id,
        toWallet: b.id,
        amount: 250, // different amount, same key
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('does not burn the key when the transfer fails (option A)', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 100 });
    const b = await h.wallets.create({ userId: randomUserId() });
    const key = randomUUID();

    // First attempt fails: insufficient funds.
    await expect(
      h.transactions.transfer({
        fromWallet: a.id,
        toWallet: b.id,
        amount: 300,
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/insufficient funds/);

    // Fund the wallet, then retry with the SAME key -> now succeeds (key was freed).
    await h.transactions.deposit({ walletId: a.id, amount: 500 });
    const retry = await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 300,
      idempotencyKey: key,
    });
    expect(retry.replayed).toBe(false);
    expect((await h.wallets.getById(b.id)).balance).toBe(300);
  });
});

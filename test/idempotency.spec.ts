import { createHarness, Harness, uuid } from './harness';
import { IdempotencyConflictError } from '../src/common/errors';

describe('orchestrator idempotency', () => {
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

  it('replaying a key applies the transfer exactly once', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 500, idempotencyKey: uuid() });
    const key = uuid();

    const first = await h.orchestrator.transfer({
      fromWallet: src.id,
      toWallet: dst.id,
      amount: 100,
      idempotencyKey: key,
    });
    const second = await h.orchestrator.transfer({
      fromWallet: src.id,
      toWallet: dst.id,
      amount: 100,
      idempotencyKey: key,
    });

    expect(second.transactionId).toBe(first.transactionId);
    expect((await h.wallet.getWallet(src.id)).balance).toBe(400);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(100);
    expect(await h.ledger.balanceOf(dst.id)).toBe(100);
  });

  it('concurrent duplicates settle exactly once', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 500, idempotencyKey: uuid() });
    const key = uuid();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        h.orchestrator.transfer({
          fromWallet: src.id,
          toWallet: dst.id,
          amount: 100,
          idempotencyKey: key,
        }),
      ),
    );

    const ids = new Set(results.map((r) => r.transactionId));
    expect(ids.size).toBe(1);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(100);
    expect(await h.ledger.balanceOf(dst.id)).toBe(100);
  });

  it('rejects the same key reused with different parameters', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 500, idempotencyKey: uuid() });
    const key = uuid();

    await h.orchestrator.transfer({
      fromWallet: src.id,
      toWallet: dst.id,
      amount: 100,
      idempotencyKey: key,
    });

    await expect(
      h.orchestrator.transfer({
        fromWallet: src.id,
        toWallet: dst.id,
        amount: 250,
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});

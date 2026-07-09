import { createHarness, Harness, uuid } from './harness';
import { InsufficientFundsError } from '../src/common/errors';

describe('TCC cancel path — a failed Try rolls back cleanly', () => {
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

  it('cancels the saga and moves no money when funds are insufficient', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 100, idempotencyKey: uuid() });

    const key = uuid();
    await expect(
      h.orchestrator.transfer({
        fromWallet: src.id,
        toWallet: dst.id,
        amount: 300, // more than available
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    // The saga reached a terminal CANCELLED state.
    const tx = await h.orchestratorDb.query<{ status: string }>(
      `SELECT status FROM orchestrator.transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(tx.rows[0].status).toBe('CANCELLED');

    // No money moved, nothing left reserved, no ledger entries.
    expect((await h.wallet.getWallet(src.id)).balance).toBe(100);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(0);
    expect(await h.wallet.availableBalance(src.id)).toBe(100);
    expect(await h.ledger.balanceOf(dst.id)).toBe(0);

    // No lingering HELD holds.
    const held = await h.walletDb.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM wallet.holds WHERE status = 'HELD'`,
    );
    expect(Number(held.rows[0].count)).toBe(0);
  });
});

import { createHarness, Harness, uuid } from './harness';

describe('TCC happy path — a transfer settles across services', () => {
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

  it('reserves, confirms, writes the ledger, and leaves everything consistent', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 1000, idempotencyKey: uuid() });

    const result = await h.orchestrator.transfer({
      fromWallet: src.id,
      toWallet: dst.id,
      amount: 300,
      idempotencyKey: uuid(),
    });

    expect(result.status).toBe('CONFIRMED');

    // Wallet balances moved.
    expect((await h.wallet.getWallet(src.id)).balance).toBe(700);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(300);

    // No funds left reserved.
    expect(await h.wallet.availableBalance(src.id)).toBe(700);

    // Ledger (source of truth) agrees with the wallet cache.
    expect(await h.ledger.balanceOf(src.id)).toBe(700);
    expect(await h.ledger.balanceOf(dst.id)).toBe(300);
    // Two entries for the transfer (DEBIT + CREDIT).
    expect(await h.ledger.countForTransaction(result.transactionId)).toBe(2);

    // Holds are settled, not lingering.
    const holds = await h.walletDb.query<{ status: string }>(
      `SELECT status FROM wallet.holds WHERE transaction_id = $1`,
      [result.transactionId],
    );
    expect(holds.rows.map((r) => r.status).sort()).toEqual(['CONFIRMED', 'CONFIRMED']);
  });
});

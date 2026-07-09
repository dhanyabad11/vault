import { createHarness, Harness, randomUserId } from './harness';

// A mini reconciliation check (the seed of the Phase 5 job): after a sequence of
// transfers, every wallet's cached balance must equal SUM(CREDIT) - SUM(DEBIT).
describe('cached balance always reconciles to the ledger', () => {
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

  it('holds after a mix of transfers in both directions', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 300 });
    const b = await h.wallets.create({ userId: randomUserId() });

    await h.transactions.transfer({ fromWallet: a.id, toWallet: b.id, amount: 120 });
    await h.transactions.transfer({ fromWallet: b.id, toWallet: a.id, amount: 50 });
    await h.transactions.transfer({ fromWallet: a.id, toWallet: b.id, amount: 30 });

    for (const w of [a, b]) {
      const cached = (await h.wallets.getById(w.id)).balance;
      const derived = await h.wallets.ledgerBalance(w.id);
      expect(cached).toBe(derived);
    }

    // a: 300 - 120 + 50 - 30 = 200 ; b: 120 - 50 + 30 = 100
    expect((await h.wallets.getById(a.id)).balance).toBe(200);
    expect((await h.wallets.getById(b.id)).balance).toBe(100);
  });

  it('rejects self-transfers and non-positive amounts', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 100 });
    await expect(
      h.transactions.transfer({ fromWallet: a.id, toWallet: a.id, amount: 10 }),
    ).rejects.toThrow(/same wallet/);
    await expect(
      h.transactions.transfer({ fromWallet: a.id, toWallet: a.id, amount: 0 }),
    ).rejects.toThrow(/positive/);
  });
});

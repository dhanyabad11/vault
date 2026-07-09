import { createHarness, Harness, uuid } from './harness';

describe('wallet cache reconciles to the ledger after mixed transfers', () => {
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

  it('holds cache == ledger for every wallet at rest', async () => {
    const a = await h.wallet.createWallet(uuid());
    const b = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: a.id, amount: 300, idempotencyKey: uuid() });

    await h.orchestrator.transfer({ fromWallet: a.id, toWallet: b.id, amount: 120, idempotencyKey: uuid() });
    await h.orchestrator.transfer({ fromWallet: b.id, toWallet: a.id, amount: 50, idempotencyKey: uuid() });
    await h.orchestrator.transfer({ fromWallet: a.id, toWallet: b.id, amount: 30, idempotencyKey: uuid() });

    for (const w of [a, b]) {
      const cache = (await h.wallet.getWallet(w.id)).balance;
      const ledger = await h.ledger.balanceOf(w.id);
      expect(cache).toBe(ledger);
    }

    // a: 300 - 120 + 50 - 30 = 200 ; b: 120 - 50 + 30 = 100
    expect((await h.wallet.getWallet(a.id)).balance).toBe(200);
    expect((await h.wallet.getWallet(b.id)).balance).toBe(100);
  });
});

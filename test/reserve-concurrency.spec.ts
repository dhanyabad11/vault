import { createHarness, Harness, uuid } from './harness';
import { InsufficientFundsError } from '../src/common/errors';

// The reservation-layer analogue of the Phase 1 race test, now across the TCC
// saga: 50 concurrent transfers out of a wallet funded for only 10.
describe('concurrent reservations never oversell a wallet', () => {
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

  it('settles exactly the fundable transfers and never goes negative', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 1000, idempotencyKey: uuid() });

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        h.orchestrator.transfer({
          fromWallet: src.id,
          toWallet: dst.id,
          amount: 100,
          idempotencyKey: uuid(),
        }),
      ),
    );

    const confirmed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 'CONFIRMED',
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(confirmed.length).toBe(10);
    expect(rejected.length).toBe(40);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }

    // Balances, availability, and the ledger all agree — and never negative.
    expect((await h.wallet.getWallet(src.id)).balance).toBe(0);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(1000);
    expect(await h.wallet.availableBalance(src.id)).toBe(0);
    expect(await h.ledger.balanceOf(src.id)).toBe(0);
    expect(await h.ledger.balanceOf(dst.id)).toBe(1000);
  });
});

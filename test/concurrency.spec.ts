import { createHarness, Harness, randomUserId } from './harness';
import { InsufficientFundsError } from '../src/common/errors';
import { LockStrategy } from '../src/transactions/transactions.service';

// The headline Phase 1 test: fire 50 simultaneous transfers out of one wallet
// that can only fund 10 of them. Prove no lost updates, no oversell, no negative
// balance — under BOTH locking strategies.
describe.each<LockStrategy>(['optimistic', 'pessimistic'])(
  '50 concurrent transfers from one wallet [%s]',
  (strategy) => {
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
      const source = await h.wallets.create({
        userId: randomUserId(),
        openingBalance: 1000, // funds exactly 10 transfers of 100
      });
      const dest = await h.wallets.create({ userId: randomUserId() });

      const results = await Promise.allSettled(
        Array.from({ length: 50 }, () =>
          h.transactions.transfer({
            fromWallet: source.id,
            toWallet: dest.id,
            amount: 100,
            strategy,
          }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      // Exactly 10 of 50 could be funded.
      expect(succeeded.length).toBe(10);
      expect(failed.length).toBe(40);

      // Every failure is a clean "insufficient funds", not a lost race.
      for (const f of failed) {
        expect(f.reason).toBeInstanceOf(InsufficientFundsError);
      }

      const src = await h.wallets.getById(source.id);
      const dst = await h.wallets.getById(dest.id);

      expect(src.balance).toBe(0);
      expect(src.balance).toBeGreaterThanOrEqual(0); // never negative
      expect(dst.balance).toBe(1000);

      // Conservation: no money created or destroyed between the two wallets.
      expect(src.balance + dst.balance).toBe(1000);

      // The invariant: cached balance === recomputed-from-ledger balance.
      expect(src.balance).toBe(await h.wallets.ledgerBalance(source.id));
      expect(dst.balance).toBe(await h.wallets.ledgerBalance(dest.id));

      // Version reflects exactly the applied debits (10), not the 40 failures.
      expect(src.version).toBe(10);
    });
  },
);

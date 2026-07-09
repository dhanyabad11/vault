import { createHarness, Harness, randomUserId } from './harness';
import { LockStrategy } from '../src/transactions/transactions.service';

// Not a pass/fail perf gate — it measures the contention cost of each strategy on
// a hot single wallet and asserts both produce identical, correct results. The
// printed timings are the interview talking point: optimistic retries thrash
// under high contention where pessimistic locking serializes cleanly.
describe('optimistic vs pessimistic under hot-wallet contention', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const strategies: LockStrategy[] = ['optimistic', 'pessimistic'];

  it('both settle 50 concurrent transfers correctly', async () => {
    for (const strategy of strategies) {
      await h.reset();
      const source = await h.wallets.create({
        userId: randomUserId(),
        openingBalance: 100_000, // plenty: all 50 succeed
      });
      const dest = await h.wallets.create({ userId: randomUserId() });

      const start = Date.now();
      await Promise.all(
        Array.from({ length: 50 }, () =>
          h.transactions.transfer({
            fromWallet: source.id,
            toWallet: dest.id,
            amount: 100,
            strategy,
          }),
        ),
      );
      const elapsedMs = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`[bench] ${strategy}: 50 concurrent transfers in ${elapsedMs}ms`);

      expect((await h.wallets.getById(source.id)).balance).toBe(100_000 - 5_000);
      expect((await h.wallets.getById(dest.id)).balance).toBe(5_000);
      expect((await h.wallets.getById(source.id)).balance).toBe(
        await h.wallets.ledgerBalance(source.id),
      );
    }
  });
});

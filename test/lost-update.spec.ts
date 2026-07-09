import { createHarness, Harness, randomUserId } from './harness';

// Classic lost-update test: N concurrent credits to the same wallet. Without
// correct optimistic concurrency, some increments would clobber others and the
// final balance / version would be short. We assert both land exactly.
describe('concurrent credits do not lose updates', () => {
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

  it('applies every concurrent deposit exactly once', async () => {
    const wallet = await h.wallets.create({ userId: randomUserId() });
    const N = 50;
    const amount = 10;

    await Promise.all(
      Array.from({ length: N }, () =>
        h.transactions.deposit({ walletId: wallet.id, amount }),
      ),
    );

    const view = await h.wallets.getById(wallet.id);
    expect(view.balance).toBe(N * amount);
    // Exactly N successful updates -> version bumped exactly N times.
    expect(view.version).toBe(N);
    // Invariant holds against the journal.
    expect(view.balance).toBe(await h.wallets.ledgerBalance(wallet.id));
  });
});

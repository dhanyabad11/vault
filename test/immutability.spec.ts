import { createHarness, Harness, randomUserId } from './harness';

// The ledger is append-only. Prove the database itself rejects UPDATE and DELETE
// on ledger_entries, so immutability does not rely on application discipline.
describe('ledger_entries is append-only', () => {
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

  it('rejects UPDATE and DELETE at the database layer', async () => {
    const wallet = await h.wallets.create({
      userId: randomUserId(),
      openingBalance: 500,
    });
    const row = await h.db.query<{ id: string }>(
      'SELECT id FROM ledger_entries WHERE wallet_id = $1 LIMIT 1',
      [wallet.id],
    );
    const entryId = row.rows[0].id;

    await expect(
      h.db.query('UPDATE ledger_entries SET amount = 1 WHERE id = $1', [entryId]),
    ).rejects.toThrow(/append-only/);

    await expect(
      h.db.query('DELETE FROM ledger_entries WHERE id = $1', [entryId]),
    ).rejects.toThrow(/append-only/);

    // The row is still intact and unchanged.
    const after = await h.db.query<{ amount: number }>(
      'SELECT amount FROM ledger_entries WHERE id = $1',
      [entryId],
    );
    expect(after.rows[0].amount).toBe(500);
  });
});

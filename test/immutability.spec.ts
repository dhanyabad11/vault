import { createHarness, Harness, uuid } from './harness';

describe('ledger_entries is append-only (Ledger Service)', () => {
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
    const w = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: w.id, amount: 500, idempotencyKey: uuid() });

    const row = await h.ledgerDb.query<{ id: string }>(
      `SELECT id FROM ledger_entries WHERE wallet_id = $1 LIMIT 1`,
      [w.id],
    );
    const id = row.rows[0].id;

    await expect(
      h.ledgerDb.query(`UPDATE ledger_entries SET amount = 1 WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.ledgerDb.query(`DELETE FROM ledger_entries WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });
});

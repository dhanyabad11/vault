import { createHarness, Harness, uuid } from './harness';
import { LedgerService } from '../src/services/ledger/ledger.service';
import { WalletService } from '../src/services/wallet/wallet.service';

// Simulate the orchestrator crashing mid-saga by making one downstream step throw
// once, then prove resumePending() drives the saga to a consistent terminal state
// with money neither lost nor duplicated. (The full kill-the-process chaos test is
// Phase 5; this exercises the recovery mechanism it will rely on.)
describe('TCC crash recovery re-drives to a consistent state', () => {
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

  it('completes a saga that crashed mid-CONFIRMING (after ledger append failed)', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 1000, idempotencyKey: uuid() });

    // Crash: ledger append throws once, leaving the saga stuck in CONFIRMING.
    const ledger = h.app.get<LedgerService>(LedgerService, { strict: false });
    const spy = jest
      .spyOn(ledger, 'append')
      .mockRejectedValueOnce(new Error('simulated crash before ledger append'));

    const key = uuid();
    await expect(
      h.orchestrator.transfer({
        fromWallet: src.id,
        toWallet: dst.id,
        amount: 300,
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/simulated crash/);

    const midStatus = await h.orchestratorDb.query<{ status: string }>(
      `SELECT status FROM orchestrator.transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(midStatus.rows[0].status).toBe('CONFIRMING');
    // Ledger not yet written — the inconsistency window.
    expect(await h.ledger.balanceOf(dst.id)).toBe(0);

    // Recover.
    spy.mockRestore();
    const resumed = await h.orchestrator.resumePending();
    expect(resumed).toBe(1);

    // Terminal + consistent, applied exactly once.
    const finalStatus = await h.orchestratorDb.query<{ status: string }>(
      `SELECT status FROM orchestrator.transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(finalStatus.rows[0].status).toBe('CONFIRMED');
    expect((await h.wallet.getWallet(src.id)).balance).toBe(700);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(300);
    expect(await h.ledger.balanceOf(src.id)).toBe(700);
    expect(await h.ledger.balanceOf(dst.id)).toBe(300);
  });

  it('completes a saga that crashed mid-RESERVING (roll forward)', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 1000, idempotencyKey: uuid() });

    // Crash: the CREDIT reservation on the destination throws once, after the
    // DEBIT hold on the source was already created -> saga stuck in RESERVING.
    const wallet = h.app.get<WalletService>(WalletService, { strict: false });
    const realReserve = wallet.reserve.bind(wallet);
    const spy = jest
      .spyOn(wallet, 'reserve')
      .mockImplementationOnce((cmd) => realReserve(cmd)) // DEBIT source succeeds
      .mockImplementationOnce(() =>
        Promise.reject(new Error('simulated crash during credit reserve')),
      );

    const key = uuid();
    await expect(
      h.orchestrator.transfer({
        fromWallet: src.id,
        toWallet: dst.id,
        amount: 300,
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/simulated crash/);

    const midStatus = await h.orchestratorDb.query<{ status: string }>(
      `SELECT status FROM orchestrator.transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(midStatus.rows[0].status).toBe('RESERVING');

    // Recover — rolls forward to completion.
    spy.mockRestore();
    const resumed = await h.orchestrator.resumePending();
    expect(resumed).toBe(1);

    const finalStatus = await h.orchestratorDb.query<{ status: string }>(
      `SELECT status FROM orchestrator.transactions WHERE idempotency_key = $1`,
      [key],
    );
    expect(finalStatus.rows[0].status).toBe('CONFIRMED');
    expect((await h.wallet.getWallet(src.id)).balance).toBe(700);
    expect((await h.wallet.getWallet(dst.id)).balance).toBe(300);
    expect(await h.ledger.balanceOf(dst.id)).toBe(300);
  });
});

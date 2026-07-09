import { createHarness, Harness, uuid } from './harness';
import { IntegrationEvent } from '../src/messaging/event-bus';

describe('orchestrator outbox publishes saga-completion events', () => {
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

  it('emits transfer.confirmed on commit and the relay delivers it once', async () => {
    const src = await h.wallet.createWallet(uuid());
    const dst = await h.wallet.createWallet(uuid());
    await h.orchestrator.fund({ walletId: src.id, amount: 500, idempotencyKey: uuid() });

    const delivered: IntegrationEvent[] = [];
    h.bus.subscribe((e) => {
      delivered.push(e);
    });

    const result = await h.orchestrator.transfer({
      fromWallet: src.id,
      toWallet: dst.id,
      amount: 100,
      idempotencyKey: uuid(),
    });

    // Event is queued (unpublished) until the relay runs. Note: the FUND above
    // also emitted a confirmed event, so expect at least the transfer's.
    expect(await h.outbox.countUnpublished(h.orchestratorDb)).toBeGreaterThanOrEqual(1);
    expect(delivered).toHaveLength(0);

    await h.relay.processBatch();
    expect(await h.outbox.countUnpublished(h.orchestratorDb)).toBe(0);

    const transferEvent = delivered.find(
      (e) => e.aggregateId === result.transactionId,
    );
    expect(transferEvent?.type).toBe('transfer.confirmed');

    // Re-running the relay does not re-deliver.
    const before = delivered.length;
    await h.relay.processBatch();
    expect(delivered).toHaveLength(before);
  });
});

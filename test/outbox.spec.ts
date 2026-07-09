import { randomUUID } from 'crypto';
import { createHarness, Harness, randomUserId } from './harness';
import { IntegrationEvent } from '../src/outbox/event-bus';
import { OutboxRepository } from '../src/outbox/outbox.repository';

describe('transactional outbox', () => {
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

  it('writes an event only for a committed transfer, and the relay delivers it', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 500 });
    const b = await h.wallets.create({ userId: randomUserId() });

    const delivered: IntegrationEvent[] = [];
    const unsubscribe = h.bus.subscribe((e) => {
      delivered.push(e);
    });

    const result = await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
      idempotencyKey: randomUUID(),
    });

    // The event exists but is unpublished until the relay runs.
    const outbox = h.app.get(OutboxRepository);
    expect(await outbox.countUnpublished(h.db)).toBe(1);
    expect(delivered).toHaveLength(0);

    const published = await h.relay.processBatch();
    expect(published).toBe(1);
    expect(await outbox.countUnpublished(h.db)).toBe(0);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].type).toBe('transfer.completed');
    expect(delivered[0].payload).toMatchObject({
      transactionId: result.transactionId,
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
    });

    unsubscribe();
  });

  it('writes NO event when the transfer rolls back (atomicity)', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 50 });
    const b = await h.wallets.create({ userId: randomUserId() });
    const outbox = h.app.get(OutboxRepository);

    await expect(
      h.transactions.transfer({
        fromWallet: a.id,
        toWallet: b.id,
        amount: 100, // insufficient
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow(/insufficient funds/);

    // The event write was in the same transaction, so it rolled back too.
    expect(await outbox.countUnpublished(h.db)).toBe(0);
  });

  it('re-running the relay does not re-deliver already-published events', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 500 });
    const b = await h.wallets.create({ userId: randomUserId() });
    const delivered: IntegrationEvent[] = [];
    h.bus.subscribe((e) => {
      delivered.push(e);
    });

    await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
      idempotencyKey: randomUUID(),
    });

    expect(await h.relay.processBatch()).toBe(1);
    expect(await h.relay.processBatch()).toBe(0); // nothing left
    expect(delivered).toHaveLength(1);
  });

  it('is at-least-once: a crash between publish and mark redelivers, but idempotent consumers dedupe', async () => {
    const a = await h.wallets.create({ userId: randomUserId(), openingBalance: 500 });
    const b = await h.wallets.create({ userId: randomUserId() });

    // A realistic consumer: dedupes on event id.
    const processed = new Set<string>();
    let sideEffectCount = 0;
    h.bus.subscribe((e) => {
      if (processed.has(e.id)) return; // idempotent guard
      processed.add(e.id);
      sideEffectCount += 1;
    });

    await h.transactions.transfer({
      fromWallet: a.id,
      toWallet: b.id,
      amount: 100,
      idempotencyKey: randomUUID(),
    });

    // Simulate a crash AFTER publish but BEFORE the row is marked published:
    // markPublished throws once, so the batch transaction rolls back and the row
    // stays unpublished even though the consumer already saw the event.
    const outbox = h.app.get(OutboxRepository);
    const spy = jest
      .spyOn(outbox, 'markPublished')
      .mockRejectedValueOnce(new Error('simulated crash before commit'));

    await expect(h.relay.processBatch()).rejects.toThrow(/simulated crash/);
    expect(await outbox.countUnpublished(h.db)).toBe(1); // still pending

    // Recover: relay runs again and redelivers (at-least-once).
    spy.mockRestore();
    expect(await h.relay.processBatch()).toBe(1);
    expect(await outbox.countUnpublished(h.db)).toBe(0);

    // The consumer saw the event twice but applied the side effect exactly once.
    expect(sideEffectCount).toBe(1);
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OutboxRepository } from './outbox.repository';
import { EventBus } from './event-bus';

/**
 * Publishes committed outbox rows to the broker. A single transaction claims a
 * batch (FOR UPDATE SKIP LOCKED), publishes each, then marks it published. If
 * publish or mark throws, the whole batch rolls back and stays unpublished —
 * i.e. at-least-once delivery. Per-event retry + dead-lettering arrives in Phase 4.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxRepository,
    private readonly bus: EventBus,
  ) {}

  /** Process a single batch. Returns the number of events published. */
  async processBatch(batchSize = 100): Promise<number> {
    return this.db.withTransaction(async (client) => {
      const rows = await this.outbox.lockUnpublishedBatch(client, batchSize);
      for (const row of rows) {
        await this.bus.publish({
          id: row.id,
          type: row.event_type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
        });
        await this.outbox.markPublished(client, row.id);
      }
      return rows.length;
    });
  }

  /** Background poller for the running app. Tests call processBatch() directly. */
  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processBatch().catch((err) =>
        this.logger.error(`relay batch failed: ${(err as Error).message}`),
      );
    }, intervalMs);
    // Do not keep the event loop alive solely for the poller.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

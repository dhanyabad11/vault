import { Inject, Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATOR_DB, SchemaDatabase } from '../../database/schema-database';
import { OutboxRepository } from './outbox.repository';
import { EventBus } from '../../messaging/event-bus';

/**
 * Publishes committed orchestrator outbox rows to the broker. One transaction
 * claims a batch (FOR UPDATE SKIP LOCKED), publishes each, then marks it. If any
 * step throws, the batch rolls back and stays unpublished — at-least-once
 * delivery. Per-event retry + dead-lettering arrives in Phase 4.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ORCHESTRATOR_DB) private readonly db: SchemaDatabase,
    private readonly outbox: OutboxRepository,
    private readonly bus: EventBus,
  ) {}

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

  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processBatch().catch((err) =>
        this.logger.error(`relay batch failed: ${(err as Error).message}`),
      );
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Queryable } from '../database/queryable';

export interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  published: boolean;
  attempts: number;
  created_at: Date;
  published_at: Date | null;
}

@Injectable()
export class OutboxRepository {
  /** Insert an event in the caller's transaction (atomic with the business write). */
  async insert(
    db: Queryable,
    event: { aggregateId: string; eventType: string; payload: Record<string, unknown> },
  ): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO outbox_events (id, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [id, event.aggregateId, event.eventType, JSON.stringify(event.payload)],
    );
    return id;
  }

  /**
   * Claim a batch of unpublished events for this relay worker. FOR UPDATE SKIP
   * LOCKED means concurrent relay workers each grab a disjoint set instead of
   * contending — the horizontally-scalable outbox pattern.
   */
  async lockUnpublishedBatch(db: Queryable, limit: number): Promise<OutboxRow[]> {
    const res = await db.query<OutboxRow>(
      `SELECT * FROM outbox_events
        WHERE published = FALSE
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return res.rows;
  }

  async markPublished(db: Queryable, id: string): Promise<void> {
    await db.query(
      `UPDATE outbox_events
          SET published = TRUE, published_at = now(), attempts = attempts + 1
        WHERE id = $1`,
      [id],
    );
  }

  async countUnpublished(db: Queryable): Promise<number> {
    const res = await db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM outbox_events WHERE published = FALSE`,
    );
    return Number(res.rows[0].count);
  }
}

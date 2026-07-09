import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Queryable } from '../database/queryable';

export interface IdempotencyRow {
  key: string;
  request_hash: string;
  transaction_id: string | null;
  created_at: Date;
}

export interface ClaimResult {
  /** true = this caller inserted the key first and owns the operation. */
  claimed: boolean;
  /** present when claimed === false: the already-committed key row. */
  existing?: IdempotencyRow;
}

/** Deterministic fingerprint of a request, to detect key reuse with new params. */
export function hashRequest(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

@Injectable()
export class IdempotencyRepository {
  /**
   * Atomically claim a key. `INSERT ... ON CONFLICT DO NOTHING` does not poison
   * the surrounding transaction, so we can branch on the row count:
   *  - inserted (rowCount 1) -> we own it, run the operation.
   *  - conflict (rowCount 0) -> already committed by someone else. A concurrent
   *    in-flight duplicate BLOCKS here until the first tx commits/rolls back, so
   *    the follow-up SELECT always sees the settled row (or none, if it rolled
   *    back and we then win the re-insert on retry).
   */
  async claim(db: Queryable, key: string, requestHash: string): Promise<ClaimResult> {
    const inserted = await db.query(
      `INSERT INTO idempotency_keys (key, request_hash)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, requestHash],
    );
    if (inserted.rowCount === 1) {
      return { claimed: true };
    }
    const existing = await db.query<IdempotencyRow>(
      `SELECT * FROM idempotency_keys WHERE key = $1`,
      [key],
    );
    return { claimed: false, existing: existing.rows[0] };
  }

  /** Records the result so a later replay can return the same transaction id. */
  async recordResult(db: Queryable, key: string, transactionId: string): Promise<void> {
    await db.query(
      `UPDATE idempotency_keys SET transaction_id = $2 WHERE key = $1`,
      [key, transactionId],
    );
  }
}

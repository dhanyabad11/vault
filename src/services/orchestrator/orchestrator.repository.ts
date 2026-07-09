import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { Queryable } from '../../database/queryable';

export type SagaKind = 'TRANSFER' | 'FUND';

export type SagaStatus =
  | 'STARTED'
  | 'RESERVING'
  | 'RESERVED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'CANCELLING'
  | 'CANCELLED';

export const TERMINAL_STATUSES: ReadonlySet<SagaStatus> = new Set<SagaStatus>([
  'CONFIRMED',
  'CANCELLED',
]);

export interface TransactionRow {
  id: string;
  kind: SagaKind;
  from_wallet: string | null;
  to_wallet: string | null;
  amount: number;
  idempotency_key: string;
  status: SagaStatus;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class OrchestratorRepository {
  /** Insert a new saga, or return the existing one for this idempotency key. */
  async insertOrGet(
    db: Queryable,
    saga: {
      kind: SagaKind;
      fromWallet: string | null;
      toWallet: string | null;
      amount: number;
      idempotencyKey: string;
    },
  ): Promise<{ row: TransactionRow; created: boolean }> {
    const inserted = await db.query<TransactionRow>(
      `INSERT INTO transactions (id, kind, from_wallet, to_wallet, amount, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'STARTED')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        saga.kind,
        saga.fromWallet,
        saga.toWallet,
        saga.amount,
        saga.idempotencyKey,
      ],
    );
    if (inserted.rowCount === 1) {
      return { row: inserted.rows[0], created: true };
    }
    const existing = await db.query<TransactionRow>(
      `SELECT * FROM transactions WHERE idempotency_key = $1`,
      [saga.idempotencyKey],
    );
    return { row: existing.rows[0], created: false };
  }

  async get(db: Queryable, id: string): Promise<TransactionRow | null> {
    const res = await db.query<TransactionRow>(
      `SELECT * FROM transactions WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async listResumable(db: Queryable): Promise<TransactionRow[]> {
    const res = await db.query<TransactionRow>(
      `SELECT * FROM transactions
        WHERE status NOT IN ('CONFIRMED', 'CANCELLED')
        ORDER BY created_at`,
    );
    return res.rows;
  }

  /**
   * Conditional status transition. The `status = fromStatus` guard makes it safe
   * under concurrent drivers (duplicate request + recovery racing): only the
   * winner advances the state and logs the step, so terminal side effects (like
   * outbox events) fire exactly once. Returns true if this call advanced it.
   */
  async setStatus(
    client: PoolClient,
    id: string,
    fromStatus: SagaStatus,
    toStatus: SagaStatus,
    note?: string,
  ): Promise<boolean> {
    const res = await client.query(
      `UPDATE transactions SET status = $1, updated_at = now()
        WHERE id = $2 AND status = $3`,
      [toStatus, id, fromStatus],
    );
    if (res.rowCount !== 1) return false;
    await client.query(
      `INSERT INTO transaction_steps (id, transaction_id, from_status, to_status, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), id, fromStatus, toStatus, note ?? null],
    );
    return true;
  }

  async logInitialStep(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `INSERT INTO transaction_steps (id, transaction_id, from_status, to_status, note)
       VALUES ($1, $2, NULL, 'STARTED', 'created')`,
      [randomUUID(), id],
    );
  }
}

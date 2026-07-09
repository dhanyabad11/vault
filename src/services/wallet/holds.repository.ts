import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Queryable } from '../../database/queryable';

export type LegType = 'DEBIT' | 'CREDIT';
export type HoldStatus = 'HELD' | 'CONFIRMED' | 'CANCELLED';

export interface HoldRow {
  id: string;
  wallet_id: string;
  transaction_id: string;
  type: LegType;
  status: HoldStatus;
  amount: number;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class HoldsRepository {
  /** Insert a HELD hold. ON CONFLICT DO NOTHING makes reserve idempotent. */
  async insertHeld(
    db: Queryable,
    hold: { walletId: string; transactionId: string; type: LegType; amount: number },
  ): Promise<void> {
    await db.query(
      `INSERT INTO holds (id, wallet_id, transaction_id, type, status, amount)
       VALUES ($1, $2, $3, $4, 'HELD', $5)
       ON CONFLICT (transaction_id, wallet_id, type) DO NOTHING`,
      [randomUUID(), hold.walletId, hold.transactionId, hold.type, hold.amount],
    );
  }

  async find(
    db: Queryable,
    transactionId: string,
    walletId: string,
    type: LegType,
  ): Promise<HoldRow | null> {
    const res = await db.query<HoldRow>(
      `SELECT * FROM holds WHERE transaction_id = $1 AND wallet_id = $2 AND type = $3`,
      [transactionId, walletId, type],
    );
    return res.rows[0] ?? null;
  }

  /** Sum of active debit holds — the amount currently reserved against a wallet. */
  async heldDebitSum(db: Queryable, walletId: string): Promise<number> {
    const res = await db.query<{ sum: string }>(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS sum
         FROM holds
        WHERE wallet_id = $1 AND type = 'DEBIT' AND status = 'HELD'`,
      [walletId],
    );
    return Number(res.rows[0].sum);
  }

  /**
   * Transition HELD -> CONFIRMED. The `status = 'HELD'` guard is the idempotency
   * mechanism: a second confirm matches 0 rows, so the balance is never adjusted
   * twice. Returns the amount if this call performed the transition, else null.
   */
  async confirm(
    db: Queryable,
    transactionId: string,
    walletId: string,
    type: LegType,
  ): Promise<number | null> {
    const res = await db.query<{ amount: number }>(
      `UPDATE holds SET status = 'CONFIRMED', updated_at = now()
        WHERE transaction_id = $1 AND wallet_id = $2 AND type = $3 AND status = 'HELD'
        RETURNING amount`,
      [transactionId, walletId, type],
    );
    return res.rows[0]?.amount ?? null;
  }

  /** Transition HELD -> CANCELLED. Idempotent no-op if not currently HELD. */
  async cancel(
    db: Queryable,
    transactionId: string,
    walletId: string,
    type: LegType,
  ): Promise<number | null> {
    const res = await db.query<{ amount: number }>(
      `UPDATE holds SET status = 'CANCELLED', updated_at = now()
        WHERE transaction_id = $1 AND wallet_id = $2 AND type = $3 AND status = 'HELD'
        RETURNING amount`,
      [transactionId, walletId, type],
    );
    return res.rows[0]?.amount ?? null;
  }
}

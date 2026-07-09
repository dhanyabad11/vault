import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Queryable } from '../../database/queryable';

export type EntryType = 'DEBIT' | 'CREDIT';

export interface LedgerEntryInput {
  walletId: string;
  amount: number;
  type: EntryType;
}

@Injectable()
export class LedgerRepository {
  /** Idempotent append: the unique (transaction_id, wallet_id, type) key + ON
   * CONFLICT DO NOTHING means re-appending the same leg is a no-op. */
  async appendEntry(
    db: Queryable,
    transactionId: string,
    entry: LedgerEntryInput,
  ): Promise<void> {
    await db.query(
      `INSERT INTO ledger_entries (id, transaction_id, wallet_id, amount, type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (transaction_id, wallet_id, type) DO NOTHING`,
      [randomUUID(), transactionId, entry.walletId, entry.amount, entry.type],
    );
  }

  /** The source of truth: SUM(CREDIT) - SUM(DEBIT) for a wallet. */
  async balanceOf(db: Queryable, walletId: string): Promise<number> {
    const res = await db.query<{ balance: string }>(
      `SELECT COALESCE(
                SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0
              )::bigint AS balance
         FROM ledger_entries WHERE wallet_id = $1`,
      [walletId],
    );
    return Number(res.rows[0].balance);
  }

  async countForTransaction(db: Queryable, transactionId: string): Promise<number> {
    const res = await db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM ledger_entries WHERE transaction_id = $1`,
      [transactionId],
    );
    return Number(res.rows[0].count);
  }
}

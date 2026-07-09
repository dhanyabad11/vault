import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Queryable } from '../database/queryable';

export type EntryType = 'DEBIT' | 'CREDIT';

export interface LedgerEntryRow {
  id: string;
  transaction_id: string;
  wallet_id: string;
  amount: number;
  type: EntryType;
  created_at: Date;
}

@Injectable()
export class LedgerRepository {
  async insertEntry(
    db: Queryable,
    entry: { transactionId: string; walletId: string; amount: number; type: EntryType },
  ): Promise<void> {
    await db.query(
      `INSERT INTO ledger_entries (id, transaction_id, wallet_id, amount, type)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), entry.transactionId, entry.walletId, entry.amount, entry.type],
    );
  }

  /**
   * The source of truth. Recomputes a wallet's balance directly from the
   * immutable journal: SUM(CREDIT) - SUM(DEBIT). Used by tests now and the
   * reconciliation job in Phase 5.
   */
  async balanceFromEntries(db: Queryable, walletId: string): Promise<number> {
    const res = await db.query<{ balance: string }>(
      `SELECT COALESCE(
                SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END), 0
              )::bigint AS balance
         FROM ledger_entries
        WHERE wallet_id = $1`,
      [walletId],
    );
    return Number(res.rows[0].balance);
  }
}

import { Injectable } from '@nestjs/common';
import { Queryable } from '../database/queryable';

export type TransactionStatus = 'COMPLETED' | 'GENESIS' | 'DEPOSIT';

@Injectable()
export class TransactionsRepository {
  async insert(
    db: Queryable,
    tx: {
      id: string;
      fromWallet: string | null;
      toWallet: string | null;
      amount: number;
      status: TransactionStatus;
    },
  ): Promise<void> {
    await db.query(
      `INSERT INTO transactions (id, from_wallet, to_wallet, amount, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [tx.id, tx.fromWallet, tx.toWallet, tx.amount, tx.status],
    );
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Queryable } from '../database/queryable';

export interface WalletRow {
  id: string;
  user_id: string;
  balance: number;
  version: number;
  created_at: Date;
}

@Injectable()
export class WalletsRepository {
  async insert(
    db: Queryable,
    opts: { userId: string; balance: number },
  ): Promise<WalletRow> {
    const res = await db.query<WalletRow>(
      `INSERT INTO wallets (id, user_id, balance, version)
       VALUES ($1, $2, $3, 0)
       RETURNING *`,
      [randomUUID(), opts.userId, opts.balance],
    );
    return res.rows[0];
  }

  async findById(db: Queryable, id: string): Promise<WalletRow | null> {
    const res = await db.query<WalletRow>(
      `SELECT * FROM wallets WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /** Pessimistic path: acquire a row lock held until the transaction ends. */
  async lockForUpdate(db: Queryable, id: string): Promise<WalletRow | null> {
    const res = await db.query<WalletRow>(
      `SELECT * FROM wallets WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Optimistic conditional update. Applies `delta` only if the row is still at
   * `expectedVersion`. For debits (delta < 0) it also guards `balance >= |delta|`,
   * so a negative balance is impossible even under a lost race. Returns true iff
   * exactly one row was updated.
   */
  async applyDeltaOptimistic(
    db: Queryable,
    id: string,
    delta: number,
    expectedVersion: number,
  ): Promise<boolean> {
    if (delta < 0) {
      const res = await db.query(
        `UPDATE wallets
            SET balance = balance + $1, version = version + 1
          WHERE id = $2 AND version = $3 AND balance >= $4`,
        [delta, id, expectedVersion, -delta],
      );
      return res.rowCount === 1;
    }
    const res = await db.query(
      `UPDATE wallets
          SET balance = balance + $1, version = version + 1
        WHERE id = $2 AND version = $3`,
      [delta, id, expectedVersion],
    );
    return res.rowCount === 1;
  }

  /**
   * Pessimistic path: apply `delta` to an already-locked row. Still guards the
   * balance on debits as a belt-and-suspenders invariant.
   */
  async applyDelta(db: Queryable, id: string, delta: number): Promise<boolean> {
    if (delta < 0) {
      const res = await db.query(
        `UPDATE wallets
            SET balance = balance + $1, version = version + 1
          WHERE id = $2 AND balance >= $3`,
        [delta, id, -delta],
      );
      return res.rowCount === 1;
    }
    const res = await db.query(
      `UPDATE wallets
          SET balance = balance + $1, version = version + 1
        WHERE id = $2`,
      [delta, id],
    );
    return res.rowCount === 1;
  }
}

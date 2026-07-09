import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Queryable } from '../../database/queryable';

export interface WalletRow {
  id: string;
  user_id: string;
  balance: number;
  version: number;
  created_at: Date;
}

@Injectable()
export class WalletRepository {
  async insert(db: Queryable, userId: string): Promise<WalletRow> {
    const res = await db.query<WalletRow>(
      `INSERT INTO wallets (id, user_id, balance, version)
       VALUES ($1, $2, 0, 0) RETURNING *`,
      [randomUUID(), userId],
    );
    return res.rows[0];
  }

  async findById(db: Queryable, id: string): Promise<WalletRow | null> {
    const res = await db.query<WalletRow>(`SELECT * FROM wallets WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async lockForUpdate(db: Queryable, id: string): Promise<WalletRow | null> {
    const res = await db.query<WalletRow>(
      `SELECT * FROM wallets WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Optimistic serialization point for reservations: bump the version iff it is
   * still what we read. Two concurrent reservers race here; only one wins, the
   * loser retries and re-checks available funds. Returns true if it won.
   */
  async bumpVersionIfMatch(
    db: Queryable,
    id: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const res = await db.query(
      `UPDATE wallets SET version = version + 1
        WHERE id = $1 AND version = $2`,
      [id, expectedVersion],
    );
    return res.rowCount === 1;
  }

  /** Settle a confirmed hold into the balance. delta may be negative (debit). */
  async applyBalanceDelta(db: Queryable, id: string, delta: number): Promise<void> {
    // balance CHECK (>= 0) is the DB-level safety net; reservations already
    // guarantee we never confirm more debits than the balance covers.
    await db.query(
      `UPDATE wallets SET balance = balance + $1, version = version + 1 WHERE id = $2`,
      [delta, id],
    );
  }
}

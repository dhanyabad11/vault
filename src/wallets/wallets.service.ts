import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { WalletNotFoundError } from '../common/errors';
import { WalletsRepository, WalletRow } from './wallets.repository';
import { LedgerRepository } from '../ledger/ledger.repository';
import { TransactionsRepository } from '../transactions/transactions.repository';

export interface WalletView {
  id: string;
  userId: string;
  balance: number;
  version: number;
}

function toView(row: WalletRow): WalletView {
  return { id: row.id, userId: row.user_id, balance: row.balance, version: row.version };
}

@Injectable()
export class WalletsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly wallets: WalletsRepository,
    private readonly ledger: LedgerRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  /**
   * Creates a wallet. If an opening balance is supplied we also write a matching
   * genesis CREDIT so the per-wallet invariant (cached balance === SUM of ledger)
   * holds immediately.
   *
   * KNOWN LIMITATION: a genesis credit is single-sided — money appears from
   * "equity" with no counterparty debit. Cross-wallet conservation is not yet
   * enforced (that is what the Phase 5 reconciliation job checks globally).
   */
  async create(input: { userId: string; openingBalance?: number }): Promise<WalletView> {
    const opening = input.openingBalance ?? 0;
    if (opening < 0) throw new Error('opening balance cannot be negative');

    return this.db.withTransaction(async (client) => {
      const row = await this.wallets.insert(client, {
        userId: input.userId,
        balance: opening,
      });
      if (opening > 0) {
        const transactionId = randomUUID();
        await this.ledger.insertEntry(client, {
          transactionId,
          walletId: row.id,
          amount: opening,
          type: 'CREDIT',
        });
        await this.transactions.insert(client, {
          id: transactionId,
          fromWallet: null,
          toWallet: row.id,
          amount: opening,
          status: 'GENESIS',
        });
      }
      return toView(row);
    });
  }

  async getById(id: string): Promise<WalletView> {
    const row = await this.wallets.findById(this.db, id);
    if (!row) throw new WalletNotFoundError(id);
    return toView(row);
  }

  /** Recompute balance from the journal — the source of truth. */
  async ledgerBalance(id: string): Promise<number> {
    return this.ledger.balanceFromEntries(this.db, id);
  }
}

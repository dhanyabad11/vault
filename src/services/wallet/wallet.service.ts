import { Inject, Injectable } from '@nestjs/common';
import { SchemaDatabase, WALLET_DB } from '../../database/schema-database';
import { WalletRepository } from './wallet.repository';
import { HoldsRepository, LegType } from './holds.repository';
import { InsufficientFundsError, OptimisticConflictError, WalletNotFoundError } from '../../common/errors';
import { withRetry } from '../../common/retry';

export interface WalletView {
  id: string;
  userId: string;
  balance: number;
  version: number;
}

export interface ReserveCommand {
  transactionId: string;
  walletId: string;
  type: LegType;
  amount: number;
}

export interface LegCommand {
  transactionId: string;
  walletId: string;
  type: LegType;
}

/**
 * Wallet Service. Owns balances and the TCC hold lifecycle. Every operation is
 * idempotent so the orchestrator can retry safely (at-least-once -> exactly-once
 * effect). Only ever touches the `wallet` schema.
 */
@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_DB) private readonly db: SchemaDatabase,
    private readonly wallets: WalletRepository,
    private readonly holds: HoldsRepository,
  ) {}

  async createWallet(userId: string): Promise<WalletView> {
    const row = await this.wallets.insert(this.db, userId);
    return { id: row.id, userId: row.user_id, balance: row.balance, version: row.version };
  }

  async getWallet(id: string): Promise<WalletView> {
    const row = await this.wallets.findById(this.db, id);
    if (!row) throw new WalletNotFoundError(id);
    return { id: row.id, userId: row.user_id, balance: row.balance, version: row.version };
  }

  /** balance minus funds already reserved by active debit holds. */
  async availableBalance(id: string): Promise<number> {
    const row = await this.wallets.findById(this.db, id);
    if (!row) throw new WalletNotFoundError(id);
    const held = await this.holds.heldDebitSum(this.db, id);
    return row.balance - held;
  }

  /**
   * TRY. Reserve funds for one leg. For a DEBIT it checks available balance and
   * serializes concurrent reservers via an optimistic version bump. For a CREDIT
   * it just records a pending inbound hold. Idempotent on (transaction, wallet, type).
   */
  async reserve(cmd: ReserveCommand): Promise<void> {
    if (cmd.type === 'CREDIT') {
      // Credits never fail for lack of funds; just record the pending hold.
      await this.db.withTransaction(async (client) => {
        await this.holds.insertHeld(client, {
          walletId: cmd.walletId,
          transactionId: cmd.transactionId,
          type: 'CREDIT',
          amount: cmd.amount,
        });
      });
      return;
    }

    await withRetry(async () => {
      await this.db.withTransaction(async (client) => {
        const existing = await this.holds.find(
          client,
          cmd.transactionId,
          cmd.walletId,
          'DEBIT',
        );
        if (existing) return; // already reserved — idempotent

        const wallet = await this.wallets.findById(client, cmd.walletId);
        if (!wallet) throw new WalletNotFoundError(cmd.walletId);

        const held = await this.holds.heldDebitSum(client, cmd.walletId);
        if (wallet.balance - held < cmd.amount) {
          throw new InsufficientFundsError(cmd.walletId);
        }

        // Win the version race, or retry. This is what stops two concurrent
        // reservers from both passing the available-funds check.
        const won = await this.wallets.bumpVersionIfMatch(
          client,
          cmd.walletId,
          wallet.version,
        );
        if (!won) throw new OptimisticConflictError(cmd.walletId);

        await this.holds.insertHeld(client, {
          walletId: cmd.walletId,
          transactionId: cmd.transactionId,
          type: 'DEBIT',
          amount: cmd.amount,
        });
      });
    });
  }

  /** CONFIRM. Settle the hold into the balance. Idempotent via the HELD guard. */
  async confirm(cmd: LegCommand): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const amount = await this.holds.confirm(
        client,
        cmd.transactionId,
        cmd.walletId,
        cmd.type,
      );
      if (amount === null) return; // already confirmed (or no hold) — no-op
      const delta = cmd.type === 'DEBIT' ? -amount : amount;
      await this.wallets.applyBalanceDelta(client, cmd.walletId, delta);
    });
  }

  /** CANCEL. Release the hold. Idempotent no-op if not currently HELD. */
  async cancel(cmd: LegCommand): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await this.holds.cancel(client, cmd.transactionId, cmd.walletId, cmd.type);
    });
  }
}

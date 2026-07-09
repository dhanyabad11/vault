import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { WalletsRepository } from '../wallets/wallets.repository';
import { LedgerRepository } from '../ledger/ledger.repository';
import { TransactionsRepository } from './transactions.repository';
import { assertValidAmount } from '../common/money';
import {
  InsufficientFundsError,
  OptimisticConflictError,
  WalletNotFoundError,
  isRetryablePgError,
} from '../common/errors';

export type LockStrategy = 'optimistic' | 'pessimistic';

export interface TransferInput {
  fromWallet: string;
  toWallet: string;
  amount: number;
  strategy?: LockStrategy;
}

export interface TransferResult {
  transactionId: string;
  attempts: number;
}

const MAX_ATTEMPTS = 100;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly wallets: WalletsRepository,
    private readonly ledger: LedgerRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  async transfer(input: TransferInput): Promise<TransferResult> {
    assertValidAmount(input.amount);
    if (input.fromWallet === input.toWallet) {
      throw new Error('cannot transfer to the same wallet');
    }
    const strategy = input.strategy ?? 'optimistic';
    return strategy === 'optimistic'
      ? this.transferOptimistic(input)
      : this.transferPessimistic(input);
  }

  /**
   * Optimistic strategy: no locks held across the read. Each wallet mutation is a
   * conditional UPDATE guarded by the version we read. If a concurrent writer got
   * there first the guard matches 0 rows; we re-read to tell apart "insufficient
   * funds" (terminal) from "someone else moved" (retry the whole transaction).
   */
  private async transferOptimistic(input: TransferInput): Promise<TransferResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const transactionId = await this.db.withTransaction(async (client) => {
          const from = await this.wallets.findById(client, input.fromWallet);
          const to = await this.wallets.findById(client, input.toWallet);
          if (!from) throw new WalletNotFoundError(input.fromWallet);
          if (!to) throw new WalletNotFoundError(input.toWallet);
          if (from.balance < input.amount) {
            throw new InsufficientFundsError(from.id);
          }

          // Apply mutations in a deterministic order (by id) so two opposing
          // transfers (A->B and B->A) acquire row locks in the same order and
          // cannot deadlock.
          const ops = [
            { id: from.id, delta: -input.amount, version: from.version },
            { id: to.id, delta: input.amount, version: to.version },
          ].sort((a, b) => (a.id < b.id ? -1 : 1));

          for (const op of ops) {
            const applied = await this.wallets.applyDeltaOptimistic(
              client,
              op.id,
              op.delta,
              op.version,
            );
            if (!applied) {
              // Classify the failure: exhausted funds vs. stale version.
              const fresh = await this.wallets.findById(client, op.id);
              if (op.delta < 0 && fresh && fresh.balance < -op.delta) {
                throw new InsufficientFundsError(op.id);
              }
              throw new OptimisticConflictError(op.id);
            }
          }

          const journal = {
            id: randomUUID(),
            from: from.id,
            to: to.id,
            amount: input.amount,
          };
          await this.writeJournal(client, journal);
          return journal.id;
        });
        return { transactionId, attempts: attempt };
      } catch (err) {
        const retryable =
          err instanceof OptimisticConflictError || isRetryablePgError(err);
        if (retryable && attempt < MAX_ATTEMPTS) {
          await backoff(attempt);
          continue;
        }
        throw err;
      }
    }
    // Unreachable: the loop either returns or throws on the final attempt.
    throw new OptimisticConflictError(input.fromWallet);
  }

  /**
   * Pessimistic strategy: lock both rows FOR UPDATE (in deterministic id order to
   * avoid deadlock), then mutate. The locks serialize concurrent writers, so no
   * retry loop is needed.
   */
  private async transferPessimistic(input: TransferInput): Promise<TransferResult> {
    const transactionId = await this.db.withTransaction(async (client) => {
      const ids = [input.fromWallet, input.toWallet].sort();
      for (const id of ids) {
        const locked = await this.wallets.lockForUpdate(client, id);
        if (!locked) throw new WalletNotFoundError(id);
      }

      const debited = await this.wallets.applyDelta(client, input.fromWallet, -input.amount);
      if (!debited) {
        // Row is locked, so a false here means the balance guard failed.
        throw new InsufficientFundsError(input.fromWallet);
      }
      await this.wallets.applyDelta(client, input.toWallet, input.amount);

      const journal = {
        id: randomUUID(),
        from: input.fromWallet,
        to: input.toWallet,
        amount: input.amount,
      };
      await this.writeJournal(client, journal);
      return journal.id;
    });
    return { transactionId, attempts: 1 };
  }

  /**
   * Single-sided deposit (external funding). Used for seeding and the
   * lost-update test. Documented limitation: not double-entry.
   */
  async deposit(input: { walletId: string; amount: number }): Promise<TransferResult> {
    assertValidAmount(input.amount);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const transactionId = await this.db.withTransaction(async (client) => {
          const wallet = await this.wallets.findById(client, input.walletId);
          if (!wallet) throw new WalletNotFoundError(input.walletId);
          const applied = await this.wallets.applyDeltaOptimistic(
            client,
            wallet.id,
            input.amount,
            wallet.version,
          );
          if (!applied) throw new OptimisticConflictError(wallet.id);

          const txId = randomUUID();
          await this.ledger.insertEntry(client, {
            transactionId: txId,
            walletId: wallet.id,
            amount: input.amount,
            type: 'CREDIT',
          });
          await this.transactions.insert(client, {
            id: txId,
            fromWallet: null,
            toWallet: wallet.id,
            amount: input.amount,
            status: 'DEPOSIT',
          });
          return txId;
        });
        return { transactionId, attempts: attempt };
      } catch (err) {
        const retryable =
          err instanceof OptimisticConflictError || isRetryablePgError(err);
        if (retryable && attempt < MAX_ATTEMPTS) {
          await backoff(attempt);
          continue;
        }
        throw err;
      }
    }
    throw new OptimisticConflictError(input.walletId);
  }

  /** Writes the two ledger rows + the transaction record for a transfer. */
  private async writeJournal(
    client: Parameters<Parameters<DatabaseService['withTransaction']>[0]>[0],
    journal: { id: string; from: string; to: string; amount: number },
  ): Promise<void> {
    await this.ledger.insertEntry(client, {
      transactionId: journal.id,
      walletId: journal.from,
      amount: journal.amount,
      type: 'DEBIT',
    });
    await this.ledger.insertEntry(client, {
      transactionId: journal.id,
      walletId: journal.to,
      amount: journal.amount,
      type: 'CREDIT',
    });
    await this.transactions.insert(client, {
      id: journal.id,
      fromWallet: journal.from,
      toWallet: journal.to,
      amount: journal.amount,
      status: 'COMPLETED',
    });
  }
}

async function backoff(attempt: number): Promise<void> {
  const base = Math.min(50, 2 ** attempt);
  const jitter = Math.random() * 5;
  await new Promise((resolve) => setTimeout(resolve, base + jitter));
}

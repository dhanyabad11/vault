import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { WalletsRepository } from '../wallets/wallets.repository';
import { LedgerRepository } from '../ledger/ledger.repository';
import { TransactionsRepository } from './transactions.repository';
import {
  IdempotencyRepository,
  hashRequest,
} from '../idempotency/idempotency.repository';
import { OutboxRepository } from '../outbox/outbox.repository';
import { assertValidAmount } from '../common/money';
import {
  IdempotencyConflictError,
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
  /** Client-supplied idempotency key. Omitted at the service layer -> generated
   * (each call unique, i.e. no dedup). The HTTP layer requires it. */
  idempotencyKey?: string;
}

export interface DepositInput {
  walletId: string;
  amount: number;
  idempotencyKey?: string;
}

export interface TransferResult {
  transactionId: string;
  attempts: number;
  /** true when this was a replay of a previously-committed idempotent request. */
  replayed: boolean;
}

const MAX_ATTEMPTS = 100;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly wallets: WalletsRepository,
    private readonly ledger: LedgerRepository,
    private readonly transactions: TransactionsRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  async transfer(input: TransferInput): Promise<TransferResult> {
    assertValidAmount(input.amount);
    if (input.fromWallet === input.toWallet) {
      throw new Error('cannot transfer to the same wallet');
    }
    const key = input.idempotencyKey ?? randomUUID();
    const requestHash = hashRequest({
      op: 'transfer',
      fromWallet: input.fromWallet,
      toWallet: input.toWallet,
      amount: input.amount,
    });
    const strategy = input.strategy ?? 'optimistic';
    return strategy === 'optimistic'
      ? this.transferOptimistic(input, key, requestHash)
      : this.transferPessimistic(input, key, requestHash);
  }

  /**
   * Optimistic strategy: no locks held across the read. Each wallet mutation is a
   * conditional UPDATE guarded by the version we read. A 0-row result is
   * classified by re-reading: insufficient funds (terminal) vs. lost race (retry).
   */
  private async transferOptimistic(
    input: TransferInput,
    key: string,
    requestHash: string,
  ): Promise<TransferResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const outcome = await this.db.withTransaction(async (client) => {
          const replay = await this.checkIdempotency(client, key, requestHash);
          if (replay) return replay;

          const from = await this.wallets.findById(client, input.fromWallet);
          const to = await this.wallets.findById(client, input.toWallet);
          if (!from) throw new WalletNotFoundError(input.fromWallet);
          if (!to) throw new WalletNotFoundError(input.toWallet);
          if (from.balance < input.amount) {
            throw new InsufficientFundsError(from.id);
          }

          // Apply mutations in deterministic id order so opposing transfers
          // (A->B and B->A) acquire row locks in the same order -> no deadlock.
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
              const fresh = await this.wallets.findById(client, op.id);
              if (op.delta < 0 && fresh && fresh.balance < -op.delta) {
                throw new InsufficientFundsError(op.id);
              }
              throw new OptimisticConflictError(op.id);
            }
          }

          const transactionId = await this.writeTransfer(client, {
            from: from.id,
            to: to.id,
            amount: input.amount,
          });
          await this.idempotency.recordResult(client, key, transactionId);
          return { transactionId, replayed: false as const };
        });
        return { ...outcome, attempts: attempt };
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
    throw new OptimisticConflictError(input.fromWallet);
  }

  /**
   * Pessimistic strategy: lock both rows FOR UPDATE (deterministic id order),
   * then mutate. Locks serialize concurrent writers, so no retry loop is needed.
   */
  private async transferPessimistic(
    input: TransferInput,
    key: string,
    requestHash: string,
  ): Promise<TransferResult> {
    const outcome = await this.db.withTransaction(async (client) => {
      const replay = await this.checkIdempotency(client, key, requestHash);
      if (replay) return replay;

      const ids = [input.fromWallet, input.toWallet].sort();
      for (const id of ids) {
        const locked = await this.wallets.lockForUpdate(client, id);
        if (!locked) throw new WalletNotFoundError(id);
      }

      const debited = await this.wallets.applyDelta(client, input.fromWallet, -input.amount);
      if (!debited) throw new InsufficientFundsError(input.fromWallet);
      await this.wallets.applyDelta(client, input.toWallet, input.amount);

      const transactionId = await this.writeTransfer(client, {
        from: input.fromWallet,
        to: input.toWallet,
        amount: input.amount,
      });
      await this.idempotency.recordResult(client, key, transactionId);
      return { transactionId, replayed: false as const };
    });
    return { ...outcome, attempts: 1 };
  }

  /**
   * Single-sided deposit (external funding). Used for seeding and the lost-update
   * test. KNOWN LIMITATION: not double-entry.
   */
  async deposit(input: DepositInput): Promise<TransferResult> {
    assertValidAmount(input.amount);
    const key = input.idempotencyKey ?? randomUUID();
    const requestHash = hashRequest({
      op: 'deposit',
      walletId: input.walletId,
      amount: input.amount,
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const outcome = await this.db.withTransaction(async (client) => {
          const replay = await this.checkIdempotency(client, key, requestHash);
          if (replay) return replay;

          const wallet = await this.wallets.findById(client, input.walletId);
          if (!wallet) throw new WalletNotFoundError(input.walletId);
          const applied = await this.wallets.applyDeltaOptimistic(
            client,
            wallet.id,
            input.amount,
            wallet.version,
          );
          if (!applied) throw new OptimisticConflictError(wallet.id);

          const transactionId = randomUUID();
          await this.ledger.insertEntry(client, {
            transactionId,
            walletId: wallet.id,
            amount: input.amount,
            type: 'CREDIT',
          });
          await this.transactions.insert(client, {
            id: transactionId,
            fromWallet: null,
            toWallet: wallet.id,
            amount: input.amount,
            status: 'DEPOSIT',
          });
          await this.outbox.insert(client, {
            aggregateId: transactionId,
            eventType: 'deposit.completed',
            payload: { transactionId, walletId: wallet.id, amount: input.amount },
          });
          await this.idempotency.recordResult(client, key, transactionId);
          return { transactionId, replayed: false as const };
        });
        return { ...outcome, attempts: attempt };
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

  /**
   * Idempotency gate, run first inside every write transaction. Returns a replay
   * result if the key was already committed, or null if this caller owns the op.
   * Rolls back with the rest of the transaction on failure, so a failed attempt
   * never burns the key (option A: successes only).
   */
  private async checkIdempotency(
    client: PoolClient,
    key: string,
    requestHash: string,
  ): Promise<TransferResult | null> {
    const claim = await this.idempotency.claim(client, key, requestHash);
    if (claim.claimed) return null;

    const existing = claim.existing!;
    if (existing.request_hash !== requestHash) {
      throw new IdempotencyConflictError(key);
    }
    if (!existing.transaction_id) {
      // Committed row with no result should be impossible (insert + result live
      // in one tx). Treat defensively as a transient conflict worth retrying.
      throw new OptimisticConflictError(key);
    }
    return { transactionId: existing.transaction_id, attempts: 0, replayed: true };
  }

  /** Writes both ledger rows, the transaction record, and the outbox event. */
  private async writeTransfer(
    client: PoolClient,
    t: { from: string; to: string; amount: number },
  ): Promise<string> {
    const transactionId = randomUUID();
    await this.ledger.insertEntry(client, {
      transactionId,
      walletId: t.from,
      amount: t.amount,
      type: 'DEBIT',
    });
    await this.ledger.insertEntry(client, {
      transactionId,
      walletId: t.to,
      amount: t.amount,
      type: 'CREDIT',
    });
    await this.transactions.insert(client, {
      id: transactionId,
      fromWallet: t.from,
      toWallet: t.to,
      amount: t.amount,
      status: 'COMPLETED',
    });
    await this.outbox.insert(client, {
      aggregateId: transactionId,
      eventType: 'transfer.completed',
      payload: {
        transactionId,
        fromWallet: t.from,
        toWallet: t.to,
        amount: t.amount,
      },
    });
    return transactionId;
  }
}

async function backoff(attempt: number): Promise<void> {
  const base = Math.min(50, 2 ** attempt);
  const jitter = Math.random() * 5;
  await new Promise((resolve) => setTimeout(resolve, base + jitter));
}

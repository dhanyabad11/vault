import { Inject, Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATOR_DB, SchemaDatabase } from '../../database/schema-database';
import { WalletService } from '../wallet/wallet.service';
import { LedgerService } from '../ledger/ledger.service';
import { LegType } from '../wallet/holds.repository';
import { OutboxRepository } from './outbox.repository';
import {
  OrchestratorRepository,
  SagaKind,
  SagaStatus,
  TERMINAL_STATUSES,
  TransactionRow,
} from './orchestrator.repository';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  WalletNotFoundError,
} from '../../common/errors';

export interface TransferInput {
  fromWallet: string;
  toWallet: string;
  amount: number;
  idempotencyKey: string;
}

export interface FundInput {
  walletId: string;
  amount: number;
  idempotencyKey: string;
}

export interface SagaResult {
  transactionId: string;
  status: SagaStatus;
}

interface Leg {
  walletId: string;
  type: LegType;
}

/**
 * Transaction Orchestrator. Drives the TCC saga across the Wallet and Ledger
 * services. Because every downstream step is idempotent, `drive()` is
 * re-entrant: it can be called fresh, by a duplicate request, or by crash
 * recovery, and always converges to a terminal state without losing or
 * duplicating money.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    @Inject(ORCHESTRATOR_DB) private readonly db: SchemaDatabase,
    private readonly repo: OrchestratorRepository,
    private readonly outbox: OutboxRepository,
    // In-process stand-ins for remote services. In production these are network
    // clients; the schema/pool isolation already forbids a shared transaction.
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
  ) {}

  async transfer(input: TransferInput): Promise<SagaResult> {
    if (input.amount <= 0) throw new Error('amount must be positive');
    if (input.fromWallet === input.toWallet) {
      throw new Error('cannot transfer to the same wallet');
    }
    const row = await this.start('TRANSFER', {
      fromWallet: input.fromWallet,
      toWallet: input.toWallet,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    return this.drive(row.id);
  }

  /** Single-sided external funding (credit only). Keeps the ledger consistent
   * with the wallet cache. Documented limitation: no counterparty debit. */
  async fund(input: FundInput): Promise<SagaResult> {
    if (input.amount <= 0) throw new Error('amount must be positive');
    const row = await this.start('FUND', {
      fromWallet: null,
      toWallet: input.walletId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    return this.drive(row.id);
  }

  async getTransaction(id: string): Promise<TransactionRow> {
    const row = await this.repo.get(this.db, id);
    if (!row) throw new Error(`transaction ${id} not found`);
    return row;
  }

  /** Recovery: re-drive every non-terminal saga to completion. Idempotent. */
  async resumePending(): Promise<number> {
    const rows = await this.repo.listResumable(this.db);
    let resumed = 0;
    for (const row of rows) {
      try {
        await this.drive(row.id);
        resumed += 1;
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          // drive() already cancelled the saga; it reached a terminal state.
          resumed += 1;
          continue;
        }
        this.logger.error(`resume of ${row.id} failed: ${(err as Error).message}`);
      }
    }
    return resumed;
  }

  // --- internals ------------------------------------------------------------

  private async start(
    kind: SagaKind,
    saga: {
      fromWallet: string | null;
      toWallet: string | null;
      amount: number;
      idempotencyKey: string;
    },
  ): Promise<TransactionRow> {
    return this.db.withTransaction(async (client) => {
      const { row, created } = await this.repo.insertOrGet(client, { kind, ...saga });
      if (created) {
        await this.repo.logInitialStep(client, row.id);
        return row;
      }
      // Same idempotency key must describe the same request.
      if (
        row.kind !== kind ||
        row.from_wallet !== saga.fromWallet ||
        row.to_wallet !== saga.toWallet ||
        Number(row.amount) !== saga.amount
      ) {
        throw new IdempotencyConflictError(saga.idempotencyKey);
      }
      return row;
    });
  }

  private legsOf(tx: TransactionRow): Leg[] {
    const legs: Leg[] = [];
    if (tx.from_wallet) legs.push({ walletId: tx.from_wallet, type: 'DEBIT' });
    if (tx.to_wallet) legs.push({ walletId: tx.to_wallet, type: 'CREDIT' });
    return legs;
  }

  /**
   * Drive a saga from its current state to a terminal state. Re-entrant and
   * idempotent — safe to call again after a crash.
   */
  private async drive(id: string): Promise<SagaResult> {
    const tx = await this.repo.get(this.db, id);
    if (!tx) throw new Error(`transaction ${id} not found`);
    if (TERMINAL_STATUSES.has(tx.status)) {
      return { transactionId: id, status: tx.status };
    }
    if (tx.status === 'CANCELLING') {
      await this.cancelSaga(id);
      return this.result(id);
    }

    const amount = Number(tx.amount);
    const legs = this.legsOf(tx);

    try {
      let status: SagaStatus = tx.status;

      // TRY phase — reserve all legs.
      if (status === 'STARTED' || status === 'RESERVING') {
        if (status === 'STARTED') await this.transition(id, 'STARTED', 'RESERVING');
        for (const leg of legs) {
          await this.wallet.reserve({
            transactionId: id,
            walletId: leg.walletId,
            type: leg.type,
            amount,
          });
        }
        await this.transition(id, 'RESERVING', 'RESERVED');
        status = 'RESERVED';
      }

      // CONFIRM phase — settle holds, then append the ledger entries.
      if (status === 'RESERVED' || status === 'CONFIRMING') {
        if (status === 'RESERVED') await this.transition(id, 'RESERVED', 'CONFIRMING');
        for (const leg of legs) {
          await this.wallet.confirm({
            transactionId: id,
            walletId: leg.walletId,
            type: leg.type,
          });
        }
        await this.ledger.append(
          id,
          legs.map((leg) => ({ walletId: leg.walletId, amount, type: leg.type })),
        );
        await this.finalize(id, 'CONFIRMING', 'CONFIRMED', 'transfer.confirmed');
      }

      return this.result(id);
    } catch (err) {
      // A failed reservation is a business outcome: cancel and surface it.
      if (err instanceof InsufficientFundsError || err instanceof WalletNotFoundError) {
        await this.cancelSaga(id);
        throw err;
      }
      // Transient/unknown: leave the saga in place for recovery to re-drive.
      throw err;
    }
  }

  private async cancelSaga(id: string): Promise<void> {
    let tx = await this.repo.get(this.db, id);
    if (!tx) throw new Error(`transaction ${id} not found`);
    if (!TERMINAL_STATUSES.has(tx.status) && tx.status !== 'CANCELLING') {
      await this.transition(id, tx.status, 'CANCELLING');
    }
    tx = (await this.repo.get(this.db, id))!;
    for (const leg of this.legsOf(tx)) {
      await this.wallet.cancel({
        transactionId: id,
        walletId: leg.walletId,
        type: leg.type,
      });
    }
    await this.finalize(id, 'CANCELLING', 'CANCELLED', 'transfer.cancelled');
  }

  /** Intermediate transition in its own transaction. Guard-based, so a lost race
   * is a harmless no-op. */
  private async transition(
    id: string,
    from: SagaStatus,
    to: SagaStatus,
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await this.repo.setStatus(client, id, from, to);
    });
  }

  /** Terminal transition + outbox event, atomically. The status guard ensures
   * the event is emitted exactly once even if several drivers race here. */
  private async finalize(
    id: string,
    from: SagaStatus,
    to: SagaStatus,
    eventType: string,
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const advanced = await this.repo.setStatus(client, id, from, to, eventType);
      if (advanced) {
        await this.outbox.insert(client, {
          aggregateId: id,
          eventType,
          payload: { transactionId: id },
        });
      }
    });
  }

  private async result(id: string): Promise<SagaResult> {
    const tx = (await this.repo.get(this.db, id))!;
    return { transactionId: id, status: tx.status };
  }
}

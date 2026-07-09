import { Module } from '@nestjs/common';
import { WalletsRepository } from './wallets/wallets.repository';
import { LedgerRepository } from './ledger/ledger.repository';
import { TransactionsRepository } from './transactions/transactions.repository';
import { IdempotencyRepository } from './idempotency/idempotency.repository';
import { OutboxRepository } from './outbox/outbox.repository';

/**
 * Repositories are dependency-free leaves (they take a Queryable per call), so
 * grouping them here lets both WalletsService and TransactionsService depend on
 * all of them without creating a module cycle. When we split into separate service
 * processes in Phase 3, each process keeps only the repositories it owns.
 */
@Module({
  providers: [
    WalletsRepository,
    LedgerRepository,
    TransactionsRepository,
    IdempotencyRepository,
    OutboxRepository,
  ],
  exports: [
    WalletsRepository,
    LedgerRepository,
    TransactionsRepository,
    IdempotencyRepository,
    OutboxRepository,
  ],
})
export class PersistenceModule {}

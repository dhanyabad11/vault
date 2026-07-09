import { Module } from '@nestjs/common';
import { WalletsRepository } from './wallets/wallets.repository';
import { LedgerRepository } from './ledger/ledger.repository';
import { TransactionsRepository } from './transactions/transactions.repository';

/**
 * Repositories are dependency-free leaves (they take a Queryable per call), so
 * grouping them here lets both WalletsService and TransactionsService depend on
 * all three without creating a module cycle. When we split into separate service
 * processes in Phase 3, each process keeps only the repositories it owns.
 */
@Module({
  providers: [WalletsRepository, LedgerRepository, TransactionsRepository],
  exports: [WalletsRepository, LedgerRepository, TransactionsRepository],
})
export class PersistenceModule {}

import { Inject, Injectable } from '@nestjs/common';
import { LEDGER_DB, SchemaDatabase } from '../../database/schema-database';
import { LedgerRepository, LedgerEntryInput } from './ledger.repository';

/**
 * Ledger Service. Owns the immutable double-entry journal. `append` is idempotent
 * and writes all entries for a transaction in one local transaction. Only ever
 * touches the `ledger` schema.
 */
@Injectable()
export class LedgerService {
  constructor(
    @Inject(LEDGER_DB) private readonly db: SchemaDatabase,
    private readonly ledger: LedgerRepository,
  ) {}

  async append(transactionId: string, entries: LedgerEntryInput[]): Promise<void> {
    await this.db.withTransaction(async (client) => {
      for (const entry of entries) {
        await this.ledger.appendEntry(client, transactionId, entry);
      }
    });
  }

  balanceOf(walletId: string): Promise<number> {
    return this.ledger.balanceOf(this.db, walletId);
  }

  countForTransaction(transactionId: string): Promise<number> {
    return this.ledger.countForTransaction(this.db, transactionId);
  }

  /** Exposed for the immutability test. */
  raw(): SchemaDatabase {
    return this.db;
  }
}

import { Global, Module } from '@nestjs/common';
import { config } from '../config';
import {
  LEDGER_DB,
  ORCHESTRATOR_DB,
  SchemaDatabase,
  WALLET_DB,
} from './schema-database';

/**
 * Provides one schema-scoped connection per service. They share a Postgres
 * instance locally but are isolated by schema + search_path — the Phase 3
 * "separate databases" simulation.
 */
@Global()
@Module({
  providers: [
    {
      provide: WALLET_DB,
      useFactory: () => new SchemaDatabase('wallet', config.databaseUrl),
    },
    {
      provide: LEDGER_DB,
      useFactory: () => new SchemaDatabase('ledger', config.databaseUrl),
    },
    {
      provide: ORCHESTRATOR_DB,
      useFactory: () => new SchemaDatabase('orchestrator', config.databaseUrl),
    },
  ],
  exports: [WALLET_DB, LEDGER_DB, ORCHESTRATOR_DB],
})
export class DatabaseModule {}

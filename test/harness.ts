import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import {
  LEDGER_DB,
  ORCHESTRATOR_DB,
  SchemaDatabase,
  WALLET_DB,
} from '../src/database/schema-database';
import { WalletService } from '../src/services/wallet/wallet.service';
import { LedgerService } from '../src/services/ledger/ledger.service';
import { OrchestratorService } from '../src/services/orchestrator/orchestrator.service';
import { OutboxRelay } from '../src/services/orchestrator/outbox.relay';
import { OutboxRepository } from '../src/services/orchestrator/outbox.repository';
import { EventBus } from '../src/messaging/event-bus';

export interface Harness {
  app: INestApplication;
  orchestrator: OrchestratorService;
  wallet: WalletService;
  ledger: LedgerService;
  relay: OutboxRelay;
  outbox: OutboxRepository;
  bus: EventBus;
  walletDb: SchemaDatabase;
  ledgerDb: SchemaDatabase;
  orchestratorDb: SchemaDatabase;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const get = <T>(token: unknown): T => app.get<T>(token as never, { strict: false });

  const walletDb = get<SchemaDatabase>(WALLET_DB);
  const ledgerDb = get<SchemaDatabase>(LEDGER_DB);
  const orchestratorDb = get<SchemaDatabase>(ORCHESTRATOR_DB);

  return {
    app,
    orchestrator: get(OrchestratorService),
    wallet: get(WalletService),
    ledger: get(LedgerService),
    relay: get(OutboxRelay),
    outbox: get(OutboxRepository),
    bus: get(EventBus),
    walletDb,
    ledgerDb,
    orchestratorDb,
    async reset() {
      await walletDb.query(
        `TRUNCATE orchestrator.transaction_steps, orchestrator.outbox_events,
                  orchestrator.transactions, ledger.ledger_entries,
                  wallet.holds, wallet.wallets RESTART IDENTITY CASCADE`,
      );
    },
    async close() {
      get<OutboxRelay>(OutboxRelay).stop();
      await app.close();
    },
  };
}

export function uuid(): string {
  return randomUUID();
}

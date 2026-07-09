import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { WalletsService } from '../src/wallets/wallets.service';
import { TransactionsService } from '../src/transactions/transactions.service';
import { OutboxRelay } from '../src/outbox/outbox.relay';
import { EventBus } from '../src/outbox/event-bus';

export interface Harness {
  app: INestApplication;
  db: DatabaseService;
  wallets: WalletsService;
  transactions: TransactionsService;
  relay: OutboxRelay;
  bus: EventBus;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const db = app.get(DatabaseService);
  const wallets = app.get(WalletsService);
  const transactions = app.get(TransactionsService);
  const relay = app.get(OutboxRelay);
  const bus = app.get(EventBus);

  return {
    app,
    db,
    wallets,
    transactions,
    relay,
    bus,
    async reset() {
      // TRUNCATE does not fire the row-level append-only trigger, so it is the
      // right tool to wipe the journal between tests.
      await db.query(
        'TRUNCATE transactions, ledger_entries, wallets, idempotency_keys, outbox_events RESTART IDENTITY CASCADE',
      );
    },
    async close() {
      relay.stop();
      await app.close();
    },
  };
}

export function randomUserId(): string {
  // Any UUID; wallets.user_id has no cross-table constraint in Phase 1.
  return crypto.randomUUID();
}

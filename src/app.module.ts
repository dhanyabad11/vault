import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { PersistenceModule } from './persistence.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransactionsModule } from './transactions/transactions.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({
  imports: [
    DatabaseModule,
    PersistenceModule,
    WalletsModule,
    TransactionsModule,
    OutboxModule,
  ],
})
export class AppModule {}

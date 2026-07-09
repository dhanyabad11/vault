import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { MessagingModule } from './messaging/messaging.module';
import { WalletModule } from './services/wallet/wallet.module';
import { LedgerModule } from './services/ledger/ledger.module';
import { OrchestratorModule } from './services/orchestrator/orchestrator.module';

@Module({
  imports: [
    DatabaseModule,
    MessagingModule,
    WalletModule,
    LedgerModule,
    OrchestratorModule,
  ],
})
export class AppModule {}

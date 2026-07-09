import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MessagingModule } from '../../messaging/messaging.module';
import { OrchestratorRepository } from './orchestrator.repository';
import { OrchestratorService } from './orchestrator.service';
import { OutboxRepository } from './outbox.repository';
import { OutboxRelay } from './outbox.relay';
import { OrchestratorController } from './orchestrator.controller';

@Module({
  imports: [WalletModule, LedgerModule, MessagingModule],
  providers: [
    OrchestratorRepository,
    OutboxRepository,
    OutboxRelay,
    OrchestratorService,
  ],
  controllers: [OrchestratorController],
  exports: [OrchestratorService, OutboxRelay, OutboxRepository],
})
export class OrchestratorModule {}

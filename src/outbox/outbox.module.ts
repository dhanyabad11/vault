import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence.module';
import { EventBus } from './event-bus';
import { OutboxRelay } from './outbox.relay';

@Module({
  imports: [PersistenceModule],
  providers: [EventBus, OutboxRelay],
  exports: [EventBus, OutboxRelay],
})
export class OutboxModule {}

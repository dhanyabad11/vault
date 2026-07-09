import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence.module';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [PersistenceModule, TransactionsModule],
  providers: [WalletsService],
  controllers: [WalletsController],
  exports: [WalletsService],
})
export class WalletsModule {}

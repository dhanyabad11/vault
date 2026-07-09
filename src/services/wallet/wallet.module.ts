import { Module } from '@nestjs/common';
import { WalletRepository } from './wallet.repository';
import { HoldsRepository } from './holds.repository';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  providers: [WalletRepository, HoldsRepository, WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}

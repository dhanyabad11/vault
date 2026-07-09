import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Post()
  create(@Body() body: { userId: string }) {
    return this.wallets.createWallet(body.userId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wallet = await this.wallets.getWallet(id);
    const available = await this.wallets.availableBalance(id);
    return { ...wallet, available };
  }
}

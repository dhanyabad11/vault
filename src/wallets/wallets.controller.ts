import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { TransactionsService } from '../transactions/transactions.service';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly transactions: TransactionsService,
  ) {}

  @Post()
  create(@Body() body: { userId: string; openingBalance?: number }) {
    return this.wallets.create(body);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wallet = await this.wallets.getById(id);
    const ledgerBalance = await this.wallets.ledgerBalance(id);
    return { ...wallet, ledgerBalance };
  }

  @Post(':id/deposit')
  deposit(@Param('id') id: string, @Body() body: { amount: number }) {
    return this.transactions.deposit({ walletId: id, amount: body.amount });
  }
}

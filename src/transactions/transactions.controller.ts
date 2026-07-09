import { Body, Controller, Post } from '@nestjs/common';
import { LockStrategy, TransactionsService } from './transactions.service';

@Controller('transfers')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  transfer(
    @Body()
    body: {
      fromWallet: string;
      toWallet: string;
      amount: number;
      strategy?: LockStrategy;
    },
  ) {
    return this.transactions.transfer(body);
  }
}

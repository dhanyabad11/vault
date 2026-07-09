import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { LockStrategy, TransactionsService } from './transactions.service';

@Controller('transfers')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  transfer(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: {
      fromWallet: string;
      toWallet: string;
      amount: number;
      strategy?: LockStrategy;
    },
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.transactions.transfer({ ...body, idempotencyKey });
  }
}

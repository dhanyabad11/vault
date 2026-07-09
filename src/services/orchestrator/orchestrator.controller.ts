import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';

@Controller()
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post('transfers')
  transfer(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { fromWallet: string; toWallet: string; amount: number },
  ) {
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return this.orchestrator.transfer({ ...body, idempotencyKey: key });
  }

  @Post('wallets/:id/fund')
  fund(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: { amount: number },
  ) {
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return this.orchestrator.fund({ walletId: id, amount: body.amount, idempotencyKey: key });
  }

  @Get('transactions/:id')
  get(@Param('id') id: string) {
    return this.orchestrator.getTransaction(id);
  }
}

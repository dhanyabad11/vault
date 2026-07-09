import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { migrate } from './database/migrate';
import { OutboxRelay } from './services/orchestrator/outbox.relay';
import { OrchestratorService } from './services/orchestrator/orchestrator.service';
import { config } from './config';

async function bootstrap(): Promise<void> {
  await migrate();
  const app = await NestFactory.create(AppModule);

  // On startup, drive any saga that was interrupted mid-flight back to a
  // terminal state (crash recovery), then start the outbox relay.
  const resumed = await app.get(OrchestratorService).resumePending();
  if (resumed > 0) {
    // eslint-disable-next-line no-console
    console.log(`recovered ${resumed} in-flight transaction(s)`);
  }
  app.get(OutboxRelay).start();

  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`services listening on :${config.port}`);
}

bootstrap();

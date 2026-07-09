import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { migrate } from './database/migrate';
import { config } from './config';

async function bootstrap(): Promise<void> {
  // Dev convenience: ensure the schema exists before serving traffic.
  await migrate();
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`wallet service listening on :${config.port}`);
}

bootstrap();

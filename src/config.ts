import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://vault:vault@localhost:5432/vault',
  port: parseInt(process.env.PORT ?? '3000', 10),
};

import './pg-types';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../config';

/**
 * Applies every migration in db/migrations in filename order. Each file is
 * idempotent DDL (safe to run repeatedly): used by the app on boot, the
 * `npm run migrate` script, and the Jest global setup.
 */
export async function migrate(connectionString: string = config.databaseUrl): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const dir = join(process.cwd(), 'db', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('migration applied');
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('migration failed', err);
      process.exit(1);
    });
}

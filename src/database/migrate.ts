import './pg-types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../config';

/**
 * Applies the Phase 1 schema. Idempotent (safe to run repeatedly): used by the
 * app on boot, the `npm run migrate` script, and the Jest global setup.
 */
export async function migrate(connectionString: string = config.databaseUrl): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const sqlPath = join(process.cwd(), 'db', 'migrations', '001_init.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
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

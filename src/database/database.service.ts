import './pg-types';
import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { Queryable } from './queryable';

@Injectable()
export class DatabaseService implements Queryable, OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  onModuleInit(): void {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      // Cap concurrency so a burst of transfers queues on the pool rather than
      // opening unbounded connections. Also keeps the concurrency tests honest.
      max: 10,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  getPool(): Pool {
    return this.pool;
  }

  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  /**
   * Runs `fn` inside a single database transaction. Commits on success, rolls
   * back on any thrown error. The DB write and any journal writes inside `fn`
   * are therefore atomic — the whole point of Phase 1.
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

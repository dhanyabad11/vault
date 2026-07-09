import './pg-types';
import { OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Queryable } from './queryable';

/** DI tokens for each service's schema-scoped connection. */
export const WALLET_DB = Symbol('WALLET_DB');
export const LEDGER_DB = Symbol('LEDGER_DB');
export const ORCHESTRATOR_DB = Symbol('ORCHESTRATOR_DB');

/**
 * A connection pool pinned to a single Postgres schema via search_path. Each
 * service gets its own instance, which simulates a separate database: a query or
 * transaction on this pool can only see its own schema's tables, so no accidental
 * cross-service transaction is possible.
 */
export class SchemaDatabase implements Queryable, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    readonly schema: string,
    connectionString: string,
  ) {
    // Pin every physical connection to this service's schema at connection time,
    // via a libpq-style option. This avoids issuing a separate SET query (which
    // would race the first real query on the pooled client).
    this.pool = new Pool({
      connectionString,
      max: 10,
      options: `-c search_path=${schema}`,
    });
  }

  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

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

  getPool(): Pool {
    return this.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

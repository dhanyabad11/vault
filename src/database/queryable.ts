import { QueryResult, QueryResultRow } from 'pg';

/**
 * Anything that can run a parameterized query: a Pool, a pooled Client inside a
 * transaction, or our DatabaseService. Repositories take this so the same method
 * works both standalone (pool) and inside a transaction (client).
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

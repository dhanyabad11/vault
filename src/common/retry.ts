import { OptimisticConflictError, isRetryablePgError } from './errors';

export const MAX_ATTEMPTS = 100;

export function isRetryable(err: unknown): boolean {
  return err instanceof OptimisticConflictError || isRetryablePgError(err);
}

export async function backoff(attempt: number): Promise<void> {
  const base = Math.min(50, 2 ** attempt);
  const jitter = Math.random() * 5;
  await new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/** Runs `fn`, retrying on optimistic-conflict / deadlock up to MAX_ATTEMPTS. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the final attempt either returns or throws.
  throw new Error('withRetry exhausted');
}

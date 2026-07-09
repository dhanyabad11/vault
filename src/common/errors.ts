/** Source wallet lacks the funds for a debit. Terminal — never retried. */
export class InsufficientFundsError extends Error {
  constructor(walletId: string) {
    super(`insufficient funds in wallet ${walletId}`);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * An optimistic (version) check failed because a concurrent writer moved first.
 * Retryable — the orchestration layer re-reads and tries again.
 */
export class OptimisticConflictError extends Error {
  constructor(walletId: string) {
    super(`optimistic lock conflict on wallet ${walletId}`);
    this.name = 'OptimisticConflictError';
  }
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`wallet ${walletId} not found`);
    this.name = 'WalletNotFoundError';
  }
}

/** Postgres deadlock / serialization failures worth retrying. */
export function isRetryablePgError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '40P01' /* deadlock_detected */ || code === '40001' /* serialization_failure */;
}

/**
 * Money is represented as an integer number of minor units (cents).
 * These helpers centralize validation so amounts can never be negative,
 * fractional, or NaN when they reach the database.
 */
export type Cents = number;

export function assertValidAmount(amount: number): Cents {
  if (!Number.isInteger(amount)) {
    throw new Error(`amount must be an integer number of cents, got ${amount}`);
  }
  if (amount <= 0) {
    throw new Error(`amount must be positive, got ${amount}`);
  }
  return amount;
}

export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

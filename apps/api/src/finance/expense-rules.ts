import { toCents } from './money';
import { RuleError } from './rule-error';
import { referenceProblem } from './payment-verification';

/** Expense rules. Framework-free. */

export const MAX_EXPENSE_CENTS = 100_000_000_000n; // 1,000,000,000.00
export const MIN_EXPENSE_CENTS = 1n;
const EARLIEST = new Date('2000-01-01T00:00:00Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function expenseAmountCents(amount: string): bigint {
  let cents: bigint;
  try {
    cents = toCents(amount);
  } catch {
    throw new RuleError('INVALID_AMOUNT', 'Amount must be a number with up to 2 decimals');
  }
  if (cents < MIN_EXPENSE_CENTS || cents > MAX_EXPENSE_CENTS) {
    throw new RuleError('AMOUNT_RANGE', 'Amount must be between 0.01 and 1,000,000,000.00');
  }
  return cents;
}

/** Expense date: must be a real date, not in the far future (more than a day ahead), not before 2000. */
export function validateSpentAt(value: string | undefined, now: Date = new Date()): Date {
  if (value === undefined) return now;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new RuleError('INVALID_DATE', 'Expense date is not a valid date');
  if (d.getTime() > now.getTime() + ONE_DAY_MS) throw new RuleError('FUTURE_DATE', 'Expense date cannot be in the future');
  if (d.getTime() < EARLIEST.getTime()) throw new RuleError('DATE_TOO_OLD', 'Expense date cannot be before 2000');
  return d;
}

export function validateDateRange(from?: string, to?: string): { gte?: Date; lte?: Date } {
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(to) : undefined;
  if ((gte && Number.isNaN(gte.getTime())) || (lte && Number.isNaN(lte.getTime()))) {
    throw new RuleError('INVALID_DATE', 'Date filters must be valid dates');
  }
  if (gte && lte && gte.getTime() > lte.getTime()) throw new RuleError('RANGE_ORDER', 'The "from" date must not be after the "to" date');
  // "to" is inclusive of its whole day.
  if (lte) lte.setUTCHours(23, 59, 59, 999);
  return { gte, lte };
}

export function expensePaymentReference(method: string | null | undefined, reference: string | null | undefined): string | null {
  if (method && method !== 'CASH') {
    const problem = referenceProblem(reference);
    if (problem) throw new RuleError(problem, 'Reference is required for this payment method and must be 4 to 80 letters, digits, dashes, underscores or slashes');
  }
  const r = (reference ?? '').trim();
  return r ? r : null;
}

export function pageBounds(page: number | undefined, pageSize: number | undefined): { page: number; pageSize: number; skip: number } {
  const p = page ?? 1;
  const s = pageSize ?? 20;
  if (!Number.isInteger(p) || p < 1) throw new RuleError('INVALID_PAGE', 'Page must be 1 or more');
  if (!Number.isInteger(s) || s < 1 || s > 100) throw new RuleError('INVALID_PAGE_SIZE', 'Page size must be from 1 to 100');
  return { page: p, pageSize: s, skip: (p - 1) * s };
}

export function assertEditable(status: string): void {
  if (status !== 'ACTIVE') throw new RuleError('EXPENSE_VOIDED', 'A voided expense cannot be changed');
}

export function voidReason(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (v.length < 3 || v.length > 200) throw new RuleError('REASON_REQUIRED', 'A void reason of 3 to 200 characters is required');
  return v;
}

/** Sum of ACTIVE expenses only. Voided rows never count. */
export function activeExpenseTotalCents(rows: { status: string; amount: string }[]): bigint {
  return rows.reduce((acc, r) => (r.status === 'ACTIVE' ? acc + toCents(r.amount) : acc), 0n);
}

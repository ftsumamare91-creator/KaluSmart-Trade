import { toCents } from '../finance/money';
import { RuleError } from '../finance/rule-error';

/** Purchase rules: line validation, server-side totals, stock arithmetic, and status transitions. Framework-free. */

export const MAX_PURCHASE_QTY = 100_000;
export const MAX_PURCHASE_LINES = 100;
const UNIT_COST = /^\d{1,10}(\.\d{1,2})?$/;

export interface RawPurchaseLine {
  productId: unknown;
  quantity: unknown;
  unitCost: unknown;
}

export interface PurchaseLine {
  productId: string;
  quantity: number;
  unitCost: string;
  lineTotal: string;
  lineCents: bigint;
}

/**
 * Validates lines and computes totals in integer cents. Rejects bad quantities and costs, and a
 * product listed twice (one line per product keeps the unit cost unambiguous).
 */
export function normalizePurchaseLines(raw: RawPurchaseLine[]): { lines: PurchaseLine[]; total: string; totalCents: bigint } {
  if (!Array.isArray(raw) || raw.length < 1) throw new RuleError('LINES_REQUIRED', 'A purchase needs at least one line');
  if (raw.length > MAX_PURCHASE_LINES) throw new RuleError('TOO_MANY_LINES', `A purchase can have at most ${MAX_PURCHASE_LINES} lines`);

  const seen = new Set<string>();
  const lines: PurchaseLine[] = [];
  let totalCents = 0n;
  for (const r of raw) {
    const productId = typeof r.productId === 'string' ? r.productId.trim() : '';
    if (!productId) throw new RuleError('PRODUCT_REQUIRED', 'Every line needs a product');
    if (seen.has(productId)) throw new RuleError('DUPLICATE_PRODUCT', 'A product can appear only once per purchase');
    seen.add(productId);

    const q = r.quantity;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_PURCHASE_QTY) {
      throw new RuleError('INVALID_QUANTITY', `Quantity must be a whole number from 1 to ${MAX_PURCHASE_QTY}`);
    }
    const cost = typeof r.unitCost === 'string' ? r.unitCost.trim() : '';
    if (!UNIT_COST.test(cost)) throw new RuleError('INVALID_UNIT_COST', 'Unit cost must be a number with up to 2 decimals');
    const unitCents = toCents(cost);
    if (unitCents <= 0n) throw new RuleError('INVALID_UNIT_COST', 'Unit cost must be greater than zero');

    const lineCents = unitCents * BigInt(q);
    totalCents += lineCents;
    lines.push({ productId, quantity: q, unitCost: cost, lineCents, lineTotal: '' });
  }
  for (const l of lines) l.lineTotal = `${l.lineCents / 100n}.${(l.lineCents % 100n).toString().padStart(2, '0')}`;
  const total = `${totalCents / 100n}.${(totalCents % 100n).toString().padStart(2, '0')}`;
  return { lines, total, totalCents };
}

/** New stock level after a change. Throws instead of going negative. */
export function stockAfter(current: number, delta: number): number {
  if (!Number.isInteger(delta) || delta === 0) throw new RuleError('INVALID_DELTA', 'Change must be a non-zero whole number');
  const next = current + delta;
  if (next < 0) throw new RuleError('STOCK_NEGATIVE', 'Stock would go below zero');
  return next;
}

export type PurchaseAction = 'receive' | 'cancel' | 'edit';

/**
 * Status rules:
 *  - edit and receive: DRAFT only. Receiving is one-way.
 *  - cancel: a DRAFT is cancelled without stock change. A RECEIVED purchase can be cancelled only with a reason,
 *    and only while no supplier payment is confirmed against it. Its stock is then reversed.
 *  - CANCELLED is terminal.
 */
export function assertPurchaseAction(status: string, action: PurchaseAction, opts: { reason?: string; hasConfirmedPayments?: boolean } = {}): void {
  if (status === 'CANCELLED') throw new RuleError('PURCHASE_CANCELLED', 'A cancelled purchase cannot be changed');
  if (action === 'edit' || action === 'receive') {
    if (status !== 'DRAFT') throw new RuleError('NOT_DRAFT', action === 'edit' ? 'Only draft purchases can be edited' : 'Only draft purchases can be received');
    return;
  }
  // cancel
  if (status === 'RECEIVED') {
    if (opts.hasConfirmedPayments) throw new RuleError('HAS_CONFIRMED_PAYMENTS', 'Confirmed supplier payments exist. Reverse them before cancelling this purchase');
    const reason = (opts.reason ?? '').trim();
    if (reason.length < 3 || reason.length > 200) throw new RuleError('REASON_REQUIRED', 'A cancellation reason of 3 to 200 characters is required');
  }
}

import { fromCents, toCents } from './money';
import { RuleError } from './rule-error';

/**
 * Ledger arithmetic for customer receivables and supplier payables. Framework-free and exact (integer cents).
 *
 * Formulas (see docs/PHASE3_6_TO_3_8.md):
 *  - Sale receivable      = sale.total - SUM(payment.amount where payment.status = CONFIRMED)
 *    Only sales with status CONFIRMED or PAID are receivable. DRAFT and CANCELLED are excluded.
 *  - Purchase payable     = purchase.total - SUM(supplierPayment.amount where status = CONFIRMED)
 *    Only purchases with status RECEIVED are payable.
 *  - PENDING and REJECTED/FAILED amounts never reduce a balance. PENDING only reserves room when recording.
 *  - A balance never goes below zero; any excess is reported separately as `overpaidCents`.
 */

export const RECEIVABLE_SALE_STATUSES = ['CONFIRMED', 'PAID'] as const;
export const PAYABLE_PURCHASE_STATUSES = ['RECEIVED'] as const;

type Decided = { status: string; amount: string };

export interface SaleForLedger {
  id: string;
  customerId: string | null;
  status: string;
  total: string;
}

export interface PurchaseForLedger {
  id: string;
  supplierId: string;
  status: string;
  total: string;
}

export interface Balance {
  totalCents: bigint;
  confirmedCents: bigint;
  pendingCents: bigint;
  balanceCents: bigint;
  overpaidCents: bigint;
}

/** Balance for one charge (a sale or a purchase) against its payments. */
export function balanceFor(totalStr: string, payments: Decided[]): Balance {
  const totalCents = toCents(totalStr);
  let confirmedCents = 0n;
  let pendingCents = 0n;
  for (const p of payments) {
    const cents = toCents(p.amount);
    if (p.status === 'CONFIRMED') confirmedCents += cents;
    else if (p.status === 'PENDING') pendingCents += cents;
  }
  const diff = totalCents - confirmedCents;
  return {
    totalCents,
    confirmedCents,
    pendingCents,
    balanceCents: diff > 0n ? diff : 0n,
    overpaidCents: diff < 0n ? -diff : 0n,
  };
}

/** Whether a new payment of `amount` fits: it must not exceed the balance after pending amounts are reserved. */
export function fitsBalance(b: Balance, amountStr: string): boolean {
  return toCents(amountStr) + b.pendingCents <= b.balanceCents;
}

export interface CustomerRow {
  customerId: string | null; // null = walk-in sales
  saleCount: number;
  totalCents: bigint;
  confirmedCents: bigint;
  pendingCents: bigint;
  balanceCents: bigint;
}

/**
 * Receivables grouped by customer. Walk-in sales (customerId null) form their own row, so the
 * grand total always reconciles to every receivable sale in the organization.
 */
export function receivablesByCustomer(sales: SaleForLedger[], payments: (Decided & { saleId: string })[]): { rows: CustomerRow[]; grandBalanceCents: bigint } {
  const paymentsBySale = new Map<string, Decided[]>();
  for (const p of payments) {
    const list = paymentsBySale.get(p.saleId) ?? [];
    list.push(p);
    paymentsBySale.set(p.saleId, list);
  }
  const groups = new Map<string | null, CustomerRow>();
  for (const sale of sales) {
    if (!(RECEIVABLE_SALE_STATUSES as readonly string[]).includes(sale.status)) continue;
    const b = balanceFor(sale.total, paymentsBySale.get(sale.id) ?? []);
    const g = groups.get(sale.customerId) ?? {
      customerId: sale.customerId,
      saleCount: 0,
      totalCents: 0n,
      confirmedCents: 0n,
      pendingCents: 0n,
      balanceCents: 0n,
    };
    g.saleCount += 1;
    g.totalCents += b.totalCents;
    g.confirmedCents += b.confirmedCents;
    g.pendingCents += b.pendingCents;
    g.balanceCents += b.balanceCents;
    groups.set(sale.customerId, g);
  }
  const rows = [...groups.values()].sort((a, b) => (a.balanceCents === b.balanceCents ? 0 : a.balanceCents < b.balanceCents ? 1 : -1));
  return { rows, grandBalanceCents: rows.reduce((acc, r) => acc + r.balanceCents, 0n) };
}

export interface SupplierRow {
  supplierId: string;
  purchaseCount: number;
  totalCents: bigint;
  paidCents: bigint;
  pendingCents: bigint;
  balanceCents: bigint;
}

/** Payables grouped by supplier. Only RECEIVED purchases are liabilities. */
export function payablesBySupplier(purchases: PurchaseForLedger[], payments: (Decided & { purchaseId: string })[]): { rows: SupplierRow[]; grandBalanceCents: bigint } {
  const paymentsByPurchase = new Map<string, Decided[]>();
  for (const p of payments) {
    const list = paymentsByPurchase.get(p.purchaseId) ?? [];
    list.push(p);
    paymentsByPurchase.set(p.purchaseId, list);
  }
  const groups = new Map<string, SupplierRow>();
  for (const pu of purchases) {
    if (!(PAYABLE_PURCHASE_STATUSES as readonly string[]).includes(pu.status)) continue;
    const b = balanceFor(pu.total, paymentsByPurchase.get(pu.id) ?? []);
    const g = groups.get(pu.supplierId) ?? { supplierId: pu.supplierId, purchaseCount: 0, totalCents: 0n, paidCents: 0n, pendingCents: 0n, balanceCents: 0n };
    g.purchaseCount += 1;
    g.totalCents += b.totalCents;
    g.paidCents += b.confirmedCents;
    g.pendingCents += b.pendingCents;
    g.balanceCents += b.balanceCents;
    groups.set(pu.supplierId, g);
  }
  const rows = [...groups.values()].sort((a, b) => (a.balanceCents === b.balanceCents ? 0 : a.balanceCents < b.balanceCents ? 1 : -1));
  return { rows, grandBalanceCents: rows.reduce((acc, r) => acc + r.balanceCents, 0n) };
}

/** Throws RuleError when a payment would take the balance over the amount still owed. */
export function assertFits(b: Balance, amountStr: string): void {
  if (!fitsBalance(b, amountStr)) {
    const remaining = fromCents(b.balanceCents > b.pendingCents ? b.balanceCents - b.pendingCents : 0n);
    throw new RuleError('OVER_BALANCE', `This amount is more than the balance due. Remaining after pending payments: ${remaining}`);
  }
}

export function cents(v: bigint): string {
  return fromCents(v);
}

import { fromCents } from '../finance/money';

/**
 * Profit & Loss composition. Pure and explicit about what is and is not known.
 *
 * What the application records (and therefore what this report can state):
 *  - Sales: sale totals for CONFIRMED and PAID sales, by sale date. CANCELLED and DRAFT are excluded.
 *  - Discounts and returns: NOT recorded anywhere in the application. Net sales equals gross sales and the
 *    report says so.
 *  - Cost of goods sold: sale lines store the price at sale time, not the cost of the stock sold. There is no
 *    reliable cost basis per sale, so COGS, gross profit and net profit are UNAVAILABLE.
 *  - Operating expenses: ACTIVE expenses by expense date. VOIDED expenses are excluded.
 *  - Purchases: RECEIVED purchases are inventory. They are shown as a memo line and are never operating expenses.
 *  - Collections: CONFIRMED customer payments by confirmation date. Cash, not revenue. Shown as a memo line.
 *  - Payables and receivables: balances at the end of the period. Shown as memo lines, never as revenue or expense.
 */

export interface PnlInputs {
  grossSalesCents: bigint;
  operatingExpensesCents: bigint;
  collectionsCents: bigint;
  purchasesCents: bigint;
  receivablesAtEndCents: bigint;
  payablesAtEndCents: bigint;
  /** null when the application has no reliable record of discounts. */
  discountsCents: bigint | null;
  /** null when the application has no returns record. */
  returnsCents: bigint | null;
  /** null when no reliable historical cost basis exists. */
  cogsCents: bigint | null;
}

export interface PnlLine {
  key: string;
  label: string;
  amount: string | null;
  status: 'REPORTED' | 'UNAVAILABLE';
  note?: string;
}

const money = (c: bigint | null) => (c === null ? null : fromCents(c));

export function buildProfitLoss(i: PnlInputs) {
  const discounts = i.discountsCents ?? 0n;
  const returns = i.returnsCents ?? 0n;
  const netSales = i.grossSalesCents - discounts - returns;

  const cogsKnown = i.cogsCents !== null;
  const grossProfit = cogsKnown ? netSales - (i.cogsCents as bigint) : null;
  const netProfit = grossProfit === null ? null : grossProfit - i.operatingExpensesCents;

  const lines: PnlLine[] = [
    { key: 'grossSales', label: 'Gross sales', amount: money(i.grossSalesCents), status: 'REPORTED', note: 'Confirmed and paid sales dated in the period.' },
    {
      key: 'discountsReturns',
      label: 'Discounts and returns',
      amount: i.discountsCents === null || i.returnsCents === null ? null : money(discounts + returns),
      status: i.discountsCents === null || i.returnsCents === null ? 'UNAVAILABLE' : 'REPORTED',
      note: 'The application does not record discounts or returns. Net sales therefore equals gross sales.',
    },
    { key: 'netSales', label: 'Net sales revenue', amount: money(netSales), status: 'REPORTED' },
    {
      key: 'cogs',
      label: 'Cost of goods sold',
      amount: money(i.cogsCents),
      status: cogsKnown ? 'REPORTED' : 'UNAVAILABLE',
      note: cogsKnown ? undefined : 'Sold items do not record the cost of the stock sold, so cost of goods sold cannot be verified.',
    },
    {
      key: 'grossProfit',
      label: 'Gross profit',
      amount: money(grossProfit),
      status: grossProfit === null ? 'UNAVAILABLE' : 'REPORTED',
      note: grossProfit === null ? 'Unavailable until cost of goods sold can be verified.' : undefined,
    },
    { key: 'operatingExpenses', label: 'Operating expenses', amount: money(i.operatingExpensesCents), status: 'REPORTED', note: 'Active expenses dated in the period. Voided expenses excluded.' },
    {
      key: 'netProfit',
      label: 'Net profit or loss',
      amount: money(netProfit),
      status: netProfit === null ? 'UNAVAILABLE' : 'REPORTED',
      note: netProfit === null ? 'Unavailable until cost of goods sold can be verified.' : undefined,
    },
  ];

  const memo = [
    { key: 'collections', label: 'Payment collections (cash received)', amount: money(i.collectionsCents), note: 'Not revenue. Confirmed customer payments in the period.' },
    { key: 'purchases', label: 'Inventory purchases received', amount: money(i.purchasesCents), note: 'Not an operating expense. Stock cost is recognized through cost of goods sold.' },
    { key: 'receivablesAtEnd', label: 'Customer receivables at period end', amount: money(i.receivablesAtEndCents), note: 'Sales not yet fully paid. Not revenue.' },
    { key: 'payablesAtEnd', label: 'Supplier payables at period end', amount: money(i.payablesAtEndCents), note: 'Received purchases not yet fully paid. Not an expense.' },
  ];

  return { lines, memo, netSalesCents: netSales, grossProfitCents: grossProfit, netProfitCents: netProfit };
}

/** Plain-language limitations, returned with every P&L so the screen never implies more than is verified. */
export const PNL_NOTES = [
  'Cost of goods sold is not recorded per sale, so gross profit and net profit are unavailable.',
  'Discounts, returns and refunds are not recorded, so net sales equals gross sales.',
  'This is a management summary from application records. It is not a formally audited accounting statement.',
  'Dates are local calendar days in the configured business time zone. Both ends of a range are inclusive.',
];

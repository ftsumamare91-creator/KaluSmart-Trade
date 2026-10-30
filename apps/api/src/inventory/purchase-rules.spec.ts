import { assertPurchaseAction, normalizePurchaseLines, stockAfter } from './purchase-rules';
import { RuleError } from '../finance/rule-error';

const line = (over: Partial<{ productId: unknown; quantity: unknown; unitCost: unknown }> = {}) => ({
  productId: 'p1',
  quantity: 2,
  unitCost: '10.50',
  ...over,
});

describe('purchase lines and totals', () => {
  it('computes line and purchase totals on the server in exact cents', () => {
    const r = normalizePurchaseLines([line({ quantity: 3, unitCost: '0.10' }), line({ productId: 'p2', quantity: 7, unitCost: '2.35' })]);
    expect(r.lines[0].lineTotal).toBe('0.30');
    expect(r.lines[1].lineTotal).toBe('16.45');
    expect(r.total).toBe('16.75');
  });

  it('rejects a product listed twice', () => {
    expect(() => normalizePurchaseLines([line(), line()])).toThrow(RuleError);
  });

  it('rejects zero, negative, fractional, and oversized quantities', () => {
    for (const q of [0, -1, 1.5, 100001, '2', null]) {
      expect(() => normalizePurchaseLines([line({ quantity: q })])).toThrow(RuleError);
    }
  });

  it('rejects zero, negative, malformed, and over-precise unit costs', () => {
    for (const c of ['0', '0.00', '-1', '1.005', 'abc', '', 12]) {
      expect(() => normalizePurchaseLines([line({ unitCost: c })])).toThrow(RuleError);
    }
  });

  it('rejects a purchase with no lines, a missing product, or too many lines', () => {
    expect(() => normalizePurchaseLines([])).toThrow(RuleError);
    expect(() => normalizePurchaseLines([line({ productId: '' })])).toThrow(RuleError);
    expect(() => normalizePurchaseLines(Array.from({ length: 101 }, (_, i) => line({ productId: `p${i}` })))).toThrow(RuleError);
  });
});

describe('stock arithmetic', () => {
  it('adds and removes stock', () => {
    expect(stockAfter(5, 10)).toBe(15);
    expect(stockAfter(5, -5)).toBe(0);
  });

  it('never goes below zero', () => {
    expect(() => stockAfter(5, -6)).toThrow(RuleError);
  });

  it('refuses a zero or fractional change', () => {
    expect(() => stockAfter(5, 0)).toThrow(RuleError);
    expect(() => stockAfter(5, 1.5)).toThrow(RuleError);
  });
});

describe('purchase status transitions', () => {
  it('only drafts can be edited or received', () => {
    expect(() => assertPurchaseAction('DRAFT', 'edit')).not.toThrow();
    expect(() => assertPurchaseAction('DRAFT', 'receive')).not.toThrow();
    expect(() => assertPurchaseAction('RECEIVED', 'receive')).toThrow(RuleError);
    expect(() => assertPurchaseAction('RECEIVED', 'edit')).toThrow(RuleError);
  });

  it('a cancelled purchase is terminal', () => {
    expect(() => assertPurchaseAction('CANCELLED', 'receive')).toThrow(RuleError);
    expect(() => assertPurchaseAction('CANCELLED', 'cancel', { reason: 'again' })).toThrow(RuleError);
  });

  it('a draft cancels without a reason', () => {
    expect(() => assertPurchaseAction('DRAFT', 'cancel')).not.toThrow();
  });

  it('a received purchase needs a reason and no confirmed supplier payments to be cancelled', () => {
    expect(() => assertPurchaseAction('RECEIVED', 'cancel')).toThrow(RuleError);
    expect(() => assertPurchaseAction('RECEIVED', 'cancel', { reason: 'wrong supplier' })).not.toThrow();
    expect(() => assertPurchaseAction('RECEIVED', 'cancel', { reason: 'wrong supplier', hasConfirmedPayments: true })).toThrow(RuleError);
  });
});

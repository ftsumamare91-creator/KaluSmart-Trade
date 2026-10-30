import { activeExpenseTotalCents, assertEditable, expensePaymentReference, expenseAmountCents, pageBounds, validateDateRange, validateSpentAt, voidReason } from './expense-rules';
import { RuleError } from './rule-error';

const NOW = new Date('2026-10-23T09:00:00Z');

describe('expense amounts', () => {
  it('accepts 0.01 up to the maximum, with two decimals', () => {
    expect(expenseAmountCents('0.01')).toBe(1n);
    expect(expenseAmountCents('1000000000.00')).toBe(100000000000n);
  });

  it('rejects zero, negative, too large, malformed, and over-precise amounts', () => {
    for (const a of ['0', '0.00', '-5', '1000000000.01', '12.345', 'ten', '']) {
      expect(() => expenseAmountCents(a)).toThrow(RuleError);
    }
  });
});

describe('expense dates', () => {
  it('defaults to now and accepts a past date', () => {
    expect(validateSpentAt(undefined, NOW)).toEqual(NOW);
    expect(validateSpentAt('2026-01-15', NOW).getUTCFullYear()).toBe(2026);
  });

  it('rejects future dates beyond one day, invalid dates, and dates before 2000', () => {
    expect(() => validateSpentAt('2026-12-01', NOW)).toThrow(RuleError);
    expect(() => validateSpentAt('not a date', NOW)).toThrow(RuleError);
    expect(() => validateSpentAt('1999-12-31', NOW)).toThrow(RuleError);
  });
});

describe('filters and pagination', () => {
  it('makes the "to" day inclusive and refuses a reversed range', () => {
    const r = validateDateRange('2026-10-01', '2026-10-31');
    expect(r.lte!.toISOString()).toBe('2026-10-31T23:59:59.999Z');
    expect(() => validateDateRange('2026-10-31', '2026-10-01')).toThrow(RuleError);
  });

  it('bounds page and page size', () => {
    expect(pageBounds(undefined, undefined)).toEqual({ page: 1, pageSize: 20, skip: 0 });
    expect(pageBounds(3, 10).skip).toBe(20);
    expect(() => pageBounds(0, 10)).toThrow(RuleError);
    expect(() => pageBounds(1, 101)).toThrow(RuleError);
  });
});

describe('editing and voiding', () => {
  it('a voided expense cannot be edited', () => {
    expect(() => assertEditable('ACTIVE')).not.toThrow();
    expect(() => assertEditable('VOIDED')).toThrow(RuleError);
  });

  it('requires a void reason of 3 to 200 characters', () => {
    expect(() => voidReason('  ')).toThrow(RuleError);
    expect(() => voidReason('ok')).toThrow(RuleError);
    expect(voidReason('  duplicate entry  ')).toBe('duplicate entry');
  });

  it('totals count only active expenses', () => {
    expect(activeExpenseTotalCents([
      { status: 'ACTIVE', amount: '10.00' },
      { status: 'VOIDED', amount: '99.00' },
      { status: 'ACTIVE', amount: '0.25' },
    ])).toBe(1025n);
  });
});

describe('payment reference on expenses', () => {
  it('cash needs no reference; other methods need a valid one', () => {
    expect(expensePaymentReference('CASH', undefined)).toBeNull();
    expect(() => expensePaymentReference('TELEBIRR', undefined)).toThrow(RuleError);
    expect(() => expensePaymentReference('BANK_TRANSFER', 'x')).toThrow(RuleError);
    expect(expensePaymentReference('BANK_TRANSFER', ' BNK-2026-77 ')).toBe('BNK-2026-77');
  });
});

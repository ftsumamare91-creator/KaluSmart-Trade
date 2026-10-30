import { feeFor, fromCents, isFullyPaid, platformFeePercent, requiresReference, toCents } from './money';

describe('money', () => {
  it('converts amounts to cents and back', () => {
    expect(toCents('1250.5')).toBe(125050n);
    expect(toCents('0.07')).toBe(7n);
    expect(fromCents(125050n)).toBe('1250.50');
    expect(fromCents(7n)).toBe('0.07');
  });

  it('rejects malformed amounts', () => {
    expect(() => toCents('12.345')).toThrow();
    expect(() => toCents('-5')).toThrow();
    expect(() => toCents('abc')).toThrow();
  });

  it('computes a percentage fee rounded half-up to the cent', () => {
    // 2.5% of 100.00 = 2.50
    expect(feeFor(toCents('100.00'), '2.5')).toEqual({ feeCents: 250n, netCents: 9750n });
    // 10% of 0.05 = 0.005 -> rounds half-up to 0.01
    expect(feeFor(toCents('0.05'), '10')).toEqual({ feeCents: 1n, netCents: 4n });
    // zero percent charges nothing
    expect(feeFor(toCents('999.99'), '0')).toEqual({ feeCents: 0n, netCents: 99999n });
  });

  it('rejects percentages outside 0 to 100', () => {
    expect(() => feeFor(toCents('10'), '101')).toThrow();
    expect(() => feeFor(toCents('10'), '1.555')).toThrow();
  });

  it('reads PLATFORM_FEE_PERCENT with a default of zero', () => {
    expect(platformFeePercent(undefined)).toBe('0');
    expect(platformFeePercent('  3.25 ')).toBe('3.25');
    expect(() => platformFeePercent('lots')).toThrow();
  });

  it('marks a sale paid only when confirmed payments cover the total', () => {
    expect(isFullyPaid(toCents('499.99'), toCents('500.00'))).toBe(false);
    expect(isFullyPaid(toCents('500.00'), toCents('500.00'))).toBe(true);
    expect(isFullyPaid(toCents('600.00'), toCents('500.00'))).toBe(true);
  });

  it('requires a receipt reference for everything except cash', () => {
    expect(requiresReference('CASH')).toBe(false);
    expect(requiresReference('TELEBIRR')).toBe(true);
    expect(requiresReference('BANK_TRANSFER')).toBe(true);
  });
});

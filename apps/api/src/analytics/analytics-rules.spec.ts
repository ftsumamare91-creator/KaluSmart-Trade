import { addDays, bucketKeys, bucketStart, localToday, parseYmd, previousRange, rangeFor, reportOffsetMinutes, resolveRange } from './analytics-rules';
import { buildProfitLoss } from './profit-loss';
import { RuleError } from '../finance/rule-error';

describe('dates', () => {
  it('rejects malformed and non-existent dates', () => {
    expect(() => parseYmd('2026-2-1')).toThrow(RuleError);
    expect(() => parseYmd('2026-02-30')).toThrow(RuleError);
    expect(() => parseYmd('tomorrow')).toThrow(RuleError);
  });

  it('defaults to the 30 days ending today in the business time zone', () => {
    const now = new Date('2026-10-23T22:30:00Z'); // 01:30 on 24 Oct in UTC+3
    expect(localToday(now, 180)).toBe('2026-10-24');
    const r = resolveRange({ now, offsetMin: 180, maxDays: 400 });
    expect(r.to).toBe('2026-10-24');
    expect(r.from).toBe('2026-09-25');
    expect(r.days).toBe(30);
  });

  it('treats both ends as inclusive: local midnight to the start of the next day', () => {
    const r = rangeFor('2026-10-01', '2026-10-01', 180, 400);
    expect(r.startUtc.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(r.endUtc.toISOString()).toBe('2026-10-01T21:00:00.000Z');
  });

  it('refuses a reversed or oversized range', () => {
    expect(() => rangeFor('2026-10-05', '2026-10-01', 180, 400)).toThrow(RuleError);
    expect(() => rangeFor('2024-01-01', '2026-10-01', 180, 400)).toThrow(RuleError);
  });

  it('the previous period has the same length and ends the day before', () => {
    const r = rangeFor('2026-10-08', '2026-10-14', 180, 400);
    const p = previousRange(r, 400);
    expect(p.from).toBe('2026-10-01');
    expect(p.to).toBe('2026-10-07');
    expect(p.days).toBe(7);
  });

  it('reads the offset setting and rejects nonsense', () => {
    expect(reportOffsetMinutes(undefined)).toBe(180);
    expect(reportOffsetMinutes('0')).toBe(0);
    expect(() => reportOffsetMinutes('plenty')).toThrow();
  });
});

describe('buckets', () => {
  it('week buckets start on Monday', () => {
    expect(bucketStart('2026-10-23', 'week')).toBe('2026-10-19'); // Friday -> Monday
    expect(bucketStart('2026-10-19', 'week')).toBe('2026-10-19');
  });

  it('quarter and year buckets start on the right date', () => {
    expect(bucketStart('2026-11-15', 'quarter')).toBe('2026-10-01');
    expect(bucketStart('2026-05-02', 'quarter')).toBe('2026-04-01');
    expect(bucketStart('2026-05-02', 'year')).toBe('2026-01-01');
  });

  it('lists every bucket, including empty ones, across month and year boundaries', () => {
    expect(bucketKeys('2026-11-30', '2027-02-01', 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
    expect(bucketKeys('2026-10-01', '2026-10-03', 'day')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('caps the number of buckets', () => {
    expect(() => bucketKeys('2000-01-01', '2026-01-01', 'day')).toThrow(RuleError);
  });

  it('addDays crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('profit & loss composition', () => {
  const base = {
    grossSalesCents: 100000n,
    operatingExpensesCents: 20000n,
    collectionsCents: 60000n,
    purchasesCents: 50000n,
    receivablesAtEndCents: 40000n,
    payablesAtEndCents: 30000n,
    discountsCents: null,
    returnsCents: null,
    cogsCents: null,
  };
  const find = (r: ReturnType<typeof buildProfitLoss>, key: string) => r.lines.find((l) => l.key === key)!;

  it('without a cost basis, gross and net profit are unavailable, not estimated', () => {
    const r = buildProfitLoss(base);
    expect(find(r, 'cogs').status).toBe('UNAVAILABLE');
    expect(find(r, 'grossProfit').amount).toBeNull();
    expect(find(r, 'netProfit').amount).toBeNull();
    expect(r.netProfitCents).toBeNull();
  });

  it('with a verified cost basis, profit is computed from net sales, COGS and expenses', () => {
    const r = buildProfitLoss({ ...base, cogsCents: 45000n });
    expect(find(r, 'grossProfit').amount).toBe('550.00');
    expect(find(r, 'netProfit').amount).toBe('350.00');
  });

  it('collections are not revenue, and purchases are not expenses', () => {
    const r = buildProfitLoss({ ...base, cogsCents: 0n });
    expect(find(r, 'netSales').amount).toBe('1000.00');
    expect(find(r, 'operatingExpenses').amount).toBe('200.00');
    expect(r.memo.find((m) => m.key === 'collections')!.amount).toBe('600.00');
    expect(r.memo.find((m) => m.key === 'purchases')!.amount).toBe('500.00');
  });

  it('net sales equal gross sales when discounts and returns are not recorded', () => {
    const r = buildProfitLoss(base);
    expect(find(r, 'netSales').amount).toBe('1000.00');
    expect(find(r, 'discountsReturns').status).toBe('UNAVAILABLE');
  });
});

import { RuleError } from '../finance/rule-error';

/**
 * Date and period rules for analytics and P&L. Framework-free.
 *
 * Time zone: the business day is fixed by REPORT_UTC_OFFSET_MINUTES (default 180 = UTC+3, Ethiopia).
 * Ranges are INCLUSIVE on both ends by calendar day: from 2026-10-01 to 2026-10-31 covers every
 * local day from Oct 1 00:00 to Oct 31 23:59:59.999. Stored timestamps are UTC.
 */

export type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const UNITS: Unit[] = ['day', 'week', 'month', 'quarter', 'year'];
export const MAX_BUCKETS = 400;
const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function reportOffsetMinutes(raw: string | undefined = process.env.REPORT_UTC_OFFSET_MINUTES): number {
  const v = (raw ?? '').trim();
  if (!v) return 180;
  const n = Number(v);
  if (!Number.isInteger(n) || n < -840 || n > 840) throw new Error('REPORT_UTC_OFFSET_MINUTES must be a whole number from -840 to 840');
  return n;
}

/** Parses YYYY-MM-DD and rejects values such as 2026-02-30. Returns the date at UTC midnight. */
export function parseYmd(s: string): Date {
  const m = YMD.exec(s);
  if (!m) throw new RuleError('INVALID_DATE', 'Dates must be in the form YYYY-MM-DD');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (fmtYmd(d) !== s) throw new RuleError('INVALID_DATE', 'That date does not exist');
  return d;
}

export const fmtYmd = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(ymd: string, n: number): string {
  return fmtYmd(new Date(parseYmd(ymd).getTime() + n * DAY_MS));
}

/** Today's calendar date in the business time zone. */
export function localToday(now: Date, offsetMin: number): string {
  return fmtYmd(new Date(now.getTime() + offsetMin * 60_000));
}

export interface Range {
  from: string; // inclusive, local calendar date
  to: string; // inclusive, local calendar date
  days: number;
  startUtc: Date; // inclusive
  endUtc: Date; // exclusive
  offsetMin: number;
}

export function rangeFor(from: string, to: string, offsetMin: number, maxDays: number): Range {
  const f = parseYmd(from);
  const t = parseYmd(to);
  if (f.getTime() > t.getTime()) throw new RuleError('RANGE_ORDER', 'The start date must not be after the end date');
  const days = Math.round((t.getTime() - f.getTime()) / DAY_MS) + 1;
  if (days > maxDays) throw new RuleError('RANGE_TOO_LARGE', `The period can be at most ${maxDays} days`);
  const startUtc = new Date(f.getTime() - offsetMin * 60_000);
  const endUtc = new Date(t.getTime() + DAY_MS - offsetMin * 60_000);
  return { from, to, days, startUtc, endUtc, offsetMin };
}

/** Resolves optional query dates. Defaults: the 30 days ending today, in the business time zone. */
export function resolveRange(opts: { from?: string; to?: string; now: Date; offsetMin: number; maxDays: number; defaultDays?: number }): Range {
  const to = opts.to ?? localToday(opts.now, opts.offsetMin);
  const from = opts.from ?? addDays(to, -((opts.defaultDays ?? 30) - 1));
  return rangeFor(from, to, opts.offsetMin, opts.maxDays);
}

/** The period of the same length immediately before `r`. */
export function previousRange(r: Range, maxDays: number): Range {
  return rangeFor(addDays(r.from, -r.days), addDays(r.from, -1), r.offsetMin, maxDays);
}

/** Start of the bucket (local date) that contains `ymd`. Weeks start on Monday, quarters on Jan/Apr/Jul/Oct. */
export function bucketStart(ymd: string, unit: Unit): string {
  const d = parseYmd(ymd);
  switch (unit) {
    case 'day':
      return ymd;
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return addDays(ymd, -dow);
    }
    case 'month':
      return `${ymd.slice(0, 7)}-01`;
    case 'quarter': {
      const m = Math.floor((d.getUTCMonth()) / 3) * 3 + 1;
      return `${d.getUTCFullYear()}-${String(m).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${d.getUTCFullYear()}-01-01`;
  }
}

function nextBucket(key: string, unit: Unit): string {
  const d = parseYmd(key);
  switch (unit) {
    case 'day':
      return addDays(key, 1);
    case 'week':
      return addDays(key, 7);
    case 'month':
      return fmtYmd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    case 'quarter':
      return fmtYmd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1)));
    case 'year':
      return fmtYmd(new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)));
  }
}

/** Every bucket key from the bucket containing `from` through the bucket containing `to`. Gaps are kept as keys. */
export function bucketKeys(from: string, to: string, unit: Unit): string[] {
  if (!UNITS.includes(unit)) throw new RuleError('INVALID_GRANULARITY', 'Granularity must be day, week, month, quarter or year');
  const keys: string[] = [];
  let key = bucketStart(from, unit);
  while (key <= to) {
    keys.push(key);
    if (keys.length > MAX_BUCKETS) throw new RuleError('TOO_MANY_BUCKETS', `This period has more than ${MAX_BUCKETS} ${unit}s. Choose a longer granularity or a shorter period.`);
    key = nextBucket(key, unit);
  }
  return keys;
}

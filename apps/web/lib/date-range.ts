/** Calendar-date helpers for dashboard and report ranges. Ranges are inclusive on both ends. */

export const MAX_RANGE_DAYS = 732;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD. */
export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return ymdOf(new Date(y, m - 1, d + n));
}

/** Number of calendar days in an inclusive range, or NaN when the input is not valid. */
export function daysInRange(from: string, to: string): number {
  if (!YMD.test(from) || !YMD.test(to)) return NaN;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  if (new Date(a).getUTCDate() !== fd || new Date(b).getUTCDate() !== td) return NaN;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Returns a user-facing problem with the range, or null when it is usable. */
export function rangeProblem(from: string, to: string): string | null {
  if (!YMD.test(from) || !YMD.test(to)) return "Choose both a start and an end date.";
  const days = daysInRange(from, to);
  if (Number.isNaN(days)) return "One of the dates does not exist.";
  if (days < 1) return "The start date must not be after the end date.";
  if (days > MAX_RANGE_DAYS) return `The period can be at most ${MAX_RANGE_DAYS} days.`;
  return null;
}

export const money = (v?: string | number | null) => (v === undefined || v === null ? "—" : `ETB ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

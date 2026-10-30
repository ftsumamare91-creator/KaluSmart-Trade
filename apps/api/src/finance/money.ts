/**
 * Money helpers that work in integer cents (and hundredths of a percent), so fee and payment
 * arithmetic is exact and has no runtime dependency. Amounts are strings such as "1250.50".
 */

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

export function toCents(amount: string): bigint {
  if (!AMOUNT.test(amount)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Percent as hundredths of a percent: "2.5" -> 250. Accepts 0 to 100 with up to two decimals. */
function percentUnits(percent: string): bigint {
  if (!PERCENT.test(percent)) throw new Error(`Invalid percent: ${percent}`);
  const [whole, frac = ''] = percent.split('.');
  const units = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  if (units > 10000n) throw new Error('Percent must be between 0 and 100');
  return units;
}

/** Fee on a total, rounded half-up to the cent. The net is what remains after the fee. */
export function feeFor(totalCents: bigint, percent: string): { feeCents: bigint; netCents: bigint } {
  const numerator = totalCents * percentUnits(percent);
  const feeCents = (numerator + 5000n) / 10000n;
  return { feeCents, netCents: totalCents - feeCents };
}

/** Reads PLATFORM_FEE_PERCENT. Missing means 0, so nothing is charged until it is set. */
export function platformFeePercent(raw: string | undefined = process.env.PLATFORM_FEE_PERCENT): string {
  const value = (raw ?? '').trim() || '0';
  percentUnits(value); // throws with a clear message when invalid
  return value;
}

/** A sale is fully paid when the confirmed payments add up to at least its total. */
export function isFullyPaid(confirmedCents: bigint, totalCents: bigint): boolean {
  return confirmedCents >= totalCents;
}

/** Cash needs no provider reference. Telebirr and bank transfers must carry the receipt reference. */
export function requiresReference(method: 'CASH' | 'TELEBIRR' | 'BANK_TRANSFER'): boolean {
  return method !== 'CASH';
}

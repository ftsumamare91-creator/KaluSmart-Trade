export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Cookies are Secure in production unless explicitly disabled; set COOKIE_SECURE=true for any HTTPS deployment. */
export const isSecureCookie = (): boolean =>
  process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction();

/** New accounts must confirm their email before signing in. On by default in production. */
export const requireEmailVerification = (): boolean =>
  process.env.REQUIRE_EMAIL_VERIFICATION ? process.env.REQUIRE_EMAIL_VERIFICATION === 'true' : isProduction();

/** Public address of the web app, used in email links. */
export const appUrl = (): string =>
  (process.env.APP_URL || (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0]).trim().replace(/\/$/, '');

/** Platform fee: 0 to 100, up to two decimals (for example "2.5"). */
export const isValidFeePercent = (value: string): boolean =>
  /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100;

/** Fails fast at startup. Only variable NAMES appear in the error, never values. */
export function validateEnv(): void {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL');
  if (isProduction()) {
    for (const name of ['AI_SERVICE_TOKEN', 'WEB_ORIGIN']) {
      if (!process.env[name]) problems.push(name);
    }
    if (process.env.COOKIE_SECURE !== 'true') problems.push('COOKIE_SECURE=true');
    if ((process.env.WEB_ORIGIN ?? '').includes('localhost')) problems.push('WEB_ORIGIN (must not point to localhost in production)');
    if (process.env.ENABLE_SWAGGER === 'true') problems.push('ENABLE_SWAGGER must not be true in production');
    if (process.env.EMAIL_PROVIDER !== 'resend') problems.push('EMAIL_PROVIDER=resend');
    if (!process.env.RESEND_API_KEY) problems.push('RESEND_API_KEY');
    if (!process.env.EMAIL_FROM) problems.push('EMAIL_FROM');
    if (!appUrl().startsWith('https://')) problems.push('APP_URL (must be an https:// address in production)');
  }
  const fee = (process.env.PLATFORM_FEE_PERCENT ?? '').trim();
  if (fee && !isValidFeePercent(fee)) problems.push('PLATFORM_FEE_PERCENT (0 to 100, up to 2 decimals)');
  if (problems.length) throw new Error(`Missing or unsafe configuration: ${problems.join(', ')}`);
}

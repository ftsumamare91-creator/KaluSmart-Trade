import { toCents } from './money';

/**
 * Phase 3.5 payment verification rules. Framework-free on purpose: the decisions here are what
 * protect the ledger, so they are unit-tested without a database or HTTP stack.
 *
 * Trust model:
 *  - A provider adapter is the only source of PROVIDER verification, and only when it returns VERIFIED.
 *  - A customer-entered reference, a screenshot, or our own HTTP 200 never verifies anything.
 *  - When a provider cannot be reached or is not configured, the payment stays PENDING for manual review.
 *  - Manual review is recorded as MANUAL, never as provider verification.
 */

export const PAYMENT_CURRENCY = 'ETB';
export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;

export type ProviderMethod = 'TELEBIRR' | 'BANK_TRANSFER';

export type ProviderOutcome =
  | { kind: 'VERIFIED'; transactionId: string; amount: string; currency: string }
  | { kind: 'NOT_FOUND' }
  | { kind: 'UNAVAILABLE'; errorCode: string };

/** The integration boundary. An adapter must never return VERIFIED without a real provider confirmation. */
export interface PaymentProviderAdapter {
  readonly method: ProviderMethod;
  /** True only when every required server-side setting is present. */
  readonly configured: boolean;
  lookup(reference: string): Promise<ProviderOutcome>;
}

type Env = Record<string, string | undefined>;

/** Reference shape accepted for Telebirr and bank references: letters, digits, dash, underscore, slash. */
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9\-_/]{3,79}$/;

export function normalizeReference(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim();
  return v ? v : null;
}

/** Returns an error code when the reference is unusable, or null when it is acceptable. */
export function referenceProblem(raw: string | undefined | null): 'REFERENCE_REQUIRED' | 'REFERENCE_INVALID' | null {
  const v = normalizeReference(raw);
  if (!v) return 'REFERENCE_REQUIRED';
  if (!REFERENCE.test(v)) return 'REFERENCE_INVALID';
  return null;
}

/** Environment variables that a Telebirr integration needs. Names only: values never appear in code or logs. */
export const TELEBIRR_REQUIRED_ENV = ['TELEBIRR_BASE_URL', 'TELEBIRR_APP_ID', 'TELEBIRR_PUBLIC_KEY'] as const;

/**
 * Adapter with no provider behind it. Used for bank transfers (no bank API is available to this project)
 * and as the default for Telebirr until its merchant credentials and API documentation are supplied.
 */
export function unavailableAdapter(method: ProviderMethod, configured: boolean, errorCode: string): PaymentProviderAdapter {
  return {
    method,
    configured,
    async lookup() {
      return { kind: 'UNAVAILABLE', errorCode };
    },
  };
}

/**
 * Telebirr adapter boundary. It reports `configured` only when the settings are present, but it does not
 * call any endpoint: the request format, signing and response shape must come from Telebirr's documentation,
 * which this project does not have. Until then every lookup is UNAVAILABLE, so nothing is verified.
 */
export function telebirrAdapter(env: Env): PaymentProviderAdapter {
  const configured = TELEBIRR_REQUIRED_ENV.every((k) => (env[k] ?? '').trim() !== '');
  return unavailableAdapter('TELEBIRR', configured, configured ? 'PROVIDER_NOT_IMPLEMENTED' : 'PROVIDER_NOT_CONFIGURED');
}

export function createAdapters(env: Env = process.env): Record<ProviderMethod, PaymentProviderAdapter> {
  return {
    TELEBIRR: telebirrAdapter(env),
    BANK_TRANSFER: unavailableAdapter('BANK_TRANSFER', false, 'PROVIDER_NOT_CONFIGURED'),
  };
}

export function providerTimeoutMs(raw: string | undefined = process.env.PAYMENT_PROVIDER_TIMEOUT_MS): number {
  const n = Number((raw ?? '').trim() || DEFAULT_PROVIDER_TIMEOUT_MS);
  if (!Number.isInteger(n) || n < 1000 || n > 60000) throw new Error('PAYMENT_PROVIDER_TIMEOUT_MS must be an integer from 1000 to 60000');
  return n;
}

/**
 * Runs a provider lookup with a deadline. A timeout, a thrown error, or a malformed answer becomes UNAVAILABLE.
 * It never becomes VERIFIED. The raw error text is dropped so it cannot leak into responses or logs.
 */
export async function lookupWithDeadline(adapter: PaymentProviderAdapter, reference: string, timeoutMs: number): Promise<ProviderOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ProviderOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_TIMEOUT' }), timeoutMs);
  });
  try {
    const attempt = Promise.resolve()
      .then(() => adapter.lookup(reference))
      .catch((): ProviderOutcome => ({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_ERROR' }));
    const outcome = await Promise.race([attempt, deadline]);
    return isWellFormed(outcome) ? outcome : { kind: 'UNAVAILABLE', errorCode: 'PROVIDER_BAD_RESPONSE' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isWellFormed(o: unknown): o is ProviderOutcome {
  if (!o || typeof o !== 'object') return false;
  const k = (o as { kind?: unknown }).kind;
  if (k === 'NOT_FOUND') return true;
  if (k === 'UNAVAILABLE') return typeof (o as { errorCode?: unknown }).errorCode === 'string';
  if (k === 'VERIFIED') {
    const v = o as { transactionId?: unknown; amount?: unknown; currency?: unknown };
    return typeof v.transactionId === 'string' && v.transactionId.trim() !== '' && typeof v.amount === 'string' && typeof v.currency === 'string';
  }
  return false;
}

export type AttemptOutcome = 'VERIFIED' | 'REJECTED' | 'FAILED' | 'NOT_FOUND' | 'UNAVAILABLE';

export type ProviderDecision =
  | { action: 'CONFIRM'; attemptOutcome: 'VERIFIED'; transactionId: string; verifiedAmount: string; verifiedCurrency: string }
  | { action: 'FAIL'; attemptOutcome: 'FAILED'; errorCode: string }
  | { action: 'STAY_PENDING'; attemptOutcome: 'NOT_FOUND' | 'UNAVAILABLE'; errorCode: string };

/**
 * Turns a provider answer into a ledger decision for one payment. Only an exact amount and currency match
 * confirms. A definite refusal fails the payment. Anything inconclusive leaves it PENDING for a person.
 */
export function decideProviderOutcome(paymentAmount: string, outcome: ProviderOutcome): ProviderDecision {
  if (outcome.kind === 'NOT_FOUND') {
    return { action: 'STAY_PENDING', attemptOutcome: 'NOT_FOUND', errorCode: 'REFERENCE_NOT_FOUND' };
  }
  if (outcome.kind === 'UNAVAILABLE') {
    return { action: 'STAY_PENDING', attemptOutcome: 'UNAVAILABLE', errorCode: outcome.errorCode };
  }
  if (outcome.currency !== PAYMENT_CURRENCY) {
    return { action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'CURRENCY_MISMATCH' };
  }
  let provided: bigint;
  try {
    provided = toCents(outcome.amount);
  } catch {
    return { action: 'STAY_PENDING', attemptOutcome: 'UNAVAILABLE', errorCode: 'PROVIDER_BAD_RESPONSE' };
  }
  if (provided !== toCents(paymentAmount)) {
    return { action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'AMOUNT_MISMATCH' };
  }
  return {
    action: 'CONFIRM',
    attemptOutcome: 'VERIFIED',
    transactionId: outcome.transactionId.trim(),
    verifiedAmount: outcome.amount,
    verifiedCurrency: outcome.currency,
  };
}

/** Methods that have a provider. Cash is verified by hand only and has no reference to look up. */
export function isProviderMethod(method: string): method is ProviderMethod {
  return method === 'TELEBIRR' || method === 'BANK_TRANSFER';
}

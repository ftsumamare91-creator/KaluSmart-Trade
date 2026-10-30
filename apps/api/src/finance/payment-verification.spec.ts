import {
  createAdapters,
  decideProviderOutcome,
  lookupWithDeadline,
  normalizeReference,
  PaymentProviderAdapter,
  ProviderOutcome,
  providerTimeoutMs,
  referenceProblem,
  telebirrAdapter,
  unavailableAdapter,
} from './payment-verification';

const verified = (over: Partial<{ transactionId: string; amount: string; currency: string }> = {}): ProviderOutcome => ({
  kind: 'VERIFIED',
  transactionId: 'TX123456',
  amount: '500.00',
  currency: 'ETB',
  ...over,
});

const fakeAdapter = (lookup: () => Promise<ProviderOutcome>, configured = true): PaymentProviderAdapter => ({
  method: 'TELEBIRR',
  configured,
  lookup,
});

describe('reference validation (customer-submitted number)', () => {
  it('rejects a missing or blank reference', () => {
    expect(referenceProblem(undefined)).toBe('REFERENCE_REQUIRED');
    expect(referenceProblem('   ')).toBe('REFERENCE_REQUIRED');
  });

  it('rejects references that are too short or contain unsafe characters', () => {
    expect(referenceProblem('ab')).toBe('REFERENCE_INVALID');
    expect(referenceProblem("TX'; DROP TABLE--")).toBe('REFERENCE_INVALID');
    expect(referenceProblem('<script>x</script>')).toBe('REFERENCE_INVALID');
    expect(referenceProblem('x'.repeat(81))).toBe('REFERENCE_INVALID');
  });

  it('accepts typical receipt numbers and trims whitespace', () => {
    expect(referenceProblem('  CE12ABC3456  ')).toBeNull();
    expect(referenceProblem('BANK/2026-0001_A')).toBeNull();
    expect(normalizeReference('  REF-1  ')).toBe('REF-1');
  });
});

describe('decideProviderOutcome: only an exact provider match confirms', () => {
  it('confirms when the provider verifies the exact amount in ETB', () => {
    const d = decideProviderOutcome('500.00', verified());
    expect(d).toEqual({ action: 'CONFIRM', attemptOutcome: 'VERIFIED', transactionId: 'TX123456', verifiedAmount: '500.00', verifiedCurrency: 'ETB' });
  });

  it('fails the payment when the provider amount differs (no partial credit)', () => {
    expect(decideProviderOutcome('500.00', verified({ amount: '499.99' }))).toEqual({ action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'AMOUNT_MISMATCH' });
    expect(decideProviderOutcome('500.00', verified({ amount: '500.01' })).action).toBe('FAIL');
  });

  it('fails the payment on a currency mismatch', () => {
    expect(decideProviderOutcome('500.00', verified({ currency: 'USD' }))).toEqual({ action: 'FAIL', attemptOutcome: 'FAILED', errorCode: 'CURRENCY_MISMATCH' });
  });

  it('treats a malformed provider amount as inconclusive, never as verified', () => {
    const d = decideProviderOutcome('500.00', verified({ amount: 'five hundred' }));
    expect(d).toEqual({ action: 'STAY_PENDING', attemptOutcome: 'UNAVAILABLE', errorCode: 'PROVIDER_BAD_RESPONSE' });
  });

  it('leaves the payment pending when the reference is not found yet', () => {
    expect(decideProviderOutcome('500.00', { kind: 'NOT_FOUND' })).toEqual({ action: 'STAY_PENDING', attemptOutcome: 'NOT_FOUND', errorCode: 'REFERENCE_NOT_FOUND' });
  });

  it('leaves the payment pending when the provider is unavailable', () => {
    expect(decideProviderOutcome('500.00', { kind: 'UNAVAILABLE', errorCode: 'PROVIDER_TIMEOUT' })).toEqual({
      action: 'STAY_PENDING',
      attemptOutcome: 'UNAVAILABLE',
      errorCode: 'PROVIDER_TIMEOUT',
    });
  });
});

describe('lookupWithDeadline: a failing provider never verifies a payment', () => {
  it('passes a real VERIFIED answer through', async () => {
    const out = await lookupWithDeadline(fakeAdapter(async () => verified()), 'TX123456', 1000);
    expect(out.kind).toBe('VERIFIED');
  });

  it('turns a timeout into UNAVAILABLE', async () => {
    const hang = fakeAdapter(() => new Promise<ProviderOutcome>(() => undefined));
    const out = await lookupWithDeadline(hang, 'TX123456', 20);
    expect(out).toEqual({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_TIMEOUT' });
  });

  it('turns a network error into UNAVAILABLE and drops the raw message', async () => {
    const boom = fakeAdapter(async () => {
      throw new Error('ECONNRESET 10.0.0.5 token=secret123');
    });
    const out = await lookupWithDeadline(boom, 'TX123456', 1000);
    expect(out).toEqual({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_ERROR' });
    expect(JSON.stringify(out)).not.toContain('secret123');
  });

  it('turns a synchronous throw into UNAVAILABLE', async () => {
    const sync: PaymentProviderAdapter = { method: 'TELEBIRR', configured: true, lookup: () => { throw new Error('sync'); } };
    expect(await lookupWithDeadline(sync, 'TX1234', 1000)).toEqual({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_ERROR' });
  });

  it('rejects a malformed "verified" object instead of trusting it', async () => {
    const weird = fakeAdapter(async () => ({ kind: 'VERIFIED', amount: '500.00', currency: 'ETB' } as any));
    expect(await lookupWithDeadline(weird, 'TX1234', 1000)).toEqual({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_BAD_RESPONSE' });
  });

  it('rejects an unknown kind', async () => {
    const weird = fakeAdapter(async () => ({ kind: 'OK' } as any));
    expect((await lookupWithDeadline(weird, 'TX1234', 1000)).kind).toBe('UNAVAILABLE');
  });
});

describe('provider adapters without credentials or documentation', () => {
  it('Telebirr is not configured when its settings are missing, and cannot verify anything', async () => {
    const a = telebirrAdapter({});
    expect(a.configured).toBe(false);
    expect(await a.lookup('TX123456')).toEqual({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('Telebirr is configured-but-unimplemented when all settings exist: still never verifies', async () => {
    const a = telebirrAdapter({ TELEBIRR_BASE_URL: 'https://x', TELEBIRR_APP_ID: 'app', TELEBIRR_PUBLIC_KEY: 'key' });
    expect(a.configured).toBe(true);
    expect(await a.lookup('TX123456')).toEqual({ kind: 'UNAVAILABLE', errorCode: 'PROVIDER_NOT_IMPLEMENTED' });
  });

  it('bank transfers have no provider and always stay manual', async () => {
    const adapters = createAdapters({});
    expect(adapters.BANK_TRANSFER.configured).toBe(false);
    expect((await adapters.BANK_TRANSFER.lookup('REF-1234')).kind).toBe('UNAVAILABLE');
  });

  it('an unavailable adapter never returns VERIFIED', async () => {
    const a = unavailableAdapter('BANK_TRANSFER', false, 'PROVIDER_NOT_CONFIGURED');
    expect((await a.lookup('REF-1234')).kind).not.toBe('VERIFIED');
  });
});

describe('provider timeout setting', () => {
  it('defaults to 8 seconds and validates bounds', () => {
    expect(providerTimeoutMs(undefined)).toBe(8000);
    expect(providerTimeoutMs(' 5000 ')).toBe(5000);
    expect(() => providerTimeoutMs('10')).toThrow();
    expect(() => providerTimeoutMs('abc')).toThrow();
  });
});

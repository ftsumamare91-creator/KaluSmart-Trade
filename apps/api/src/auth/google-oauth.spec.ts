import { buildAuthorizeUrl, decodeJwtPayload, googleConfig, verifyIdTokenClaims } from './google-oauth';

const clientId = 'client-123.apps.googleusercontent.com';
const now = 1_800_000_000;
const good = {
  iss: 'https://accounts.google.com',
  aud: clientId,
  exp: now + 300,
  nonce: 'n-abc',
  sub: '1092384756',
  email: 'Abebe@Example.com',
  email_verified: true,
  name: 'Abebe Kebede',
};
const ok = { clientId, nonce: 'n-abc' };

describe('Google ID token checks', () => {
  it('accepts a correct token and normalises the email', () => {
    expect(verifyIdTokenClaims(good, ok, now)).toEqual({ sub: '1092384756', email: 'abebe@example.com', name: 'Abebe Kebede' });
  });
  it('refuses a wrong issuer', () => {
    expect(verifyIdTokenClaims({ ...good, iss: 'https://evil.example' }, ok, now)).toBeNull();
  });
  it('refuses a token for another application (audience)', () => {
    expect(verifyIdTokenClaims({ ...good, aud: 'other-app' }, ok, now)).toBeNull();
    expect(verifyIdTokenClaims({ ...good, aud: ['other-app', clientId] }, ok, now)).toBeTruthy();
  });
  it('refuses an expired token', () => {
    expect(verifyIdTokenClaims({ ...good, exp: now - 1 }, ok, now)).toBeNull();
  });
  it('refuses a replayed token with a different nonce', () => {
    expect(verifyIdTokenClaims(good, { clientId, nonce: 'other' }, now)).toBeNull();
  });
  it('refuses an unverified Google email', () => {
    expect(verifyIdTokenClaims({ ...good, email_verified: false }, ok, now)).toBeNull();
  });
  it('refuses a missing subject', () => {
    expect(verifyIdTokenClaims({ ...good, sub: '' }, ok, now)).toBeNull();
  });
});

describe('Google configuration', () => {
  it('is disabled unless all three values are set', () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REDIRECT_URI: 'http://x/cb' })?.clientId).toBe('a');
  });
  it('builds an authorize URL with state, nonce and the openid scope', () => {
    const url = new URL(buildAuthorizeUrl({ clientId: 'a', clientSecret: 'b', redirectUri: 'http://x/cb' }, 'S1', 'N1'));
    expect(url.searchParams.get('state')).toBe('S1');
    expect(url.searchParams.get('nonce')).toBe('N1');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });
});

describe('JWT payload decoding', () => {
  it('reads the payload and rejects malformed tokens', () => {
    const payload = Buffer.from(JSON.stringify({ sub: '1' })).toString('base64url');
    expect(decodeJwtPayload(`h.${payload}.s`)).toEqual({ sub: '1' });
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });
});

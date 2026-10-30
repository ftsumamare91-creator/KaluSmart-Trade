/**
 * Google OpenID Connect helpers. Pure functions only (no I/O), so the security checks can be unit-tested.
 * The ID token is obtained directly from Google's token endpoint over HTTPS with our client secret,
 * so its signature is not re-verified here; its claims are checked strictly before any account is trusted.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = (env.GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? '').trim();
  const redirectUri = (env.GOOGLE_REDIRECT_URI ?? '').trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthorizeUrl(cfg: GoogleConfig, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  sub?: unknown;
}

export interface VerifiedGoogleUser {
  sub: string;
  email: string;
  name: string;
}

/**
 * Accepts the token only if every check passes: issuer, audience (our client id), expiry, the nonce that we
 * sent in the browser, a stable subject, and a verified email. Anything else is refused with null.
 */
export function verifyIdTokenClaims(
  claims: IdTokenClaims,
  expected: { clientId: string; nonce: string },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifiedGoogleUser | null {
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss)) return null;
  // aud may be a string or an array; it must contain exactly our client id.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
  if (typeof claims.nonce !== 'string' || !constantTimeEqual(claims.nonce, expected.nonce)) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (claims.email_verified !== true) return null;
  if (typeof claims.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) return null;
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 80) : claims.email;
  return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name };
}

/** Decodes the payload of a JWT without verifying it. Only used on a token received directly from Google. */
export function decodeJwtPayload(jwt: string): IdTokenClaims | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as IdTokenClaims) : null;
  } catch {
    return null;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

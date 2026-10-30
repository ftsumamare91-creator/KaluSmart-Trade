# Security controls and open items

## Implemented in code
- Sessions: random 32-byte token, only its SHA-256 hash stored, 12-hour expiry, logout revokes.
- Passwords: bcrypt cost 12; constant-time check for unknown emails; generic login errors.
- Login lockout: keyed by IP + email, 5 failures, 30 s doubling to 15 min (temporary, not permanent).
- Rate limits: login 20/min per IP, registration 5/h per IP, all routes 300/min per IP, AI questions 20/min per user.
- Cross-site guard: write requests carrying the session cookie from a foreign Origin are refused.
- Cookies: HttpOnly, SameSite=Lax, Secure in production (or COOKIE_SECURE=true).
- Swagger only outside production unless ENABLE_SWAGGER=true.
- Startup refuses production configs with missing AI_SERVICE_TOKEN/WEB_ORIGIN, localhost origins, or insecure cookies.
- Tenant scope: every query filters by the session's organization.
- Money visibility: expense figures only for roles with expenses:read (summary and assistant).
- AI service: fails closed without AI_SERVICE_TOKEN; constant-time token compare.
- Uploads: type by magic bytes, size limit, storage path built from verified organization and product.

## Must be done by a person (not in code)
- Rotate every secret that appeared in the original upload archive (API, AI, web env files; DB password; session secrets).
- Treat the old database dump as sensitive; delete it from shared storage.
- Decide on consent and a privacy notice before business data goes to an external AI provider (AI_SEND_BUSINESS_CONTEXT=false disables it).

## Password reset and email verification
- Links are one-time and stored as hashes only: verification 24 h, reset 30 min. Older links are invalidated when a new one is issued.
- Reset signs out every session. Responses never reveal whether an email is registered.
- Production requires EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM and an https APP_URL.
- After the first `prisma migrate dev`, mark accounts that already existed as verified (run once, only if you have existing users):
  `UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE "emailVerifiedAt" IS NULL;`

## Known limitations (planned)
- Lockout and rate limits are in memory: they reset on restart and do not share across instances. Move to a shared store (for example PostgreSQL or Redis) before running several instances.
- No CSRF token; the Origin check and SameSite=Lax cover the main cases.
- No malware scanning on uploads.
- Phone-only or breached-password checks are not implemented.

# KaluSmart Trade architecture

## Trust boundaries
- The browser talks to the NestJS API.
- NestJS owns authentication, authorization, business data, tenant context and audit records.
- PostgreSQL is the source of truth.
- FastAPI is an internal AI gateway. Do not expose provider credentials to the browser.
- Document retrieval should use tenant-filtered PostgreSQL + pgvector once embeddings and document ingestion are implemented.

## Tenant isolation
Every business-owned table includes `organizationId`. Production queries must derive this value from the authenticated session/token, never from an untrusted request body. Add automated cross-tenant access tests before launch.

## Security baseline
- Hash passwords with Argon2id or bcrypt (implementation TODO in auth module).
- Use short-lived access tokens or secure HttpOnly sessions, rotation and revocation.
- Apply DTO validation, rate limiting, CSRF protections where cookie sessions are used, and audit sensitive operations.
- Keep all secrets in environment variables / a secret manager.

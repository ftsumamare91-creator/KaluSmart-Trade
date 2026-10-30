# Verification record (Phase 2.3)

Environment used for this record: a sandbox with no network, no PostgreSQL, no Docker and no installed `node_modules`.
Nothing in this file is a test result unless it is marked PASS with the command that produced it.

## Phase 2.2 fixes and their tests

| Issue | Fix | Test file | Status |
|---|---|---|---|
| E2 generate on install | `postinstall: prisma generate` | (build check) | NOT RUN |
| E3 signup when email fails | `safeSendVerification` in `register` | `src/auth/auth.service.spec.ts` | NOT RUN |
| E4 resend when email fails | `safeSendVerification` in `resendVerification` | `src/auth/auth.service.spec.ts` | NOT RUN |
| E5 invalid PLATFORM_FEE_PERCENT | `validateEnv` + `isValidFeePercent` | `src/common/config.spec.ts` | NOT RUN |
| E6 Prisma validation error | filter returns 400 | `src/common/all-exceptions.filter.spec.ts` | NOT RUN |
| E7 payment null check (unconfirmed) | explicit NotFound | none yet | NOT RUN |
| Dockerfile order | schema copied before `npm ci` | (docker build) | NOT RUN |

## Commands to run (on a machine with the database and network)

```bash
cd "KaluSmart Trade/apps/api"
npm ci                                   # postinstall runs prisma generate
npm test                                 # unit tests (all spec files)
npm run build                            # TypeScript build (tsconfig.build.json)
git -C ../.. diff --check                # whitespace / conflict markers
cd ../.. && docker compose build api     # Dockerfile order check
```

Integration tests against PostgreSQL are NOT present yet. They must use a dedicated test database and must never point at real data.

## Results in this sandbox

| Check | Status | Reason |
|---|---|---|
| Package registry reachable | BLOCKED | No network |
| `npm ci`, `npm test`, `npm run build` | BLOCKED | No dependencies installed |
| Prisma client generation | BLOCKED | Needs the Prisma engine download |
| Docker build | BLOCKED | No Docker |
| `git diff --check` on the last commits | PASS | Ran successfully |
| Static review of the spec files | NEEDS REVIEW | See below |

## Static review findings (not test results)

1. `all-exceptions.filter.spec.ts` builds `Prisma.PrismaClientValidationError(message, { clientVersion })`. The constructor signature must be checked against the installed Prisma version (6.19.x). NEEDS REVIEW.
2. `auth.service.spec.ts` needs the generated Prisma types and the `bcryptjs` package. Both come from `npm ci`. NEEDS REVIEW until it runs.
3. No tests yet for: AI-service timeout and malformed responses, cross-tenant access through HTTP, permission denial (403) through HTTP, and E7. These are gaps, not failures.
4. No AI-service (Python) tests exist.

## Database and security
- No database was touched. No schema change was made in this phase.
- Authentication, permissions and tenant scope were not modified in this phase.

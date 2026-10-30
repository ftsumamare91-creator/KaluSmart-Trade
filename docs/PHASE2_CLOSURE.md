# Phase 2 closure report (500 Internal Server Errors)

**Overall status: PARTIALLY CLOSED. Verification is BLOCKED.**

Code changes exist for every Phase 2.1 issue, but none has been executed. Closure requires passing tests and runtime checks, which this environment cannot run (no network, no installed dependencies, no Docker, no PostgreSQL).

## A. Issue register

| ID | Priority | Phase 2.1 status | Affected route | Fix in code | Regression test | Latest result | Status |
|---|---|---|---|---|---|---|---|
| E1 | P0 | LIKELY | All data routes | None possible here; needs `prisma migrate dev` | none | not run | OPEN (user action) |
| E2 | P1 | LIKELY | All routes, on a fresh install | `postinstall: prisma generate` | build check | not run | NEEDS REVIEW |
| E3 | P1 | CONFIRMED | `POST /api/auth/register` | email failure logged, account kept | `auth.service.spec.ts` | not run | NEEDS REVIEW |
| E4 | P1 | CONFIRMED | `POST /api/auth/resend-verification` | email failure logged, same reply | `auth.service.spec.ts` | not run | NEEDS REVIEW |
| E5 | P2 | LIKELY | `POST /api/sales`, startup | `validateEnv` checks fee | `config.spec.ts` | not run | NEEDS REVIEW |
| E6 | P2 | CONFIRMED | any route with invalid input | Prisma validation → 400 | `all-exceptions.filter.spec.ts` | not run | NEEDS REVIEW |
| E7 | P3 | UNCONFIRMED | `POST /api/payments/:id/confirm` | explicit NotFound check (changed without proof) | none | n/a | NEEDS REVIEW |
| Docker | — | regression from E2 | `docker compose build api` | schema copied before `npm ci` | docker build | not run | NEEDS REVIEW |

No issue is CLOSED: a closed status needs a passing test, and none has run.

## B. Automated test results

| Command | Result | Reason |
|---|---|---|
| `npm ci` (apps/api) | BLOCKED | no network |
| `npm test` (apps/api) | BLOCKED | dependencies not installed |
| `npm run build` (apps/api) | BLOCKED | dependencies not installed |
| `npm run build` (apps/web) | BLOCKED | dependencies not installed |
| `npm run lint` (apps/web) | BLOCKED | dependencies not installed; ESLint not added to devDependencies |
| AI-service tests | NOT RUN | no test suite exists |
| `git diff --check 61e68d2 HEAD` | PASS | ran successfully |

## C. Runtime verification

Not performed. No service is running and no test database exists. Health endpoints (`/api/health`, AI `/health`) and the 500 scenarios were not exercised.

## D. Static checks (these are not test results)

- Uncommitted files: 0.
- Debug output or unsafe logging added in Phase 2: none found.
- Secret-like literals added in Phases 1–2: none found.
- No `.env`, dump or backup file is tracked by Git (examples only).
- Fixes are present in the code: `postinstall`, `safeSendVerification`, `isValidFeePercent`, `PrismaClientValidationError` mapping, payment NotFound check.

## E. Database and security

- Database: no data changed, no schema change, no migration run.
- Authentication, authorization and tenant scope: not modified in Phase 2. Runtime checks to confirm them were NOT run.

## F. Remaining work

1. Run on a machine with network and PostgreSQL: `npm ci`, `npx prisma migrate dev --name init`, `npm test`, `npm run build`, `docker compose build api`.
2. Send the full output of any failing command.
3. Add tests that are still missing: cross-tenant access over HTTP, 403 over HTTP, AI-service timeout and malformed response, and E7.
4. Add ESLint to `apps/web` devDependencies (needs an approved lockfile update).
5. Rotate every secret that was in the original upload archive.
6. Check the `PrismaClientValidationError` constructor against the installed Prisma version.

## G. Changed files in Phase 2

- `apps/api/package.json`: `postinstall` script added.
- `apps/api/Dockerfile`: schema copied before `npm ci`.
- `apps/api/src/common/config.ts`: fee validation in `validateEnv`.
- `apps/api/src/common/all-exceptions.filter.ts`: Prisma validation → 400.
- `apps/api/src/auth/auth.service.ts`: safe verification email on register and resend.
- `apps/api/src/finance/payments.controller.ts`: explicit NotFound on confirm.
- New specs: `auth.service.spec.ts`, `all-exceptions.filter.spec.ts`, `config.spec.ts`.
- New docs: `TROUBLESHOOTING.md`, `VERIFICATION.md`, this file.

## H. Recommendation

Do not mark Phase 2 CLOSED yet. The fixes are written and reviewed by reading, but none has been executed. Close Phase 2 after section F items 1 and 2 pass on a machine that can run them.

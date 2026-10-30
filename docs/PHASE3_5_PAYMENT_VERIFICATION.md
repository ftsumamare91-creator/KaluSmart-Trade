# Phase 3.5: Payment verification (Telebirr and bank transfer)

## Status at a glance

| Part | State |
|---|---|
| Verification states, attempt history, manual review | Built (API) |
| Provider adapter boundary | Built |
| Telebirr provider connection | **Not connected.** No API documentation, merchant ID or keys are in the project. Every lookup returns `UNAVAILABLE`. |
| Bank provider connection | **Not connected.** Manual review only. |
| Provider webhook / callback | **Not built.** No signature method is documented, so no callback is accepted. |
| Web UI for verification | **Not built** in this pass (API only). |
| Migration | **Not generated.** See "Database" below. |
| Tests | Pure rules: run and passing (20/20, see below). Controller specs: written, **not executed** (dependencies could not be installed). |

## Trust rules

- Only a provider `VERIFIED` answer, with the exact amount and currency `ETB`, can confirm a payment as `PROVIDER`.
- A customer-entered reference, a screenshot, or our own HTTP 200 never verifies anything.
- A timeout, network error, malformed answer, or missing configuration is `UNAVAILABLE`. The payment stays `PENDING`.
- A manual decision is recorded as `MANUAL`, with the reviewer, time and an attempt row. It is never shown as provider verification.
- Customers have no login, so they cannot verify. Only roles with `payments:confirm` (ADMIN, ACCOUNTANT) can decide.

## Status lifecycle

```
PENDING --verify-provider: VERIFIED--> CONFIRMED (verificationMethod = PROVIDER)
PENDING --verify-provider: amount/currency mismatch, duplicate, sale cancelled, over total--> FAILED
PENDING --verify-provider: not found / unavailable / timeout--> PENDING (attempt recorded)
PENDING --confirm (manual)--> CONFIRMED (verificationMethod = MANUAL)
PENDING --reject (manual)--> REJECTED
```

`FAILED`, `REJECTED` and `CONFIRMED` are terminal. Only `CONFIRMED` counts as money received.

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/payments/:id/verify-provider` | payments:confirm | Ask the provider adapter. Returns `{ payment, outcome, errorCode }`. |
| POST | `/api/payments/:id/confirm` | payments:confirm | Manual confirmation (MANUAL). |
| POST | `/api/payments/:id/reject` | payments:confirm | Manual rejection. |
| GET | `/api/payments/:id/verification-attempts` | payments:confirm | Attempt history for one payment. |

Recording (`POST /api/sales/:saleId/payments`) now also checks the reference format: 4 to 80 letters, digits, `-`, `_` or `/`.

## Idempotency and concurrency

- Repeating a provider check on a provider-verified payment returns the stored result and calls no provider.
- A second manual confirm or reject returns 400 and adds no attempt.
- Provider and manual decisions both lock the sale row and re-read the payment before deciding, so only one can win.
- A provider transaction ID is unique per organization and method. A duplicate is refused as `DUPLICATE_TRANSACTION`, and the database unique index is the final guard.
- A provider lookup happens outside the database transaction. Two checks in parallel can both call the provider, but only one can change the payment.

## Database

Schema changes (`apps/api/prisma/schema.prisma`):
- `PaymentStatus` gains `FAILED`.
- `Payment` gains `verificationMethod`, `verifiedAmount`, `verifiedCurrency`, `providerTransactionId`, and a unique index on `(organizationId, method, providerTransactionId)`. The decision time reuses the existing `confirmedAt`.
- New table `PaymentVerificationAttempt`. It stores outcome and a stable `errorCode`, never raw provider text or secrets.

Migration status: the project has no migration history (`prisma/` has no `migrations` folder). A migration that only adds this delta would fail on an empty database, so none was generated. Apply it the way the project's setup notes describe:

1. On a development database only: `npx prisma migrate dev --name init` (baseline), then `npx prisma migrate dev --name payment_verification`.
2. Data backfill: `apps/api/prisma/manual/backfill-verification-method.sql` marks existing confirmed payments as MANUAL. It is not run automatically. It needs approval and a backup first.

## Configuration

| Variable | Purpose |
|---|---|
| `TELEBIRR_BASE_URL`, `TELEBIRR_APP_ID`, `TELEBIRR_PUBLIC_KEY` | Telebirr settings. Names only in the code. Values stay in `.env`. Telebirr shows "configured" only when all three are set, and it still does not call the provider. |
| `PAYMENT_PROVIDER_TIMEOUT_MS` | Provider deadline, 1000 to 60000, default 8000. |

## What is needed to connect a real provider

1. Telebirr: merchant account, API documentation (request format, signing, lookup endpoint, response format), test environment, and the public key.
2. Bank: which bank, and whether it offers an API. If not, bank stays manual.
3. Then implement `telebirrAdapter.lookup` against that documentation, and add tests with recorded provider responses (test-only, never in production code).

## Tests

- `apps/api/src/finance/payment-verification.spec.ts`: 20 tests covering reference validation, the decision rules, timeouts and errors, adapter configuration, and the timeout setting. Run with a jest-compatible shim in this environment: **20 passed, 0 failed**.
- `apps/api/src/finance/payments.controller.spec.ts`: Phase 3.4 tests plus new Phase 3.5 tests (manual review, provider checks, duplicates, cross-tenant access, history). **Not executed.** Run `npm test` in `apps/api` to execute them.

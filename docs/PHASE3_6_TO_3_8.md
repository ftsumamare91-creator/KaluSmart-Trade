# Phases 3.6–3.8: expenses, suppliers and purchases, debt ledgers

## Status

| Phase | Status | Notes |
|---|---|---|
| 3.6 Expenses | **PARTIAL** | API complete. No web screen. Receipt attachments not built. |
| 3.7 Suppliers & purchases | **PARTIAL** | API complete. No web screen. Purchase cancel of a received purchase reverses stock. |
| 3.8 Debt ledgers | **PARTIAL** | API complete. Customer and supplier balances computed on the server. No web screen. |

Not verified in this environment: dependencies could not be installed, so Prisma, NestJS and the controller specs did not run. Pure-logic tests ran and passed (see Tests). Phase 3.5 is also still unverified.

## Business decisions I made (change any of these)

Approval for the schema changes is taken from your instruction to include the proposed design. Decisions the readiness report left open, and the default I used:

1. Currency: ETB only (no per-record currency).
2. Expense payment methods: reuse CASH / TELEBIRR / BANK_TRANSFER. Reference required for non-cash.
3. Receipt attachments: not built. Deferred.
4. Expenses are voided, never deleted. Void needs ADMIN or MANAGER and a reason.
5. Cancelling a received purchase: allowed only with a reason, no confirmed supplier payment, and no stock already sold. Stock is reversed with a `PURCHASE_REVERSAL` movement.
6. Credit due dates: not stored. Overdue status not built.
7. Supplier payments: included. Each one is recorded against one RECEIVED purchase, with the same PENDING → CONFIRMED/REJECTED flow as customer payments. Manual only, no provider.
8. Opening stock: the current `Product.quantity` stands as the opening balance. No backfill was run.
9. Supplier invoice number is unique per supplier. A duplicate is refused.
10. Suppliers are deactivated, never deleted.

## Schema changes (`apps/api/prisma/schema.prisma`)

- `Expense`: `paymentMethod`, `reference`, `status` (ACTIVE / VOIDED), `createdById`, `updatedAt`, `voidedAt`, `voidedById`, `voidReason`. New enum `ExpenseStatus`.
- `Supplier` (new): name, phone, email, address, notes, isActive, timestamps.
- `Purchase` (new): supplierId, reference (`P-…`), supplierReference, status (DRAFT / RECEIVED / CANCELLED), total, notes, purchasedAt, idempotencyKey, created / received / cancelled actor and time fields, cancelReason. Unique: `(organizationId, reference)`, `(organizationId, idempotencyKey)`, `(organizationId, supplierId, supplierReference)`.
- `PurchaseItem` (new): productId, quantity, unitCost, lineTotal. Unit cost stored per line.
- `StockMovement` (new): productId, delta, quantityAfter, reason (SALE / PURCHASE_RECEIPT / PURCHASE_REVERSAL / ADJUSTMENT), purchaseId, saleId, note, createdById. One row per stock change.
- `SupplierPayment` (new): supplierId, purchaseId, method, status (reuses `PaymentStatus`), amount, reference, recordedById, confirmedById, confirmedAt. Unique `(organizationId, method, reference)`.
- `Sale.customerId` (nullable, `SetNull` when a customer is deleted; the `customerName` snapshot stays).

**Migration: not generated.** The project has no migration history. Apply the Phase 3.5 steps first, then run `prisma migrate dev --name phases_3_6_to_3_8` on a development database. Nothing was run against any database.

**Backfill: none.** Existing expenses get `status = ACTIVE`. Existing sales keep `customerId = NULL` (walk-in). No stock history is invented.

## Balance formulas

- Sale receivable = `total − Σ payments where status = CONFIRMED`. Only sales with status CONFIRMED or PAID count. DRAFT and CANCELLED do not.
- Customer balance = Σ of its sales' receivables. Walk-in sales (no customer) form their own row, so the grand total equals every receivable sale.
- Purchase payable = `total − Σ supplier payments where status = CONFIRMED`. Only RECEIVED purchases count.
- Supplier balance = Σ of its RECEIVED purchases' payables.
- PENDING amounts never reduce a balance. They only reserve room, so two pending payments cannot promise more than is owed.
- A balance never goes below zero. Overpayment is reported separately.

## Double-counting rules

- An expense is operating spend. It is never a purchase and never a payable.
- A purchase affects stock and supplier payables. It is never also an expense.
- Each supplier payment belongs to exactly one purchase, so payables are never counted twice.
- Each customer payment still belongs to exactly one sale (unchanged from Phase 3.4).

## Stock integrity

- Receiving a purchase: row lock on the purchase, status check, one conditional `UPDATE` per product, one `StockMovement` per line, status change to RECEIVED. All in one transaction. A second receive is refused.
- Sales and manual adjustments now also write a `StockMovement` in the same transaction as the stock change.
- Cancelling a received purchase reverses stock only if the reversal would not go negative.

## Endpoints

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/api/expenses`, `/api/expenses/:id` (GET), `PATCH /api/expenses/:id` | expenses:read / expenses:write |
| POST | `/api/expenses/:id/void` | expenses:void (ADMIN, MANAGER) |
| GET / POST | `/api/suppliers`, `PATCH /api/suppliers/:id`, `GET /api/suppliers/:id` | suppliers:read / suppliers:write |
| GET / POST | `/api/purchases`, `GET /api/purchases/:id`, `PATCH /api/purchases/:id` (draft only) | purchases:read / purchases:write |
| POST | `/api/purchases/:id/receive` | purchases:receive (ADMIN, MANAGER) |
| POST | `/api/purchases/:id/cancel` | purchases:receive |
| GET | `/api/ledger/receivables`, `/api/ledger/receivables/customers/:customerId` | ledger:read |
| GET | `/api/ledger/payables`, `/api/ledger/payables/suppliers/:supplierId` | ledger:read |
| POST | `/api/supplier-payments` | payables:write (ADMIN, MANAGER, ACCOUNTANT) |
| GET | `/api/supplier-payments` | ledger:read |
| POST | `/api/supplier-payments/:id/confirm`, `/reject` | payments:confirm |

Customer payments continue to use the existing Phase 3.4/3.5 endpoints.

## Errors

Business refusals return HTTP 400 with `{ code, message }`. Codes include `NOT_DRAFT`, `OVER_BALANCE`, `STOCK_NEGATIVE`, `STOCK_ALREADY_SOLD`, `DUPLICATE_PRODUCT`, `EXPENSE_VOIDED`, `PURCHASE_NOT_RECEIVED`, `DUPLICATE_SUPPLIER_INVOICE`, and `DUPLICATE_REFERENCE`. Messages are safe for end users. No stack traces are returned.

## Limitations

- Ledger endpoints load all receivable and payable rows for the organization in one query. This is fine at small scale and needs paging or SQL aggregation before large volumes.
- Customer deletion unlinks sales (`SetNull`), so those sales appear as walk-in in the ledger. Delete a customer only when you accept that.
- No web UI for any of 3.6–3.8.
- No separation-of-duties check: a user with both `purchases:write` and `purchases:receive` (ADMIN, MANAGER) can create and receive the same purchase.
- Rollback and concurrent receiving are enforced by the database lock and the status guard. Neither has been run against PostgreSQL here.

## Tests

- `finance/ledger.spec.ts`, `inventory/purchase-rules.spec.ts`, `finance/expense-rules.spec.ts`: pure rules. **Ran and passed: 30 of 30** under a jest-compatible shim.
- `purchases/purchases.controller.spec.ts`, `finance/expenses.controller.spec.ts`: mock-based. Written, **not executed**. They do not test rollback or real row locks.
- `sales/sales.controller.spec.ts`: mock updated for the `RETURNING` stock update and the movement write. **Not executed.**
- Phase 3.4/3.5 `payment-verification.spec.ts`: **20 of 20 pass** under the same shim.

Run `npm test` in `apps/api` to execute the jest specs. Then run `npx prisma validate` and `npm run build`.

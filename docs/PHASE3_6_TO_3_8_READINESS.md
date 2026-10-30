# Phases 3.6 to 3.8: readiness check and approval request

Status: **BLOCKED. No code changed.** The readiness checks found that every phase needs a schema change, and the earlier payment phase is not yet verified. Per the brief, implementation stops here until the approvals below are given.

## 0. Workspace

- The upload is not a git repository (`git status` unavailable). User changes cannot be diffed against a baseline; the zip is the baseline.
- Phase 3.5 changes are in place but unverified: controller tests were not executed and no migration has been applied.
- Phase 3.1 audit and the 3.2–3.4 results were not included in the upload.

## 1. Feature classification (from code)

| Area | Status | Evidence |
|---|---|---|
| Expenses | PARTIAL | `Expense` has category, description, amount, spentAt only. API: list (take ≤ 100, no filters or pagination cursor) and create. No edit, no status, no payment method, no currency, no reference, no creator, no receipt link. No web screen. |
| Expense receipts | MISSING | `BusinessDocument` exists but is not linked to anything. Upload pipeline exists only for product images/3D models. |
| Suppliers | MISSING | No model, API or UI. |
| Purchases | MISSING | No model, API or UI. |
| Stock movements | PARTIAL | `Product.quantity` only. No movement table. Adjustments are logged in `AuditEvent`, and sales deduct stock inside a transaction with no movement record. History cannot be reconstructed reliably. |
| Customers | PARTIAL | `Customer` exists, but `Sale` has only `customerName` (a string) and no `customerId`. Sales cannot be tied to a customer account. |
| Customer receivables | BLOCKED | Needs `Sale.customerId`. Due dates are not stored (correctly not invented). |
| Supplier payables | MISSING | Depends on purchases and a supplier payment model. |
| Confirmed payments (3.4/3.5) | IMPLEMENTED, UNVERIFIED | Code exists. Tests not executed. Migration not applied. |

## 2. Readiness stop conditions triggered

1. **Stock history is not reliable enough for purchases.** The brief says to stop before purchase implementation in this case. A movement ledger is needed first.
2. **Phase 3.5 is unverified.** Balances and receivables rely on confirmed payments, and that logic has not been run.
3. **Every phase needs a schema change.** Under the brief, each one requires explicit approval first.

## 3. Proposed schema changes (for approval, not applied)

**Expenses (3.6)**
- Add `status` (ACTIVE / VOIDED), `voidedAt`, `voidedById`, `paymentMethod`, `reference`, `createdById`, `updatedAt`.
- Void instead of delete. Expenses are never removed.
- Optional `receiptDocumentId` linking to `BusinessDocument` (only if you approve receipt uploads now).

**Suppliers (3.7)**
- `Supplier`: name, phone, email, address, notes, isActive, timestamps. Index `(organizationId, name)`.
- Uniqueness: none by default. A unique name is risky without checking existing data.

**Purchases (3.7)**
- `Purchase`: supplierId, supplierReference, purchasedAt, status (DRAFT / RECEIVED / CANCELLED), total, createdById, receivedAt, receivedById, idempotencyKey. Unique `(organizationId, idempotencyKey)`.
- `PurchaseItem`: purchaseId, productId, quantity, unitCost, lineTotal. Unit cost is stored per line, so historical cost is preserved.
- Receiving sets RECEIVED in a single transaction, with a guarded update so it can happen only once.

**Stock movements (3.7)**
- `StockMovement`: productId, delta, quantityAfter, reason (SALE / PURCHASE_RECEIPT / ADJUSTMENT / REVERSAL), referenceType, referenceId, createdById, createdAt. Each stock change writes one row in the same transaction.
- Historical stock before this table cannot be reconstructed. The first row is an opening balance, set by approval.

**Customers (3.8)**
- `Sale.customerId` (nullable FK to `Customer`). Walk-in sales keep it NULL. Existing rows are not auto-assigned.

**Supplier payments (3.8)**
- `SupplierPayment`: supplierId, purchaseId (nullable, for purchase-level allocation), amount, method, reference, status (PENDING / CONFIRMED / REJECTED / FAILED, the same vocabulary as customer payments), recordedById, confirmedById, timestamps. Unique `(organizationId, method, reference)`.
- Customer payments remain on `Payment`. No new allocation table, because a payment already belongs to one sale.

## 4. Balance formulas (proposed)

- Customer receivable per sale = `Sale.total − Σ Payment.amount where status = CONFIRMED`. Only `CONFIRMED` counts. PENDING, REJECTED, FAILED and unverified are excluded.
- Customer receivable per customer = Σ of the above across sales where `Sale.customerId` = that customer and status is not CANCELLED.
- Supplier payable per purchase = `Purchase.total − Σ SupplierPayment.amount where status = CONFIRMED`, for RECEIVED purchases only.
- Expenses are not payables. Paid or unpaid, they stay in operating expenses.
- A purchase is never also an expense: inventory purchases affect stock and payables, not the expense table.

## 5. Decisions needed before implementation

1. Approve the schema changes in section 3 (all of them, or a subset)?
2. Currency: ETB only, or store a currency per record?
3. Expense payment methods: reuse CASH / TELEBIRR / BANK_TRANSFER?
4. Expense receipts now (requires upload pipeline work), or later?
5. Voiding rules: who may void an expense or a purchase, and is a reason required?
6. Cancelling a RECEIVED purchase: reverse stock with a REVERSAL movement (recommended), or disallow?
7. Do customer sales on credit need a due date? If yes, what field and default?
8. Supplier payments in this release, or deferred?
9. Opening stock balance for the StockMovement table: take current `Product.quantity` as the opening balance?
10. Phase 3.5: run `npm test` and apply the schema, or accept it as is?

## 6. Actions awaiting explicit approval

- Schema changes in section 3 (Expense, Supplier, Purchase, PurchaseItem, StockMovement, Sale.customerId, SupplierPayment).
- Migration generation and application (the project has no migration history; a baseline is needed first).
- The Phase 3.5 backfill script.
- Any new dependency (none is required so far).

## 7. Phase status

- 3.6 Expenses: **BLOCKED** (schema approval).
- 3.7 Purchases & Suppliers: **BLOCKED** (schema approval; stock-history readiness).
- 3.8 Debt ledgers: **BLOCKED** (schema approval; depends on 3.5 verification and 3.7).

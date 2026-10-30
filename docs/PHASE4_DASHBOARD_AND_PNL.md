# Phase 4: Dashboard and Profit & Loss

## Status

| Area | Status | Notes |
|---|---|---|
| Mock data removed from the Overview dashboard | IMPLEMENTED | Hard-coded KPIs, change percentages, revenue chart, recent activity, insight narrative and the period selector were removed. |
| Analytics API (overview, series, products, inventory, top balances) | IMPLEMENTED | Server-side aggregates, tenant scoped, validated ranges. Not executed here. |
| Profit & Loss report | PARTIAL | Revenue, operating expenses, collections, purchases and balances are reported. COGS, gross profit and net profit are **unavailable** (see below). |
| Customer and supplier summaries | PARTIAL | Top balances use the ledger rules. Supplier summary uses `/ledger/payables`. |
| Tests | PARTIAL | Date and P&L composition rules: **15 of 15 passed** under a jest-compatible shim. Controller specs written, **not executed**. No UI tests. |
| Build and type checks | NOT RUN | Dependencies could not be installed. TSX syntax checked only. |

## Why profit is unavailable

Sale lines store the **selling price** at the time of sale. They do not store the **cost** of the stock sold. Products store only the current selling price, and purchases store unit cost per purchase line. Nothing links a sold unit to the cost it was bought at, and no costing method (FIFO, average) is implemented. Using current product price or latest purchase cost as COGS would be an invented figure, so the report marks COGS, gross profit and net profit as unavailable.

To make profit verifiable, a future phase would need, at minimum, a cost snapshot on each sale line (approval required; a schema change) and an agreed costing policy.

## Revenue, collections, purchases and balances

- **Sales (revenue):** totals of sales with status CONFIRMED or PAID, dated by `soldAt`. DRAFT and CANCELLED are excluded.
- **Collections:** confirmed customer payments, dated by `confirmedAt`. Cash received, not revenue. Pending, rejected and failed payments are excluded.
- **Purchases:** received supplier purchases, dated by `receivedAt`. Inventory, not an operating expense.
- **Operating expenses:** ACTIVE expenses, dated by `spentAt`. Voided expenses are excluded.
- **Receivables and payables at period end:** balances as of the end of the period. Only confirmed payments reduce them. Receivables are per sale, clipped at zero; payables are per purchase, for RECEIVED purchases only.

No figure is counted in two places: a purchase is never an expense, a payment is never revenue, and a balance is never added to revenue.

## Dates and time zone

- Dates are local calendar days. `REPORT_UTC_OFFSET_MINUTES` sets the business day offset from UTC (default 180, Ethiopia). Changing it changes which day a timestamp falls on.
- Both ends of a range are inclusive. `from=2026-10-01&to=2026-10-31` covers 1 Oct 00:00 to 31 Oct 23:59:59.999 local time.
- Maximum range: 732 days. Maximum buckets in a series: 400.
- Default when no dates are given: the 30 days ending today.

## Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/analytics/overview?from&to&compare` | analytics:read (ADMIN, MANAGER, ACCOUNTANT) | Totals, collections, expenses, purchases, balances at period end, low-stock count, previous-period comparison, 10 most recent transactions. |
| GET | `/api/analytics/timeseries?from&to&granularity` | analytics:read | Per bucket: sales count and value, collections, expenses, purchases. Granularity: day, week, month, quarter, year. |
| GET | `/api/analytics/products?from&to&limit` | analytics:read | Best-selling products by sales value. Grouped on sale lines, so each line counts once. |
| GET | `/api/analytics/inventory?limit` | products:read (all roles) | Stock totals and low-stock list. No money fields. |
| GET | `/api/analytics/top-balances?limit` | reports:read | Largest customer balances and total receivables, as of now. |
| GET | `/api/reports/profit-loss?from&to&granularity` | reports:read | P&L lines with status, memo items, per-period rows, consistency check, limitations. |

The existing `/api/summary` endpoint is unchanged but no longer used by the dashboard.

## Reconciliation

The P&L endpoint computes totals independently of the period rows. It returns `reconciled` flags. The report shows whether the rows add up to the totals. A `false` flag means the report should not be relied on.

## Known limitations

- Balances at a past date are reconstructed from current rows. A sale or purchase cancelled after that date is shown as excluded, so past balances are approximate. The response sets `exact: false` when the period ends before now.
- Discounts, returns and refunds are not recorded by the application. Net sales equals gross sales, and the report says so.
- Customer and supplier summaries read whole balance sets for the organization. Fine at small scale; needs SQL-side limits for large volumes.
- The dashboard text is English. The existing Amharic/Afan Oromo/Tigrinya translations cover the main navigation only.
- Currency is ETB (the only currency the application defines).
- Authorization is enforced by the API. The UI hides finance widgets for employees, but that is a convenience, not the control.

## Files

- `apps/api/src/analytics/analytics-rules.ts`, `profit-loss.ts`: date rules and P&L composition (pure).
- `apps/api/src/analytics/analytics.controller.ts`: endpoints and aggregates.
- `apps/api/src/analytics/analytics-rules.spec.ts`: 15 pure tests.
- `apps/api/src/analytics/analytics.controller.spec.ts`: mock-based tenant and validation tests (not executed).
- `apps/api/src/common/permissions.ts`: `analytics:read` added.
- `apps/web/components/DashboardOverview.tsx`: live dashboard.
- `apps/web/components/ProfitLossReport.tsx`: P&L screen (shown under Business Intelligence).
- `apps/web/lib/date-range.ts`: range validation and formatting.
- `apps/web/app/page.tsx`: removed fake dashboard content and fake period selector; wired the live components.
- `apps/web/app/globals.css`: small styles for the new components.

## Verification

- `analytics-rules.spec.ts`: 15 of 15 pass (shim).
- Phase 3.5 payment-verification rules: 20 of 20 pass (shim).
- Phases 3.6–3.8 pure rules: 30 of 30 pass (shim).
- Not run: `npm test`, `npm run build`, `next build`, `tsc` with project types, eslint, browser tests.

Run in `apps/api`: `npm install && npx prisma validate && npm test && npm run build`. Run in `apps/web`: `npm install && npx tsc --noEmit && npm run lint && npm run build`.

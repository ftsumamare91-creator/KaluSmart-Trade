# Project status

Status is based on reading the code. Nothing in this revision has been compiled or run in the authoring environment, so the first `npm run build`, `prisma migrate`, and `npm test` may report errors that need fixing.

## Working in code (needs a local run to confirm)
- **Auth:** sign up (creates organization + Admin), sign in, sign out, current user (`/api/auth/*`). Server-side sessions, HttpOnly cookie, lockout after failed attempts.
- **Roles:** ADMIN, MANAGER, ACCOUNTANT, EMPLOYEE, one permission matrix enforced on the API and mirrored in the UI menu.
- **Users (Admin):** create staff accounts inside the organization, change role, remove access (revokes their sessions).
- **Customers:** list, search, create, edit, delete (role-gated).
- **Inventory:** products, stock adjustments that cannot go below zero, low-stock highlighting.
- **Sales:** recording a sale checks stock and reduces it in one transaction; prices come from the database.
- **Expenses and summary:** expenses (Admin/Manager/Accountant); dashboard figures for 30 days come from stored records.
- **Audit log** (Admin): viewable via `/api/audit`.
- **Backups:** `scripts/backup.sh`, `scripts/restore.sh`.
- **Permission tests:** `apps/api/src/common/permissions.spec.ts` (run with `npm test`).
- **Bilingual UI and dark mode** on the screens above. Some dashboard parts (activity feed, inventory alerts, chart) still show labelled sample data.

## Not implemented
- Google sign-in (needs OAuth client ID and secret from Google Cloud).
- Email: verification, password reset, scheduled reports.
- Multimodal AI: voice input/output, image and receipt analysis, PDF/Excel/Word/CSV import, video.
- Business AI grounding: the assistant does not yet read the company's records. Adding that means an authorized summary endpoint that the AI service calls with the user's session.
- Workflows / automated alerts, purchases and receivables/debts ledgers, reports export.
- Business Intelligence pages, Organizations page, Security page: placeholders.
- Full translation (only the main screens are bilingual) and full dark-mode coverage.
- Tenant isolation tests against a live database, end-to-end tests, performance tests.
- HTTPS, production container configs, monitoring, rate limiting at the edge. Set `COOKIE_SECURE=true` once served over HTTPS.

## Change log
- **v5 – Categories (Phase 0–2):**
  - Fixed the role enum in `schema.prisma` to match `permissions.ts`: `ADMIN, MANAGER, ACCOUNTANT, EMPLOYEE` (default `EMPLOYEE`).
  - Added `Category` model: multi-level tree (`parentId`), `nameAm`/`nameEn`, `slug` (unique among siblings), `sortOrder`, `isActive`.
  - Added `categories` API: list, tree (`GET /api/categories/tree`), one with breadcrumb path, create, update (including moving), enable/disable. Writes need `categories:write` (ADMIN, MANAGER).
  - Products: optional `categoryId` (must be a subcategory with no active children), plus `imageUrl`, `model3dUrl`, `manufacturer`, `manufacturerAddress`, `qualityGrade`, `productionDate`, `expiryDate`. `GET /api/products?categoryId=…` filters by category.
  - Seed (`npx prisma db seed`): 20 top-level categories and their subcategories for each organization that has none yet.
  - Unit tests for the tree builder (`npm test`).
- **Not yet built:** Next.js UI for categories and product forms, image/3D upload, payments (banks and Telebirr), percentage/fee calculation, full Amharic/Afan Oromo/Tigrinya translation, deeper (3+ level) seed data beyond the traditional clothing example.

### Setup after this change
Because the schema changed and no migration folder existed in the earlier upload, use a fresh migration on a fresh or disposable database:
```powershell
cd apps/api
npm install
npm install -D ts-node          # already listed in package.json; installs the lockfile entry
npx prisma migrate dev --name init
npx prisma db seed
npm test
```
`prisma migrate reset` deletes all data in the database; only use it on a development database.

- **v6 – Frontend categories (Phase 3):**
  - `Inventory & Sales` now opens a **Categories & products** panel: category tree (expand/collapse, select to filter products, selecting a parent includes its subcategories), add category/subcategory and enable/disable (ADMIN and MANAGER only; "show disabled" toggle).
  - Product form (create and edit) with category picker that only allows subcategories, the product fields from Phase 2, and client-side checks (price, reorder level, expiry after production).
  - The existing stock table moved into a **Stock** tab, unchanged.
  - English and Amharic labels in `lib/catalog-i18n.ts`.
  - Fixed an invalid icon import (`CircleArrowUpRight`) in `app/page.tsx` that would have failed the build.
  - Verified: `tsc --noEmit` passes for the web app. A production `next build` needs internet access (SWC download) and was not run here.
  - Limitation: the product list loads the first 100 products; pagination comes later. Products cannot be moved back to "no category" from the form yet.
- **v7 – Product images and 3D models:**
  - API: `POST /api/products/:id/media/:kind` (`kind` = `image` or `model3d`, multipart field `file`), `GET` to stream it back, and `DELETE` to remove it. Writes need `products:write`; reads need `products:read`. Both are limited to the caller's organization.
  - Accepted files are checked by their first bytes, not by name: JPEG, PNG or WebP for images (max 5 MB); single-file GLB for 3D models (max 50 MB). Anything else is refused.
  - Files are stored under `UPLOAD_DIR` (default `apps/api/uploads/<orgId>/<productId>/`), outside the web root. Uploading again replaces the old file.
  - Product fields `imageUrl` / `model3dUrl` hold `/api/products/<id>/media/<kind>?v=<timestamp>` for uploaded files. External links still work.
  - Web: the product form has file pickers with preview. In edit mode, uploads and removals happen immediately; in create mode, files upload after the product is saved.
  - Tests: `apps/api/src/uploads/media.spec.ts` (run with `npm test`).
  - Limitations: GLB only (no .gltf/.obj/.usdz); no virus scanning; files live on local disk, so production needs a shared or cloud store and backups of `UPLOAD_DIR`; the product list does not show thumbnails yet; after an upload in edit mode, the list refreshes on the next save.
  - Not compiled here: the npm registry was blocked in the authoring session, so `npm install`, `tsc`, `next build` and `jest` still need a run on your machine. The media rules were checked separately with a script.
- **v8 – Languages (Afaan Oromoo, Tigrinya):**
  - UI languages are now English, Amharic, Afaan Oromoo and Tigrinya. The language is chosen from a dropdown in the top bar and stored in `kalu-lang`. Unknown stored values fall back to English.
  - `lib/i18n.ts` holds the language list (`LANGS`), navigation labels (`NAV`), and top-bar text. `lib/catalog-i18n.ts` holds the catalog and product form text. `lib/assistant-i18n.ts` holds the AI assistant text.
  - Categories have new optional names `nameOm` and `nameTi` (schema, API create/update, category form, product list). Missing names fall back to English, then Amharic.
  - The seed translates the 20 top-level categories into Oromo and Tigrinya, and backfills existing databases. Sub-categories are not translated yet.
  - AI service: `language` accepts `om` and `ti`, and replies in Afaan Oromo (Latin) or Tigrinya (Ge'ez).
  - **The Oromo and Tigrinya text is a first draft. A native speaker must review it before it goes live.**
  - Limitations: product names are still a single language; the dashboard body (charts, stat cards, activity) is still English only; Oromo and Tigrinya sub-categories fall back to English.
  - Schema change: `Category.nameOm` and `Category.nameTi` were added. Run a migration (or `prisma migrate dev`) before the API starts.
- **v9 – Payments, platform fee, sub-category translations:**
  - **Payments** (`POST /api/sales/:saleId/payments`, `GET /api/sales/:saleId/payments`, `POST /api/payments/:id/confirm`, `POST /api/payments/:id/reject`). Methods: CASH, TELEBIRR, BANK_TRANSFER. Telebirr and bank payments need a receipt reference, which is unique per organization and method, so one receipt cannot be recorded twice. An employee records a payment (`payments:write`). An accountant or admin confirms or rejects it (`payments:confirm`). The sale becomes PAID when confirmed payments cover its total. Confirmation locks the sale row, so simultaneous confirmations cannot both miss the PAID step.
  - **No gateway is called.** Telebirr and bank payments are checked by a person against the receipt. Live Telebirr and bank APIs need merchant agreements and credentials that this codebase does not have, and their API contracts were not checked here.
  - **Platform fee:** `PLATFORM_FEE_PERCENT` (0 to 100, up to 2 decimals, default 0). Each sale stores `feePercent`, `feeAmount` and `netAmount`, so later changes do not alter past sales. The rate is not in the requirements, so it is set by the operator. Fee maths runs in integer cents and rounds half-up.
  - **Sub-categories** now have Oromo and Tigrinya drafts at every level (83 names). The seed backfills existing databases. These are drafts too.
  - Schema change: `Payment` model, `Sale.feePercent/feeAmount/netAmount`, and enums `PaymentMethod`, `PaymentStatus`. Run a migration before starting the API.
  - Tests: `apps/api/src/finance/money.spec.ts`. Checked here with a small jest-compatible runner (24 tests across four spec files passed). Jest itself was not run.
  - **Not built:** web UI for payments and fees; deeper (3+ level) catalog data beyond the existing examples (the tree supports any depth); live gateway integration; the dashboard body translation.
- **v10 – Phase 3.5: payment verification (Telebirr and bank):**
  - Verification rules in `apps/api/src/finance/payment-verification.ts`: trusted-provider-only verification, exact amount and currency match, timeouts and errors never verify, duplicate provider transactions refused.
  - New endpoints: `POST /api/payments/:id/verify-provider`, `GET /api/payments/:id/verification-attempts`. Manual confirm and reject now record a `MANUAL` decision and an attempt.
  - Schema change: `PaymentStatus.FAILED`, verification fields on `Payment`, unique `(organizationId, method, providerTransactionId)`, new `PaymentVerificationAttempt` table. No migration generated (see `docs/PHASE3_5_PAYMENT_VERIFICATION.md`).
  - **No provider is connected.** Telebirr and bank lookups return `UNAVAILABLE`. Webhooks and the web UI are not built.
  - Tests: 20 rule tests pass. Controller tests were written but not executed in this environment.
- **v11 – Phases 3.6–3.8: expenses, suppliers, purchases, debt ledgers (API):**
  - Expenses: edit, void (no delete), filters, pagination, active-only totals, payment method and reference.
  - Suppliers: create, list, edit, deactivate.
  - Purchases: draft with server-side totals; receive once (stock up, one movement per line); cancel (draft, or received with stock reversal).
  - Stock: every sale, adjustment, receipt and reversal writes a `StockMovement` row in the same transaction.
  - Ledgers: customer receivables (sales linked by `Sale.customerId`, walk-ins separate) and supplier payables; supplier payments with PENDING → CONFIRMED/REJECTED.
  - Schema change and no migration generated. No web UI. See `docs/PHASE3_6_TO_3_8.md`.
- **v12 – Phase 4: dashboard and profit & loss:**
  - Overview dashboard now shows only API data. Hard-coded KPIs, chart, activity feed, insight text and period selector removed.
  - Analytics endpoints: overview, time series (day/week/month/quarter/year), best-selling products, inventory alerts, top balances. Permission `analytics:read`.
  - Profit & Loss report at `/api/reports/profit-loss` and under Business Intelligence. COGS, gross profit and net profit are unavailable because sale lines do not store cost.
  - Date rules: inclusive local days, business offset `REPORT_UTC_OFFSET_MINUTES` (default 180).
  - No schema changes, no migration. Not built or executed in this environment. See `docs/PHASE4_DASHBOARD_AND_PNL.md`.
- **v13 – Phase 5: Ask TIBEB AI:**
  - One global "Ask TIBEB AI" drawer in the shell, opened from the header on every authenticated page. The old in-page takeover is removed. The "AI Assistant" nav item still opens the full-page chat.
  - `POST /assistant/ask` now plans at most three allowlisted, read-only tools (sales, top products, low stock, collections, expenses, customer and supplier balances, P&L), checks each against the role, runs them scoped to the tenant, and returns `sources`.
  - No SQL from the model. Amounts are exact decimals. Gross and net profit stay unavailable (no cost of goods sold).
  - No schema change, migration or dependency. Provider key still required before model answers.
  - Tests: 31/31 pure assistant tests and 15/15 analytics tests pass via the local shim. Nest, Prisma and Next builds, controller tests and a browser check were not run. See `docs/PHASE5_ASK_TIBEB_AI.md`.
- **v14 – Phase 6: documents and voice input:**
  - `BusinessDocument` API under `/api/documents` (upload, list, get, update, download, analyze, review, archive), with type detection from file bytes, 10 MB limit, server-generated storage keys, duplicate detection, atomic claim for analysis, and audit records.
  - AI service `POST /extract` returns structured fields for one document. The API sanitises every field. Extraction never creates financial records.
  - Web: Documents page (upload, search, filters, pagination, download, extract, review, archive) and a microphone button in Ask TIBEB AI (browser speech recognition, transcript is editable before sending).
  - Schema change: BusinessDocument fields and `DocumentStatus` enum. Create the migration as described in `docs/PHASE6_DOCUMENTS.md`.
  - Tests: `document-rules.spec.ts` (14 cases) passed through a local type-stripping runner. Nest build, Prisma migration, jest, Next build and controller tests were not run here. See `docs/PHASE6_DOCUMENTS.md` for limitations (no malware scan, no queue, browser speech service, no stored-document context in Ask yet).
- **v15 – Phase 7 (partial): Google sign-in and verification UI:**
  - Google OpenID Connect: `GET /api/auth/google/start` and `/callback`. One-time state and nonce in an HttpOnly cookie, server-side code exchange with the client secret, strict ID-token claim checks (issuer, audience, expiry, nonce, verified email). A verified Google email links to an existing account or creates one with an unusable password hash.
  - Configuration: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (empty = disabled). Not tested against Google; needs real credentials.
  - Verify-email page: resend-verification form (backend endpoint existed; UI was missing).
  - NOT included: scheduled business report emails (needs approved schema for subscriptions and delivery records, and a scheduler dependency); policy for existing unverified accounts when verification is enforced in production.
  - Tests: `google-oauth.spec.ts` (10 cases) passed through a local type-stripping runner. Not run with Jest or built.
- **v16 – Phase 8 (partial): members, own sessions, activity log:**
  - Last-administrator protection on role change and removal (serializable transaction).
  - Own-session list, sign-out and sign-out-others (`/api/auth/sessions`).
  - Security & Audit page (sessions for everyone; activity log for admins) and Members & roles page (admins).
  - NOT built, blocked on approval or design: branches, invitations, workflow approvals, organization switching, security metrics, custom roles. See `docs/PHASE8_PARTIAL.md`.
  - Tests: `admin-rules.spec.ts` (3 cases) passed through a local runner. Not built or run with Jest.

- **v17 – Phase 9 (partial): CSV report export:**
  - `GET /api/reports/export/:type?from&to` for sales (CONFIRMED and PAID only), expenses (all statuses, status column shown) and stock levels. Permission per type; row cap 10,000; range cap 366 days; Business timezone via `REPORT_UTC_OFFSET_MINUTES`.
  - Formula-injection protection and UTF-8 BOM for Excel (`reports/csv.ts`). Tested through a local runner (5 cases).
  - Business Intelligence page: CSV download panel.
  - NOT built: PDF and native .xlsx export (need an approved library), document content search, pgvector and RAG (need approval and database verification).
  - v17b: Document content search (`GET /api/documents/search?q=`): keyword match in titles and extracted fields (not vector search), at most the 500 newest documents, literal matching. Tested through a local runner (8 cases). Documents page has a content search box.
  - Still blocked: pgvector extension (not verified on the database), embedding model choice, sending document content to an embedding provider (needs privacy decision and approval), RAG grounding, PDF and .xlsx export.

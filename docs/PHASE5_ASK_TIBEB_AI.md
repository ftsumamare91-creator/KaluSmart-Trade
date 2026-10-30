# Phase 5: Ask TIBEB AI

One assistant, opened from every authenticated page. It answers business questions from the company's own persisted records. The model never reads the database and never chooses a query. Scope is read-only analysis; it cannot create, edit, approve or delete anything.

## What the user sees

- **Header button "Ask TIBEB AI"** (English; Amharic label unchanged in other languages). It opens one panel beside the current page. The page and the user's place stay where they are.
- **Panel:** desktop floating card (bottom right, 460 px wide); phones use a full-screen view. Escape closes it; focus returns to the button. The chat stays loaded while the panel is closed.
- **"New conversation"** clears the visible history and the context sent with later questions.
- **Topics line** lists only what the signed-in role may ask about (see the table below).
- **Nav item "AI Assistant"** still opens the full-page chat. The panel is hidden there to avoid a duplicate.

## How an answer is produced

1. `POST /assistant/ask` (permission `sales:read`, which every role has) authenticates the session and takes the tenant and role from it, never from the request.
2. `assistant-tools.ts` (pure) reads the question and the last two earlier user questions. It picks at most **three** tools from a fixed allowlist, resolves the period, and checks each tool against the caller's role.
3. `assistant-data.service.ts` runs the allowed tools. Every query is scoped to the caller's `organizationId`, and each tool re-checks its permission, so a missing check in the controller still cannot expose a restricted figure.
4. The results are formatted as a bounded text block (≤ 18,000 characters) with the period and source of each figure. It opens with the rule that record text is data, not instructions.
5. `apps/ai-service` sends the block to the configured provider with the question and the earlier turns. The model is told to quote the supplied figures and to say when something is unavailable.
6. The response contains the answer plus `sources` (metric, period, currency, record count, source description, unavailable flag), `period`, `deniedMetrics` and `grounded`.

If no provider is configured, the AI service returns its setup message. The API still returns the verified `sources`, but no figure is ever invented.

## Tools

| Tool | Answers | Permission | Source rule |
|---|---|---|---|
| `sales_summary` | Sales count and total; optional comparison | `sales:read` (all roles) | Sales with status CONFIRMED or PAID, by sale date |
| `top_products` | Best sellers by units, top 5 | `analytics:read` | Sale lines of CONFIRMED/PAID sales in the period |
| `low_stock` | Products at or below reorder level (up to 10 listed) | `products:read` (all roles) | Current quantities, not period-bound |
| `collections` | Confirmed payments in the period | `analytics:read` | Payments with status CONFIRMED, by confirmation date |
| `expenses` | Active expenses and top 5 categories | `expenses:read` | ACTIVE expenses by spent date; VOIDED and purchases excluded |
| `receivables` | Customer balances as of today | `ledger:read` | `receivablesByCustomer` (existing ledger rules) |
| `payables` | Supplier balances as of today | `ledger:read` | `payablesBySupplier` (existing ledger rules, RECEIVED purchases) |
| `profit_loss` | Phase 4 P&L lines and memo lines | `reports:read` | `buildProfitLoss`; gross and net profit reported **unavailable** (no cost of goods sold) |

Roles: ADMIN, MANAGER and ACCOUNTANT receive all tools; EMPLOYEE receives sales and low stock. The web topics list (`apps/web/lib/assistant-capabilities.ts`) mirrors this for display only. The server is the authority.

## Periods

- Keywords (English and Amharic): today, this month, last month, last two months, this quarter, this year, or explicit `YYYY-MM-DD` dates.
- Default when none is stated: the last 30 days ending today. The answer states the period it used.
- Follow-up questions reuse the period of one of the two most recent earlier questions, but only when the follow-up states none.
- "Last two months" comparisons compare the two calendar months. Other comparisons use the previous period of equal length.
- Dates are validated (e.g. `2026-02-30` is refused), and a range longer than 732 days is refused. Refusals return a 400 with a stable code and a safe message.
- Business timezone: `REPORT_UTC_OFFSET_MINUTES` (default 180).

## Security and privacy

- No SQL from the model, no table or tool choice by the model, no write tools.
- Tenant from the session; role re-checked per tool.
- Minimal fields: names only for customers and suppliers. No phone numbers, emails, payment references or payer details are sent to the model.
- Names are stripped of control characters and truncated (`safeText`).
- Failed tool queries return an explicit "could not be retrieved; do not estimate" result. Only the tool name and error class are logged, never the query or the amounts.
- Rate limit unchanged: 20 questions per user per minute. The shared-token check and fail-closed behaviour are unchanged.
- Chat history lives only in the browser session (component state). Nothing is stored server-side, and no schema changed.
- Set `AI_SEND_BUSINESS_CONTEXT=false` to stop sending any business figures to the provider.

## Configuration (no new variables)

- API: `AI_SERVICE_URL`, `AI_SERVICE_TOKEN`, `AI_SEND_BUSINESS_CONTEXT`, `REPORT_UTC_OFFSET_MINUTES`.
- AI service: `AI_PROVIDER` (`openai` | `gemini` | `openai_compatible` | `disabled`) with its key. Set `AI_PROVIDER=openai` and `OPENAI_API_KEY`, or `AI_PROVIDER=gemini` and `GEMINI_API_KEY`, in `apps/ai-service/.env`.
- **A provider key is required before any answer is written by the model.** None was configured or called while building this phase.

## Files

- `apps/api/src/assistant/assistant-tools.ts` (new): planner, periods, permissions, formatting, context block.
- `apps/api/src/assistant/assistant-data.service.ts` (new): allowlisted, tenant-scoped queries.
- `apps/api/src/assistant/assistant.controller.ts` (changed): fixed 30-day snapshot replaced by planned tools; sources returned.
- `apps/api/src/assistant/assistant-tools.spec.ts` (new): 31 pure tests.
- `apps/api/src/app.module.ts` (changed): registers `AssistantDataService`.
- `apps/ai-service/main.py` (changed): prompt and docstring state the new contract.
- `apps/web/components/AskTibebDrawer.tsx` (new): the global panel.
- `apps/web/lib/assistant-capabilities.ts` (new): topics per role for display.
- `apps/web/app/page.tsx` (changed): header button opens the drawer; the old in-page takeover removed; drawer mounted once.
- `apps/web/lib/i18n.ts` (changed): English header label.
- `apps/web/app/globals.css` (changed): drawer styles, responsive and dark mode.

## Verification (what ran, and what did not)

- **Ran:** `assistant-tools.spec.ts`, 31 of 31 pass, through the local jest-compatible shim. `analytics-rules.spec.ts` still passes, 15 of 15. The web role mapping, 3 of 3 pass.
- **Syntax-checked only:** `assistant-data.service.ts`, `assistant.controller.ts`, `AskTibebDrawer.tsx`, `page.tsx`. No syntax errors. Type-checking needs installed packages (Nest, Prisma, Next, React), which this environment cannot install.
- **Not run:** `npm test` (jest), `prisma validate`, `nest build`, `next build`, `next lint`, `git diff --check` on the user's machine, live provider calls, and a browser check of the panel layout. No controller or data-service tests were written in this phase; the spec's mock-based API tests remain open.

## Known limitations

- Routing is deterministic keyword matching. A question that names no metric gets no company figures, and the model is told so. This is safer than free tool choice but misses phrasings it does not know.
- When the period is unstated, the default (last 30 days) is used and stated in the answer, rather than asking a clarification question first.
- Receivables and payables load all of the organization's sales and confirmed payments (and purchases and supplier payments). That is correct but will slow on large datasets; it needs a SQL aggregation or paging later.
- Amharic keyword coverage is partial. Topic names and panel text are English except the title and two buttons.
- Cost of goods sold is not recorded, so profit answers are "unavailable", as in Phase 4.
- The panel cannot be minimised; it can be closed.
- Streaming is not used; the answer arrives in one reply.

## Decisions needed

None. No schema change, migration, or dependency was needed. Earlier pending approvals (Phase 3.5 migration and backfill, Phase 3.6–3.8 migrations) are unchanged.

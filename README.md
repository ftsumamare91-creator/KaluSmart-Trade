# kalu Trading PLC · KaluSmart Trade

Business operations + AI assistant for Ethiopian SMEs (Amharic / English).

## Setup (Windows PowerShell, from the project root)

1. **Database** (PostgreSQL 16+): create `kalusmart_app` user and `kalusmart_trade` database (see notes in the starter guide).
2. **API**
   ```powershell
   cd apps/api
   Copy-Item .env.example .env          # set DATABASE_URL and JWT-free settings (sessions are DB-backed)
   npm install
   npx prisma migrate dev --name init   # first migration for the new schema
   npm run start:dev                    # http://localhost:4000/api  · docs: /api/docs
   ```
3. **Web**
   ```powershell
   cd apps/web
   Copy-Item .env.example .env.local
   npm install
   npm run dev                          # http://localhost:3000 → redirects to /login
   ```
4. **AI service** (optional, for the assistant)
   ```powershell
   cd apps/ai-service
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```
   Set `AI_PROVIDER=openai_compatible`, `AI_PROVIDER_API_KEY`, `AI_MODEL` in `.env` for real answers.

## Roles
| Role | Can |
|---|---|
| ADMIN | everything, manage users and roles, view audit log |
| MANAGER | customers (incl. delete), stock, sales, expenses, reports |
| ACCOUNTANT | read sales/stock, expenses and reports |
| EMPLOYEE | customers, stock, record sales |

Permissions are defined once in `apps/api/src/common/permissions.ts` and enforced on every endpoint. The UI hides menus by the same matrix, but the server is the source of truth.

## Security in this version
- Passwords hashed with bcrypt (cost 12); policy: 10+ characters with letters and numbers.
- Server-side sessions: random token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored; 12-hour expiry; logout revokes it.
- Tenant isolation: the organization comes from the session, never from request data. Every query filters by it.
- Login lockout after 5 failed attempts for 15 minutes (in-memory; resets when the API restarts).
- Audit log of logins, failed logins, and business changes; secret-looking fields are redacted.
- Backups: `scripts/backup.sh` and `scripts/restore.sh` (PostgreSQL custom format).

## Not included yet
Google sign-in, email (verification, reset, reports), voice/image/document AI, Excel/PDF import, workflows, HTTPS and deployment configs, automated end-to-end tests. See `PROJECT_STATUS.md`.

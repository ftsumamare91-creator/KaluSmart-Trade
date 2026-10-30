# Phase 8 (partial): members, own sessions, activity log

## Done in this change (no schema change, no new dependency)
- **Last-administrator protection** (`apps/api/src/users`): an organization cannot be left without an ADMIN. Demotion and removal run in a serializable transaction. Rule: `admin-rules.ts`, tested by `admin-rules.spec.ts`.
- **Own sessions** (`GET /api/auth/sessions`, `POST /api/auth/sessions/:id/revoke`, `POST /api/auth/sessions/revoke-others`): users see and sign out only their own sessions. The list shows start time, expiry and the current session. Raw tokens and hashes are never returned. Revoking the current session signs you out.
- **Security & Audit page** (all users): own sessions. Admins also see the 100 most recent audit events for the organization (read-only).
- **Organizations page** (admins): member list, role change and removal. The server blocks changing your own role and removing the last admin.

## Not built (blocked, needs approved schema or design)
- **Branches**: no Branch model exists. Adding one changes the data model for sales, expenses and inventory attribution. Needs approval.
- **Invitations**: no invitation model exists. Needs a table for hashed, single-use, expiring tokens bound to org, email and role. Needs approval, and the email provider (Phase 7) must be configured.
- **Workflow approvals**: Expense and Purchase have status fields, but there is no approval history, approver assignment or notification table. Needs approval.
- **Organization switching and creation**: a user currently belongs to one organization through the session. Multi-organization switching needs a design decision and session changes.
- **Security dashboard metrics**: no login-attempt table, IP or device storage. The dashboard shows only recorded events.
- **Permission editor**: roles are fixed (ADMIN, MANAGER, ACCOUNTANT, EMPLOYEE). Custom roles need a schema and design decision.

## Tests
- `admin-rules.spec.ts`: 3 cases pass through a local runner. Jest was not run.
- Controller, serializable-transaction and tenant-isolation tests are NOT written yet.

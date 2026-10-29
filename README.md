# KaluSmart AI — React UI Starter

Responsive React + TypeScript + Vite frontend inspired by the supplied KaluSmart AI business dashboard and split-screen login/signup references.

## Requirements
- Node.js 20.19+ or 22.12+
- npm

## Run locally (Windows PowerShell)
```powershell
cd "D:\ጥበብ (TIBEB AI)\New folder\KaluSmart_Trade_Phase9_partial\kalusmart-ui"
npm install
npm run dev
```
Open the localhost URL printed by Vite (usually http://localhost:5173).

## Production build
```powershell
npm run build
npm run preview
```

## Included
- Responsive sign-in and create-account screens
- Password visibility toggle and basic client-side validation
- Dashboard layout with responsive sidebar and navigation
- Sales/collections area chart (Recharts)
- KPI cards, balances, transactions, product and inventory panels
- Search filter for the sample transaction list
- Quick actions and notification/profile menus
- Mobile and tablet layouts

## Important integration notes
This is a frontend UI starter. Authentication is a demo: valid-looking form values switch to the dashboard locally; it does not create accounts, securely authenticate users, or persist sessions. Google/GitHub buttons are placeholders. Dashboard figures and transactions are sample display data, not live financial records. Connect your existing backend/API, authorization, database, and real transaction workflows before production use.

## Integrating into the existing project
The source project itself was not attached in the chat, so these files are supplied as a self-contained UI starter rather than a verified in-place edit. Keep a backup of your current project. If it already uses a different framework or has an existing router/auth setup, merge the components and styles into that structure instead of replacing its configuration blindly.

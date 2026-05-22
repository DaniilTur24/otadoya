# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (uses local SQLite)
npm run build        # Production build
npm run db:push      # Sync Prisma schema to local SQLite (dev only)
npm run db:studio    # Open Prisma Studio (GUI for local DB)
```

No test suite exists in this project.

## Architecture

**Next.js 14 App Router** with Prisma ORM. Two environments:
- **Local dev**: SQLite (`prisma/dev.db`), files saved to `uploads/` folder
- **Production (Railway)**: PostgreSQL, files stored in Cloudflare R2

### Auth

Two roles, password-only (no user table). Passwords set via env vars `ADMIN_PASSWORD` and `BOOKKEEPER_PASSWORD`. JWT stored in `session` cookie, validated in `src/middleware.ts`. Bookkeeper can only access `/revenue`, `/employees`, and their APIs. Role is forwarded to API routes via `x-user-role` header.

### File Storage (`src/lib/storage.ts`)

Abstraction over local disk vs Cloudflare R2. Auto-detects based on env vars (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`). If R2 vars are absent, falls back to local `uploads/` folder. Always use `uploadFile` / `downloadFile` / `deleteFile` from this module — never use `fs` directly for uploaded files.

### Bank Import Flow

1. Excel uploaded → `parseBankTransactionsExcel()` extracts rows
2. Each row matched against `TransactionImportRule` records (priority-ordered, regex/contains/exact)
3. Distribution types: `specific_pharmacy`, `detect_pharmacy_from_text`, `split_equally`
4. Results stored as `ImportedTransaction` + `ImportedReportValue` rows
5. User reviews at `/files/[id]` — approve/reject individual transactions
6. `regenerateImportedReportValues()` recalculates splits when user edits a transaction

### Monthly Report

`MONTHLY_REPORT_ROWS` in `src/lib/monthly-report-fields.ts` defines all rows, their keys, types (`income`/`expense`/`neutral`), and data source (`db` = from transactions, `calc` = computed, `empty` = manual). The report aggregates: daily revenue entries + approved `ImportedReportValue` rows + `MonthlyReportOverride` manual adjustments. Closing a month snapshots the data into `ClosedMonth.snapshotJson`.

### Salary Calculation (`src/lib/salary-calculator.ts`)

Calculated from shifts within a month: base salary + bonuses (`pharmaBonus` expense items) − fines. Shift types affect multipliers.

## CSS Conventions

Global utility classes defined in `src/app/globals.css` — use these instead of raw Tailwind:
- `.btn-primary`, `.btn-secondary`, `.btn-success`, `.btn-danger`, `.btn-warning`
- `.input`, `.label`, `.card`
- `.th`, `.td` — table header/cell

## Key Env Vars

```
DATABASE_URL         # PostgreSQL connection string (Railway sets this automatically)
AUTH_SECRET          # JWT signing secret (min 32 chars)
ADMIN_PASSWORD       # Admin login password
BOOKKEEPER_PASSWORD  # Bookkeeper login password
R2_ENDPOINT          # https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID     # Cloudflare R2 API key
R2_SECRET_ACCESS_KEY # Cloudflare R2 secret
R2_BUCKET_NAME       # R2 bucket name
```

## Deployment

Railway auto-deploys from the `dev` branch. On each deploy:
1. Build: `npx prisma generate && npm run build`
2. Start: `npx prisma migrate deploy && npm run start`

Migration files live in `prisma/migrations/`. When changing the schema, create a new migration with `npx prisma migrate dev --name <name>` (requires local PostgreSQL or use `--create-only` to generate SQL without applying).

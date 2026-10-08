# RYNOW project working agreement

- Read `README.md`, `docs/ARCHITECTURE.md` and `docs/RYNOW_HANDOFF_RU.md` before changing product behavior or the database.
- Update the relevant documentation in the same commit as every code, schema, configuration or release change.
- Use the connected Supabase integration for live schema inspection, migrations, advisors, logs and verification.
- Never edit an already applied migration. Create a new additive migration and keep local SQL aligned with the migration applied remotely.
- Remote migration history is reconciled through seven versions ending at `20260820103251`; never replay or edit an applied migration.
- Keep `/demo` isolated from production routes.
- Preserve privacy and Fair Exposure rules described in the architecture document.
- Never put a PAT, database password, secret/service-role key or any elevated credential in frontend code, `NEXT_PUBLIC_*`, source control or logs.
- Require explicit owner approval for destructive database operations and production deployment.

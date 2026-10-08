# RYNOW — Pilot RC1

RYNOW is a mobile-first web application for meeting people who are attending the same physical event.

The Pilot RC1 product flow is:

```text
event QR → minimal profile → Room → continuous curated Explore → Interest
→ Interested Too → Match → text chat → in-person meeting feedback
```

The product does not expose a full participant catalogue and does not rank people by popularity. Candidate selection happens in PostgreSQL before data reaches the browser.

## Current repository status

This checkout contains the **staging-validated Pilot RC1 candidate**.

- Active guest, organizer, demo and landing flows contain no Drops.
- Historical Drop migrations/tables are retained for safe forward migration. The new migration revokes their client RPC execution rather than deleting historical data.
- The full migration chain, including `20260928180331_staging_security_hardening.sql`, is applied only to the isolated `RYNOW staging` Supabase project. The RC1 flow and the post-hardening live security smoke pass there using only a publishable key and ordinary test identities.
- Local lint, TypeScript, unit/contract tests and a clean production build pass.
- Security Advisor reports no `ERROR` findings. Staging now retires three compatibility RPCs, gives nine inherited functions an empty `search_path`, and closes direct client reads of historical Drops. Leaked-password protection remains a real pre-pilot item but requires a paid Supabase plan; the current organization is on Free and was not upgraded automatically.
- As of 28 September 2026, the production project, production frontend and DNS remain untouched.
- Nothing from this candidate has been deployed to production.
- As of 8 October 2026, the RYNOW-branded frontend is live only on `https://staging.rynowqr.com` through Cloudflare Worker `rynow-staging-web`. The root domain and production Supabase remain untouched. Supabase project display labels still require a dashboard rename; their immutable project refs do not change.
- On staging only, a daily 60-day retention worker is active for event data and eligible inactive anonymous guests. Its room deletion and authorization gates passed staging checks; end-to-end avatar/Auth deletion still needs a real CAPTCHA-enabled test guest before production. The updated Draft Privacy/Terms frontend is in this branch, not yet published. See [docs/RETENTION_60_DAY_RUNBOOK_RU.md](docs/RETENTION_60_DAY_RUNBOOK_RU.md).

See [docs/PILOT_RC1_PHASE2A.md](docs/PILOT_RC1_PHASE2A.md) for the implementation and test report, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system boundaries, [docs/RYNOW_HANDOFF_RU.md](docs/RYNOW_HANDOFF_RU.md) for the Russian owner handoff, [docs/OWNER_RUNBOOK_RU.md](docs/OWNER_RUNBOOK_RU.md) for independent local/domain operation, and [docs/PHYSICAL_QA_RU.md](docs/PHYSICAL_QA_RU.md) for the owner-run iPhone/Android checklist.

## Active routes

| Route | Purpose |
| --- | --- |
| `/` | Public organizer-first landing |
| `/demo` | Isolated, browser-only guest walkthrough; no production writes |
| `/r/{join_code}` | Real guest Room flow backed by Supabase |
| `/organizer` | Permanent organizer Auth, Room management and aggregate analytics |
| `/admin` | Platform-admin-only operations and moderation |
| `/privacy` | Clearly marked draft Privacy Policy |
| `/terms` | Clearly marked draft Terms |

## Product behavior in this candidate

### Guest identity and Room entry

- New guests use Supabase anonymous Auth with the configured Turnstile CAPTCHA proof.
- Existing valid sessions are reused and do not repeat CAPTCHA.
- The profile contains a photo, display name, 18+ confirmation, gender/discovery preference, and acceptance version/time for the draft Terms and Privacy Policy.
- Profile identity and `(room_id, user_id)` event membership remain separate.
- Repeated Room entry is idempotent.

### Continuous Explore

- `claim_explore_batch(room_id)` returns at most 10 server-curated candidates.
- The client asks for a refill when approximately three cards remain and polls for newly eligible guests without a full reload.
- Previously viewed candidates are not repeated within the Room.
- Self, blocked relationships, existing Matches, prior Interest relationships and non-eligible members are excluded.
- Fair Exposure is based on delivered/pending impressions, never likes or popularity.
- There is no visible or backend hard Interest budget. A private, configurable rapid-send threshold protects against obviously automated behavior.

### Presence and rejoin

- A normal refresh, background/foreground cycle, or browser close does not record an explicit Leave.
- Explicit **Leave Event** records `left_at` and disables presence/discovery.
- Opening the same QR later reuses the same user, profile and membership and displays **Rejoin this event?**.
- Rejoin reactivates the same membership; it does not create duplicates and preserves Connections/chat.

### Social, safety and outcomes

- One Interest per sender/recipient pair per Room; a rejection cannot be resent.
- A reciprocal response creates exactly one Match.
- Text chat remains Match-only.
- Profile/User Area shows Connections only after at least one Match and can reopen cross-event chat.
- In-app unread state covers incoming Interest, new Match and new message.
- Post-event feedback asks each participant independently: “Did you meet [Name] in person?”
- Report categories are normalized; both Report and Report & Block are supported.
- Event-staff escalation requires an explicit per-report consent flag.

### Organizer and platform operations

- Organizer analytics are aggregate-only: attendance, joins, active/eligible members, Explore usage, views, Interests, Matches, conversations, IRL responses, Blocks and Reports.
- `/admin` requires a permanent Auth user that is also present in the private server-controlled allowlist. Organizer ownership, guest metadata or a client boolean cannot grant access.
- Moderators can see submitted Report context and move Reports through Open, Reviewed and Resolved. Reporter identity is not returned by the UI RPC.

## Local setup

Requirements:

- Node.js 22.13 or newer
- pnpm
- A Supabase project for live testing
- Cloudflare Turnstile configured through Supabase Auth for real new-session tests

Install and run:

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Fill `.env.local` with public values only:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

The Turnstile **secret** belongs only in Supabase Auth CAPTCHA settings. Never place a service-role key, database password, Supabase secret key or Turnstile secret in this repository or browser environment.

## Local verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The default test command keeps live suites disabled unless their explicit environment gates are present. This prevents accidental calls against production and prevents skipped live tests from being reported as release evidence.

## Database rollout order

The full historical chain, including the Phase 2A and staging-hardening additions below, has been applied and live-tested on isolated staging. Production rollout still requires a separate approval:

1. `20260914135346_pilot_rc1_continuous_explore.sql`
2. `20260914135348_pilot_rc1_connections_safety_operations.sql`
3. `20260928180331_staging_security_hardening.sql`

Staging additionally has `20261008161930_retention_60_days.sql` applied and its retention worker enabled. The draft-policy compatibility migration `20261008162822_draft_policy_60_days.sql` is also applied to staging, but the revised frontend copy is only in this branch and has not been published. Production needs a separate approved snapshot, migration plan, frontend release and smoke test; do not infer approval from staging.

## Historical backend objects

Old Drop tables and earlier migration definitions remain in the migration chain because editing migration history or deleting production data would be unsafe. They are deprecated compatibility/history objects only. No active RC1 frontend path references them; client execution on old Drop RPCs and direct client reads of `public.drops` are revoked on staging.

## Ownership

PR #1 and staging-hardening PR #2 were squash-merged to the owner-controlled GitHub `main`. Independent local/domain operation is documented in `docs/OWNER_RUNBOOK_RU.md`. No frontend deployment, production database mutation or DNS change is included. Production rollout remains a separately approved phase.

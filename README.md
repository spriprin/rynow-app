# HERE — Pilot RC1

HERE is a mobile-first web application for meeting people who are attending the same physical event.

The Pilot RC1 product flow is:

```text
event QR → minimal profile → Room → continuous curated Explore → Interest
→ Interested Too → Match → text chat → in-person meeting feedback
```

The product does not expose a full participant catalogue and does not rank people by popularity. Candidate selection happens in PostgreSQL before data reaches the browser.

## Current repository status

This checkout contains the **local Pilot RC1 Phase 2A implementation candidate**.

- Active guest, organizer, demo and landing flows contain no Drops.
- Historical Drop migrations/tables are retained for safe forward migration. The new migration revokes their client RPC execution rather than deleting historical data.
- Two new forward-only migrations are prepared under `supabase/migrations/`.
- The migrations have **not** been applied to production or staging in this phase.
- Nothing from Phase 2A has been deployed.
- The production Supabase project was reported inactive, so live acceptance has not been claimed.
- Local lint, TypeScript, unit/contract tests and a clean production build pass. Live-only suites remain gated and intentionally skipped without an isolated backend.

See [docs/PILOT_RC1_PHASE2A.md](docs/PILOT_RC1_PHASE2A.md) for the implementation and test report, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system boundaries, and [docs/HERE_HANDOFF_RU.md](docs/HERE_HANDOFF_RU.md) for the Russian owner handoff.

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

After production/staging Supabase is available, use an isolated staging project first and apply all historical migrations in timestamp order. The Phase 2A additions are:

1. `20260914135346_pilot_rc1_continuous_explore.sql`
2. `20260914135348_pilot_rc1_connections_safety_operations.sql`

Then run the gated RC1 acceptance suite and the complete release regression. Do not apply retention cleanup: the candidate only stores proposed durations and keeps `cleanup_enabled = false`.

## Historical backend objects

Old Drop tables and earlier migration definitions remain in the migration chain because editing migration history or deleting production data would be unsafe. They are deprecated compatibility/history objects only. No active RC1 frontend path references them, and the prepared migration revokes client execution on the old Drop RPCs.

## Ownership

This directory is a Git repository on branch `main`. At the time of Phase 2A it has no configured remote. No remote, hosting or DNS work is part of this phase. Add an owner-controlled remote and managed deployment only in the separately approved infrastructure phase.

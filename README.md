# HERE — IRL Social Room

HERE is a mobile-first social discovery web app for people who are already at the same physical event.

The implemented core loop after Sprint 3 is:

```text
event QR → Room → Room Wall → Drop → Your Drop → Interest
→ Interested in You → Interested Too → Match → realtime text chat → meet IRL
```

The product is not a full guest catalogue and does not rank people by popularity. Room Wall creates a sense of activity, Drops synchronize attention, Your Drop limits choice, and Fair Exposure balances opportunity rather than outcomes.

## Current status

- Sprint 1 foundation: implemented, verified against live Supabase and published.
- Sprint 2 Drops/Interests: implemented and live-verified, not published.
- Sprint 3 Match/Chat/Safety: implemented, hardened and live-verified, not published.
- Public URL: `https://here-social-room.spriprin.chatgpt.site`.
- Public frontend is still the earlier Sprint 1 release. A successful local build is not a deployment.
- Supabase project `xwycdnyxuluuhylcnnjh` is connected through the Supabase integration and can be queried or migrated directly.

Live verification completed on 20 August 2026:

- Sprint 1 A–G: PASS;
- Sprint 2 S2-A–S2-O: PASS;
- Sprint 3 S3-A–S3-N, including two-way Realtime: PASS;
- typecheck, lint, static security contracts and production build: PASS.

## Product routes

| Route | Behavior |
| --- | --- |
| `/` | Marketing landing page |
| `/r/{join_code}` | Real Supabase guest flow; never falls back to fake users |
| `/organizer` | Permanent-account organizer flow for Rooms, QR and Drops |
| `/demo` | Isolated legacy mock experience |

## Product contract

- Persistent `profile` and temporary `room_member` are separate concepts.
- If a user can see and participate in a Room, that user can also participate in discovery.
- Room Wall is limited to a joined count and at most 12 real avatars; it is not a roster.
- Drop availability and Interest Budget are enforced using database time and database transactions.
- Assigning a card is not an impression; `first_seen_at` is the impression.
- Interests, declines, Matches and messages never influence Fair Exposure.
- An incoming Interest shows the sender to its recipient.
- Match creation is atomic, canonical and idempotent on the backend.
- Organizer access is aggregate-only and never includes individual Interests, Matches, Reports or chat bodies.
- Block filtering happens before candidate ranking.

Rejected legacy concepts `Hidden`, `Open to Meet`, `Selective` and blind-mutual discovery must not be reintroduced.

## Stack

- Vinext / Next.js-compatible App Router;
- React 19 and TypeScript;
- `@supabase/supabase-js` and `@supabase/ssr`;
- Supabase Auth, PostgreSQL 17, RLS, private Storage and Realtime;
- QR generation with `qrcode`;
- OpenAI Sites / Cloudflare-compatible production build.

## Supabase

Browser code may contain only:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_APP_URL
```

Never put a database password, Personal Access Token, secret key or `service_role` key in `NEXT_PUBLIC_*`, source control or browser code.

Remote schema currently contains:

```text
profiles, rooms, room_members
drops, drop_items, interests
matches, messages, blocks, reports
```

All ten tables have RLS enabled. `drop_items` and `interests` intentionally have no direct client policies; access is provided through narrow RPC functions.

The live schema was originally installed manually through SQL Editor. Supabase migration history currently reports no tracked migrations even though the schema is present. Do not reapply the old migrations blindly. Before relying on CLI-style `db push`, establish or repair a remote baseline after reviewing the live schema.

Local migration order:

1. `202608110001_initial.sql`;
2. `202608190001_fix_join_code_trigger.sql`;
3. `202608190002_sprint2_drops_interests.sql`;
4. `202608200003_sprint3_matches_chat_safety.sql`;
5. `202608200004_sprint3_live_hardening.sql`.

Applied migration files are immutable. Every database update must use a new additive migration, be applied through the connected Supabase tooling, verified live, and documented in the same change.

## Development and verification

```text
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Live acceptance tests require the test Supabase environment variables:

```text
pnpm test:acceptance
```

The harness creates real test users and Rooms, so Supabase Auth rate limits can affect repeated runs. A permanent-account fallback must never be mistaken for an anonymous actor in security tests.

## Documentation rule

Every code, schema, configuration or release change must update the relevant documentation in the same commit:

- this README for product status and operating instructions;
- `docs/ARCHITECTURE.md` for data model and trust boundaries;
- `docs/HERE_HANDOFF_RU.md` for Russian handoff status and known limitations.

See those files before starting a new sprint or production release.

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
- Sprint 3 Match/Chat/Safety: implemented and functionally live-verified, not published.
- Organizer self-service Auth and the current-product landing/demo: implemented as a new local release candidate, not published.
- Public URL: `https://here-social-room.spriprin.chatgpt.site`.
- Public frontend is still Sites version 8 from commit `ab8891e` (Sprint 1). A successful local build is not a deployment.
- Supabase project `xwycdnyxuluuhylcnnjh` is connected through the Supabase integration and can be queried or migrated directly.
- Product release status: **VERIFIED LOCAL RELEASE CANDIDATE**. No publication was performed.

The current release candidate adds permanent organizer account creation, sign-in,
sign-out and password recovery without changing the Sprint 1–3 database. Organizer
Auth uses a dedicated persisted browser cookie, separate from the anonymous guest
identity. The live project currently has email auto-confirm enabled, so a new
organizer receives a session immediately; the UI also supports the confirmation-
required state if that project setting changes. Recovery redirects are restricted
to the configured application origin, local development, or the fixed production
origin. Hosted recovery-email delivery and the clicked reset link still require a
final production smoke test with access to a real inbox.

Phase 0 verification was repeated on 21 August 2026:

- expanded Sprint 1 A–G, including forged helper-RPC probes: PASS;
- Sprint 2 S2-A–S2-O: PASS;
- Sprint 3 S3-A–S3-N: one cold-start Realtime timeout, then PASS in full on an independent retry;
- direct Sprint 3 attacks now explicitly cover organizer message reads, reversed Match insertion, forged Block ownership and forged Report ownership;
- typecheck, lint, static security contracts and production build: PASS.

The Phase 0 audit found and fixed a cross-Room presence oracle in the generic
`is_room_member` and `shares_active_room` helpers. Their spoofable signatures
are no longer executable through the Data API. RLS now uses self-bound wrappers
that derive the viewer from `auth.uid()`, while trusted backend RPCs retain the
internal checks they need. Trigger helpers are also no longer client-executable.

## Product routes

| Route | Behavior |
| --- | --- |
| `/` | Current HERE product landing and links to demo, organizer signup and sign-in |
| `/r/{join_code}` | Real Supabase guest flow; never falls back to fake users |
| `/organizer` | Self-service permanent organizer signup/sign-in, Rooms, QR and Drops |
| `/demo` | Isolated in-memory Sprint 3 product demo; no Supabase reads or writes |

The landing and demo no longer use the rejected `Hidden`, `Open to Meet`,
`Selective`, full-catalogue or blind-mutual model. The demo walks through Room
Wall, one-card-at-a-time Your Drop, limited Interests, visible incoming Interest,
Interested Too, Match, chat and safety actions. It uses sample state only and is
explicitly distinguished from a real organizer-created Room with persistent
Supabase participants and interactions.

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

The live schema was originally installed manually through SQL Editor. With the
owner's explicit approval, the five verified historical migrations were added
to the canonical migration history without replaying their SQL. The operation
and the first hardening migration were atomic. A follow-up migration separated
generic internal membership checks from self-bound RLS wrappers after live
Sprint 2 regression testing exposed that distinction. The connected migration
API now reports seven applied versions. A prior audit checked Supabase CLI
2.115.0; the current shell has no `supabase` executable in `PATH` and no CLI
session, so the connected Supabase integration is the live authority.

Local migration order:

1. `202608110001_initial.sql`;
2. `202608190001_fix_join_code_trigger.sql`;
3. `202608190002_sprint2_drops_interests.sql`;
4. `202608200003_sprint3_matches_chat_safety.sql`;
5. `202608200004_sprint3_live_hardening.sql`;
6. `20260820085448_phase0_privilege_hardening.sql`;
7. `20260820103251_restore_internal_membership_checks.sql`.

All seven versions are present in remote migration history. Files 1–5 were
baselined only after live catalog and behavior comparison; files 6–7 were
applied live and verified by the expanded Sprint 1, Sprint 2 and Sprint 3 suites.

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

`tests/organizer-auth-acceptance.test.mjs` verifies permanent signup and Room
ownership, rejects anonymous and cross-organizer attacks, preserves the separate
anonymous identity, restores the organizer session and signs it out locally. The
password-recovery UI and its trusted redirect are covered by static/render tests;
the live email-click path must also be included in the production smoke test.

## Documentation rule

Every code, schema, configuration or release change must update the relevant documentation in the same commit:

- this README for product status and operating instructions;
- `docs/ARCHITECTURE.md` for data model and trust boundaries;
- `docs/HERE_HANDOFF_RU.md` for Russian handoff status and known limitations.

See those files before starting a new sprint or production release.

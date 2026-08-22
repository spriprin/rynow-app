# HERE — IRL Social Room

HERE is a mobile-first social discovery web app for people who are already at the same physical event.

The implemented product after Sprint 4 is:

```text
event QR → Room → Room Wall → Drop → Your Drop → Interest
→ Interested in You → Interested Too → Match → realtime text chat → meet IRL
organizer-owned Room → privacy-safe aggregate dashboard
```

The product is not a full guest catalogue and does not rank people by popularity. Room Wall creates a sense of activity, Drops synchronize attention, Your Drop limits choice, and Fair Exposure balances opportunity rather than outcomes.

## Current status

- Sprint 1 foundation: implemented, verified against live Supabase and published.
- Sprint 2 Drops/Interests: implemented and live-verified, not published.
- Sprint 3 Match/Chat/Safety: implemented and functionally live-verified, not published.
- Sprint 4 privacy-safe Room analytics: implemented, migrated and live-verified, not published.
- Organizer self-service Auth and the current-product landing/demo: implemented as a new local release candidate, not published.
- Public URL: `https://here-social-room.spriprin.chatgpt.site`.
- Public frontend is still Sites version 8 from commit `ab8891e` (Sprint 1). A successful local build is not a deployment.
- Supabase project `xwycdnyxuluuhylcnnjh` is connected through the Supabase integration and can be queried or migrated directly.
- Product release status: **VERIFIED LOCAL RELEASE CANDIDATE**. No publication was performed.

The current release candidate includes permanent organizer account creation,
sign-in, sign-out and password recovery plus the Sprint 4 aggregate dashboard. Organizer
Auth uses a dedicated persisted browser cookie, separate from the anonymous guest
identity. The live project currently has email auto-confirm enabled, so a new
organizer receives a session immediately; the UI also supports the confirmation-
required state if that project setting changes. Recovery redirects are restricted
to the configured application origin, local development, or the fixed production
origin. Hosted recovery-email delivery and the clicked reset link still require a
final production smoke test with access to a real inbox.

Sprint 4 verification was completed on 22 August 2026:

- expanded Sprint 1 A–G, including forged helper-RPC probes: PASS;
- Sprint 2 S2-A–S2-O: PASS;
- Sprint 3 S3-A–S3-N: PASS, including real two-session Realtime in both directions;
- Sprint 4 S4-A–S4-P: PASS (18/18 including the Fair Exposure regression);
- organizer Auth/signup/recovery: PASS (7/7; the clicked inbox link remains a production-smoke item);
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
| `/organizer` | Self-service permanent organizer signup/sign-in, Rooms, QR, Drops and owner-only aggregate analytics |
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
- Analytics never changes discovery ranking and never returns people, pairs, profiles or private interaction content.
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
private.drop_claim_states, private.interest_opens
```

All public product tables and both private instrumentation tables have RLS enabled. `drop_items`, `interests` and the private instrumentation intentionally have no direct client policies; access is provided through narrow identity-bound RPC functions.

Sprint 4 adds nullable, validated `room_id`/`match_id` attribution to `blocks`,
private idempotent `(drop_id, viewer_id)` claim state, recipient-only Interest
open state, and one owner-only `room_analytics(room_id)` RPC. Organizers retain no
direct access to `drop_items`, `interests`, `matches`, `messages`, `blocks` or
`reports`.

The live schema was originally installed manually through SQL Editor. With the
owner's explicit approval, the five verified historical migrations were added
to the canonical migration history without replaying their SQL. The operation
and the first hardening migration were atomic. A follow-up migration separated
generic internal membership checks from self-bound RLS wrappers after live
Sprint 2 regression testing exposed that distinction. The connected migration
API now reports ten applied versions. Sprint 4 migrations were created with the
official Supabase CLI 2.115.0, transaction-dry-run against the linked database,
then applied through the connected Supabase integration, which remains the live
schema/history authority.

Local migration order:

1. `202608110001_initial.sql`;
2. `202608190001_fix_join_code_trigger.sql`;
3. `202608190002_sprint2_drops_interests.sql`;
4. `202608200003_sprint3_matches_chat_safety.sql`;
5. `202608200004_sprint3_live_hardening.sql`;
6. `20260820085448_phase0_privilege_hardening.sql`;
7. `20260820103251_restore_internal_membership_checks.sql`;
8. `20260822140308_sprint4_privacy_safe_room_analytics.sql`;
9. `20260822140512_sprint4_instrumentation_fk_indexes.sql`;
10. `20260822140736_sprint4_no_historical_claim_backfill.sql`.

All ten versions are present in remote migration history. Files 1–5 were
baselined only after live catalog and behavior comparison; files 6–7 were
applied live during Phase 0; files 8–10 were applied live and verified by the
Sprint 4 suite and the complete Sprint 1–3 regression set.

## Analytics formulas and privacy boundary

All queries are scoped to one organizer-owned Room and execute as a single
aggregate RPC. A zero denominator returns `null`, rendered as `No data`.

- unlock rate = unique viewer+Drop rows with `unlocked_at` / unique viewer+Drop claim rows;
- Drop completion = viewer+Drop runs where every assigned item has both `first_seen_at` and an action / all assigned viewer+Drop runs;
- Interest response = accepted + declined Interests / all Interests sent;
- Interest acceptance = accepted / accepted + declined Interests;
- Interest decline = declined / accepted + declined Interests;
- Match → conversation = Matches with at least one persisted message / all Matches;
- median Match → first message = median seconds from `matches.created_at` to the first persisted message per Match.

Joined/active memberships, Drops, real card views, Your Drop runs, Interests,
Matches, conversations and Reports are derived historically from canonical
tables. Claim attempts/forming/unlocks, actually opened incoming Interests and
Room-attributed Blocks are correct only from Sprint 4 onward. No approximate
historical backfill is performed. Assignment alone is never an impression.

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

The acceptance runner executes organizer Auth, Sprint 1, Sprint 2, Sprint 3 and
Sprint 4 sequentially so the strict anonymous-security probe runs before the
high-volume discovery suites.

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

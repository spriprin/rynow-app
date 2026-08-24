# HERE — IRL Social Room

HERE is a mobile-first social discovery web app for people who are already at the same physical event.

The authoritative pre-pilot product is:

```text
event QR → Room → Room Wall → always-on curated Explore → Interest
→ Interested in You → Interested Too → Match → realtime text chat → meet IRL

plus optional scheduled Drop moments that inject fresh synchronized discovery
organizer-owned Room → privacy-safe aggregate dashboard
```

The deprecated model is `Room → wait for Drop → discovery`. Guests no longer
wait for a Drop before meeting people. The product is not a full guest catalogue
and does not rank people by popularity. Explore and Drops both use small
server-selected persistent batches; Fair Exposure balances opportunity rather
than outcomes.

## Current status

- Sprint 1 foundation: implemented, verified against live Supabase and published.
- Sprint 2 Drops/Interests: implemented and live-verified, not published.
- Sprint 3 Match/Chat/Safety: implemented and functionally live-verified, not published.
- Sprint 4 privacy-safe Room analytics: implemented, migrated and live-verified, not published.
- Sprint 5 pilot reliability hardening: implemented, migrated and live-verified, not published.
- Sprint 5.1 Pre-Pilot Core Revision: Explore, split presence, Leave/Rejoin,
  adaptive budgets and aggregate Explore analytics are implemented, migrated and
  functionally live-verified, not published.
- Organizer self-service Auth and the current-product landing/demo: implemented as a new local release candidate, not published.
- Public URL: `https://here-social-room.spriprin.chatgpt.site`.
- Public frontend is still Sites version 8 from commit `ab8891e` (Sprint 1). A successful local build is not a deployment.
- Supabase project `xwycdnyxuluuhylcnnjh` is connected through the Supabase integration and can be queried or migrated directly.
- Product release status: **PRE-PILOT RELEASE BLOCKED BY AUTH CAPACITY**. No
  publication was performed and no Sprint 6 work was started.

On 24 August 2026 the dedicated PP functional suite passed 10/10 test groups,
including PP-A–PP-O and PP-S/PP-T. A controlled same-egress Auth run then
attempted 100 genuinely fresh anonymous sessions in ten-request bursts every
1.5 seconds: **1 succeeded and 99 returned HTTP 429 in 15.094 seconds**.
Observed request latency was 103–384 ms (median 123 ms, p95 240 ms). Therefore
PP-P and PP-Q fail, PP-R is not satisfied because the public Auth settings expose
anonymous signup but no configured CAPTCHA/Turnstile protection, and this
release is not pilot-ready. The task's publication gate explicitly forbids
deployment in this state.

Current local verification after the final code/schema changes: typecheck PASS,
lint PASS, static/render/security contracts 12/12 PASS, production build PASS,
local production route smoke PASS, and credential-value scan PASS. The live
functional PP suite passed 10/10 groups. A fresh full Sprint 1–5 identity-heavy
rerun was not claimed after the capacity test because the project Auth bucket is
now demonstrably rate-limited; the previously green live regression ledger
remains historical evidence, not a substitute for the required post-fix rerun.

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

Sprint 5 verification was completed against the same live Supabase project on
22 August 2026. The dedicated S5-A–S5-R suite passed 17/17. The verified load
run used 20 participant sessions, 20 concurrent join RPCs (249 ms total), and
10 near-simultaneous Drop claims (458 ms total) with a maximum-minus-minimum
exposure variance of 2. The then-current five-minute presence expiry was tested
twice with a 302-second wait; Sprint 5.1 later replaced that definition with the
separate 10/60-minute model verified on 24 August.
Realtime reconnect, persisted-history recovery, duplicate-message prevention,
Room close, Block, signed-avatar recovery, idempotent Report/message mutations,
analytics isolation and direct API security all passed live.

Repeated full-regression runs can exhaust the project anonymous/signup quotas.
The harness now separates identity preparation from concurrent Room joins,
backs off boundedly on generated-account 429s, and never treats a permanent
fallback as an anonymous identity for anonymous-only security probes. See
`docs/SPRINT5_REPORT.md` for the exact final regression ledger and observed
infrastructure limits. After quota recovery, the current post-Sprint-5 build
also passed Sprint 1 A–G and Organizer Auth 7/7 live; Sprint 2, Sprint 3 and
Sprint 4 had already passed their current post-migration reruns.

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
| `/demo` | Isolated in-memory current-product demo with Explore + optional Drops; no Supabase reads or writes |

The landing and demo no longer use the rejected `Hidden`, `Open to Meet`,
`Selective`, full-catalogue or blind-mutual model. The demo presents Explore as
the primary all-evening action and Drops as optional synchronized moments, then
walks through Interest, Interested Too, Match, chat and safety. It uses sample
state only and is explicitly distinguished from a real Room.

## Product contract

- Persistent `profile` and temporary `room_member` are separate concepts.
- If a user can see and participate in a Room, that user can also participate in discovery.
- Room Wall is limited to a joined count and at most 12 real avatars; it is not a roster.
- Explore is always available in limited persistent batches and never returns the full candidate pool.
- Scheduled Drops are an additional event activation mechanic, not a gateway to discovery.
- Explore/Drop availability and adaptive Interest Budget are enforced using database time and transactions.
- A completed Explore batch cools down for 15 minutes unless at least three genuinely new eligible unseen people join.
- Explicit Leave disables new discovery and Room Wall presence without deleting membership, profile, Matches or chat; Rejoin is allowed only while the Room remains open.
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
explore_batches, explore_items
private.drop_claim_states, private.interest_opens
```

All public product tables and both private instrumentation tables have RLS enabled. `drop_items`, `interests` and the private instrumentation intentionally have no direct client policies; access is provided through narrow identity-bound RPC functions.

Sprint 4 adds nullable, validated `room_id`/`match_id` attribution to `blocks`,
private idempotent `(drop_id, viewer_id)` claim state, recipient-only Interest
open state, and one owner-only `room_analytics(room_id)` RPC. Organizers retain no
direct access to `drop_items`, `interests`, `matches`, `messages`, `blocks` or
`reports`.

Sprint 5.1 separates presence into two server-time concepts. `recently active`
means an open Room, discovery not explicitly disabled and `last_seen_at` within
10 minutes; it drives Room Wall vitality and organizer recent count. `discovery
eligible` uses a 60-minute window plus a valid profile and drives new Explore and
Drop assignments. The client sends one heartbeat per minute only while visible
and online. Automatic timeout deletes nothing; foreground heartbeat restores
eligibility. Explicit Leave is persistent across refresh/heartbeat until Rejoin.

The live schema was originally installed manually through SQL Editor. With the
owner's explicit approval, the five verified historical migrations were added
to the canonical migration history without replaying their SQL. The operation
and the first hardening migration were atomic. A follow-up migration separated
generic internal membership checks from self-bound RLS wrappers after live
Sprint 2 regression testing exposed that distinction. The connected migration
API now reports fifteen applied versions. Sprint 4–5 migrations were created with the
official Supabase CLI 2.115.0, transaction-dry-run against the linked database,
then applied through the connected Supabase integration, which remains the live
schema/history authority. Sprint 5.1 was applied only through new additive
migrations after transaction dry-runs.

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
10. `20260822140736_sprint4_no_historical_claim_backfill.sql`;
11. `20260822170732_sprint5_presence_reliability.sql`;
12. `20260824093231_pre_pilot_core_revision.sql`;
13. `20260824094220_fix_explore_replacement_position.sql`;
14. `20260824094426_fix_left_presence_state.sql`;
15. `20260824095156_pre_pilot_fk_indexes.sql`.

All fifteen versions are present in remote migration history. Files 1–5 were
baselined only after live catalog and behavior comparison; files 6–7 were
applied live during Phase 0; files 8–10 were applied live and verified by the
Sprint 4 suite and the complete Sprint 1–3 regression set. File 11 was dry-run
inside a rollback transaction, applied live through the connected integration,
and verified by the dedicated Sprint 5 suite. Files 12–15 are the pre-pilot
feature migration, two live-acceptance edge-case fixes and covering FK indexes.

## Pre-pilot presence and discovery model

- Presence heartbeat: 60 seconds, visible/online tabs only.
- Recently active: 10 minutes; discovery eligible: 60 minutes; both use database time.
- Explore batch target: available candidates up to 5; then 6 for pools 6–11, 8 for pools 12–49 and 10 for pools 50+.
- Adaptive budget: assigned size `<=5` gives one Interest per assigned card; larger batches use `ceil(size × 0.5)`.
- Explore and Drop opportunity accounting shares delivered real impressions and pending reservations. Interests, Matches and messages never influence ranking.
- Explicit Leave sets `discovery_enabled=false` and `left_at`; heartbeat and refresh do not silently undo it. Rejoin clears the explicit state while the Room is open.
- Room polling: one guarded 15-second foreground loop with cleanup; hidden/offline tabs make no polling or heartbeat writes.
- Foreground/online recovery immediately refreshes Room, Drop, incoming Interest, Match and presence state.
- Realtime accelerates chat delivery but Postgres history is authoritative. Subscriptions re-authenticate, retry with bounded backoff and re-fetch history; selected chat history also refreshes through the guarded poll fallback.
- Read operations retry at most twice with jitter. Non-idempotent mutations are never blindly retried.
- Message and Report retries use stable client action UUIDs and database uniqueness/advisory locking.
- Private avatar URLs are cached below their signed lifetime, re-signed once after image failure, then fall back to initials without making the bucket public.
- Auth 429 has a dedicated friendly state, but retry UX is not a capacity solution. The current project fails the required same-NAT capacity gate.
- Diagnostics log only operation/category/status and resource IDs where appropriate; they exclude chat bodies, report details, profile data and credentials.

Actual physical iOS/Android device QA has not been performed. A 390×844 browser
emulation pass covered landing, organizer Auth, isolated demo and closed QR Room,
including horizontal overflow and 44 px touch targets. Status: **EMULATED PASS**.
Use `docs/REAL_DEVICE_QA.md` for the required 10–20 device stage.

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

The acceptance runner executes organizer Auth and Sprint 1–5 sequentially, with
a short gap between suites and bounded Auth 429 backoff for generated test
accounts. Anonymous-only security probes still require real anonymous quota and
must fail rather than silently substituting a permanent test user.

`tests/pre-pilot-acceptance.test.mjs` covers PP functional/security behavior.
`tests/auth-capacity.test.mjs` is deliberately gated by
`HERE_TEST_AUTH_CAPACITY=true`; it creates no fallbacks and fails unless at least
50/100 fresh anonymous sessions succeed. Do not run it casually immediately
before an event because it intentionally consumes hosted Auth quota.

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

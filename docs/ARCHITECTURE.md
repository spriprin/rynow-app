# HERE architecture after Sprint 3

## Identity and event presence

```text
auth.users
  ├── 1:1 profiles
  ├── 1:N room_members N:1 rooms
  ├── 1:N drop_items as viewer/candidate
  ├── 1:N interests as sender/recipient
  ├── N:N matches inside a Room
  ├── 1:N messages inside a Match
  ├── 1:N blocks
  └── 1:N reports

rooms 1:N drops 1:N drop_items 0:1 interests
```

`profiles` never stores `current_room_id`. A browser identity can reuse one minimal profile across many Rooms; event presence is the canonical `(room_id, user_id)` membership.

## Production and demo isolation

- `/r/{join_code}` uses only live Supabase data and fails closed.
- `/organizer` creates or signs in a permanent email/password Supabase Auth user and uses database-enforced ownership.
- Organizer Auth has its own persisted cookie/client namespace; it cannot overwrite or promote the anonymous guest session in the same browser.
- `/demo` is a current Sprint 3 walkthrough backed only by local React state. It performs no Supabase reads or writes.
- No production RPC inserts fake people or mixes demo data into a Room.

The current demo deliberately exposes only a limited, non-clickable Room Wall
sample and one Drop profile at a time. Its Interests, Match, messages and safety
actions are disposable sample interactions. The production route uses real Room
membership, server-selected Drops and database-authorized interactions.

## Organizer Auth boundary

Organizer signup uses Supabase email/password Auth and creates a permanent user;
passwords are never stored by HERE. The project currently auto-confirms email,
while the UI also handles a null signup session by showing a check-email state.
Password recovery uses a fixed trusted application origin and completes with
`updateUser` only after Supabase establishes the recovery session.

Authorization never depends on `user_metadata` or a client `isAdmin` flag. Room
inserts require a non-anonymous authenticated JWT and set
`organizer_id = auth.uid()`; reads and updates remain owner-bound. Organizer
identity grants no access to individual Interests, Matches, messages or Reports.

## Room boundary

`get_room_by_join_code` resolves only safe Room fields using an unpredictable public join code. `join_room_by_code` derives identity from `auth.uid()`, requires a completed 18+ profile, rejects non-open Rooms, and upserts only the caller's membership.

The Room Wall returns a joined count and no more than 12 minimal profiles. It is deliberately not a full catalogue and cannot originate an Interest.

Anonymous guests carry the PostgreSQL `authenticated` role, so organizer policies also inspect the JWT `is_anonymous` claim. Restrictive Room write policies prevent another permissive policy from accidentally restoring organizer rights to anonymous users.

## Discovery and Fair Exposure

A Drop is opened by persisted database time or an organizer RPC. `claim_your_drop` creates one stable assignment and position order per viewer and Drop.

Eligibility is applied before ranking:

1. same open Room and active memberships;
2. complete 18+ profile;
3. not self;
4. pair is not blocked;
5. candidate has not previously been seen by this viewer.

Ranking uses actual delivered impressions (`first_seen_at`) plus pending reservations. A small randomization is allowed inside a close exposure band. Interests, declines, Matches, messages and popularity do not enter the ranking.

Interest creation accepts only a server-assigned, actually seen `drop_item`. The database enforces Room identity, sender identity and per-Drop Interest Budget.

## Match and chat boundary

`respond_to_interest` is callable only by the real recipient. Acceptance canonicalizes the two user UUIDs and inserts one unique `(room_id, user_a_id, user_b_id)` Match with conflict-safe idempotency.

Messages are created only through `send_match_message`; history is readable only by the two unblocked Match participants. The selected chat subscribes to `messages INSERT` through Supabase Realtime using the current access token. Closing a Room prevents new discovery but does not delete existing Match/chat history.

## Safety boundary

- Block is private and excludes both directions before future Drop ranking.
- Block closes pending Interests and unhandled cards for the pair.
- A blocked pair cannot list its Match or send/read messages through normal access.
- Reports are visible only to the reporter through ordinary product roles.
- Organizer identity is not a moderation identity and cannot inspect Reports or chats.

## Storage boundary

The `avatars` bucket is private. Object paths begin with the authenticated user UUID. Upload, replacement and deletion are limited to the owner's folder; signed reads are available only to the owner or an active co-member where required by the Room UI.

## Database operations

The connected project is `xwycdnyxuluuhylcnnjh` (`Here MVP`, PostgreSQL 17). Supabase integration tools are the authority for live schema inspection, migrations, advisors and logs.

The initial schema was applied manually, so Phase 0 first compared the intended
objects and behavior with the live database. With explicit owner approval, the
five matching historical versions were registered in
`supabase_migrations.schema_migrations` without replaying their SQL. The two
Phase 0 hardening migrations were then applied normally. Remote history now
contains seven ordered versions through
`20260820103251_restore_internal_membership_checks`.

The generic `is_room_member(room, user)` and
`shares_active_room(viewer, target)` functions remain available only to trusted
database-owned functions; neither `anon` nor `authenticated` can execute them
through RPC. RLS policies call separate one-target wrappers that derive the
viewer from `auth.uid()`. This prevents forged-user presence probes without
breaking server-side checks that legitimately validate both people.

Phase 0 advisor classification:

- `drop_items` and `interests` having RLS but no policies is intentional: product roles have no direct DML grants and all access is through narrow RPCs;
- anonymous users receiving the `authenticated` role is intentional for the QR guest model; ownership and Room checks remain mandatory;
- anonymous execution of `get_room_by_join_code` is intentional and returns only the public join-route fields;
- authenticated execution of product RPCs is intentional where each function binds identity with `auth.uid()` and the acceptance suite attacks forged arguments;
- direct regression attacks also reject organizer chat reads, reversed Match insertion, forged Block ownership and forged Report ownership;
- public execution of `rls_auto_enable` and `rooms_set_join_code` is revoked;
- spoofable generic membership helpers are not Data API executable; the authenticated RLS wrappers bind identity to `auth.uid()`;
- leaked-password protection is not enabled and remains an organizer-auth hardening limitation;
- nine unindexed-foreign-key notices are low-scale performance debt, while four unused-index notices are not actionable on a new/test-heavy database.

The post-DDL advisor run reports 38 notices: two informational RPC-only table
notices, one intentional anonymous join-route function, 24 authenticated
`SECURITY DEFINER` notices requiring normal function-by-function review, ten
warnings caused by the intentional anonymous-guest model, and one leaked-
password setting. Performance reports nine unindexed foreign keys and four
unused indexes; none changed release correctness.

Supabase Realtime showed one cold-tenant delivery timeout at 12 seconds. Logs
showed replication startup rather than an authorization failure, and the full
two-way S3 suite passed on retry. The test harness now allows 20 seconds for a
cold subscription; production reliability should still be monitored.

## Release boundary

The public Sites deployment remains version 8 / commit `ab8891e` from Sprint 1.
Sprint 2/3 source and live schema are newer than the public frontend. Phase 0
now has a reconciled seven-version migration history, green expanded Sprint 1
A–G, Sprint 2 A–O and Sprint 3 A–N suites, plus a clean local production build.
The organizer self-service and current landing/demo changes form a newer local
release candidate and do not change the seven-version database history. Email
auto-confirm is enabled on the current live project. The full hosted recovery
email/click path remains a production-smoke item because it requires inbox and
redirect-configuration access. This is a release candidate, not a deployment. Publishing still
requires separate owner authorization, an exact source-commit deployment and a
production smoke test on the public URL.

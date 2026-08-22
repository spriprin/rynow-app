# HERE architecture after Sprint 4

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
  ├── 1:N reports
  ├── 1:N private.drop_claim_states as Drop viewer
  └── 1:N private.interest_opens as recipient

rooms 1:N drops 1:N drop_items 0:1 interests
rooms 1:N private instrumentation and validated safety attribution
```

`profiles` never stores `current_room_id`. A browser identity can reuse one minimal profile across many Rooms; event presence is the canonical `(room_id, user_id)` membership.

## Production and demo isolation

- `/r/{join_code}` uses only live Supabase data and fails closed.
- `/organizer` creates or signs in a permanent email/password Supabase Auth user and uses database-enforced ownership for Rooms, Drops and aggregate analytics.
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
identity grants no access to individual Interests, Matches, messages, Blocks or Reports.

## Analytics boundary

`room_analytics(room_id)` is the only organizer analytics surface. It derives
the viewer from `auth.uid()`, rejects anonymous users, requires that permanent
user to own the requested Room, fixes `search_path`, and returns one JSON
aggregate. The response may contain only an owned Room ID, owned Drop IDs,
times, statuses, counts and rates. It never returns participant/profile IDs,
names, avatars, assignments, Interest/Match/message IDs, pairs, safety actors,
reasons, details or message bodies.

Canonical historical sources remain `room_members`, `drops`, `drop_items`,
`interests`, `matches`, `messages`, `blocks` and `reports`. No analytics event
warehouse or generic person-level log exists. Two private tables store only
facts that cannot be reconstructed reliably:

- `private.drop_claim_states`: one `(drop_id, viewer_id)` row with database-time first attempt, optional first forming state and optional first unlock;
- `private.interest_opens`: one Interest row written only by the real recipient when the sender card is actually displayed.

Both private tables have RLS, no policies, no grants to `anon`/`authenticated`,
and are reached only by fixed-path `SECURITY DEFINER` functions. A trigger skips
claim instrumentation when an assignment predates Sprint 4, preventing a later
refresh from fabricating historical claim data. `blocks.room_id` and
`blocks.match_id` are nullable, validated context for new actions; the Block
itself remains global.

Exact rate definitions (returned as `null` when the denominator is zero):

1. unlock = successful unique viewer+Drop unlocks / unique viewer+Drop claim attempts;
2. Drop completion = viewer+Drop runs with every assigned item seen and handled / assigned viewer+Drop runs;
3. Interest response = accepted + declined / all Interests sent;
4. Interest acceptance = accepted / accepted + declined;
5. Interest decline = declined / accepted + declined;
6. Match → conversation = Matches with at least one persisted message / all Matches.

`cards_seen` counts only `drop_items.first_seen_at is not null`. Conversation
latency is the median database-time interval from Match creation to the first
persisted message. Joined/active are membership semantics; active is not claimed
to be precise physical attendance. Claim/forming/unlock, incoming-open and
attributed-Block metrics begin with Sprint 4 and are not backfilled. Analytics
tables or outcomes never enter Fair Exposure ranking.

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
- New Block/Report backend paths validate shared Room or actual Match context before storing Room attribution; cross-Room spoofing is rejected.

## Storage boundary

The `avatars` bucket is private. Object paths begin with the authenticated user UUID. Upload, replacement and deletion are limited to the owner's folder; signed reads are available only to the owner or an active co-member where required by the Room UI.

## Database operations

The connected project is `xwycdnyxuluuhylcnnjh` (`Here MVP`, PostgreSQL 17). Supabase integration tools are the authority for live schema inspection, migrations, advisors and logs.

The initial schema was applied manually, so Phase 0 first compared the intended
objects and behavior with the live database. With explicit owner approval, the
five matching historical versions were registered in
`supabase_migrations.schema_migrations` without replaying their SQL. The two
Phase 0 hardening migrations were then applied normally. Three additive Sprint
4 migrations were created with the official CLI, transaction-dry-run, applied
live and verified. Remote history now contains ten ordered versions through
`20260822140736_sprint4_no_historical_claim_backfill`.

The generic `is_room_member(room, user)` and
`shares_active_room(viewer, target)` functions remain available only to trusted
database-owned functions; neither `anon` nor `authenticated` can execute them
through RPC. RLS policies call separate one-target wrappers that derive the
viewer from `auth.uid()`. This prevents forged-user presence probes without
breaking server-side checks that legitimately validate both people.

Current advisor classification:

- `drop_items` and `interests` having RLS but no policies is intentional: product roles have no direct DML grants and all access is through narrow RPCs;
- anonymous users receiving the `authenticated` role is intentional for the QR guest model; ownership and Room checks remain mandatory;
- anonymous execution of `get_room_by_join_code` is intentional and returns only the public join-route fields;
- authenticated execution of product RPCs is intentional where each function binds identity with `auth.uid()` and the acceptance suite attacks forged arguments;
- direct regression attacks also reject organizer chat reads, reversed Match insertion, forged Block ownership and forged Report ownership;
- public execution of `rls_auto_enable` and `rooms_set_join_code` is revoked;
- spoofable generic membership helpers are not Data API executable; the authenticated RLS wrappers bind identity to `auth.uid()`;
- `private.drop_claim_states` and `private.interest_opens` having RLS with no policy is intentional deny-all instrumentation isolation;
- Sprint 4 `SECURITY DEFINER` warnings are intentional narrow product surfaces with fixed `search_path`, `auth.uid()` binding and explicit owner/recipient/context authorization;
- leaked-password protection is not enabled and remains an organizer-auth hardening limitation;
- the advisor's composite-FK notice for `(drop_id, room_id)` is covered for equality lookups by the existing `(room_id, drop_id)` index and leading `drop_id` primary-key column; a duplicate index was not added;
- unused-index notices are expected immediately after adding safety/instrumentation indexes to a new test-heavy workload.

The post-Sprint-4 advisor run reports no ERROR findings. Security has 42 notices:
four informational deny-all/RPC-only table notices, one intentional anonymous
join-route RPC, 26 authenticated `SECURITY DEFINER` surfaces reviewed through
their authorization contracts, ten warnings caused by the intentional anonymous
guest model, and one leaked-password setting. Performance has 19 informational
notices (eight unindexed-FK heuristics and eleven unused indexes); none changes
release correctness at current scale.

Supabase Realtime showed one cold-tenant delivery timeout while replication was
initializing. Logs showed stream/slot startup rather than an authorization
failure. The test now starts its delivery timeout only after `SUBSCRIBED` and
allows 30 seconds; the complete two-way S3 suite then passed live.

## Release boundary

The public Sites deployment remains version 8 / commit `ab8891e` from Sprint 1.
Sprint 2–4 source and live schema are newer than the public frontend. The current
release candidate has a reconciled ten-version migration history, green Sprint
1 A–G, Sprint 2 A–O, Sprint 3 A–N, Sprint 4 A–P and organizer-auth suites, plus
a clean local production build. Email
auto-confirm is enabled on the current live project. The full hosted recovery
email/click path remains a production-smoke item because it requires inbox and
redirect-configuration access. This is a release candidate, not a deployment. Publishing still
requires separate owner authorization, an exact source-commit deployment and a
production smoke test on the public URL.

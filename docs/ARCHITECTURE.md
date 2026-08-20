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
- `/organizer` uses a permanent Supabase Auth user and database-enforced ownership.
- `/demo` retains mock people and interactions only as a design reference.
- No production RPC inserts fake people or mixes demo data into a Room.

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

The live tables exist and have RLS, but the remote migration-history listing is empty because the initial schema was applied manually. Until a reviewed baseline is established:

- do not blindly replay migrations `001`–`004`;
- compare intended SQL with live objects before every schema update;
- create a new local migration for every new schema change;
- apply the matching migration through Supabase;
- verify affected behavior and run security/performance advisors;
- update documentation in the same commit.

Phase 0 advisor classification:

- `drop_items` and `interests` having RLS but no policies is intentional: product roles have no direct DML grants and all access is through narrow RPCs;
- anonymous users receiving the `authenticated` role is intentional for the QR guest model; ownership and Room checks remain mandatory;
- anonymous execution of `get_room_by_join_code` is intentional and returns only the public join-route fields;
- authenticated execution of product RPCs is intentional where each function binds identity with `auth.uid()` and the acceptance suite attacks forged arguments;
- public execution of `rls_auto_enable` and `rooms_set_join_code`, plus forged-user arguments in `is_room_member` and `shares_active_room`, are fixable and are hardened by pending migration `20260820085448`;
- leaked-password protection is not enabled and remains an organizer-auth hardening limitation;
- nine unindexed-foreign-key notices are low-scale performance debt, while four unused-index notices are not actionable on a new/test-heavy database.

Supabase Realtime showed one cold-tenant delivery timeout at 12 seconds. Logs
showed replication startup rather than an authorization failure, and the full
two-way S3 suite passed on retry. The test harness now allows 20 seconds for a
cold subscription; production reliability should still be monitored.

## Release boundary

The public Sites deployment remains version 8 / commit `ab8891e` from Sprint 1.
Sprint 2/3 source and live schema are newer than the public frontend. Phase 0 is
blocked because the live migration history is absent and the new helper-RPC
regression fails until pending migration `20260820085448` can be applied through
a reviewed history strategy. Publishing requires that reconciliation, a green
expanded A–G plus S2/S3 regression, a clean build, a source-commit match and a
smoke test on the public URL.

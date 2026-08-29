# HERE architecture — Pre-Pilot Core Revision

## Auth release-gate environment

The production organization is on the Supabase Free plan. An authorized
temporary Branch could not be created on 24 August 2026 because hosted Branching
requires Pro; the failed request created no resource and incurred no charge.
With owner authorization, a separate temporary Free project,
`HERE Auth Gate Temporary 20260826` (`rgenouyngkgfurrffcgw`, `eu-west-1`, quoted
at $0/month), was created for the destructive Auth-capacity and repeatable
CAPTCHA phases. It received the complete migration chain and test-only Auth
configuration. Production was not used as an automated CAPTCHA token farm. The
temporary project remains retained only until the human-browser portion of the
authorized production smoke is complete, then must be permanently deleted and
verified absent.

## Identity and event presence

```text
auth.users
  ├── 1:1 profiles
  ├── 1:N room_members N:1 rooms
  ├── 1:N drop_items as viewer/candidate
  ├── 1:N explore_batches as viewer
  ├── 1:N explore_items as viewer/candidate
  ├── 1:N interests as sender/recipient
  ├── N:N matches inside a Room
  ├── 1:N messages inside a Match
  ├── 1:N blocks
  ├── 1:N reports
  ├── 1:N private.drop_claim_states as Drop viewer
  └── 1:N private.interest_opens as recipient

rooms 1:N drops 1:N drop_items 0:1 interests
rooms 1:N explore_batches 1:N explore_items 0:1 interests
rooms 1:N private instrumentation and validated safety attribution
```

`profiles` never stores `current_room_id`. A browser identity can reuse one minimal profile across many Rooms; event presence is the canonical `(room_id, user_id)` membership.

When a valid returning session has a profile but no membership in the scanned
Room, the Welcome Back boundary offers either explicit Room join or profile edit.
The editor revalidates the current user with `auth.getUser()`, updates only the
row whose ID is that user, optionally uploads a new avatar under that user's
private Storage folder, and preserves the profile ID, anonymous session, 18+
confirmation and all memberships. Replaced or failed-upload avatar objects are
removed with bounded retries. Migration
`20260828092916_restrict_replaced_avatar_reads` permits non-owner signing only for
the avatar path currently referenced by `profiles`. Follow-up migration
`20260829125141_allow_owner_avatar_cleanup` retains owner SELECT on objects in the
owner's own folder because Supabase Storage resolves an object through SELECT
before DELETE. This lets supported client cleanup remove the stale object without
making it signable by unrelated users. New uploads set a five-minute response
cache TTL and signed avatar tokens also last five minutes. Successful deletion
invalidates CDN copies after propagation; a browser that already cached a legacy
upload can keep that local response until its former one-hour TTL expires.
Database and Storage RLS remain the authorization boundary.

## Split presence model

Membership, recent activity and discovery eligibility are intentionally distinct.
A membership is durable event history. `recently active` requires an open Room,
`is_active`, `discovery_enabled`, no `left_at`, and server-written `last_seen_at`
within 10 minutes. It drives Room Wall vitality and the organizer recent count.
`discovery eligible` uses the same explicit state plus a valid completed profile
and a 60-minute server window; it drives new Explore and Drop assignments.

The visible/online client calls `heartbeat_room_presence(room_id)` once per 60
seconds. Hidden or offline tabs stop heartbeats. Returning to the foreground
immediately restores automatic timeout eligibility. `leave_room_presence` is an
explicit user decision: it writes `discovery_enabled=false`, `left_at=now()` and
invalidates unseen assignments where that person is the candidate. Heartbeat,
refresh and idempotent join do not undo explicit Leave. `rejoin_room_presence`
is required and works only while the Room is open.

Guests have no direct UPDATE grant on `room_members`, so they cannot forge a
future timestamp or update another user. Both heartbeat/leave RPCs derive the
user from `auth.uid()` and use database time. `organizer_room_presence_counts()`
returns only owner-authorized aggregate `joined_count`, ten-minute `recent_count`
and sixty-minute `eligible_count`. Automatic or explicit ineligibility never
deletes a profile, membership, Match or message. Existing Matches/chat and safety
actions remain available after Leave.

## Production and demo isolation

- `/r/{join_code}` uses only live Supabase data and fails closed.
- `/organizer` creates or signs in a permanent email/password Supabase Auth user and uses database-enforced ownership for Rooms, Drops and aggregate analytics.
- Organizer Auth has its own persisted cookie/client namespace; it cannot overwrite or promote the anonymous guest session in the same browser.
- `/demo` is a current Explore + Drops walkthrough backed only by local React state. It performs no Supabase reads or writes.
- No production RPC inserts fake people or mixes demo data into a Room.

The current demo deliberately exposes only a limited, non-clickable Room Wall
sample and one profile at a time. Explore is primary; Drop is a separate optional
moment. Its interactions are disposable sample state. Production uses real Room
membership, server-selected persistent Explore/Drop batches and authorized RPCs.

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

Canonical historical sources remain `room_members`, `explore_batches`,
`explore_items`, `drops`, `drop_items`, `interests`, `matches`, `messages`,
`blocks` and `reports`. Explore analytics exposes only batches claimed/completed,
real cards seen and Explore Interests. No analytics event
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

Drop `cards_seen` and Explore `explore_cards_seen` count only assignments whose
`first_seen_at` is not null. Conversation
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

The deprecated architecture `Room → wait for Drop → discovery` is not
authoritative. `claim_explore_batch(room_id)` gives an eligible participant a
small persistent server-selected batch throughout the evening. Target size is:
available candidates up to 5; 6 for eligible pools 6–11; 8 for 12–49; and 10
for 50+. The browser never receives the full eligible pool or direct table access.

After every card is handled, the ambient batch is complete and the next one is
unavailable for 15 minutes unless at least three genuinely new eligible unseen
participants joined after the completed batch was created. Refresh returns the
same batch and progression. If an unseen candidate becomes ineligible, only that
unseen reservation may be invalidated and replaced; seen cards never reroll.

A scheduled Drop is opened by persisted database time or an organizer RPC and
creates an independent synchronized batch of up to 12 fresh people. Explore
remains usable before and after a Drop. A pending or genuinely seen candidate in
either mode is excluded from the other mode while unseen eligible people remain.

Eligibility is applied before ranking:

1. same open Room and discovery-eligible memberships within the 60-minute server window;
2. complete 18+ profile;
3. not self;
4. pair is not blocked;
5. candidate has not previously been seen by this viewer.

Explore and Drops share one opportunity calculation: actual delivered impressions
(`first_seen_at`) plus pending reservations across both modes. A small
randomization is allowed inside close exposure bands. Interests, declines,
Matches, messages and popularity do not enter ranking.

Interest creation accepts only a server-assigned, actually seen Explore or Drop
item. The budget is batch-scoped and backend-only: for assigned size `<=5`,
budget equals assigned size; otherwise it is `ceil(size × 0.5)`. Decline does not
refund. Explore and Drop budgets are separate but both feed the same incoming
Interest/Match flow.

## Match and chat boundary

`respond_to_interest` is callable only by the real recipient. Acceptance canonicalizes the two user UUIDs and inserts one unique `(room_id, user_a_id, user_b_id)` Match with conflict-safe idempotency.

Messages are created through the idempotent
`send_match_message_idempotent(match_id, body, client_message_id)` surface;
the database uniqueness constraint makes double-submit one logical message.
History is readable only by the two unblocked Match participants. The selected
chat subscribes to `messages INSERT` through Supabase Realtime using the current
access token, deduplicates by persisted message ID, and reloads Postgres history
on every subscription. Channel errors use bounded reconnect backoff; the single
foreground Room poll also refreshes an open conversation. Realtime is delivery
acceleration, never the source of truth. Closing a Room prevents new discovery
but does not delete existing Match/chat history.

## Safety boundary

- Block is private and excludes both directions before future Explore/Drop ranking.
- Block closes pending Interests and unhandled cards for the pair.
- A blocked pair cannot list its Match or send/read messages through normal access.
- Reports are visible only to the reporter through ordinary product roles.
- One report action uses `submit_report_idempotent(..., client_action_id)` so retries cannot duplicate the logical report; Report and Block remains one transaction.
- Organizer identity is not a moderation identity and cannot inspect Reports or chats.
- New Block/Report backend paths validate shared Room or actual Match context before storing Room attribution; cross-Room spoofing is rejected.

## Storage boundary

The `avatars` bucket is private. Object paths begin with the authenticated user
UUID. Upload, replacement and deletion are limited to the owner's folder;
signed reads are available to the owner, a recent active Room co-member, or an
unblocked Match participant. This keeps Match/chat avatars available after a
Room closes without exposing the bucket publicly. The client caches signed URLs
for less than their lifetime, retries signing once after an image error, and
falls back to initials if Storage remains unavailable.

## Runtime recovery and diagnostics

The Room screen owns one guarded 15-second poll and one 60-second heartbeat.
Both stop while the document is hidden or offline and are cleaned up on unmount.
Foreground/online events immediately refresh persisted Room, discovery, Match
and presence state. Safe reads retry no more than twice with jitter; mutations
are retried only through explicit database idempotency.

Normal users receive friendly offline, reconnect, rate-limit and generic retry
states rather than raw PostgREST/RPC/fetch errors. Development diagnostics use
operation name, error code/status, timestamp and Room/Drop/Match IDs where
appropriate. Chat bodies, Interest pairs, report details, profile data, session
tokens and credentials are never logged.

## Database operations

The connected project is `xwycdnyxuluuhylcnnjh` (`Here MVP`, PostgreSQL 17). Supabase integration tools are the authority for live schema inspection, migrations, advisors and logs.

The initial schema was applied manually, so Phase 0 first compared the intended
objects and behavior with the live database. With explicit owner approval, the
five matching historical versions were registered in
`supabase_migrations.schema_migrations` without replaying their SQL. The two
Phase 0 hardening migrations were then applied normally. Three additive Sprint
4 migrations and the additive Sprint 5 reliability migration were created with
the official CLI, transaction-dry-run, applied live and verified. Sprint 5.1
added one core revision plus three narrow follow-ups, each transaction-dry-run
before application. A final compatibility migration restored the established
closed-Room error precedence without changing eligibility or access. Remote
history now contains eighteen ordered versions through
`20260829125141_allow_owner_avatar_cleanup`:

- `20260824093231_pre_pilot_core_revision`;
- `20260824094220_fix_explore_replacement_position`;
- `20260824094426_fix_left_presence_state`;
- `20260824095156_pre_pilot_fk_indexes`;
- `20260827163024_restore_closed_room_error_precedence`;
- `20260828092916_restrict_replaced_avatar_reads`;
- `20260829125141_allow_owner_avatar_cleanup`.

The generic `is_room_member(room, user)` and
`shares_active_room(viewer, target)` functions remain available only to trusted
database-owned functions; neither `anon` nor `authenticated` can execute them
through RPC. RLS policies call separate one-target wrappers that derive the
viewer from `auth.uid()`. This prevents forged-user presence probes without
breaking server-side checks that legitimately validate both people.

Current advisor classification:

- `drop_items`, `interests`, `explore_batches` and `explore_items` having RLS but no policies is intentional: product roles have no direct DML grants and all access is through narrow RPCs;
- anonymous users receiving the `authenticated` role is intentional for the QR guest model; ownership and Room checks remain mandatory;
- anonymous execution of `get_room_by_join_code` is intentional and returns only the public join-route fields;
- authenticated execution of product RPCs is intentional where each function binds identity with `auth.uid()` and the acceptance suite attacks forged arguments;
- direct regression attacks also reject organizer chat reads, reversed Match insertion, forged Block ownership and forged Report ownership;
- public execution of `rls_auto_enable` and `rooms_set_join_code` is revoked;
- spoofable generic membership helpers are not Data API executable; the authenticated RLS wrappers bind identity to `auth.uid()`;
- `private.drop_claim_states` and `private.interest_opens` having RLS with no policy is intentional deny-all instrumentation isolation;
- Sprint 4–5.1 `SECURITY DEFINER` warnings are intentional narrow product surfaces with fixed `search_path`, `auth.uid()` binding and explicit owner/recipient/context authorization;
- leaked-password protection is not enabled and remains an organizer-auth hardening limitation;
- the advisor's composite-FK notice for `(drop_id, room_id)` is covered for equality lookups by the existing `(room_id, drop_id)` index and leading `drop_id` primary-key column; a duplicate index was not added;
- unused-index notices are expected immediately after adding safety/instrumentation indexes to a new test-heavy workload.

The post-fix production advisor run reports no ERROR findings. Security has 6
INFO and 51 WARN notices; Performance has 18 INFO and no ERROR. The categories
are intentional deny-all/RPC-only tables, reviewed identity-bound product RPCs,
the intentional anonymous guest model and the existing leaked-password-protection
setting. Performance advisor suggestions
for the new Explore foreign keys were addressed by the final covering-index
migration; older informational heuristics remain documented rather than being
treated as authorization failures.

During the earlier 20-session stress run, Supabase Realtime temporarily reported
`DatabaseLackOfConnections`: only 9 database connections were available while
the tenant required at least 12. This was capacity pressure rather than RLS or
authorization failure. Bounded reconnect plus Postgres-history refresh recovered
successfully in the final S5-H live run. The client now tolerates that transient
condition. The earlier 24 August anonymous run (1 success, 99 HTTP 429) was made
against a depleted token bucket and remains only historical negative evidence;
it is not used as capacity proof. No retry, spoofed forwarding,
secret-in-browser or RLS weakening was used as a fix.

The deployed Auth-capacity release integrates Cloudflare Turnstile through
Supabase's supported CAPTCHA contract. A fresh open-Room guest first resolves the
Room, checks `getSession()`, and only when no valid session exists obtains a token
for `signInAnonymously({ options: { captchaToken } })`. Existing sessions continue
directly to profile/membership state. Invalid, draft and closed Room routes never
create an identity. Since Supabase CAPTCHA is a project-wide Auth setting rather
than an anonymous-only switch, permanent organizer sign-in, signup and password
recovery use the same public widget/token contract. The public site key is a
browser build variable; the Turnstile secret must exist only in hosted Supabase
Auth configuration.

The official hosted rate limiter uses a 30-token maximum IP bucket and the
configured anonymous hourly value as its refill rate. Test code therefore records
the exact inspected `rate_limit_anonymous_users`, waits for a full natural refill,
requires 100 unique users over roughly ten minutes and then 50 unique users in
roughly one minute, and fails on every 429. Repeatable Cloudflare test proof is
allowed only against an explicitly isolated non-production Supabase project.
Authenticated Dashboard inspection showed the actual HERE Free-project value was
30/hour/IP and the anonymous field was editable. The Dashboard accepted
`1800/hour/IP`, and a full reload independently returned 1800. IP forwarding
remains disabled. This gives a 30/minute refill while preserving the hosted
30-token burst ceiling. The production Cloudflare Managed widget is restricted
to `here-social-room.spriprin.chatgpt.site`; its public site key is present in
Sites environment revision 2 as a non-secret client build variable. Supabase
persisted CAPTCHA as enabled with provider `Turnstile by
Cloudflare`. The provider secret was transferred directly into Supabase Auth and
is absent from the repository and browser configuration. Live production Auth
now rejects both missing and invalid proof without returning 429. A real widget
token was accepted once by production anonymous Auth and its replay was rejected
with a CAPTCHA-specific HTTP 400. Refresh of an existing guest session rendered
no widget and returned directly to the Room. Temporary localhost/loopback widget
hostnames and the probe route were removed immediately afterward. The isolated
provider phases passed independently: the official always-fail configuration
rejected 3/3 attempts and the official always-pass configuration accepted 3/3.
Production PP-R rejected missing and malformed proof 3/3 without 429. AUTH-P1
then created 100/100 genuinely fresh users from one NAT over 588.973 seconds
with 0 HTTP 429 and p95 latency 473 ms. After a clean refill, AUTH-P2 created
50/50 fresh users over 49.487 seconds with 0 HTTP 429 and p95 latency 336 ms.
The exact deployed hostname now renders the real widget fail-closed. Production
smoke passed for the landing/current product, the full isolated `/demo`, closed
Room behavior with unchanged Auth-user and membership counts, and all nine local
JavaScript bundles with no service-role, Supabase secret or Turnstile secret.
In two independent automated in-app Browser contexts Cloudflare did not issue a
fresh Managed-challenge token, so no organizer request or test identity was
created. The remaining fresh organizer and two-guest path must be performed in
an ordinary human browser; CAPTCHA must not be bypassed or disabled for it.

## Release boundary

The verified application was published as Sites version 10 from commit
`25d6613ece09ccaf8268fdb3fd0b45a0b2908dd8`, using Sites environment revision 2,
on the existing production URL. It has a reconciled eighteen-version migration
history, supported Turnstile protection and the verified 1800/hour/IP anonymous
setting.
AUTH-P1, AUTH-P2 and the isolated/production-negative PP-R phases are green. The
strict final live runner passed 92/92 tests with 0 fail and 0 skip across
Organizer Auth, Sprint 1–5 and Sprint 5.1, including the real 603-second presence
test. Typecheck, lint, Auth harness, static/render/security contracts and the
production build are also green (22/22 local tests). P0=0 and P1=0, and the
owner-authorized publication completed successfully. Production smoke passed for
the read-only and negative-security cases above. The new organizer/Room/two-guest
live path remains blocked only on obtaining a legitimate Managed-challenge proof
in an ordinary human browser. The human-browser run has since created the real
open Room `Test1`; one returning guest reused a nine-day-old identity/profile,
created one active membership and refreshed presence 209 seconds after join
without duplication. The second fresh guest and
two-person social loop remain open. After that path, the temporary Supabase project
must be deleted and verified absent. Sprint 6 is out of scope.

Version 10 post-deploy checks returned HTTP 200 for the landing page, organizer,
isolated demo and real `Test1` join route. All 13 referenced browser bundles
loaded successfully; `Edit profile` is present in the deployed bundle and no
service-role key, Supabase secret key or database credential was found.

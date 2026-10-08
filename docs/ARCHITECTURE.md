# RYNOW Pilot RC1 architecture

Status: staging-validated Pilot RC1 candidate, updated 29 September 2026. The full migration chain, including the staging security-hardening migration, is applied and live-tested on isolated `RYNOW staging`. Production Supabase, the production frontend and DNS were not modified.

## 1. System shape

```text
mobile browser
  ├─ public landing and isolated demo
  ├─ guest Supabase client (anonymous Auth session)
  └─ organizer/admin Supabase client (separate permanent Auth storage)
             │
             ▼
Supabase Auth + PostgreSQL/RLS/RPC + private avatar Storage
```

The frontend is React 19 + TypeScript, built with Vinext/Vite. The application router lives under `app/`. Browser and server Supabase clients live under `lib/supabase/`.

Guest and organizer sessions use different browser storage keys and client instances. An anonymous guest cannot become an organizer because organizer mutations require a non-anonymous Auth identity and ownership checks in the database. Platform operations add a second server-side allowlist check.

## 2. Canonical identity model

```text
auth.users
  ├─ 1:1 profiles
  ├─ 1:N room_members N:1 rooms
  ├─ 1:N explore_batches → explore_items
  ├─ interests as sender/recipient
  ├─ matches as one canonical pair inside a Room
  ├─ messages inside a Match
  ├─ blocks and reports
  ├─ user_notifications
  ├─ match_irl_feedback
  └─ user_data_deletion_requests
```

`profiles.id = auth.users.id`. A profile persists across events. Event participation is the unique `(room_id, user_id)` row in `room_members`; no `current_room_id` is stored in the profile.

New profile creation deliberately cannot set its own legal acceptance audit fields. After the 18+ profile exists, `accept_pilot_terms(version)` records the supported document version and a server timestamp.

## 3. QR and session flow

```text
/r/{join_code}
  → resolve Room through secure RPC
  → reject missing/draft/closed entry as appropriate
  → reuse valid browser session, otherwise Turnstile + anonymous sign-in
  → load existing profile or run onboarding
  → load existing membership or idempotently join
  → inspect presence before any protected Room Wall/Explore reads
  → active Room or explicit Rejoin state
```

Existing members of a closed Room can still open their Connections and chats. A new user cannot create a membership after closure.

## 4. Presence invariants

Membership history, recent activity and discovery eligibility are different concepts.

- **Membership:** durable unique `(room_id, user_id)` record.
- **Recently active:** active/discovery-enabled, not explicitly left, with a heartbeat in the last 10 minutes.
- **Discovery eligible:** active/discovery-enabled, not explicitly left, complete profile, heartbeat/activity within 60 minutes, and Room open.

The client does not use unload/pagehide to infer Leave. Therefore a refresh, temporary network loss, backgrounding or ordinary browser close leaves `left_at` unchanged.

Explicit Leave calls `leave_room_presence`, sets `is_active=false`, `discovery_enabled=false`, and writes `left_at`. Cold reopening calls the idempotent join path but then checks the same membership before any Room data. An explicitly-left member sees **Rejoin this event?**. `rejoin_room_presence` clears `left_at` and restores the same row.

## 5. Continuous curated Explore

`claim_explore_batch(room_id)` is the only active candidate acquisition path.

The server:

1. verifies the authenticated user is discovery eligible;
2. invalidates stale cards;
3. counts current unhandled cards;
4. when three or fewer remain and a new candidate exists, reserves enough candidates to bring the buffer toward ten;
5. excludes self, incomplete/inactive/left users, blocked pairs, existing active Matches, any existing Interest relationship, already viewed candidates and candidates already pending for that viewer;
6. orders by delivered plus pending exposure buckets and randomizes only within comparable exposure buckets;
7. returns at most ten cards.

Only the selected rows are returned. The complete Room candidate pool never reaches the browser. Likes/Interest outcomes are not an ordering signal.

The browser merges only the server-authoritative rows, preserves `first_seen_at`, de-duplicates candidate IDs and keeps a maximum of ten. It refreshes every 15 seconds while visible/online and immediately after a foreground/network recovery, so newly joined or newly eligible guests can appear without a full application reload. When no candidate exists, no empty batch is written repeatedly.

The truthful empty state is:

> You’ve seen everyone available right now. New people will appear here as they join the event.

## 6. Interest, Match and chat invariants

- `interests_one_pair_per_room` permits at most one sender → recipient Interest in a Room.
- Any prior Interest relationship excludes the pair from future Explore assignment, so a declined Interest cannot be resent.
- Existing active Matches are excluded.
- Blocked relationships cannot interact.
- `send_explore_interest` is idempotent for a network retry of the same handled card.
- A private configurable sender threshold defaults to 20 new Interests in 60 seconds. An advisory transaction lock prevents concurrent requests from racing the check. This is anti-automation protection, not an Interest budget.
- Match creation retains the canonical pair and unique Room/pair constraint, so concurrent reciprocal responses create one Match.
- Message insertion remains through the identity-bound idempotent RPC; only Match participants can read chat.

## 7. Connections and notifications

`user_connections()` returns only the caller’s active, non-blocked Matches across Rooms, plus the other person’s minimum public profile, source Room name, recent message summary and the caller’s unread count. No empty Connections section is rendered.

`user_notifications` stores identity-bound events for:

- incoming Interest;
- new Match;
- new chat message.

Database triggers create events with a unique `(recipient_id, kind, source_id)` key. `notification_state()` returns only counts for `auth.uid()`. `mark_notifications_read()` can scope message reads to one Match. The current UI polls every 15 seconds and on foreground, so badges appear without first opening a tab. Realtime publication is optional; polling remains the source-of-truth fallback.

## 8. Post-event IRL outcome

`match_irl_feedback` uses `(match_id, respondent_id)` as its primary key. `record_match_irl_feedback` verifies the caller is a Match participant and the event has ended. The four values are `yes`, `no`, `not_yet`, and `prefer_not_to_say`.

RLS lets a participant read only their own answer. The other participant never receives it. Organizer analytics only count answers by category.

## 9. Safety and moderation

Report categories are normalized to the Pilot RC1 list. `submit_report_rc1`:

- derives the reporter from `auth.uid()`;
- validates Room/Match context;
- uses a caller-provided idempotency UUID;
- optionally invokes the same Block operation;
- stores explicit event-staff sharing consent separately.

`block_user_rc1` invalidates pending Explore cards and declines pending Interests for the pair without mutating historical Drop rows.

The platform admin boundary is `private.platform_admins`. `/admin` signs in with a permanent account (and Turnstile when configured), then every operations RPC verifies both non-anonymous Auth and allowlist membership. Organizer ownership is insufficient.

The admin Room overview is aggregate. The moderation queue returns category, Room, reported user, timestamp, optional details, consent and status. It intentionally does not return reporter identity or chat contents. Status changes are audited.

Organizer analytics remain separate and aggregate-only. They never return individual pairings, rejections, messages, reporter identities or individual feedback answers.

## 10. Draft legal and retention infrastructure

`/terms` and `/privacy` are explicitly labelled drafts and do not claim legal/GDPR compliance. On 26 September 2026 the owner kept them intentionally minimal for controlled event testing, not as global public-service terms. A real attendee pilot still requires a named legal operator, contact details and jurisdiction-specific review. The application records a version and server timestamp after the 18+ confirmation.

The owner selected a uniform target retention period of 60 days for pilot product data. This is a product decision, not current runtime behavior. The applied staging configuration still stores the earlier proposal:

- operational/unmatched event data: 30 days;
- Connections/Matches/chat: 90 days;
- safety Reports: 180 days.

`cleanup_enabled` is constrained to `false`. No scheduled delete job or historical cleanup is introduced in Phase 2A. A new forward-only migration and a verified trusted cleanup worker are required before the product or Privacy page may promise automatic 60-day deletion.

“Delete my data” creates/refreshes an identity-bound pending request. The owner clarified that account deletion must remove the requesting user's identity and access while preserving shared information needed by other users. The working product model is therefore deactivation plus pseudonymization, not an immediate hard delete of the Auth row:

1. disable further sign-in/use and revoke active sessions through a trusted backend operation;
2. remove the owned avatar through the Storage API and clear any identifying profile fields;
3. replace the public identity with a neutral “Deleted user” label and placeholder image;
4. remove or disconnect private account-only data that is not needed by another user;
5. preserve the shared Match/chat for the other participant, including message bodies, but show the former participant only as “Deleted user”;
6. preserve safety Reports in pseudonymized form for the 60-day retention window;
7. keep aggregate analytics only where they no longer identify the deleted person.

The existing foreign keys do not implement that model safely: a direct Auth-user delete would still cascade through `matches`, shared chat, the other participant's feedback view and Reports. An organizer account also remains referenced by owned Rooms. The final workflow therefore requires a separate reviewed backend operation, a forward-only migration, explicit session handling, Storage deletion and destructive staging tests. The 60-day treatment of shared message bodies and pseudonymized Reports is the recommended working interpretation and must be reflected consistently in the final Privacy copy. No deletion or pseudonymization is currently executed.

## 11. Historical Drop objects

Historical migration files, Drop tables and rows remain untouched. Phase 2A does not rewrite history, truncate tables or drop definitions.

The continuous-Explore migration copies previously viewed historical Drop-card identities once into a private, RLS-protected seen ledger. Active helpers then use that ledger rather than reading Drop tables, so those people do not repeat within a Room. It removes all frontend calls/UI/copy and revokes client execution from legacy Drop RPCs. The staging hardening migration also removes the obsolete direct client `SELECT` path from `public.drops`; the historical table and rows remain intact. Historical cleanup can happen only in a later dedicated migration after backup, dependency inspection and owner approval.

## 12. Migration order and rollout

The full chain has been applied on the isolated `RYNOW staging` Supabase project in timestamp order. The RC1 additions are:

1. `supabase/migrations/20260914135346_pilot_rc1_continuous_explore.sql`
2. `supabase/migrations/20260914135348_pilot_rc1_connections_safety_operations.sql`
3. `supabase/migrations/20260928180331_staging_security_hardening.sql`

Completed on staging:

- the full migration chain was applied;
- the live RC1 social/safety/analytics acceptance suite passed;
- the negative cross-profile RLS check passed;
- the hardening migration revoked three inactive compatibility RPCs, set an empty `search_path` on nine inherited functions, and closed the direct `public.drops` read path;
- the publishable-key-only post-hardening live security smoke passed;
- Security Advisor and live catalog grants/policies were re-reviewed with no `ERROR` findings;
- local typecheck, lint, contract tests and production build passed.

Still required before production rollout:

- take a schema/data snapshot;
- keep Supabase Free per the owner's decision, treat disabled leaked-password protection as an accepted plan limitation, and protect permanent organizer/admin identities with unique credentials plus a reviewed MFA path before real admin access;
- seed a permanent organizer and separately allowlist a platform admin using a trusted database operator path;
- run real iPhone Safari and Android Chrome QA;
- verify production Auth/CAPTCHA/shared-NAT capacity separately;
- deploy frontend only after database compatibility is confirmed.

Rollback strategy is application rollback plus a forward corrective migration. Do not edit an already-applied migration or restore old client privileges casually.

## 13. Security boundaries to preserve

- Only public/publishable credentials are present in browser code.
- Turnstile and Supabase secrets remain in their provider configuration.
- All mutating RPCs derive identity from `auth.uid()`.
- RLS remains enabled on user-facing public tables.
- Security-definer functions use an explicit empty `search_path` and schema-qualified objects.
- No `using (true)` private-data policy is introduced.
- Anonymous guests cannot create/modify organizer Rooms or access admin operations.
- Organizers receive aggregates, not private relationship or safety details.

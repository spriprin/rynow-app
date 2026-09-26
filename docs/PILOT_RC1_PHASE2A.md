# Pilot RC1 Phase 2A — implementation report

Date: 16 September 2026
Latest staging/status update: 26 September 2026
Scope: product source, forward-only migrations, local automated tests and an isolated staging test harness.
Explicitly out of scope: production database/configuration, deployment, hosting/DNS migration, Git remotes, destructive data cleanup, physical removal of historical Drop objects, Sprint 6.

## 1. Implementation summary

### Active product no longer contains Drops

Removed Drop UI, countdowns, “Your Drop”, organizer controls, analytics fields, demo/landing copy and all active frontend calls to Drop RPCs. Historical SQL migrations and data definitions remain intact. The RC1 migration revokes client execution from deprecated functions and replaces shared discovery/safety helpers so RC1 runtime no longer depends on Drop rows.

### Continuous server-curated Explore

- Buffer target: 10 cards.
- Refill threshold: 3 remaining.
- Client polling: 15 seconds while visible/online plus foreground/network recovery.
- Server exclusions: self, incomplete or ineligible presence, preference mismatch, Blocks, existing Matches, any existing Interest relationship, already viewed candidates and already pending candidates.
- Fair Exposure: delivered plus pending impression count, with randomness only inside comparable exposure buckets.
- Previously viewed historical Drop cards are copied once into a private RC1 seen-history ledger; the active stream does not query Drop tables and does not repeat those people in the same Room.
- No full candidate list reaches the client.
- No repeated empty database batch is created when nobody new is available.
- Exact caught-up copy is implemented.

### Interest policy

- Removed the hard/adaptive Interest budget from active behavior and UI.
- Retained the unique one-way pair constraint per Room.
- Rejected/prior Interest relationships are excluded from future candidate assignment.
- Existing Matches and Blocks are excluded.
- Same-card network retry is idempotent.
- Added configurable, sender-scoped rapid automation protection: default 20 new Interests per 60 seconds, transaction locked.

### Exact P0 Leave lifecycle

Both Room entry and refresh now load membership presence before Room Wall, Explore or incoming Interest data. An explicit `left_at` state clears Room discovery data and renders **Rejoin this event?**. Rejoin uses the existing membership. Ordinary close/refresh/background has no leave event and restores normally.

### Connections and notifications

Added Profile/User Area with cross-Room Connections, source event and existing chat reopen. It is hidden when there are zero Connections. Added persistent unread notification records/triggers and caller-only aggregate state for incoming Interests, Matches and messages. Message read actions can be limited to one Match.

### IRL feedback

Added independent per-participant post-event responses with a `(match_id, respondent_id)` primary key, own-answer-only RLS and organizer aggregates only.

### Safety and operations

Normalized Report categories; added idempotent Report/Report & Block without historical Drop mutation; added explicit event-staff sharing consent. Added private permanent-account platform-admin allowlist, aggregate Room operations, restricted moderation queue and status audit.

### Legal, retention and deletion preparation

Added draft `/privacy` and `/terms`; onboarding records the fixed draft document version and a server timestamp after 18+. Added the original private configurable 30/90/180-day retention proposal with cleanup disabled; the owner later selected a uniform 60-day target that is not yet applied. “Delete my data” records an authenticated request but performs no destructive deletion.

### Organizer analytics

Aggregate-only analytics now cover manual attendance, joined/recent/eligible, Explore users/views, Interests, Matches, conversations, IRL answers, Blocks, Reports, conversion rates and median Match-to-first-message. No pair identities or chat text are returned.

## 2. Files changed

Product source:

- `app/components/RoomJoinApp.tsx`
- `app/components/UserArea.tsx` (new)
- `app/components/OrganizerFoundationApp.tsx`
- `app/components/OrganizerAnalytics.tsx`
- `app/components/AdminOperations.tsx` (new)
- `app/components/CurrentProductDemo.tsx`
- `app/components/ProductLanding.tsx`
- `app/admin/page.tsx` (new)
- `app/privacy/page.tsx` (new)
- `app/terms/page.tsx` (new)
- `app/globals.css`
- `lib/rc1-state.ts` (new)
- `lib/reliability.ts`
- `lib/types.ts`

Database:

- `supabase/migrations/20260914135346_pilot_rc1_continuous_explore.sql` (applied to `here-staging`, not production)
- `supabase/migrations/20260914135348_pilot_rc1_connections_safety_operations.sql` (applied to `here-staging`, not production)

Tests and release harness:

- `tests/pilot-rc1-state.test.mjs` (new)
- `tests/pilot-rc1-contract.test.mjs` (new)
- `tests/pilot-rc1-acceptance.test.mjs` (new, isolated live gate)
- `tests/gender-preferences-contract.test.mjs`
- `tests/rendered-html.test.mjs`
- `scripts/run-live-acceptance.mjs`

Documentation:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/HERE_HANDOFF_RU.md`
- `docs/PHYSICAL_QA_RU.md`
- `docs/PILOT_RC1_PHASE2A.md` (new)

## 3. Migrations prepared and applied to staging

### `20260914135346_pilot_rc1_continuous_explore.sql`

- Replaces Drop-dependent discovery helpers with Explore-only definitions.
- Adds a one-time, non-destructive backfill of historical viewed-card IDs into a private RLS-protected seen-history ledger.
- Implements server-curated continuous refill and Fair Exposure.
- Removes the hard Interest budget from the mutation path.
- Adds private pilot configuration and sender-scoped automation protection.
- Replaces Leave/availability helpers without historical Drop mutation.
- Revokes old Drop RPC privileges and comments matching functions as deprecated.
- Does not drop/truncate historical objects or run cleanup.

### `20260914135348_pilot_rc1_connections_safety_operations.sql`

- Adds acceptance version/timestamp and optional total attendance.
- Tightens profile column updates and adds trusted acceptance RPC.
- Adds notification, IRL feedback and deletion-request tables with RLS/restricted grants.
- Adds Connections/notification/feedback RPCs.
- Normalizes Report categories/states and adds consent/audit data.
- Adds new safety RPCs independent of Drops.
- Adds private platform-admin allowlist and moderation RPCs.
- Extends aggregate-only organizer analytics.
- Optionally adds notification events to the existing Realtime publication; polling remains the fallback.

## 4. Automated coverage

Local tests verify:

- no active Drop UI/copy/RPC calls;
- the real QR route stays isolated from demo data whether its configured backend renders the loading shell or rejects the deliberately fake test slug;
- source-contract extraction is reproducible with both LF and Windows CRLF checkouts;
- no hard Interest budget;
- candidate buffer bound/de-duplication/refill threshold;
- server eligibility, preference, Block/Match/Interest/view exclusions;
- Fair Exposure inputs are impressions, not popularity;
- rapid-send protection and transaction lock exist;
- exact caught-up state;
- exact explicit Leave versus ordinary close restoration logic;
- Connections hidden when empty and cross-Room chat reopen wiring;
- notification badge state;
- exact Report category set;
- legal draft/version wiring;
- platform-admin and aggregate-only code boundaries;
- existing Sprint 1–5 security/HTML contracts remain intact.

The isolated staging suite prepares an end-to-end check for:

- organizer Room creation;
- four fresh anonymous profiles and memberships, including guests joining later;
- server candidate claim/view/Interest;
- idempotent Interest retry;
- rejection without resend and late-candidate appearance;
- concurrent reciprocal response and exactly one Match;
- notification/message creation;
- explicit Leave → cold session → same membership → Rejoin;
- ordinary close/session restore;
- cross-profile RLS attack;
- organizer denial from platform-admin RPC;
- Report creation;
- independent IRL feedback and answer privacy;
- organizer aggregate-only output;
- deprecated Drop RPC denial.

The live test refuses the known production project, refuses secret/service-role keys, and requires an explicitly marked isolated hosted project with Cloudflare’s official repeatable test token.

## 5. Verification results

Local results for this candidate:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS: 35, FAIL: 0, intentionally gated live-only SKIP: 11 |
| Clean `pnpm build` | PASS; `/`, `/admin`, `/demo`, `/organizer`, `/privacy`, `/r/:slug`, `/terms` generated |
| Local HTTP smoke | PASS: `/`, `/demo`, `/privacy`, `/terms`, `/admin`, `/organizer` returned 200 |
| Credential-pattern scan | PASS: no service-role/secret Supabase key, database credential URL or Turnstile secret assignment in source or generated bundle |
| New-migration static safety scan | PASS: no `DROP TABLE`, `TRUNCATE`, `DELETE FROM` or permissive `USING (true)` |
| `git diff --check` | PASS |

The first build attempt encountered an old generated `dist/.openai/drizzle` directory (`EEXIST`). Only the verified local generated `dist` directory was removed; the clean rebuild then passed. No source or production data was removed.

### Staging Security Advisor addendum — 22 September 2026

The full migration chain is now applied to the isolated `here-staging` project (`orkkwgxuzudawiailyen`). Production Supabase, production frontend and DNS remain unchanged.

`supabase db advisors --linked --project-ref orkkwgxuzudawiailyen --type security --level info` reported no `ERROR` findings:

- Eight `rls_enabled_no_policy` `INFO` findings are expected deny-by-default controls. The affected private/RPC-only tables have no direct `anon` or `authenticated` table grants in the live staging catalog.
- The single anonymous `SECURITY DEFINER` warning for `get_room_by_join_code` is expected: it is the deliberately narrow pre-Auth QR lookup and returns only Room entry metadata for a high-entropy join code.
- Forty authenticated `SECURITY DEFINER` warnings cover 32 active client RPCs, five identity-bound RLS/Storage helpers and three inactive compatibility RPCs. The active identity-bound functions derive the caller from `auth.uid()`; the admin functions instead call the private platform-admin allowlist guard.
- Enabling the architecture's required anonymous Auth flow adds twelve `auth_allow_anonymous_sign_ins` warnings. Eleven are expected for guest-facing, identity/member-bound policies on profiles, Rooms, memberships, blocks, Matches/messages, Reports/feedback/deletion requests, Realtime chat and avatar objects. Their live definitions bind access to `auth.uid()` or the reviewed membership/Match helpers, and the RC1 negative cross-profile test passed. The twelfth is the obsolete `public.drops` read path and should not remain client-readable for the new product.
- `auth_leaked_password_protection` is a genuine Auth hardening warning for permanent organizer/admin accounts; it is not mitigated by the anonymous guest model.

Four defense-in-depth items must be resolved before the pilot:

1. Revoke client execution from the inactive `explore_state`, `sent_interests` and non-idempotent `send_match_message` RPCs unless an explicit compatibility requirement is approved.
2. Change the nine inherited functions still configured with `search_path=public` (`can_access_match`, `get_room_by_join_code`, `interested_in_you`, `is_pair_blocked`, `mark_match_messages_read`, `room_joined_count`, `room_matches`, `send_match_message`, `sent_interests`) to the documented empty `search_path`, schema-qualifying any remaining references. Re-run the advisor and live regression after that migration.
3. Remove the remaining `authenticated` `SELECT` grant/policy exposure from the deprecated `public.drops` table unless an explicit compatibility requirement is approved.
4. Enable leaked-password protection for permanent email/password identities and verify organizer sign-in/recovery afterwards.

These are staging hardening findings, not evidence of a current cross-user data path. No database change was made as part of this review.

### Staging live acceptance addendum — 22 September 2026

The existing `pilot-rc1-acceptance` harness passed against the isolated `here-staging` project (`orkkwgxuzudawiailyen`) using only its publishable key, Cloudflare's official repeatable Turnstile test token and ordinary test identities. No service-role/secret key was read, stored or used.

The first live attempt exposed two staging/test issues before the successful run:

- anonymous sign-ins were disabled in staging even though the guest architecture requires them; they were enabled only for `here-staging`;
- three membership assertions used `.single()` after filtering only by Room, so a Room with multiple members could not be coerced to one row. The harness now also filters by the expected `user_id` and asserts the Rejoin read error explicitly.

The successful run covered Room creation, four anonymous guest identities, join and late join, continuous Explore, Interest idempotency and rejection, reciprocal Match creation, notification/chat state, explicit Leave and Rejoin with session restoration, cross-profile RLS denial, organizer denial from platform-admin operations, Report creation, independent IRL feedback privacy, organizer aggregates and deprecated Drop RPC denial.

## 6. Remaining live verification

The original Phase 2A run did not include a hosted backend. The staging addenda above now provide live evidence for migrated Auth, core RLS/RPC paths, organizer analytics and the RC1 social/safety flow. They do not claim production verification, Storage upload coverage, Realtime subscription delivery, enforced CAPTCHA validation, concurrent physical devices, shared NAT/load, a populated platform-admin allowlist, production routes or physical iPhone Safari/Android Chrome QA. Production mutation remains prohibited without separate authorization.

## 7. Product/operator decisions

Owner update, 26 September 2026:

- Keep the current minimal Draft Terms/Privacy scope for controlled event testing, not as global public-service terms. A named legal operator/contact and jurisdiction-specific review are still required before a real attendee pilot.
- Use a uniform 60-day target retention period. This is not yet implemented: staging still stores 30/90/180 and `cleanup_enabled=false`.
- The intended Delete My Data outcome is full account/data erasure. Implementation remains blocked until the owner confirms whether that intentionally deletes the other participant's shared Match/chat state and related safety Reports through existing cascades.
- The baseline event size is at least 20 guests and may vary. Use 40 simultaneous guests as the minimum 2× capacity gate, and resize the gate for larger planned events.
- The owner will perform physical mobile QA using `docs/PHYSICAL_QA_RU.md`.
- The initial permanent platform-admin email is still required after the role has been explained.
- Approval or adjustment of the default 20 Interests/60 seconds abuse threshold is still required.
- Production rollout still requires separate approval after staging hardening and physical QA.

## 8. Migration, data and security risks

- Run migrations on a production-shaped staging copy first; static tests cannot prove PostgreSQL execution.
- Existing Report values are normalized before adding new constraints, but actual staging data must still be inspected.
- The historical viewed-card backfill may take time on a larger database and must be measured in staging; it does not delete original rows.
- Revoking legacy RPCs can break an old frontend during a staggered rollout; database/frontend release order needs a planned compatibility window.
- New notification triggers do not backfill historical activity.
- The admin allowlist starts empty by design and must be populated through a trusted database operator path.
- The owner selected a 60-day target, but retention remains configuration-only and no cleanup occurs until a new migration/worker is reviewed and tested.
- Auth-user deletion is unsafe until shared/cascade behavior is finalized: current foreign keys can delete the other participant's shared Match/chat state and safety Reports, Storage objects must be removed first, and issued JWTs can outlive the deleted Auth row until expiry.
- CAPTCHA and same-NAT Auth capacity require current isolated/live evidence before pilot approval.

## 9. Remaining staging/live sequence

Completed: isolated staging exists, the full migration chain is applied, core grants/RLS/functions were inspected, an organizer test identity was created, the RC1 staging suite passed and its negative cross-profile RLS check passed.

1. Apply a new forward-only hardening migration for the inactive compatibility RPCs, inherited function search paths and deprecated Drops read path.
2. Enable leaked-password protection and add a separate allowlisted platform-admin test identity.
3. Repeat Security Advisor, the RC1 staging suite and the full local regression.
4. Run the remaining Realtime, Storage, concurrency, retention/deletion-request and moderation checks.
5. Complete physical iPhone Safari and Android Chrome QA.
6. Repeat real Turnstile and the baseline 40-guest shared-NAT/load gate; resize it for any event expected above 20 guests.
7. Close the remaining owner decisions: legal operator/contact, exact deletion cascade, platform-admin email and anti-abuse threshold.
8. Prepare a production snapshot, coordinated database/frontend order and rollback plan.
9. Separately authorize production migration, frontend deploy and production smoke.

## 10. Deployment statement

Nothing was deployed. No production database, Supabase configuration, hosting, DNS, Git remote or production source was modified. Sprint 6 was not started.

# Pilot RC1 Phase 2A — implementation report

Date: 16 September 2026
Latest staging/status update: 29 September 2026
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
- `supabase/migrations/20260928180331_staging_security_hardening.sql` (applied to `here-staging`, not production)

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

### `20260928180331_staging_security_hardening.sql`

- Revokes `public`/`anon`/`authenticated` execution of the inactive `explore_state`, `sent_interests` and non-idempotent `send_match_message` compatibility RPCs.
- Sets `search_path=''` on nine reviewed inherited `SECURITY DEFINER` functions; their relation/function references were already schema-qualified.
- Drops the obsolete authenticated `drops` read policy and revokes direct `anon`/`authenticated` `SELECT` while preserving the historical table and rows.
- Does not drop/truncate a table or delete historical data.

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
- post-hardening denial of the three inactive compatibility RPCs and direct historical `drops` reads.

The live test refuses the known production project, refuses secret/service-role keys, and requires an explicitly marked isolated hosted project with Cloudflare’s official repeatable test token.

## 5. Verification results

Local results for this candidate:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS: 36, FAIL: 0, intentionally gated live-only SKIP: 12 |
| Clean `pnpm build` | PASS; `/`, `/admin`, `/demo`, `/organizer`, `/privacy`, `/r/:slug`, `/terms` generated |
| Local HTTP smoke | PASS: `/`, `/demo`, `/privacy`, `/terms`, `/admin`, `/organizer` returned 200 |
| Credential-pattern scan | PASS: no service-role/secret Supabase key, database credential URL or Turnstile secret assignment in source or generated bundle |
| New-migration static safety scan | PASS: no `DROP TABLE`, `TRUNCATE`, `DELETE FROM` or permissive `USING (true)` |
| `git diff --check` | PASS |

The first build attempt encountered an old generated `dist/.openai/drizzle` directory (`EEXIST`). Only the verified local generated `dist` directory was removed; the clean rebuild then passed. No source or production data was removed.

### Staging Security Advisor addendum — updated 28 September 2026

The full migration chain is now applied to the isolated `here-staging` project (`orkkwgxuzudawiailyen`). Production Supabase, production frontend and DNS remain unchanged.

The post-migration Security Advisor run reported no `ERROR` findings:

- Nine `rls_enabled_no_policy` `INFO` findings are expected deny-by-default controls. The count increased by one because historical `public.drops` now also has no client read policy or grant.
- The single anonymous `SECURITY DEFINER` warning for `get_room_by_join_code` is expected: it is the deliberately narrow pre-Auth QR lookup and returns only Room entry metadata for a high-entropy join code.
- Authenticated `SECURITY DEFINER` warnings fell from 40 to 37 because the three inactive compatibility RPC grants were removed. The remaining functions are active identity/membership/ownership-bound operations; admin functions additionally call the private platform-admin allowlist guard.
- Eleven `auth_allow_anonymous_sign_ins` warnings remain expected for the guest architecture. The obsolete `public.drops` warning is gone; active guest-facing policies remain bound to `auth.uid()` or reviewed membership/Match helpers.
- `auth_leaked_password_protection` remains a genuine Auth hardening warning for permanent organizer/admin accounts. Supabase makes this control available on Pro and above; the organization is currently on Free, so no unapproved paid upgrade was performed.

Three database defense-in-depth items are now completed on staging:

1. Client execution is revoked from `explore_state`, `sent_interests` and `send_match_message`.
2. The nine inherited functions use the documented empty `search_path`.
3. Direct client `SELECT` access to deprecated `public.drops` is removed.

On 29 September 2026 the owner chose to remain on Supabase Free. Leaked-password protection therefore remains an accepted plan limitation rather than an open upgrade decision. Permanent organizer/admin accounts require unique password-manager credentials and a reviewed MFA path before real admin access. The retained Advisor warnings are architecture-aware review items, not evidence of a current cross-user data path.

### Staging live acceptance addendum — 22 September 2026

The existing `pilot-rc1-acceptance` harness passed against the isolated `here-staging` project (`orkkwgxuzudawiailyen`) using only its publishable key, Cloudflare's official repeatable Turnstile test token and ordinary test identities. No service-role/secret key was read, stored or used.

The first live attempt exposed two staging/test issues before the successful run:

- anonymous sign-ins were disabled in staging even though the guest architecture requires them; they were enabled only for `here-staging`;
- three membership assertions used `.single()` after filtering only by Room, so a Room with multiple members could not be coerced to one row. The harness now also filters by the expected `user_id` and asserts the Rejoin read error explicitly.

The successful run covered Room creation, four anonymous guest identities, join and late join, continuous Explore, Interest idempotency and rejection, reciprocal Match creation, notification/chat state, explicit Leave and Rejoin with session restoration, cross-profile RLS denial, organizer denial from platform-admin operations, Report creation, independent IRL feedback privacy, organizer aggregates and deprecated Drop RPC denial.

After the hardening migration, a separate publishable-key-only live security smoke passed on 28 September 2026. It used an ordinary anonymous staging identity and verified that the three compatibility RPCs and direct `drops` reads are denied. No service-role/secret key was used. A newly created email organizer did not receive an immediate session because staging now requires email confirmation; the test did not weaken that setting or bypass it with elevated credentials.

## 6. Remaining live verification

The original Phase 2A run did not include a hosted backend. The staging addenda above now provide live evidence for migrated Auth, core RLS/RPC paths, organizer analytics and the RC1 social/safety flow. They do not claim production verification, Storage upload coverage, Realtime subscription delivery, enforced CAPTCHA validation, concurrent physical devices, shared NAT/load, a populated platform-admin allowlist, production routes or physical iPhone Safari/Android Chrome QA. Production mutation remains prohibited without separate authorization.

## 7. Product/operator decisions

Owner update, 26 September 2026:

- Keep the current minimal Draft Terms/Privacy scope for controlled event testing, not as global public-service terms. A named legal operator/contact and jurisdiction-specific review are still required before a real attendee pilot.
- Use a uniform 60-day target retention period. This is not yet implemented: staging still stores 30/90/180 and `cleanup_enabled=false`.
- Delete My Data must remove the former user's name, avatar and access without destroying information shared with other users. The working model keeps Match/chat for the counterpart under a neutral “Deleted user” identity and retains pseudonymized safety Reports within the 60-day window. It is not implemented yet.
- The baseline event size is at least 20 guests and may vary. Use 40 simultaneous guests as the minimum 2× capacity gate, and resize the gate for larger planned events.
- The owner will perform physical mobile QA using `docs/PHYSICAL_QA_RU.md`.
- The owner selected the initial permanent platform-admin email out of band. The address is intentionally not committed to source control; the staging Auth account and private allowlist entry do not exist yet.
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
- Direct Auth-user deletion is incompatible with the selected pseudonymization model: current foreign keys can delete the other participant's shared Match/chat state and safety Reports, Storage objects must be removed first, and issued JWTs can outlive the deleted Auth row until expiry. A forward-only schema change and trusted worker are required.
- CAPTCHA and same-NAT Auth capacity require current isolated/live evidence before pilot approval.

## 9. Remaining staging/live sequence

Completed: isolated staging exists, the full migration chain and hardening migration are applied, core grants/RLS/functions were inspected, the RC1 staging suite and negative cross-profile RLS check passed, the post-hardening security smoke passed, Security Advisor was repeated, and the local regression is green.

1. Add a separate confirmed allowlisted platform-admin test identity and verify moderation; Supabase remains on Free by owner decision.
2. Run the remaining Realtime, Storage, concurrency, retention/deletion-request and moderation checks.
3. Complete physical iPhone Safari and Android Chrome QA.
4. Repeat real Turnstile and the baseline 40-guest shared-NAT/load gate; resize it for any event expected above 20 guests.
5. Close the remaining owner decisions: legal operator/contact, final Privacy wording for 60-day pseudonymized shared data and the anti-abuse threshold.
6. Prepare a production snapshot, coordinated database/frontend order and rollback plan.
7. Separately authorize production migration, frontend deploy and production smoke.

## 10. Deployment statement

Only the forward-only hardening migration was applied to isolated `here-staging`. No production database, production Supabase configuration, frontend hosting or DNS was modified or deployed. Sprint 6 was not started.

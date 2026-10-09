# RYNOW — Sprint 5 verification report

Original Sprint 5 run: 22 August 2026. Final pre-pilot gate addendum: 29 August
2026. Sites version 10 successfully deployed the verified application commit
`25d6613ece09ccaf8268fdb3fd0b45a0b2908dd8` with environment revision 2.

## Architecture and presence

- Client heartbeat every 60 seconds while visible and online.
- Historical Sprint 5 recent-active timeout: five minutes, evaluated from
  server/database time. Sprint 5.1 superseded it with 10-minute recent activity
  and 60-minute discovery eligibility.
- Stale participants remain durable members but leave Room Wall sharing and new Drop eligibility.
- Organizer sees aggregate joined and recent counts; no individual presence analytics is exposed.
- Guests cannot directly update `room_members`; self-bound heartbeat/leave RPCs own the timestamp.
- Migration: `20260822170732_sprint5_presence_reliability.sql`, applied live as remote migration 11/11.

## Reliability and security

- One guarded 15-second foreground Room poll; clean unmount/background/offline behavior.
- Immediate foreground/online refresh and heartbeat.
- Realtime re-authentication, bounded reconnect and persisted chat-history recovery.
- Selected chat history also refreshes through the polling fallback; displayed messages deduplicate by database ID.
- Idempotent message and Report mutations use client UUIDs, unique constraints and short advisory-locked transactions.
- Private avatars re-sign after expiry/fetch failure and fall back to initials.
- Friendly offline, reconnect, generic retry and Auth 429 UX; raw backend errors are not shown.
- Privacy-safe diagnostics exclude message bodies, Interest pairs, report details, profile data and credentials.
- Direct membership timestamp UPDATE privilege is revoked from product roles.
- Final production advisors: 0 ERROR; security 6 INFO / 51 WARN and performance
  18 INFO. WARN/INFO findings were reviewed and are not represented as errors.

## Dedicated Sprint 5 live acceptance

The final green dedicated run used the live project `xwycdnyxuluuhylcnnjh`.

| ID | Result | Evidence |
| --- | --- | --- |
| S5-A | PASS | Real 302-second expiry passed twice; profile/membership persisted. |
| S5-B | PASS | Heartbeat restored recent presence; membership stayed unique. |
| S5-C | PASS | 20 sessions; 20 concurrent joins; count 20; second Room isolated. |
| S5-D | PASS | 10 concurrent claims; persistent assignments; variance 2. |
| S5-E | PASS | Six parallel Interest requests produced one Interest and one budget use. |
| S5-F | PASS | Six reciprocal accepts returned one Match. |
| S5-G | PASS | Scheduled Drop became live after background-equivalent delay. |
| S5-H | PASS | Disconnect/reconnect recovered the offline message and delivered the new message without duplicates. |
| S5-I | PASS | Block stopped all later sends and hid the Match. |
| S5-J | PASS | Closed Room rejected discovery while existing chat and Match avatar remained available. |
| S5-K | PASS | 429 maps to the dedicated safe message. |
| S5-L | PASS | One-second signed URL expired; a re-signed URL fetched successfully. |
| S5-M | PASS | Offline/read recovery contract and retry UI are present. |
| S5-N | PASS | One guarded poll, visibility/offline guards and cleanup verified. |
| S5-O | PASS | Analytics presence envelope and canonical counts passed live. |
| S5-P | PASS | No outcome/popularity feedback; exposure variance remained bounded. |
| S5-Q | PASS | Foreign profile/membership/drop/message/analytics/private access attacks were rejected. |
| S5-R | PASS | Live RPC/schema surface, static contracts, typecheck, lint, build and secret scan passed. |

Measured final run: concurrent joins 249 ms total; concurrent claims 458 ms total; exposure max-minus-min variance 2. The suite also passed earlier with join totals between 2.8–4.1 seconds while anonymous Auth was under heavier pressure.

Post-run database sanity: zero recorded deadlocks, zero duplicate memberships,
zero duplicate canonical Matches, and no direct authenticated UPDATE grant on
`room_members`. At inspection time the project had 26/60 direct connections in
use (2 active); earlier Realtime pressure occurred only during the burst.

## Full regression ledger

- Current post-Sprint-5 Sprint 1 A–G: PASS 8/8, including a real anonymous guest, session restoration, closed-Room rejection and cross-user/cross-Room RLS probes.
- Current post-Sprint-5 Sprint 2 A–O: PASS 16/16.
- Current post-Sprint-5 Sprint 3 A–N: PASS 15/15, including persisted-history recovery when Realtime delivery is temporarily unavailable.
- Current post-Sprint-5 Sprint 4 A–P: PASS 18/18.
- Current post-Sprint-5 Organizer Auth: PASS 8/8 test nodes (parent plus seven scenarios).
- Dedicated S5-A–S5-R: PASS 17/17 after the migration and runtime changes.

The suites were rerun individually to stay within Supabase project Auth quotas.
An earlier all-in-one rerun hit the documented anonymous/signup 429 limit; after
quota recovery, the remaining identity-sensitive suites above passed live without
source-inspection substitutions.

Final strict post-Auth-gate rerun: Organizer Auth + Sprint 1–5 + Sprint 5.1
passed 92/92 with 0 fail and 0 skip. It included the real 603-second presence
expiry, 20 concurrent joins, 10 concurrent Drop claims and exposure variance 2.
Local typecheck/lint/Auth/static/render/security/build verification passed 20/20.
The additive migration chain is reconciled at 18/18 through
`20260829125141_allow_owner_avatar_cleanup`.

## Browser/device status

- Physical device status: **ONE-PHONE PASS** for real Test1/Test2 QR, returning
  session, profile edit and refresh. A second phone was unavailable.
- Browser emulation at 390×844: **EMULATED PASS** for landing, organizer Auth, isolated demo and a closed real QR Room.
- Deployed-host smoke: **PARTIAL**. Landing/current product, full isolated `/demo`,
  closed-Room no-write behavior, organizer route/widget fail-closed behavior and
  the credential scan of all nine deployed JavaScript bundles passed. A fresh
  organizer/Room/two-guest path remains pending because two automated in-app
  Browser contexts received no legitimate Managed Turnstile proof; no request or
  data was created and CAPTCHA was not bypassed.
- Human-browser continuation: organizer Room `Test1` is real/open and its exact
  join URL returns HTTP 200. One returning guest reused a nine-day-old identity
  and profile, created exactly one active membership and advanced presence 209
  seconds after join without duplication. A
  returning-profile name/photo editor is implemented and published as a narrow
  pre-pilot patch. Its isolated live mutation/storage test
  passed 1/1, including denial of the replaced path to an unrelated authenticated
  user, owner-bound exact-object Storage cleanup confirmation and stable
  identity/18+/membership state. New uploads and signed tokens use a five-minute
  TTL; a browser-cached legacy upload can retain its prior one-hour TTL.
  The published editor then passed human production verification in real Room
  `Test2`: the same UUID changed `Pavel` to `Rooney` and replaced its avatar,
  retained 18+ and Test1 membership, joined Test2 exactly once, persisted after
  refresh, and left only the new Storage object.
  Second-guest/social-loop smoke is **NOT EXECUTED** because no second physical
  device was available; it was not replaced with reused-session evidence.
- Version 10 post-deploy static smoke returned HTTP 200 for `/`, `/organizer`,
  `/demo` and the real `Test1` join route. All 13 referenced browser bundles
  loaded; `Edit profile` is present and no service-role key, Supabase secret key
  or database credential was found.
- No horizontal overflow on checked screens; checked interactive controls are at least 44 px after the mobile sanity fixes.
- Camera/gallery, iOS Safari keyboard/safe-area behavior and Android Chrome backgrounding remain physical-device QA items.

## Known limitations and open pilot risks

- The actual anonymous limit is configured through the supported Supabase setting
  at 1800/hour/IP with IP forwarding off. AUTH-P1 passed 100/100 fresh users over
  588.973 seconds and AUTH-P2 passed 50/50 over 49.487 seconds from one NAT, both
  with zero HTTP 429. The fixed hosted burst bucket remains 30 and should still be
  monitored during a physical pilot.
- During peak test load, Realtime logs reported only 9 available database connections when 12 were required. Bounded reconnect and Postgres-history fallback recovered, but connection headroom should be monitored or increased for the event.
- Leaked-password protection is not enabled for organizer Auth.
- Hosted password-recovery email/click has not been smoke-tested with a real inbox.
- The production URL serves Sites version 10 with the full verified Sprint 1–5.1
  release. The two-device ordinary-browser fresh-user smoke is recorded as not
  executed because a second physical device was unavailable.
- Physical iOS Safari/Android Chrome QA is pending.

Bug classification at handoff: `P0 = 0`, `P1 = 0` in all completed live
scenarios. Realtime headroom and pending physical QA are open pilot risks, not
silently closed findings.

## Release rule

The final regression is green, P0=0/P1=0, and Sites version 10 successfully
deployed the exact verified application commit. The owner ended the remaining
two-device smoke because no second phone was available. The temporary Auth-gate
Supabase project was permanently deleted and verified absent through both CLI and
the connected project list; the one-time local CLI session was removed. Execute
`REAL_DEVICE_QA.md` when 10–20 pilot devices are available. Do not start Sprint 6.

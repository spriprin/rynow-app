# HERE — Sprint 5 verification report

Date: 22 August 2026. Status: local release candidate; not deployed.

## Architecture and presence

- Client heartbeat every 60 seconds while visible and online.
- Recent active timeout: five minutes, evaluated from server/database time.
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
- Post-DDL advisors: 0 ERROR; security 47 reviewed notices, performance 14 INFO notices.

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

## Browser/device status

- Actual physical devices: **not tested**.
- Browser emulation at 390×844: **EMULATED PASS** for landing, organizer Auth, isolated demo and a closed real QR Room.
- No horizontal overflow on checked screens; checked interactive controls are at least 44 px after the mobile sanity fixes.
- Camera/gallery, iOS Safari keyboard/safe-area behavior and Android Chrome backgrounding remain physical-device QA items.

## Known limitations and open pilot risks

- Supabase anonymous sign-in and generated email signup can return 429 during repeated same-IP load tests. Existing sessions recover; new guests see friendly retry UX. Venue NAT concentration must be tested before the pilot.
- During peak test load, Realtime logs reported only 9 available database connections when 12 were required. Bounded reconnect and Postgres-history fallback recovered, but connection headroom should be monitored or increased for the event.
- Leaked-password protection is not enabled for organizer Auth.
- Hosted password-recovery email/click has not been smoke-tested with a real inbox.
- The public URL still serves the old Sprint 1 frontend; the live database is newer.
- Physical iOS Safari/Android Chrome QA is pending.

Bug classification at handoff: `P0 = 0`, `P1 = 0` in all completed live scenarios. Auth/Realtime project-capacity headroom and pending physical QA are open pilot risks, not silently closed findings.

## Release rule

Do not deploy automatically. The final regression is green; deploy only the exact
release-candidate commit when explicitly requested, run production smoke, then
execute `REAL_DEVICE_QA.md` on 10–20 devices. Do not start Sprint 6.

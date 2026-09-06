# HERE — 10–20 device QA checklist

This checklist is for the stage after an explicitly approved production deployment. Browser emulation is not a substitute for these results.

Sites version 14 is deployed. Its 390×844 production browser smoke passed, but the
physical iOS/Android and multi-device boxes below remain intentionally unchecked.

## Test matrix

Include at least:

- recent iPhone + Safari;
- older supported iPhone + Safari;
- recent Android + Chrome;
- mid-range/older Android + Chrome;
- venue Wi‑Fi and cellular connections;
- two devices returning after 15+ minutes in the background;
- at least one Room with 10–20 devices active together.

## Per-device flow

- [ ] Open the exact `/r/{join_code}` URL from the event QR.
- [ ] Anonymous join shows no email/password/Google guest screen.
- [ ] Camera avatar input works.
- [ ] Gallery avatar input works.
- [ ] Name, gender and 18+ onboarding completes once; default Show me is Women for
      male, Men for female and Everyone for prefer-not-to-say.
- [ ] Existing pre-migration profile sees only the lightweight gender completion;
      UUID, name/photo, membership, Matches and chat remain unchanged.
- [ ] Profile edit changes name/photo/gender/Show me; existing assigned cards and
      Incoming Interests stay visible, while the next assignment uses the new value.
- [ ] Refresh keeps the same profile and membership.
- [ ] Room Wall count and limited real avatar sample load.
- [ ] Drop countdown follows server state and reaches ready/forming correctly.
- [ ] Your Drop claim persists after refresh and does not reroll.
- [ ] Next and Interested tolerate double taps without duplicates.
- [ ] Incoming Interest shows the sender to the recipient.
- [ ] Interested Too creates one Match.
- [ ] Chat sends, receives, persists and scrolls with the keyboard open.
- [ ] Background/lock for 15+ minutes, then return without a full reload.
- [ ] Drop/Interest/Match changes made while backgrounded appear after return.
- [ ] Disable network, observe recoverable UX, reconnect and recover current state.
- [ ] Avatar recovers after a long wait or failed request.
- [ ] Block stops later messages without notifying the blocked person.
- [ ] Report and Report and Block complete once on double tap.
- [ ] Organizer closes Room; new discovery stops while existing Match/chat remains.
- [ ] Safe areas, modals, scroll, countdown and destructive actions remain usable.
- [ ] Repeat Room home/Wall, Explore, Incoming, Matches, Drop, chat, Profile, Leave
      and Safety at 360/375/390/412/430px-equivalent widths: no main horizontal scroll.
- [ ] Focus onboarding name, Profile name, chat, organizer, report select/textarea:
      no unintended iOS auto-zoom; browser pinch zoom remains available.

## Result template

| Device | Browser | OS | Flow result | Bug | Severity | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Example: iPhone 15 | Safari | iOS 19.x | PASS/FAIL | Short title or none | P0/P1/P2/P3 | Network, step, screenshots/log time |

Severity:

- **P0** — security/privacy failure or data corruption;
- **P1** — core pilot flow unusable;
- **P2** — important degraded UX with a workaround;
- **P3** — cosmetic/non-blocking.

Pilot entry requires `P0 = 0` and `P1 = 0`. Record exact device/browser/OS rather than “mobile”.

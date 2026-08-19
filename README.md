# HERE — Sprint 1 Real Foundation

HERE is a mobile-first social discovery web app for physical events. Sprint 1 implements only the durable foundation:

**Organizer creates a real Room → QR opens `/r/{join_code}` → guest receives a persistent anonymous session → creates a minimal profile → joins the Room → real participants survive refresh and remain isolated by Room.**

## Product routes

| Route | Current behavior |
| --- | --- |
| `/` | Marketing landing page with a link to the isolated demo |
| `/r/{join_code}` | Real Supabase Room flow; never falls back to fake people |
| `/organizer` | Minimal protected organizer flow for real Rooms and QR codes |
| `/demo` | Legacy interactive mock experience, explicitly isolated from production routes |

Sprint 1 does **not** implement Drops, Fair Exposure, Interests, Matches, Chat, payments, Premium, recommendations, or social login.

## Stack

- Vinext/Next.js-compatible App Router, React 19 and TypeScript;
- `@supabase/supabase-js` and `@supabase/ssr`;
- Supabase Auth anonymous users for guests;
- PostgreSQL with RLS for profiles, Rooms and memberships;
- private Supabase Storage bucket for avatars;
- QR generation with `qrcode`.

## Supabase setup

1. Create a Supabase project.
2. Apply `supabase/migrations/202608110001_initial.sql` to a fresh project.
3. In Supabase Authentication settings, enable **Allow anonymous sign-ins**.
4. Create one permanent email/password Auth user for organizer development access. There is no organizer signup in the app.
5. Copy `.env.example` to `.env.local` and set:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Never place a service-role key in this project or any browser environment variable.

## Guest flow

The public join code is a server-generated 24-character cryptographic token. Opening `/r/{join_code}` resolves only the safe Room fields through an RPC. A closed Room stops before Auth and displays `This Room has ended.`

For an open Room:

1. the browser restores its Supabase cookie session or calls `signInAnonymously()` once;
2. an existing profile is reused;
3. a new guest completes exactly three onboarding screens: photo, first name, and 18+ confirmation;
4. the photo is uploaded to the private `avatars/{user_id}/...` folder and only its path is stored in PostgreSQL;
5. `join_room_by_code` creates or reactivates the `(room_id, user_id)` membership and updates `last_seen_at`;
6. the Room screen reads only real memberships and minimal shared profile fields.

The Room Wall shows a maximum of 12 participant thumbnails. It has no Interest, Match, Drop or Chat controls.

## Organizer flow

`/organizer` accepts only a pre-created permanent Supabase Auth account. Anonymous JWTs are rejected by the Room insert/update policies. The organizer can:

- create a Room with name, venue, city, start and end time;
- receive its real `/r/{join_code}` link and QR;
- download the QR PNG or copy the link;
- see only aggregate joined count;
- close the Room.

The organizer does not receive direct access to individual memberships, private user interaction data, or future chats.

## RLS summary

- `profiles`: direct reads/inserts/updates are limited to the owner; active Room members receive only `id`, `display_name` and `avatar_path` through the narrow Room Wall RPC;
- `rooms`: owner read/update; participants read only after membership; public QR resolution is a narrow safe-fields RPC;
- `room_members`: direct inserts are not granted; the authenticated user joins only through the idempotent security-definer RPC; members can read memberships only in Rooms they belong to and update only their own presence columns;
- `storage.objects`: avatar reads are limited to the owner or active co-members; writes must target the authenticated user’s own folder.

No private user table contains `using (true)` policies.

## Development

```text
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

The regular test command runs render/security contract tests. Full A–G integration tests require a configured disposable Supabase project:

```text
HERE_TEST_SUPABASE_URL=...
HERE_TEST_SUPABASE_PUBLISHABLE_KEY=...
HERE_TEST_ORGANIZER_EMAIL=...
HERE_TEST_ORGANIZER_PASSWORD=...
pnpm test:acceptance
```

## Current boundary

The repository intentionally contains no production seed users or fake Rooms. The legacy mock people, Interests, Matches and Chat remain accessible only on `/demo` for design reference. They are not queried or inserted by the real QR and organizer routes.

See `docs/ARCHITECTURE.md` for the trust boundaries and future compatibility notes.

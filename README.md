# HERE — IRL social discovery MVP

HERE turns a physical event or venue into a temporary digital room. Guests scan a QR, opt into visibility, privately express interest, match only when interest is mutual, and can then chat in realtime.

The repository contains two deliberately connected modes:

- **Production mode:** Supabase Auth, PostgreSQL, Row Level Security, Storage and Realtime. Enabled when the public Supabase environment variables are present.
- **Demo mode:** a complete interactive product walkthrough with realistic data when no Supabase keys are configured. It lets reviewers test the experience immediately; it is not used as production persistence.

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/r/friday-social` | QR destination and join flow |
| `/demo` | Signed-in guest experience |
| `/organizer` | Organizer dashboard, room creation and QR export |

The core flow is implemented end to end: **QR → room → authentication → short profile → opt-in discovery → interest → mutual match → realtime chat**. Organizer room closing stops discovery and new interests while matches and chats remain available.

## Local setup

Requirements: Node.js 22.13+ and a Supabase project.

1. Install dependencies with `pnpm install` (or `npm install`).
2. Copy `.env.example` to `.env.local`.
3. Add your Supabase project URL and anonymous key.
4. Apply `supabase/migrations/202608110001_initial.sql` in the Supabase SQL editor or with `supabase db push`.
5. Optionally apply `supabase/seed.sql` for the demo organizer, 17 guest profiles, interests, matches and chats.
6. Enable Google in Supabase Authentication → Providers and add `http://localhost:5173/**` as an allowed redirect URL.
7. Run `pnpm dev` and open the printed local URL.

Without step 2, the app intentionally starts in interactive demo mode. Any email and a 6+ character password continue through the demo onboarding.

### Demo Supabase accounts

- Organizer: `organizer@here.demo` / `demo-password`
- Guest: `maya@here.demo` / `demo-password`

The seed also adds `noah@here.demo`, `sofia@here.demo` and the other visible profiles with the same password.

## Supabase setup

The migration creates:

- `profiles`, `rooms`, `room_members`, `interests`, `matches`, `messages`, `blocks`, and `reports`;
- foreign keys, chronological and discovery indexes, unique memberships/interests/matches, and safe cascades;
- an 18+ database gate;
- `profile-photos` Storage with owner-folder write policies;
- Realtime publication for `messages`;
- RLS on every application table;
- security-definer functions for join, visibility, analytics and interest → match.

Important: the client never supplies a trusted user identity. `auth.uid()` is used inside policies/functions, matches have no direct client insert policy, and duplicate pair creation is prevented by canonical ordering plus a database constraint.

## Authentication and QR return flow

Supabase retains the session in the browser. The Google redirect is set to the original `/r/[slug]` room URL, so a scanned room is not lost across sign-in. Email/password stays in the same flow and proceeds directly into one-time profile creation. Apple can be added later as another Supabase provider without changing the data model.

## Deployment to Vercel

1. Import this directory into Vercel.
2. Set the framework preset to Next.js and use the repository’s build command.
3. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL` in Vercel project settings.
4. Add the production domain and `https://your-domain.com/**` to Supabase Auth redirect URLs.
5. Deploy, then create a room and test its downloaded QR on another phone.

No service-role key belongs in the browser or Vercel public environment variables.

## Quality checks

Run:

```text
pnpm lint
pnpm typecheck
pnpm build
```

## MVP limitations

- Reports are recorded but there is no moderator console yet.
- Email confirmation behavior depends on the chosen Supabase Auth settings.
- Demo state resets on reload; production state is durable in Supabase.
- Uploaded cover-image controls are represented in the MVP UI; profile-photo Storage policy and schema are ready, while production upload wiring should be completed before a public launch.
- Analytics are live counts, not a historical BI system.
- There is no push notification, typing indicator, read-receipt UI, or offline message queue.

## Recommended V2

- Moderator review queue and venue-level ban lists.
- Apple sign-in, verified organizer accounts and team roles.
- Push notifications and optional “where to meet” prompts.
- Rate limits, abuse heuristics and content moderation.
- Safer segmented age cohorts if audiences below 21 are introduced.
- Room templates, organizer teams, branded posters and scheduled lifecycle changes.
- Privacy-preserving recommendation ranking based on declared intent—not location tracking.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for boundaries, trust decisions and the acceptance flow.

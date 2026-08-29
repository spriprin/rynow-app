import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", host: "localhost" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the product landing page", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Real people/);
  assert.match(html, /Same place/);
  assert.match(html, /Try the product demo/);
  assert.match(html, /Create a Room/);
  assert.match(html, /Room Wall creates abundance/);
  assert.match(html, /Interested Too/);
  assert.doesNotMatch(html, /Open to meet|Selective/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps real QR and organizer routes separate from demo data", async () => {
  const [roomResponse, organizerResponse, demoResponse] = await Promise.all([
    render("/r/friday-social"),
    render("/organizer"),
    render("/demo"),
  ]);
  assert.equal(roomResponse.status, 200);
  assert.equal(organizerResponse.status, 200);
  const roomHtml = await roomResponse.text();
  assert.match(roomHtml, /Opening Room/i);
  assert.doesNotMatch(roomHtml, /Noah|Sofia|93 visible/i);
  const organizerHtml = await organizerResponse.text();
  assert.match(organizerHtml, /Opening organizer space/i);
  assert.doesNotMatch(organizerHtml, /142|287|Friday Social Night/i);
  const demoHtml = await demoResponse.text();
  assert.match(demoHtml, /Product demo/);
  assert.match(demoHtml, /ROOM WALL/);
  assert.match(demoHtml, /74 people here/);
  assert.match(demoHtml, /Explore now/);
  assert.match(demoHtml, /Preview Drop/);
  assert.match(demoHtml, /Create a real Room &amp; QR/);
  assert.doesNotMatch(demoHtml, /Open to meet|visibility-toggle/i);
});

test("organizer self-service Auth keeps permanent and anonymous sessions separate", async () => {
  const [organizer, organizerClient, landing] = await Promise.all([
    readFile(new URL("../app/components/OrganizerFoundationApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/organizer-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProductLanding.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(organizer, /signUp\(/);
  assert.match(organizer, /Create organizer account/);
  assert.match(organizer, /signInWithPassword/);
  assert.match(organizer, /Forgot password\?/);
  assert.match(organizer, /resetPasswordForEmail/);
  assert.match(organizer, /AuthTurnstile/);
  assert.match(organizer, /captchaToken/);
  assert.match(organizer, /updateUser\(\{ password \}\)/);
  assert.match(organizer, /emailRedirectTo: organizerAuthRedirect/);
  assert.match(organizer, /redirectTo: organizerAuthRedirect/);
  assert.match(organizer, /scope: "local"/);
  assert.doesNotMatch(organizer, /ORGANIZER DEVELOPMENT ACCESS|pre-created permanent/i);
  assert.doesNotMatch(organizer, /user_metadata|isAdmin|service[_-]?role/i);
  assert.match(organizerClient, /ORGANIZER_AUTH_COOKIE = "here-organizer-auth"/);
  assert.match(organizerClient, /isSingleton: false/);
  assert.match(organizerClient, /localhost|127\.0\.0\.1/);
  assert.match(organizerClient, /PRODUCTION_ORIGIN/);
  assert.doesNotMatch(organizerClient, /service[_-]?role/i);
  assert.match(landing, /href="\/organizer\?mode=signup"/);
  assert.match(landing, /href="\/organizer\?mode=signin"/);
  assert.doesNotMatch(landing.replaceAll("aria-hidden", ""), /Open to meet|Hidden|Selective/i);
});

test("current demo models the authoritative Explore + Drops flow without production writes", async () => {
  const demo = await readFile(new URL("../app/components/CurrentProductDemo.tsx", import.meta.url), "utf8");
  for (const contract of ["Room Wall", "Explore", "all evening", "Your Drop", "Adaptive Interest Budget", "Interests left", "Interested in You", "Interested Too", "IT’S MUTUAL", "Message Sofia", "Block Sofia", "Report", "Report and Block"]) {
    assert.match(demo, new RegExp(contract, "i"));
  }
  assert.match(demo, /one profile at a time/i);
  assert.match(demo, /sample people and interactions only/i);
  assert.match(demo, /Nothing is written to production/i);
  assert.doesNotMatch(demo, /supabase|from\("|rpc\(|insert\(|update\(|storage\./i);
  assert.doesNotMatch(demo, /Open to meet|visibility-toggle|Interest stays private/i);
});

test("Sprint 1 migration enforces the foundation trust boundaries", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608110001_initial.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table public\.profiles/i);
  assert.match(migration, /create table public\.rooms/i);
  assert.match(migration, /create table public\.room_members/i);
  assert.match(migration, /primary key \(room_id, user_id\)/i);
  assert.match(migration, /extensions\.gen_random_bytes\(12\)/i);
  assert.match(migration, /function public\.rooms_set_join_code\(\)[\s\S]*security definer/i);
  assert.match(migration, /alter column join_code drop default/i);
  assert.match(migration, /signInAnonymously|anonymous/gi);
  assert.match(migration, /create or replace function public\.join_room_by_code/i);
  assert.match(migration, /create or replace function public\.room_wall_profiles/i);
  assert.match(migration, /create policy "profiles_read_self"/i);
  assert.match(migration, /on conflict \(room_id, user_id\) do update/i);
  assert.match(migration, /target_room\.status = 'closed'/i);
  assert.match(migration, /profiles_update_self/i);
  assert.match(migration, /memberships_update_self/i);
  assert.match(migration, /rooms_update_owner/i);
  assert.match(migration, /'avatars'[\s\S]*false,[\s\S]*5242880/i);
  assert.doesNotMatch(migration, /create table public\.(interests|matches|messages)/i);
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
});

test("Sprint 2 is additive, server-generated and popularity-neutral", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608190002_sprint2_drops_interests.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table(?: if not exists)? public\.drops/i);
  assert.match(migration, /create table(?: if not exists)? public\.drop_items/i);
  assert.match(migration, /create table(?: if not exists)? public\.interests/i);
  assert.match(migration, /unique \(room_id, from_user_id, to_user_id\)/i);
  assert.match(migration, /create or replace function public\.claim_your_drop\(p_drop_id uuid\)/i);
  assert.match(migration, /returns table \([\s\S]*?item_position integer/i);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /first_seen_at = coalesce\(first_seen_at, clock_timestamp\(\)\)/i);
  assert.match(migration, /pending_count/i);
  assert.match(migration, /create or replace function public\.send_interest\(p_drop_item_id uuid\)/i);
  assert.match(migration, /used_budget >= allowed_budget/i);
  assert.match(migration, /create or replace function public\.interested_in_you\(p_room_id uuid\)/i);
  assert.match(migration, /create or replace function public\.sent_interests\(p_room_id uuid\)/i);
  assert.match(migration, /i\.from_user_id = auth\.uid\(\)/i);
  assert.match(migration, /drop_items and interests intentionally have no direct table policies/i);
  assert.doesNotMatch(migration, /create table public\.(matches|messages)/i);

  const rankingBlock = migration.match(/with candidate_exposure as \([\s\S]*?\), ranked as \([\s\S]*?\)\n {4}select/i)?.[0] || "";
  assert.match(rankingBlock, /delivered_count/);
  assert.match(rankingBlock, /pending_count/);
  assert.doesNotMatch(rankingBlock, /interests|interest_budget|popularity/i);
});

test("client bundle source never references a service role key", async () => {
  const files = await Promise.all([
    "../app/components/RoomJoinApp.tsx",
    "../app/components/OrganizerFoundationApp.tsx",
    "../lib/supabase/client.ts",
    "../lib/supabase/organizer-client.ts",
    "../app/components/AuthTurnstile.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /service[_-]?role/i);
  assert.match(files[0], /signInAnonymously\(\{[\s\S]*options: \{ captchaToken \}/);
  assert.match(files[0], /getSession\(\)[\s\S]*isTurnstileConfigured/);
  assert.match(files[0], /Existing guest sessions skip this check/);
  assert.match(files[0], /createdSession[\s\S]*setScreen\("error"\)/);
  assert.match(files[1], /signInWithPassword\([\s\S]*captchaToken/);
  assert.match(files[1], /resetPasswordForEmail\([\s\S]*captchaToken/);
  assert.match(files[4], /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.doesNotMatch(files[4], /secret|service[_-]?role/i);
  assert.match(files[0], /join_room_by_code/);
  assert.match(files[0], />Edit profile</);
  assert.match(files[0], /setScreen\("edit-profile"\)/);
  const returningProfileEdit = files[0].match(/async function saveReturningProfile\(\) \{[\s\S]*?\n {2}\}\n\n {2}async function joinReturningGuest/)?.[0] || "";
  assert.match(returningProfileEdit, /getUser\(\)/);
  assert.match(returningProfileEdit, /userData\.user\.id !== profile\.id/);
  assert.match(returningProfileEdit, /update\(\{ display_name: expectedDisplayName, avatar_path: expectedAvatarPath \}\)[\s\S]*\.eq\("id", userData\.user\.id\)/);
  assert.match(returningProfileEdit, /storage\.from\("avatars"\)\.upload\(expectedAvatarPath/);
  assert.match(returningProfileEdit, /reconciliationError[\s\S]*reconciled\?\.display_name === expectedDisplayName[\s\S]*reconciled\.avatar_path === expectedAvatarPath/);
  assert.match(returningProfileEdit, /removeAvatarWithRetry[\s\S]*attempt <= 3/);
  assert.doesNotMatch(returningProfileEdit, /signInAnonymously|room_members|join_room_by_code/);
  assert.match(files[0], /SIGNED_AVATAR_SECONDS = 300/);
  assert.match(files[0], /SIGNED_AVATAR_CACHE_MS = 4 \* 60 \* 1000/);
  assert.equal((files[0].match(/cacheControl: "300"/g) || []).length, 2);
  assert.match(files[0], /previously opened link can remain cached for up to one hour \(new uploads: five minutes\)/);
  assert.match(files[3], /NEXT_PUBLIC_APP_URL/);
  assert.match(files[1], /margin: 4/);
  assert.match(files[1], /Open join link/);
  assert.match(files[0], /room_drop_state/);
  assert.match(files[0], /claim_your_drop/);
  assert.match(files[0], /mark_drop_item_seen/);
  assert.match(files[0], /Interested in You/i);
  assert.match(files[0], /new Date\(target\)\.getTime\(\) > nowMs/);
  assert.match(files[0], /aria-expanded=\{incomingOpen\}/);
});

test("replaced avatar paths cannot receive new non-owner signed URLs before physical cleanup", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260828092916_restrict_replaced_avatar_reads.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /function public\.can_current_user_read_current_avatar\([\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /from public\.profiles p[\s\S]*p\.id = target[\s\S]*p\.avatar_path = object_name/i);
  assert.match(migration, /alter policy avatars_read_owner_or_shared_room on storage\.objects[\s\S]*can_current_user_read_current_avatar/i);
  assert.match(migration, /revoke all on function public\.can_current_user_read_avatar\(uuid\)[\s\S]*authenticated/i);
});

test("avatar owners retain only the read access required for exact Storage cleanup", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260829125141_allow_owner_avatar_cleanup.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter policy avatars_read_owner_or_shared_room on storage\.objects/i);
  assert.match(migration, /storage\.foldername\(name\)[\s\S]*auth\.uid\(\)[\s\S]*owner_id[\s\S]*auth\.uid\(\)/i);
  assert.match(migration, /or public\.can_current_user_read_current_avatar/i);
});

test("Auth release gates are isolated, complete and skip-intolerant", async () => {
  const [helpers, capacity, captcha, runner] = await Promise.all([
    "../tests/live-auth-helpers.mjs",
    "../tests/auth-capacity.test.mjs",
    "../tests/auth-captcha.test.mjs",
    "../scripts/run-live-acceptance.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(helpers, /Cloudflare test proof must never be used against the HERE production Supabase project/);
  assert.match(helpers, /HERE_TEST_ISOLATED_PROJECT_REF/);
  assert.match(helpers, /OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN/);
  assert.match(helpers, /HERE_TEST_DELETE_ISOLATED_PROJECT_AFTER_RUN/);
  assert.match(helpers, /HERE_REQUIRE_RELEASE_GATES !== "true"/);
  assert.match(capacity, /AUTH-P1 \/ PP-Q/);
  assert.match(capacity, /AUTH-P2 \/ PP-P/);
  assert.match(capacity, /official repeatable Turnstile test token/);
  assert.match(capacity, /assertAuthorizedIsolatedAuthLoad\(url, key\)/);
  assert.match(captcha, /OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN/);
  assert.match(captcha, /production-negative/);
  assert.match(captcha, /captchaToken: validToken/);
  assert.match(runner, /HERE_TEST_CREATE_ORGANIZER/);
  assert.match(runner, /HERE_TEST_EMAIL_CONFIRMATION_DISABLED_VERIFIED/);
  assert.match(runner, /HERE_TEST_FAST_RECHECK/);
  assert.match(runner, /HERE_TEST_AUTH_CAPACITY_VERIFIED/);
  assert.match(runner, /HERE_TEST_AUTH_CAPTCHA_ACCEPT_VERIFIED/);
  assert.match(runner, /releaseGate \? regressionSuites/);
  assert.match(runner, /full anonymous Auth bucket/);
  assert.match(runner, /HERE_TEST_REAL_TURNSTILE_BROWSER_VERIFIED/);
  assert.match(runner, /# SKIP\\b/);
});

test("Sprint 3 creates one secure social loop without popularity ranking", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608200003_sprint3_matches_chat_safety.sql", import.meta.url),
    "utf8",
  );
  const hardening = await readFile(
    new URL("../supabase/migrations/202608200004_sprint3_live_hardening.sql", import.meta.url),
    "utf8",
  );
  const roomSource = await readFile(new URL("../app/components/RoomJoinApp.tsx", import.meta.url), "utf8");

  for (const table of ["matches", "messages", "blocks", "reports"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(migration, /matches_room_pair_unique unique \(room_id, user_a_id, user_b_id\)/i);
  assert.match(migration, /create or replace function public\.respond_to_interest\(p_interest_id uuid, p_interested boolean\)/i);
  assert.match(migration, /i\.id = p_interest_id and i\.to_user_id = current_user_id/i);
  assert.match(migration, /on conflict \(room_id, user_a_id, user_b_id\) do nothing/i);
  assert.match(migration, /create or replace function public\.send_match_message\(p_match_id uuid, p_body text\)/i);
  assert.match(migration, /create or replace function public\.block_user\(p_blocked_id uuid\)/i);
  assert.match(migration, /create or replace function public\.submit_report/i);
  assert.match(migration, /not public\.is_pair_blocked\(current_user_id, rm\.user_id\)/i);
  const rankingBlock = migration.match(/with candidate_exposure as \([\s\S]*?\), ranked as \([\s\S]*?\)\n {4}select/i)?.[0] || "";
  assert.doesNotMatch(rankingBlock, /matches|messages|interests|popularity/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.messages/i);
  assert.match(migration, /rooms_insert_permanent_organizer[\s\S]*is_anonymous[\s\S]*auth\.jwt\(\)[\s\S]*email/i);
  assert.match(hardening, /rooms_insert_permanent_guard[\s\S]*as restrictive for insert/i);
  assert.match(hardening, /alter table public\.messages replica identity full/i);

  assert.match(roomSource, /Interested Too/);
  assert.match(roomSource, /Not for me/);
  assert.match(roomSource, /IT’S MUTUAL/);
  assert.match(roomSource, /send_match_message/);
  assert.match(roomSource, /postgres_changes/);
  assert.match(roomSource, /Report and Block/);
});

test("Sprint 4 exposes owner-only aggregates and instruments only real product events", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260822140308_sprint4_privacy_safe_room_analytics.sql", import.meta.url),
    "utf8",
  );
  const historicalGuard = await readFile(
    new URL("../supabase/migrations/20260822140736_sprint4_no_historical_claim_backfill.sql", import.meta.url),
    "utf8",
  );
  const roomSource = await readFile(new URL("../app/components/RoomJoinApp.tsx", import.meta.url), "utf8");
  const organizerSource = await readFile(new URL("../app/components/OrganizerAnalytics.tsx", import.meta.url), "utf8");

  assert.match(migration, /create table private\.drop_claim_states/i);
  assert.match(migration, /primary key \(drop_id, viewer_id\)/i);
  assert.match(migration, /create table private\.interest_opens/i);
  assert.match(migration, /create or replace function public\.mark_incoming_interest_opened/i);
  assert.match(migration, /i\.to_user_id = current_user_id[\s\S]*i\.status = 'pending'/i);
  assert.match(migration, /create or replace function public\.block_user_in_context/i);
  assert.match(migration, /create or replace function public\.room_analytics/i);
  assert.match(migration, /r\.organizer_id = current_user_id/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /when cr\.claim_attempts = 0 then null/i);
  assert.match(migration, /when ir\.started_runs = 0 then null/i);
  assert.match(migration, /when ints\.interests_sent = 0 then null/i);
  assert.match(migration, /di\.first_seen_at is not null/i);
  assert.match(migration, /revoke all on private\.drop_claim_states from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.room_analytics\(uuid\) from public, anon, authenticated/i);
  assert.match(historicalGuard, /guard_new_claim_instrumentation/i);
  assert.match(historicalGuard, /exists[\s\S]*from public\.drop_items/i);

  assert.match(roomSource, /mark_incoming_interest_opened/);
  assert.match(roomSource, /if \(!incomingOpen \|\| !selectedIncoming/);
  assert.match(roomSource, /block_user_in_context/);
  assert.match(organizerSource, /room_analytics/);
  assert.match(organizerSource, /No data/);
  assert.match(organizerSource, /Joined → Your Drop started → Card seen → Interest → Match → Conversation|From Room to conversation/);
  assert.doesNotMatch(organizerSource, /display_name|avatar_path|from_user_id|to_user_id|message body/i);
});

test("Phase 0 hardens helper RPC identity and trigger privileges", async () => {
  const initialHardening = await readFile(
    new URL("../supabase/migrations/20260820085448_phase0_privilege_hardening.sql", import.meta.url),
    "utf8",
  );
  const internalHelperSeparation = await readFile(
    new URL("../supabase/migrations/20260820103251_restore_internal_membership_checks.sql", import.meta.url),
    "utf8",
  );
  assert.match(initialHardening, /set search_path = ''/i);
  assert.match(initialHardening, /revoke all on function public\.rooms_set_join_code\(\) from public, anon, authenticated/i);
  assert.match(initialHardening, /to_regprocedure\('public\.rls_auto_enable\(\)'\)/i);
  assert.match(internalHelperSeparation, /revoke all on function public\.is_room_member\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(internalHelperSeparation, /revoke all on function public\.shares_active_room\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(internalHelperSeparation, /rm\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(internalHelperSeparation, /mine\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(internalHelperSeparation, /public\.is_current_user_room_member\(id\)/i);
  assert.match(internalHelperSeparation, /public\.shares_current_user_active_room/i);
});

test("Sprint 5 hardens presence, retries, Realtime and duplicate mutations", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260822170732_sprint5_presence_reliability.sql", import.meta.url),
    "utf8",
  );
  const roomSource = await readFile(new URL("../app/components/RoomJoinApp.tsx", import.meta.url), "utf8");
  const reliabilitySource = await readFile(new URL("../lib/reliability.ts", import.meta.url), "utf8");
  const organizerSource = await readFile(new URL("../app/components/OrganizerFoundationApp.tsx", import.meta.url), "utf8");

  assert.match(migration, /last_seen_at >= now\(\) - interval '5 minutes'/i);
  assert.match(migration, /create or replace function public\.heartbeat_room_presence/i);
  assert.match(migration, /set last_seen_at = heartbeat_at,[\s\S]*is_active = true/i);
  assert.match(migration, /revoke update on public\.room_members from authenticated/i);
  assert.match(migration, /rm\.last_seen_at >= instrumentation_now - interval '5 minutes'/i);
  assert.match(migration, /create unique index messages_sender_client_message_uidx/i);
  assert.match(migration, /create unique index reports_reporter_client_action_uidx/i);
  assert.match(migration, /send_match_message_idempotent/i);
  assert.match(migration, /submit_report_idempotent/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /organizer_room_presence_counts/i);

  assert.match(roomSource, /PRESENCE_HEARTBEAT_MS = 60_000/);
  assert.match(roomSource, /document\.visibilityState === "hidden"/);
  assert.match(roomSource, /addEventListener\("online"/);
  assert.match(roomSource, /status === "SUBSCRIBED"[\s\S]*loadMessages/);
  assert.match(roomSource, /ResilientAvatar/);
  assert.match(roomSource, /send_match_message_idempotent/);
  assert.match(roomSource, /submit_report_idempotent/);
  assert.match(reliabilitySource, /value\.status === 429/);
  assert.match(reliabilitySource, /Too many people are joining at once/);
  assert.match(reliabilitySource, /\[HERE operation failed\]/);
  assert.doesNotMatch(reliabilitySource, /body|details|display_name|avatar_path/);
  assert.match(organizerSource, /joined ·.*recent/i);
});

test("Pre-pilot revision makes Explore primary while keeping Drops and explicit presence control", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260824093231_pre_pilot_core_revision.sql", import.meta.url),
    "utf8",
  );
  const [roomSource, landingSource, organizerSource, replacementFix, leftStateFix, fkIndexes] = await Promise.all([
    readFile(new URL("../app/components/RoomJoinApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ProductLanding.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/OrganizerAnalytics.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260824094220_fix_explore_replacement_position.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260824094426_fix_left_presence_state.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260824095156_pre_pilot_fk_indexes.sql", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /add column if not exists discovery_enabled boolean not null default true/i);
  assert.match(migration, /add column if not exists left_at timestamptz/i);
  assert.match(migration, /interval '10 minutes'/i);
  assert.match(migration, /interval '60 minutes'/i);
  assert.match(migration, /create table public\.explore_batches/i);
  assert.match(migration, /create table public\.explore_items/i);
  assert.match(migration, /revoke all on public\.explore_batches from anon, authenticated/i);
  assert.match(migration, /private\.explore_target_size/i);
  assert.match(migration, /database_now \+ interval '15 minutes'/i);
  assert.match(migration, /new_total >= 3/i);
  assert.match(migration, /private\.adaptive_interest_budget/i);
  assert.match(migration, /ceil\(p_batch_size::numeric \* 0\.5\)/i);
  assert.match(migration, /private\.discovery_delivered_count/i);
  assert.match(migration, /private\.discovery_pending_count/i);
  assert.match(replacementFix, /where invalidated_at is null/i);
  assert.match(leftStateFix, /select 1 from public\.room_members/i);
  assert.doesNotMatch(leftStateFix, /public\.is_room_member/i);
  assert.match(fkIndexes, /interests_explore_assignment_idx/i);
  const rankingBlock = migration.slice(migration.indexOf("with candidate_exposure"), migration.indexOf("create or replace function private.complete_explore_batch_if_finished"));
  assert.doesNotMatch(rankingBlock, /matches|messages|status = 'accepted'|popularity/i);

  for (const contract of ["claim_explore_batch", "mark_explore_item_seen", "send_explore_interest", "Leave event", "Rejoin event", "Explore now", "Interested in You", "Matches"]) {
    assert.match(roomSource, new RegExp(contract, "i"));
  }
  assert.match(landingSource, /Explore works all evening/i);
  assert.match(landingSource, /scheduled Drops create synchronized bursts/i);
  assert.match(organizerSource, /discovery eligible/i);
  assert.match(organizerSource, /Explore started/i);
});

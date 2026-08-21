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
  assert.match(demoHtml, /Open Your Drop/);
  assert.match(demoHtml, /Create a real Room &amp; QR/);
  assert.doesNotMatch(demoHtml, /Open to meet|full People catalogue/i);
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

test("current demo models Sprint 3 locally without production writes", async () => {
  const demo = await readFile(new URL("../app/components/CurrentProductDemo.tsx", import.meta.url), "utf8");
  for (const contract of ["Room Wall", "Your Drop", "Interest Budget", "Interests left", "Interested in You", "Interested Too", "IT’S MUTUAL", "Message Sofia", "Block Sofia", "Report", "Report and Block"]) {
    assert.match(demo, new RegExp(contract, "i"));
  }
  assert.match(demo, /one profile at a time/i);
  assert.match(demo, /sample people and interactions only/i);
  assert.match(demo, /Nothing is written to production/i);
  assert.doesNotMatch(demo, /supabase|from\("|rpc\(|insert\(|update\(|storage\./i);
  assert.doesNotMatch(demo, /Open to meet|visibility-toggle|full People catalogue|Interest stays private/i);
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
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /service[_-]?role/i);
  assert.match(files[0], /signInAnonymously\(\)/);
  assert.match(files[0], /join_room_by_code/);
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

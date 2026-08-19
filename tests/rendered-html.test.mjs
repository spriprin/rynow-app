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
  assert.match(html, /Meet the people/);
  assert.match(html, /who are already/);
  assert.match(html, /View product demo/);
  assert.match(html, /Turn your event into/);
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
  assert.match(demoHtml, /Create a real Room &amp; QR/);
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
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /service[_-]?role/i);
  assert.match(files[0], /signInAnonymously\(\)/);
  assert.match(files[0], /join_room_by_code/);
  assert.match(files[1], /NEXT_PUBLIC_APP_URL/);
  assert.match(files[1], /margin: 4/);
  assert.match(files[1], /Open join link/);
  assert.match(files[0], /room_drop_state/);
  assert.match(files[0], /claim_your_drop/);
  assert.match(files[0], /mark_drop_item_seen/);
  assert.match(files[0], /Interested in You/i);
});

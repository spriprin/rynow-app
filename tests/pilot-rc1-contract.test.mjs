import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("RC1 active product contains no Drops or hard Interest budget", async () => {
  const active = (await Promise.all([
    read("../app/components/RoomJoinApp.tsx"), read("../app/components/OrganizerFoundationApp.tsx"),
    read("../app/components/OrganizerAnalytics.tsx"), read("../app/components/CurrentProductDemo.tsx"),
    read("../app/components/ProductLanding.tsx"), read("../app/globals.css"),
  ])).join("\n");
  assert.doesNotMatch(active, /\bDrops?\b|Your Drop|Interest Budget|Interests left/i);
  assert.doesNotMatch(active, /room_drop_state|claim_your_drop|send_interest\b|open_drop_now|create_room_drop/i);
  assert.match(active, /claim_explore_batch/);
  assert.match(active, /You’ve seen everyone available right now/);
});

test("RC1 Explore is server-curated, fair, continuously refilled and abuse protected", async () => {
  const migration = await read("../supabase/migrations/20260914135346_pilot_rc1_continuous_explore.sql");
  const claim = migration.match(/create or replace function public\.claim_explore_batch[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(claim, /pending<=3/i);
  assert.match(claim, /pending<=3 and has_candidate/i);
  assert.match(claim, /limit greatest\(0,10-pending\)/i);
  assert.match(claim, /private\.is_discovery_eligible/i);
  assert.match(migration, /private\.viewer_accepts_candidate/i);
  assert.match(migration, /is_pair_blocked/i);
  assert.match(claim, /viewer_has_seen_candidate/i);
  assert.match(claim, /viewer_has_pending_candidate/i);
  assert.match(migration, /create table private\.rc1_legacy_seen_profiles/i);
  assert.match(migration, /insert into private\.rc1_legacy_seen_profiles[\s\S]*from public\.drop_items where first_seen_at is not null/i);
  assert.match(migration, /alter table private\.rc1_legacy_seen_profiles enable row level security/i);
  assert.match(migration, /or exists \(select 1 from private\.rc1_legacy_seen_profiles/i);
  assert.match(claim, /discovery_delivered_count[\s\S]*discovery_pending_count/i);
  assert.match(claim, /random\(\)/i);
  assert.doesNotMatch(claim, /interest_budget|drop_items|order by[^;\n]*popular/i);
  const send = migration.match(/create or replace function public\.send_explore_interest[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(send, /rapid_interest_limit/i);
  assert.match(send, /pg_advisory_xact_lock/i);
  assert.doesNotMatch(send, /interest_budget|Interests left/i);
  assert.match(migration, /revoke all on function public\.room_drop_state/i);
  assert.doesNotMatch(migration, /^\s*(drop table|truncate)\b/im);
});

test("RC1 social, notification, outcome and safety access is identity-bound", async () => {
  const [migration, exploreMigration] = await Promise.all([
    read("../supabase/migrations/20260914135348_pilot_rc1_connections_safety_operations.sql"),
    read("../supabase/migrations/20260914135346_pilot_rc1_continuous_explore.sql"),
  ]);
  for (const contract of [
    "user_notifications", "notification_state", "user_connections", "match_irl_feedback",
    "record_match_irl_feedback", "submit_report_rc1", "platform_admins",
    "admin_operations_rooms", "admin_report_queue", "user_data_deletion_requests",
  ]) assert.match(migration, new RegExp(contract, "i"));
  assert.match(migration, /unique\(recipient_id,kind,source_id\)/i);
  assert.match(migration, /primary key\(match_id,respondent_id\)/i);
  assert.match(migration, /respondent_id=\(select auth\.uid\(\)\)/i);
  assert.match(migration, /not coalesce\(\(\(select auth\.jwt\(\)\)->>'is_anonymous'\)::boolean,true\)/i);
  assert.match(migration, /exists\(select 1 from private\.platform_admins where user_id=auth\.uid\(\)\)/i);
  assert.match(exploreMigration, /cleanup_enabled boolean not null default false/i);
  assert.doesNotMatch(migration, /service[_-]?role|using\s*\(\s*true\s*\)/i);
});

test("Connections are hidden when empty, cross-Room, and reopen existing chat", async () => {
  const source = await read("../app/components/UserArea.tsx");
  assert.match(source, /connections\.length > 0/);
  assert.match(source, /roomName/);
  assert.match(source, /onOpenConnection\(connection\)/);
  assert.match(source, /record_match_irl_feedback/);
  assert.match(source, /notification_state/);
  assert.match(source, /15_000/);
  assert.match(source, /request_my_data_deletion/);
});

test("exact Leave/reopen P0 path branches before protected Room data", async () => {
  const source = await read("../app/components/RoomJoinApp.tsx");
  const enter = source.match(/const enterRoom =[\s\S]*?\n {2}\}, \[/)?.[0] || "";
  const refresh = source.match(/const refreshRoom =[\s\S]*?\n {2}\}, \[/)?.[0] || "";
  for (const block of [enter, refresh]) {
    assert.match(block, /loadPresence/);
    assert.match(block, /isExplicitlyLeft/);
    assert.match(block, /clearDiscovery/);
  }
  assert.match(source, /Rejoin this event\?/);
  assert.match(source, /rejoin_room_presence/);
  assert.doesNotMatch(source, /beforeunload|pagehide/);
});

test("legal acceptance, draft documents and aggregate-only operations are explicit", async () => {
  const [room, privacy, terms, admin, organizer] = await Promise.all([
    read("../app/components/RoomJoinApp.tsx"), read("../app/privacy/page.tsx"),
    read("../app/terms/page.tsx"), read("../app/components/AdminOperations.tsx"),
    read("../app/components/OrganizerAnalytics.tsx"),
  ]);
  assert.match(room, /accept_pilot_terms/);
  assert.match(room, /I am 18 or older/);
  assert.match(room, /Draft Terms/);
  assert.match(privacy + terms, /not final legal advice/i);
  assert.match(admin, /admin_operations_rooms/);
  assert.match(admin, /AuthTurnstile/);
  assert.doesNotMatch(admin, /user_metadata|isAdmin/);
  assert.doesNotMatch(organizer, /\breported_user_id\b|\breporter_id\b|\bdisplay_name\b|last_message_body/i);
});

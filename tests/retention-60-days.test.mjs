import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261008161930_retention_60_days.sql", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../supabase/functions/retention-cleanup/index.ts", import.meta.url),
  "utf8",
);
const policy = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
const terms = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
const version = readFileSync(new URL("../lib/rc1-state.ts", import.meta.url), "utf8");
const operatorMigration = readFileSync(
  new URL("../supabase/migrations/20261009113050_pilot_operator_contact.sql", import.meta.url),
  "utf8",
);

test("60-day retention is guarded, server-only and removes Storage before Auth", () => {
  assert.match(migration, /operational_retention_days = 60[\s\S]*connection_retention_days = 60[\s\S]*safety_retention_days = 60/);
  assert.match(migration, /ends_at < cutoff/);
  assert.match(migration, /delete from public\.reports[\s\S]*delete from public\.blocks[\s\S]*delete from public\.user_notifications[\s\S]*delete from public\.rooms/);
  assert.match(migration, /where u\.is_anonymous is true|u\.is_anonymous is true/);
  assert.match(migration, /not exists \(select 1 from public\.room_members/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /revoke all on function private\.retention_delete_expired_rooms[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.retention_delete_expired_rooms[\s\S]*to service_role/);
  assert.match(worker, /retention_worker_authorized/);
  assert.match(worker, /storage\.from\("avatars"\)\.remove\(paths\)/);
  assert.ok(worker.indexOf('storage.from("avatars").remove(paths)') < worker.indexOf("auth.admin.deleteUser"));
  assert.match(policy, /once 60 days have passed since the event ended/);
  assert.match(version, /pilot-rc1-draft-2026-10-09/);
  for (const document of [policy, terms]) {
    assert.match(document, /Pavel Yerchak/);
    assert.match(document, /spriprin@gmail\.com/);
    assert.match(document, /pilot-rc1-draft-2026-10-09/);
  }
  assert.match(operatorMigration, /pilot-rc1-draft-2026-10-09/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260906125841_gender_preferences_mobile_viewport.sql", import.meta.url);

test("GP-A–I — gender and viewer-side preferences stay server-bound and privacy-safe", async () => {
  const [migration, roomSource, typesSource, analyticsSource] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../app/components/RoomJoinApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/OrganizerAnalytics.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /alter table public\.profiles[\s\S]*add column gender text[\s\S]*add column discovery_preference text/i);
  assert.match(migration, /gender in \('male', 'female', 'prefer_not_to_say'\)/i);
  assert.match(migration, /discovery_preference in \('male', 'female', 'everyone'\)/i);
  assert.doesNotMatch(migration, /alter column (gender|discovery_preference) set not null/i);
  assert.match(typesSource, /type Gender = "male" \| "female" \| "prefer_not_to_say"/);
  assert.match(typesSource, /type DiscoveryPreference = "male" \| "female" \| "everyone"/);

  assert.match(roomSource, /ONE QUICK THING/);
  assert.match(roomSource, /How do you identify\?/);
  assert.match(roomSource, /STEP 3 OF 4/);
  assert.match(roomSource, /defaultDiscoveryPreference[\s\S]*gender === "male"[\s\S]*"female"[\s\S]*gender === "female"[\s\S]*"male"[\s\S]*"everyone"/);
  assert.match(roomSource, /label="Show me"/);
  assert.match(roomSource, /openProfileEditor\("room"\)/);

  const completion = roomSource.match(/async function finishProfileCompletion\(\) \{[\s\S]*?\n {2}\}\n\n {2}function openProfileEditor/)?.[0] || "";
  assert.match(completion, /getUser\(\)/);
  assert.match(completion, /update\(\{ gender, discovery_preference: preference \}\)/);
  assert.doesNotMatch(completion, /display_name:|avatar_path:|room_members|matches|messages|blocks|reports/);

  assert.match(migration, /private\.has_complete_discovery_profile\(current_user_id\)/);
  assert.match(migration, /join_room_by_code[\s\S]*p\.gender is not null[\s\S]*p\.discovery_preference is not null/i);
  const candidatePools = [...migration.matchAll(/with candidate_exposure as \(([\s\S]*?)\), ranked as \(/gi)];
  assert.equal(candidatePools.length, 2, "Explore and Drop must each filter their candidate pool before ranking");
  for (const [, pool] of candidatePools) {
    assert.match(pool, /private\.viewer_accepts_candidate\(current_user_id, rm\.user_id\)/);
    assert.match(pool, /private\.discovery_delivered_count/);
    assert.match(pool, /private\.discovery_pending_count/);
  }
  const rankingClauses = [...migration.matchAll(/row_number\(\) over \(([\s\S]*?)\)\s*::integer/gi)];
  assert.equal(rankingClauses.length, 2);
  for (const [, ranking] of rankingClauses) {
    assert.match(ranking, /delivered_count \+ ce\.pending_count/);
    assert.match(ranking, /random\(\)/);
    assert.doesNotMatch(ranking, /interest|match|message|accept|popularity|gender/);
  }

  assert.match(roomSource, /Changes apply to future selections\. Existing cards, incoming Interests, Matches and chats stay unchanged\./);
  assert.doesNotMatch(migration, /create or replace function public\.(interested_in_you|respond_to_interest|room_analytics)/i);
  assert.doesNotMatch(analyticsSource, /gender|discovery_preference/i);
  assert.match(migration, /revoke all on function private\.viewer_accepts_candidate\(uuid, uuid\)[\s\S]*public, anon, authenticated, service_role/i);
});

test("GP-J–L — mobile Room uses a natural viewport, safe input size and bounded layout", async () => {
  const [layout, css] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /export const viewport: Viewport = \{[\s\S]*width: "device-width"[\s\S]*initialScale: 1/);
  assert.doesNotMatch(layout, /maximumScale|minimumScale|userScalable/);
  assert.match(css, /-webkit-text-size-adjust: 100%/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*input, textarea, select[^{]*\{ font-size: 16px; \}/);
  assert.match(css, /\.foundation-room-screen \{[\s\S]*max-width: 100%[\s\S]*overflow-x: hidden[\s\S]*overflow-x: clip/);
  assert.match(css, /\.explore-profile-card > \* \{ min-width: 0; \}/);
  assert.doesNotMatch(`${layout}\n${css}`, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

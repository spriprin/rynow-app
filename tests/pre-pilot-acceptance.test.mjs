import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { allowPermanentGuestFallback, anonymousSignInCredentials, withAuthCaptcha } from "./live-auth-helpers.mjs";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const organizerEmail = process.env.HERE_TEST_ORGANIZER_EMAIL;
const organizerPassword = process.env.HERE_TEST_ORGANIZER_PASSWORD;
const allowGeneratedOrganizer = process.env.HERE_TEST_CREATE_ORGANIZER === "true";
const enabled = Boolean(url && key && ((organizerEmail && organizerPassword) || allowGeneratedOrganizer));
const clients = new Set();
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const one = (data) => Array.isArray(data) ? data[0] : data;

function client() {
  const value = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.add(value);
  return value;
}

async function withAuthRetry(operation, attempts = 6) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await operation();
    if (result.error?.status !== 429 && !/rate limit/i.test(result.error?.message || "")) return result;
    await wait(Math.min(12_000, 1_800 * attempt));
  }
  return result;
}

async function organizer() {
  const value = client();
  const credentials = organizerEmail && organizerPassword
    ? { email: organizerEmail, password: organizerPassword }
    : { email: `here-pp-${crypto.randomUUID()}@example.com`, password: `Here-${crypto.randomUUID()}-Aa1!` };
  const { data, error } = await withAuthRetry(() => organizerEmail && organizerPassword
    ? value.auth.signInWithPassword(withAuthCaptcha(credentials))
    : value.auth.signUp(withAuthCaptcha(credentials)));
  assert.ifError(error);
  assert.ok(data.user && data.session && !data.user.is_anonymous);
  return { client: value, user: data.user };
}

async function actor(name) {
  const value = client();
  let result = await withAuthRetry(() => value.auth.signInAnonymously(anonymousSignInCredentials()), 3);
  if (result.error && allowPermanentGuestFallback()) {
    const credentials = { email: `here-pp-guest-${crypto.randomUUID()}@example.com`, password: `Here-${crypto.randomUUID()}-Aa1!` };
    result = await withAuthRetry(() => value.auth.signUp(withAuthCaptcha(credentials)));
  }
  assert.ifError(result.error);
  assert.ok(result.data.user && result.data.session);
  const avatarPath = `${result.data.user.id}/pp-${crypto.randomUUID()}.png`;
  assert.ifError((await value.storage.from("avatars").upload(avatarPath, tinyPng, { contentType: "image/png" })).error);
  assert.ifError((await value.from("profiles").insert({ id: result.data.user.id, display_name: name, avatar_path: avatarPath, age_confirmed_18: true, gender: "prefer_not_to_say", discovery_preference: "everyone" })).error);
  return { client: value, user: result.data.user, avatarPath };
}

async function createRoom(owner, ownerId, name) {
  const { data, error } = await owner.from("rooms").insert({
    organizer_id: ownerId,
    name,
    venue_name: "HERE Pre-Pilot Lab",
    city: "Riga",
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
    status: "open",
  }).select().single();
  assert.ifError(error);
  return data;
}

async function join(value, joinCode) {
  const result = await value.rpc("join_room_by_code", { p_join_code: joinCode });
  assert.ifError(result.error);
}

async function claimExplore(value, roomId) {
  const result = await value.rpc("claim_explore_batch", { p_room_id: roomId });
  assert.ifError(result.error);
  return result.data;
}

async function seeAndPass(value, item) {
  assert.ifError((await value.rpc("mark_explore_item_seen", { p_explore_item_id: item.id })).error);
  assert.ifError((await value.rpc("pass_explore_item", { p_explore_item_id: item.id })).error);
}

test("Pre-pilot live acceptance — PP-A through PP-T", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  const owner = await organizer();
  const roomsToClose = [];
  t.after(async () => {
    if (roomsToClose.length) await owner.client.from("rooms").update({ status: "closed" }).in("id", roomsToClose);
    for (const value of clients) {
      await value.removeAllChannels();
      value.realtime.disconnect();
    }
  });

  const actors = [];
  for (let offset = 0; offset < 13; offset += 1) actors.push(await actor(`PP Guest ${offset + 1}`));
  const room = await createRoom(owner.client, owner.user.id, "HERE Pre-Pilot Explore");
  roomsToClose.push(room.id);
  await Promise.all(actors.map(({ client: value }) => join(value, room.join_code)));

  await t.test("PP-A/PP-B — presence contracts are distinct and recovery is idempotent", async () => {
    const state = await actors[0].client.rpc("room_presence_state", { p_room_id: room.id });
    assert.ifError(state.error);
    assert.equal(one(state.data).recently_active, true);
    assert.equal(one(state.data).discovery_eligible, true);
    const analytics = await owner.client.rpc("room_analytics", { p_room_id: room.id });
    assert.ifError(analytics.error);
    assert.deepEqual(analytics.data.presence_model, {
      heartbeat_seconds: 60,
      recent_active_timeout_seconds: 600,
      discovery_eligible_timeout_seconds: 3600,
      definition: "server heartbeat plus explicit discovery state",
    });
    assert.ifError((await actors[0].client.rpc("heartbeat_room_presence", { p_room_id: room.id })).error);
    await Promise.all(Array.from({ length: 4 }, () => join(actors[0].client, room.join_code)));
    const memberships = await actors[0].client.from("room_members").select("room_id").eq("room_id", room.id).eq("user_id", actors[0].user.id);
    assert.ifError(memberships.error);
    assert.equal(memberships.data.length, 1);
  });

  let firstBatch;
  await t.test("PP-E/PP-F/PP-G — Explore is immediate, limited, private and persistent", async () => {
    firstBatch = await claimExplore(actors[0].client, room.id);
    assert.equal(firstBatch.status, "active");
    assert.equal(firstBatch.items.length, 8);
    assert.equal(firstBatch.interest_budget, 4);
    assert.equal(new Set(firstBatch.items.map((item) => item.candidate_id)).size, 8);
    const repeated = await claimExplore(actors[0].client, room.id);
    assert.deepEqual(repeated.items.map((item) => [item.id, item.position]), firstBatch.items.map((item) => [item.id, item.position]));
    assert.ok((await actors[0].client.from("explore_batches").select("*")).error);
    assert.ok((await actors[0].client.from("explore_items").select("*")).error);
    const wall = await actors[0].client.rpc("room_wall_profiles", { p_room_id: room.id, p_limit: 1000 });
    assert.ifError(wall.error);
    assert.ok(wall.data.length <= 12);
  });

  await t.test("PP-M/PP-N — adaptive batch budgets use actual assigned people", async () => {
    for (const [candidateCount, expectedBudget] of [[5, 5], [6, 3], [8, 4], [10, 5], [12, 6]]) {
      const budgetRoom = await createRoom(owner.client, owner.user.id, `PP Budget ${candidateCount}`);
      roomsToClose.push(budgetRoom.id);
      await join(actors[0].client, budgetRoom.join_code);
      await Promise.all(actors.slice(1, candidateCount + 1).map(({ client: value }) => join(value, budgetRoom.join_code)));
      const created = await owner.client.rpc("create_room_drop", {
        p_room_id: budgetRoom.id,
        p_scheduled_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        p_drop_size: candidateCount,
        p_min_unlock_count: 1,
        p_interest_budget: 0,
      });
      assert.ifError(created.error);
      assert.ifError((await owner.client.rpc("open_drop_now", { p_drop_id: created.data.id })).error);
      const claim = await actors[0].client.rpc("claim_your_drop", { p_drop_id: created.data.id });
      assert.ifError(claim.error);
      assert.equal(claim.data.length, candidateCount);
      const state = await actors[0].client.rpc("room_drop_state", { p_room_id: budgetRoom.id });
      assert.ifError(state.error);
      assert.equal(one(state.data).interest_budget, expectedBudget);
      if (candidateCount <= 5) assert.equal(claim.data.length, candidateCount);
    }
  });

  await t.test("PP-H/PP-I — cooldown resists refresh and three new arrivals unlock the next batch", async () => {
    for (const item of firstBatch.items) await seeAndPass(actors[0].client, item);
    const caughtUp = await claimExplore(actors[0].client, room.id);
    assert.ok(["caught_up", "waiting"].includes(caughtUp.status));
    assert.equal(caughtUp.items, undefined);
    const newcomers = [await actor("PP New 1"), await actor("PP New 2"), await actor("PP New 3")];
    actors.push(...newcomers);
    await Promise.all(newcomers.map(({ client: value }) => join(value, room.join_code)));
    const unlocked = await claimExplore(actors[0].client, room.id);
    assert.equal(unlocked.status, "active");
    assert.ok(unlocked.items.length > 0);
    firstBatch = unlocked;
  });

  await t.test("PP-J/PP-K — scheduled Drop is independent and does not repeat seen or reserved Explore people", async () => {
    const seen = firstBatch.items[0];
    await seeAndPass(actors[0].client, seen);
    const before = await actors[0].client.rpc("explore_state", { p_room_id: room.id });
    const created = await owner.client.rpc("create_room_drop", {
      p_room_id: room.id,
      p_scheduled_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      p_drop_size: 12,
      p_min_unlock_count: 1,
      p_interest_budget: 0,
    });
    assert.ifError(created.error);
    assert.ifError((await owner.client.rpc("open_drop_now", { p_drop_id: created.data.id })).error);
    const drop = await actors[0].client.rpc("claim_your_drop", { p_drop_id: created.data.id });
    assert.ifError(drop.error);
    assert.ok(drop.data.length <= 12);
    assert.ok(!drop.data.some((item) => item.candidate_id === seen.candidate_id));
    const after = await actors[0].client.rpc("explore_state", { p_room_id: room.id });
    assert.equal(after.data.batch_id, before.data.batch_id);
  });

  await t.test("PP-L — shared Fair Exposure stays based on delivered and pending opportunity", async () => {
    const analytics = await owner.client.rpc("room_analytics", { p_room_id: room.id });
    assert.ifError(analytics.error);
    assert.ok(Number(analytics.data.summary.explore_batches_claimed) >= 2);
    assert.ok(Number(analytics.data.summary.explore_cards_seen) >= 9);
    assert.equal("individual_candidates" in analytics.data, false);
    assert.equal("popularity" in analytics.data, false);
  });

  let preservedMatchId;
  await t.test("PP-C/PP-D — Leave disables new discovery while preserving history; Rejoin restores it", async () => {
    const leaveRoom = await createRoom(owner.client, owner.user.id, "PP Leave and Rejoin");
    roomsToClose.push(leaveRoom.id);
    await join(actors[0].client, leaveRoom.join_code);
    await join(actors[1].client, leaveRoom.join_code);
    const senderBatch = await claimExplore(actors[0].client, leaveRoom.id);
    const target = senderBatch.items.find((item) => item.candidate_id === actors[1].user.id);
    assert.ok(target);
    assert.ifError((await actors[0].client.rpc("mark_explore_item_seen", { p_explore_item_id: target.id })).error);
    assert.ifError((await actors[0].client.rpc("send_explore_interest", { p_explore_item_id: target.id })).error);
    const incoming = await actors[1].client.rpc("interested_in_you", { p_room_id: leaveRoom.id });
    const interest = incoming.data.find((item) => item.from_user_id === actors[0].user.id);
    const accepted = await actors[1].client.rpc("respond_to_interest", { p_interest_id: interest.interest_id, p_interested: true });
    assert.ifError(accepted.error);
    preservedMatchId = accepted.data;
    assert.ifError((await actors[0].client.rpc("send_match_message_idempotent", { p_match_id: preservedMatchId, p_body: "PP history stays", p_client_message_id: crypto.randomUUID() })).error);
    await join(actors[2].client, leaveRoom.join_code);
    const pending = await claimExplore(actors[1].client, leaveRoom.id);
    assert.equal(pending.items.length, 1);
    assert.ifError((await actors[1].client.rpc("mark_explore_item_seen", { p_explore_item_id: pending.items[0].id })).error);
    assert.ifError((await actors[1].client.rpc("leave_room_presence", { p_room_id: leaveRoom.id })).error);
    const left = await actors[1].client.rpc("room_presence_state", { p_room_id: leaveRoom.id });
    assert.equal(one(left.data).discovery_enabled, false);
    assert.ok(one(left.data).left_at);
    assert.ok((await actors[1].client.rpc("send_explore_interest", { p_explore_item_id: pending.items[0].id })).error);
    const wall = await actors[0].client.rpc("room_wall_profiles", { p_room_id: leaveRoom.id, p_limit: 12 });
    assert.ok(!wall.data.some((person) => person.id === actors[1].user.id));
    assert.ifError((await actors[1].client.from("profiles").select("id").eq("id", actors[1].user.id).single()).error);
    assert.ifError((await actors[1].client.from("room_members").select("room_id").eq("room_id", leaveRoom.id).single()).error);
    assert.ifError((await actors[1].client.rpc("room_matches", { p_room_id: leaveRoom.id })).error);
    assert.ifError((await actors[1].client.from("messages").select("id").eq("match_id", preservedMatchId)).error);
    assert.ifError((await actors[1].client.rpc("rejoin_room_presence", { p_room_id: leaveRoom.id })).error);
    const rejoined = await actors[1].client.rpc("room_presence_state", { p_room_id: leaveRoom.id });
    assert.equal(one(rejoined.data).discovery_eligible, true);
    assert.equal(one(rejoined.data).left_at, null);
    const memberships = await actors[1].client.from("room_members").select("room_id").eq("room_id", leaveRoom.id).eq("user_id", actors[1].user.id);
    assert.equal(memberships.data.length, 1);
  });

  await t.test("PP-O — unseen candidate Leave invalidates safely and cannot be restored by refresh", async () => {
    const invalidationRoom = await createRoom(owner.client, owner.user.id, "PP Invalidation");
    roomsToClose.push(invalidationRoom.id);
    await join(actors[3].client, invalidationRoom.join_code);
    await join(actors[4].client, invalidationRoom.join_code);
    const assigned = await claimExplore(actors[3].client, invalidationRoom.id);
    assert.equal(assigned.items.length, 1);
    assert.ifError((await actors[4].client.rpc("leave_room_presence", { p_room_id: invalidationRoom.id })).error);
    assert.ok((await actors[3].client.rpc("mark_explore_item_seen", { p_explore_item_id: assigned.items[0].id })).error);
    const refreshed = await claimExplore(actors[3].client, invalidationRoom.id);
    assert.ok(!refreshed.items?.some((item) => item.candidate_id === actors[4].user.id));
    await join(actors[5].client, invalidationRoom.join_code);
    const replacement = await claimExplore(actors[3].client, invalidationRoom.id);
    assert.ok(replacement.items.some((item) => item.candidate_id === actors[5].user.id));
  });

  await t.test("PP-S/PP-T — analytics remain aggregate and direct security boundaries stay closed", async () => {
    const analytics = await owner.client.rpc("room_analytics", { p_room_id: room.id });
    assert.ifError(analytics.error);
    assert.ok(analytics.data.explore);
    assert.ok(Number(analytics.data.summary.discovery_eligible_memberships) >= 1);
    assert.doesNotMatch(JSON.stringify(analytics.data), /PP Guest|PP history stays/);
    const forgedProfile = await actors[0].client.from("profiles").update({ display_name: "forged" }).eq("id", actors[1].user.id).select("id");
    assert.ok(forgedProfile.error || forgedProfile.data.length === 0);
    assert.ok((await actors[0].client.from("explore_items").select("*")).error);
    assert.ok((await actors[0].client.from("drop_items").select("*")).error);
    assert.ok((await owner.client.from("interests").select("*")).error);
    const organizerMessages = await owner.client.from("messages").select("*").eq("match_id", preservedMatchId);
    assert.ok(organizerMessages.error || organizerMessages.data.length === 0);
    const organizerReports = await owner.client.from("reports").select("*");
    assert.ok(organizerReports.error || organizerReports.data.length === 0);
  });
});

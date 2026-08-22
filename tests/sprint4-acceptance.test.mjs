import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { retryAuthRateLimit } from "./live-auth-helpers.mjs";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const organizerEmail = process.env.HERE_TEST_ORGANIZER_EMAIL;
const organizerPassword = process.env.HERE_TEST_ORGANIZER_PASSWORD;
const allowGeneratedOrganizer = process.env.HERE_TEST_CREATE_ORGANIZER === "true";
const enabled = Boolean(url && key && ((organizerEmail && organizerPassword) || allowGeneratedOrganizer));

function client() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signInOrganizer(prefix) {
  const organizer = client();
  const credentials = organizerEmail && organizerPassword && prefix === "owner"
    ? { email: organizerEmail, password: organizerPassword, existing: true }
    : { email: `here-sprint4-${prefix}-${crypto.randomUUID()}@example.com`, password: `Here-${crypto.randomUUID()}-Aa1!`, existing: false };
  const { data, error } = await retryAuthRateLimit(() => credentials.existing
    ? organizer.auth.signInWithPassword(credentials)
    : organizer.auth.signUp(credentials));
  assert.ifError(error);
  assert.ok(data.user && data.session && !data.user.is_anonymous, `${prefix} organizer must be a permanent authenticated user`);
  return { client: organizer, user: data.user };
}

async function createGuest(name, joinCode) {
  const guest = client();
  let { data: auth, error: authError } = await guest.auth.signInAnonymously();
  if (authError && /rate limit/i.test(authError.message)) {
    const fallback = await retryAuthRateLimit(() => guest.auth.signUp({
      email: `here-sprint4-guest-${crypto.randomUUID()}@example.com`,
      password: `Here-${crypto.randomUUID()}-Aa1!`,
    }));
    auth = fallback.data;
    authError = fallback.error;
  }
  assert.ifError(authError);
  assert.ok(auth.user && auth.session);
  const avatarPath = `${auth.user.id}/sprint4-${crypto.randomUUID()}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  assert.ifError((await guest.storage.from("avatars").upload(avatarPath, png, { contentType: "image/png" })).error);
  assert.ifError((await guest.from("profiles").insert({ id: auth.user.id, display_name: name, avatar_path: avatarPath, age_confirmed_18: true })).error);
  assert.ifError((await guest.rpc("join_room_by_code", { p_join_code: joinCode })).error);
  return { client: guest, user: auth.user, name };
}

async function createRoom(organizer, organizerId, name) {
  const { data, error } = await organizer.from("rooms").insert({
    organizer_id: organizerId,
    name,
    venue_name: "HERE Analytics Lab",
    city: "Riga",
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    status: "open",
  }).select().single();
  assert.ifError(error);
  return data;
}

async function createDrop(organizer, roomId, { size, unlock, budget = size, open = true }) {
  const { data, error } = await organizer.rpc("create_room_drop", {
    p_room_id: roomId,
    p_scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    p_drop_size: size,
    p_min_unlock_count: unlock,
    p_interest_budget: budget,
  });
  assert.ifError(error);
  if (open) assert.ifError((await organizer.rpc("open_drop_now", { p_drop_id: data.id })).error);
  return data;
}

async function analytics(organizer, roomId) {
  const { data, error } = await organizer.rpc("room_analytics", { p_room_id: roomId });
  assert.ifError(error);
  return data;
}

function itemFor(items, userId) {
  const item = items.find((candidate) => candidate.candidate_id === userId);
  assert.ok(item, `Expected candidate ${userId} in Your Drop`);
  return item;
}

function allKeys(value, result = []) {
  if (Array.isArray(value)) for (const item of value) allKeys(item, result);
  else if (value && typeof value === "object") {
    for (const [keyName, child] of Object.entries(value)) {
      result.push(keyName);
      allKeys(child, result);
    }
  }
  return result;
}

test("Sprint 4 live acceptance — S4-A through S4-P", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  const owner = await signInOrganizer("owner");
  const foreignOrganizer = await signInOrganizer("foreign");
  const roomsToClose = [];
  let foreignRoom = null;
  t.after(async () => {
    if (roomsToClose.length) assert.ifError((await owner.client.from("rooms").update({ status: "closed" }).in("id", roomsToClose)).error);
    if (foreignRoom) assert.ifError((await foreignOrganizer.client.from("rooms").update({ status: "closed" }).eq("id", foreignRoom.id)).error);
  });

  const room = await createRoom(owner.client, owner.user.id, "HERE Sprint 4 Analytics");
  roomsToClose.push(room.id);
  const alice = await createGuest("S4 Alice", room.join_code);
  const bob = await createGuest("S4 Bob", room.join_code);
  const cara = await createGuest("S4 Cara", room.join_code);
  const dan = await createGuest("S4 Dan", room.join_code);

  foreignRoom = await createRoom(foreignOrganizer.client, foreignOrganizer.user.id, "HERE Sprint 4 Foreign");
  const outsider = await createGuest("S4 Outsider", foreignRoom.join_code);

  const formingDrop = await createDrop(owner.client, room.id, { size: 4, unlock: 4 });
  const formingResults = await Promise.all(Array.from({ length: 5 }, () => alice.client.rpc("claim_your_drop", { p_drop_id: formingDrop.id })));
  for (const result of formingResults) { assert.ifError(result.error); assert.equal(result.data.length, 0); }

  const mainDrop = await createDrop(owner.client, room.id, { size: 3, unlock: 1, budget: 3 });
  const concurrentClaims = await Promise.all(Array.from({ length: 6 }, () => alice.client.rpc("claim_your_drop", { p_drop_id: mainDrop.id })));
  for (const result of concurrentClaims) assert.ifError(result.error);
  const aliceItems = concurrentClaims[0].data;
  assert.equal(aliceItems.length, 3);
  for (const result of concurrentClaims.slice(1)) {
    assert.deepEqual(result.data.map((item) => item.id), aliceItems.map((item) => item.id));
  }
  const futureDrop = await createDrop(owner.client, room.id, { size: 3, unlock: 1, open: false });

  await t.test("S4-J — assignment is not an impression", async () => {
    const beforeSeen = await analytics(owner.client, room.id);
    assert.equal(beforeSeen.summary.cards_seen, 0);
    assert.equal(beforeSeen.summary.your_drop_started_runs, 1);
    assert.equal(beforeSeen.drops.find((drop) => drop.drop_id === mainDrop.id).cards_seen, 0);
  });

  for (const item of aliceItems) {
    assert.ifError((await alice.client.rpc("mark_drop_item_seen", { p_drop_item_id: item.id })).error);
    const action = item.candidate_id === bob.user.id ? "send_interest" : "pass_drop_item";
    assert.ifError((await alice.client.rpc(action, { p_drop_item_id: item.id })).error);
  }

  const { data: caraItems, error: caraClaimError } = await cara.client.rpc("claim_your_drop", { p_drop_id: mainDrop.id });
  assert.ifError(caraClaimError);
  const caraToDan = itemFor(caraItems, dan.user.id);
  assert.ifError((await cara.client.rpc("mark_drop_item_seen", { p_drop_item_id: caraToDan.id })).error);
  assert.ifError((await cara.client.rpc("send_interest", { p_drop_item_id: caraToDan.id })).error);

  const { data: bobItems, error: bobClaimError } = await bob.client.rpc("claim_your_drop", { p_drop_id: mainDrop.id });
  assert.ifError(bobClaimError);
  const bobToCara = itemFor(bobItems, cara.user.id);
  assert.ifError((await bob.client.rpc("mark_drop_item_seen", { p_drop_item_id: bobToCara.id })).error);
  assert.ifError((await bob.client.rpc("send_interest", { p_drop_item_id: bobToCara.id })).error);

  const { data: bobInbox, error: bobInboxError } = await bob.client.rpc("interested_in_you", { p_room_id: room.id });
  assert.ifError(bobInboxError);
  const aliceInterest = bobInbox.find((interest) => interest.from_user_id === alice.user.id);
  assert.ok(aliceInterest);

  await t.test("S4-L — incoming open is recipient-only, display-bound and idempotent", async () => {
    assert.equal((await analytics(owner.client, room.id)).summary.incoming_interests_opened, 0, "loading inbox must not count as opened");
    const wrongRecipient = await alice.client.rpc("mark_incoming_interest_opened", { p_interest_id: aliceInterest.interest_id });
    assert.match(wrongRecipient.error?.message || "", /not found/i);
    const opened = await Promise.all(Array.from({ length: 5 }, () => bob.client.rpc("mark_incoming_interest_opened", { p_interest_id: aliceInterest.interest_id })));
    for (const result of opened) assert.ifError(result.error);
    assert.equal(new Set(opened.map((result) => result.data)).size, 1);
    assert.equal((await analytics(owner.client, room.id)).summary.incoming_interests_opened, 1);
  });

  const exposureBeforeSocialActions = (await analytics(owner.client, room.id)).summary.cards_seen;
  const { data: matchId, error: acceptError } = await bob.client.rpc("respond_to_interest", { p_interest_id: aliceInterest.interest_id, p_interested: true });
  assert.ifError(acceptError);
  const { data: danInbox, error: danInboxError } = await dan.client.rpc("interested_in_you", { p_room_id: room.id });
  assert.ifError(danInboxError);
  const caraInterest = danInbox.find((interest) => interest.from_user_id === cara.user.id);
  assert.ok(caraInterest);
  assert.ifError((await dan.client.rpc("respond_to_interest", { p_interest_id: caraInterest.interest_id, p_interested: false })).error);
  assert.ifError((await alice.client.rpc("send_match_message", { p_match_id: matchId, p_body: "S4 privacy-safe hello" })).error);

  await t.test("Regression — social outcomes do not change Fair Exposure count", async () => {
    const afterSocialActions = await analytics(owner.client, room.id);
    assert.equal(afterSocialActions.summary.cards_seen, exposureBeforeSocialActions);
  });

  const blockResults = await Promise.all(Array.from({ length: 4 }, () => dan.client.rpc("block_user_in_context", {
    p_blocked_id: alice.user.id,
    p_room_id: room.id,
    p_match_id: null,
  })));
  for (const result of blockResults) assert.ifError(result.error);
  assert.ifError((await cara.client.rpc("submit_report", {
    p_reported_user_id: alice.user.id,
    p_room_id: room.id,
    p_match_id: null,
    p_reason: "Safety concern",
    p_details: "Private S4 acceptance detail",
    p_block: false,
  })).error);
  assert.ifError((await dan.client.rpc("leave_room_presence", { p_room_id: room.id })).error);

  const result = await analytics(owner.client, room.id);

  await t.test("S4-A — owner receives the correct aggregate envelope", () => {
    assert.equal(result.room_id, room.id);
    assert.ok(result.last_updated);
    assert.equal(result.drops.length, 3);
  });

  await t.test("S4-B — a different organizer is denied", async () => {
    assert.match((await foreignOrganizer.client.rpc("room_analytics", { p_room_id: room.id })).error?.message || "", /Organizer access required/i);
  });

  await t.test("S4-C — an ordinary participant is denied", async () => {
    assert.match((await alice.client.rpc("room_analytics", { p_room_id: room.id })).error?.message || "", /organizer/i);
  });

  await t.test("S4-D — an unauthenticated caller is denied", async () => {
    assert.ok((await client().rpc("room_analytics", { p_room_id: room.id })).error);
  });

  await t.test("S4-E — underlying instrumentation and private interactions are not directly accessible", async () => {
    assert.ok((await alice.client.schema("private").from("drop_claim_states").select("*")).error);
    assert.ok((await alice.client.schema("private").from("interest_opens").insert({ interest_id: aliceInterest.interest_id })).error);
    assert.ok((await alice.client.from("blocks").insert({ blocker_id: alice.user.id, blocked_id: outsider.user.id, room_id: room.id })).error);
    assert.ok((await alice.client.from("reports").insert({ reporter_id: alice.user.id, reported_user_id: outsider.user.id, room_id: room.id, reason: "Spam" })).error);
  });

  await t.test("S4-F — response contains no person-level identifiers or private content", () => {
    const forbidden = new Set([
      "profile_id", "participant_id", "user_id", "viewer_id", "candidate_id", "from_user_id", "to_user_id",
      "interest_id", "match_id", "message_id", "blocker_id", "blocked_id", "reporter_id", "reported_user_id",
      "display_name", "avatar_path", "body", "reason", "details",
    ]);
    const leaked = allKeys(result).filter((keyName) => forbidden.has(keyName));
    assert.deepEqual(leaked, []);
    assert.doesNotMatch(JSON.stringify(result), /S4 Alice|S4 Bob|S4 Cara|S4 Dan|privacy-safe hello|Private S4 acceptance detail/);
  });

  await t.test("S4-G — joined and active counts match canonical membership actions", () => {
    assert.equal(result.summary.joined_memberships, 4);
    assert.equal(result.summary.active_memberships, 3);
  });

  await t.test("S4-H — scheduled and effectively-opened Drops use database time", () => {
    assert.equal(result.summary.scheduled_drops, 3);
    assert.equal(result.summary.effectively_opened_drops, 2);
    assert.equal(result.drops.find((drop) => drop.drop_id === futureDrop.id).effective_status, "scheduled");
  });

  await t.test("S4-I — retries and concurrency do not inflate claims or unlocks", () => {
    assert.equal(result.summary.claim_attempts, 4);
    assert.equal(result.summary.forming_attempts, 1);
    assert.equal(result.summary.successful_unlocks, 3);
    assert.equal(result.rates.unlock_rate, 75);
  });

  await t.test("S4-K — Your Drop completion requires every assigned card to be seen and handled", () => {
    assert.equal(result.summary.cards_seen, 5);
    assert.equal(result.summary.your_drop_started_runs, 3);
    assert.equal(result.summary.your_drop_completed_runs, 1);
    assert.equal(result.rates.drop_completion_rate, 33.3);
  });

  await t.test("S4-M — Interest outcomes and rates use explicit canonical denominators", () => {
    assert.equal(result.summary.interests_sent, 3);
    assert.equal(result.summary.pending_interests, 1);
    assert.equal(result.summary.accepted_interests, 1);
    assert.equal(result.summary.declined_interests, 1);
    assert.equal(result.rates.interest_response_rate, 66.7);
    assert.equal(result.rates.interest_acceptance_rate, 50);
    assert.equal(result.rates.interest_decline_rate, 50);
  });

  await t.test("S4-N — Match, conversation and median first-message time are canonical", () => {
    assert.equal(result.summary.matches_created, 1);
    assert.equal(result.summary.conversations_started, 1);
    assert.equal(result.rates.match_to_conversation_rate, 100);
    assert.ok(result.summary.median_match_to_first_message_seconds >= 0);
  });

  await t.test("S4-O — Block and Report are attributed only as private Room totals", () => {
    assert.equal(result.summary.blocks_count, 1);
    assert.equal(result.summary.reports_count, 1);
  });

  await t.test("S4-P — cross-Room spoofing and duplicate context requests cannot distort totals", async () => {
    const spoofedBlock = await alice.client.rpc("block_user_in_context", { p_blocked_id: outsider.user.id, p_room_id: foreignRoom.id, p_match_id: null });
    assert.match(spoofedBlock.error?.message || "", /context is invalid/i);
    const spoofedReport = await alice.client.rpc("submit_report", {
      p_reported_user_id: outsider.user.id,
      p_room_id: room.id,
      p_match_id: null,
      p_reason: "Spam",
      p_details: null,
      p_block: false,
    });
    assert.match(spoofedReport.error?.message || "", /context is invalid/i);
    const afterSpoof = await analytics(owner.client, room.id);
    assert.equal(afterSpoof.summary.claim_attempts, 4);
    assert.equal(afterSpoof.summary.blocks_count, 1);
    assert.equal(afterSpoof.summary.reports_count, 1);
  });
});

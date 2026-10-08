import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { allowPermanentGuestFallback, anonymousSignInCredentials, retryAuthRateLimit, withAuthCaptcha } from "./live-auth-helpers.mjs";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const organizerEmail = process.env.HERE_TEST_ORGANIZER_EMAIL;
const organizerPassword = process.env.HERE_TEST_ORGANIZER_PASSWORD;
const allowGeneratedOrganizer = process.env.HERE_TEST_CREATE_ORGANIZER === "true";
const enabled = Boolean(url && key && ((organizerEmail && organizerPassword) || allowGeneratedOrganizer));

function client() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createGuest(name, joinCode) {
  const guest = client();
  let { data: auth, error: authError } = await guest.auth.signInAnonymously(anonymousSignInCredentials());
  if (authError?.message?.match(/rate limit/i) && allowPermanentGuestFallback()) {
    const passwordAuth = await retryAuthRateLimit(() => guest.auth.signUp(withAuthCaptcha({
      email: `rynow-guest-${crypto.randomUUID()}@example.com`,
      password: `Rynow-${crypto.randomUUID()}-Aa1!`,
    })));
    auth = passwordAuth.data;
    authError = passwordAuth.error;
  }
  assert.ifError(authError);
  assert.ok(auth.user && auth.session);
  const avatarPath = `${auth.user.id}/sprint2-${crypto.randomUUID()}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  assert.ifError((await guest.storage.from("avatars").upload(avatarPath, png, { contentType: "image/png" })).error);
  assert.ifError((await guest.from("profiles").insert({ id: auth.user.id, display_name: name, avatar_path: avatarPath, age_confirmed_18: true, gender: "prefer_not_to_say", discovery_preference: "everyone" })).error);
  assert.ifError((await guest.rpc("join_room_by_code", { p_join_code: joinCode })).error);
  return { client: guest, user: auth.user, name };
}

async function joinExistingGuest(guest, joinCode) {
  assert.ifError((await guest.client.rpc("join_room_by_code", { p_join_code: joinCode })).error);
  return guest;
}

async function createRoom(organizer, organizerId, name) {
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const { data, error } = await organizer.from("rooms").insert({
    organizer_id: organizerId,
    name,
    venue_name: "Drop Lab",
    city: "Riga",
    starts_at: start,
    ends_at: end,
    status: "open",
  }).select().single();
  assert.ifError(error);
  return data;
}

async function createDrop(organizer, roomId, scheduledAt, { size = 10, unlock = 6, budget = 3 } = {}) {
  const { data, error } = await organizer.rpc("create_room_drop", {
    p_room_id: roomId,
    p_scheduled_at: scheduledAt,
    p_drop_size: size,
    p_min_unlock_count: unlock,
    p_interest_budget: budget,
  });
  assert.ifError(error);
  return data;
}

async function openDrop(organizer, dropId) {
  assert.ifError((await organizer.rpc("open_drop_now", { p_drop_id: dropId })).error);
}

async function markAndPass(guest, item) {
  assert.ifError((await guest.client.rpc("mark_drop_item_seen", { p_drop_item_id: item.id })).error);
  assert.ifError((await guest.client.rpc("pass_drop_item", { p_drop_item_id: item.id })).error);
}

test("Sprint 2 live acceptance — S2-A through S2-O", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  const organizer = client();
  const generatedEmail = `rynow-sprint2-${crypto.randomUUID()}@example.com`;
  const generatedPassword = `Rynow-${crypto.randomUUID()}-Aa1!`;
  const { data: organizerAuth, error: organizerError } = await retryAuthRateLimit(() => organizerEmail && organizerPassword
    ? organizer.auth.signInWithPassword(withAuthCaptcha({ email: organizerEmail, password: organizerPassword }))
    : organizer.auth.signUp(withAuthCaptcha({ email: generatedEmail, password: generatedPassword })));
  assert.ifError(organizerError);
  assert.ok(organizerAuth.user && !organizerAuth.user.is_anonymous);

  const roomsToClose = [];
  t.after(async () => {
    if (!roomsToClose.length) return;
    const { error } = await organizer.from("rooms").update({ status: "closed" }).in("id", roomsToClose);
    assert.ifError(error);
  });
  const primaryRoom = await createRoom(organizer, organizerAuth.user.id, "RYNOW Sprint 2 Acceptance");
  roomsToClose.push(primaryRoom.id);
  const viewer = await createGuest("Pavel", primaryRoom.join_code);
  const primaryCandidates = [];
  for (let index = 1; index <= 11; index += 1) {
    primaryCandidates.push(await createGuest(`Candidate ${index}`, primaryRoom.join_code));
  }
  const guestById = new Map(primaryCandidates.map((guest) => [guest.user.id, guest]));

  const futureTimes = [30, 75, 120].map((minutes) => new Date(Date.now() + minutes * 60_000).toISOString());
  const drop1 = await createDrop(organizer, primaryRoom.id, futureTimes[0], { size: 10, unlock: 6, budget: 3 });
  const drop2 = await createDrop(organizer, primaryRoom.id, futureTimes[1], { size: 10, unlock: 1, budget: 3 });
  const drop3 = await createDrop(organizer, primaryRoom.id, futureTimes[2], { size: 10, unlock: 1, budget: 3 });

  await t.test("S2-A — three scheduled Drops persist", async () => {
    const { data, error } = await organizer.from("drops").select("id, sequence_number, scheduled_at").eq("room_id", primaryRoom.id).order("sequence_number");
    assert.ifError(error);
    assert.deepEqual(data.map((drop) => drop.id), [drop1.id, drop2.id, drop3.id]);
    assert.deepEqual(data.map((drop) => drop.sequence_number), [1, 2, 3]);
  });

  await t.test("S2-B — countdown uses persisted backend time and premature claim is denied", async () => {
    const { data: state, error: stateError } = await viewer.client.rpc("room_drop_state", { p_room_id: primaryRoom.id });
    assert.ifError(stateError);
    assert.equal(state[0].next_scheduled_at, drop1.scheduled_at);
    assert.ok(new Date(state[0].next_scheduled_at) > new Date(state[0].server_now));
    const { error } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop1.id });
    assert.match(error?.message || "", /not open yet/i);
  });

  await openDrop(organizer, drop1.id);
  const { data: firstClaim, error: firstClaimError } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop1.id });
  assert.ifError(firstClaimError);

  await t.test("S2-C — Open Now makes a dense Your Drop available", async () => {
    assert.equal(firstClaim.length, 10);
    assert.ok(firstClaim.every((item) => item.candidate_id !== viewer.user.id));
  });

  await t.test("S2-E — Your Drop IDs and order are persistent", async () => {
    const { data: repeated, error } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop1.id });
    assert.ifError(error);
    assert.deepEqual(
      repeated.map((item) => [item.id, item.candidate_id, item.item_position]),
      firstClaim.map((item) => [item.id, item.candidate_id, item.item_position]),
    );
  });

  await t.test("S2-F — Room Wall is limited and foreign Drop items are blocked", async () => {
    const { data: wall, error: wallError } = await viewer.client.rpc("room_wall_profiles", { p_room_id: primaryRoom.id, p_limit: 8 });
    assert.ifError(wallError);
    assert.ok(wall.length <= 8);
    assert.ok(wall.length < 12);
    assert.ok((await viewer.client.from("drop_items").select("*")).error);

    const intruder = primaryCandidates[0];
    const { data: foreignClaim, error: foreignClaimError } = await intruder.client.rpc("claim_your_drop", { p_drop_id: drop1.id });
    assert.ifError(foreignClaimError);
    const { error: foreignItemError } = await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: foreignClaim[0].id });
    assert.match(foreignItemError?.message || "", /not found/i);
  });

  await t.test("S2-G — only the first three displayed cards become impressions", async () => {
    for (const item of firstClaim.slice(0, 3)) {
      assert.ifError((await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: item.id })).error);
    }
    const { data: afterThree, error } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop1.id });
    assert.ifError(error);
    assert.equal(afterThree.filter((item) => item.first_seen_at).length, 3);
    assert.equal(afterThree.filter((item) => item.first_seen_at === null).length, 7);
    const firstSeen = afterThree[0].first_seen_at;
    assert.ifError((await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: afterThree[0].id })).error);
    const { data: afterRefresh } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop1.id });
    assert.equal(afterRefresh[0].first_seen_at, firstSeen);
  });

  const adaptiveBudget = Math.ceil(firstClaim.length * 0.5);

  await t.test("S2-J — adaptive budget survives requests and rejects the next Interest", async () => {
    assert.equal(adaptiveBudget, 5);
    for (const item of firstClaim.slice(0, adaptiveBudget)) {
      assert.ifError((await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: item.id })).error);
      const { error } = await viewer.client.rpc("send_interest", { p_drop_item_id: item.id });
      assert.ifError(error);
    }
    assert.ifError((await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: firstClaim[adaptiveBudget].id })).error);
    const { error: exhaustedError } = await viewer.client.rpc("send_interest", { p_drop_item_id: firstClaim[adaptiveBudget].id });
    assert.match(exhaustedError?.message || "", /No Interests left/i);
    const { data: state, error: stateError } = await viewer.client.rpc("room_drop_state", { p_room_id: primaryRoom.id });
    assert.ifError(stateError);
    assert.equal(Number(state[0].interests_used), adaptiveBudget);
  });

  const otherRoom = await createRoom(organizer, organizerAuth.user.id, "RYNOW Cross-room Isolation");
  roomsToClose.push(otherRoom.id);
  const otherRoomGuest = await createGuest("Other Room Guest", otherRoom.join_code);
  const otherRoomDrop = await createDrop(organizer, otherRoom.id, futureTimes[0], { size: 2, unlock: 1, budget: 1 });

  await t.test("S2-K — arbitrary, self, cross-room, Wall and non-assigned Interests are rejected", async () => {
    const randomItem = crypto.randomUUID();
    assert.match((await viewer.client.rpc("send_interest", { p_drop_item_id: randomItem })).error?.message || "", /not found/i);
    assert.match((await viewer.client.rpc("send_interest", { p_drop_item_id: firstClaim[adaptiveBudget].id })).error?.message || "", /No Interests left/i);
    assert.ok((await viewer.client.from("interests").insert({ room_id: primaryRoom.id, drop_id: drop1.id, drop_item_id: firstClaim[0].id, from_user_id: viewer.user.id, to_user_id: viewer.user.id })).error);
    assert.ok((await viewer.client.from("interests").insert({ room_id: otherRoom.id, drop_id: otherRoomDrop.id, drop_item_id: randomItem, from_user_id: viewer.user.id, to_user_id: otherRoomGuest.user.id })).error);
    assert.ok((await viewer.client.from("interests").insert({ room_id: primaryRoom.id, drop_id: drop1.id, drop_item_id: randomItem, from_user_id: viewer.user.id, to_user_id: primaryCandidates[10].user.id })).error);
    const { data: someoneElsesItems } = await primaryCandidates[1].client.rpc("claim_your_drop", { p_drop_id: drop1.id });
    assert.match((await viewer.client.rpc("send_interest", { p_drop_item_id: someoneElsesItems[0].id })).error?.message || "", /not found/i);
  });

  await t.test("S2-L — recipient and sender see only their own Interest side", async () => {
    const recipient = guestById.get(firstClaim[0].candidate_id);
    const { data: incoming, error: incomingError } = await recipient.client.rpc("interested_in_you", { p_room_id: primaryRoom.id });
    assert.ifError(incomingError);
    assert.ok(incoming.some((interest) => interest.from_user_id === viewer.user.id && interest.display_name === "Pavel"));

    const { data: sent, error: sentError } = await viewer.client.rpc("sent_interests", { p_room_id: primaryRoom.id });
    assert.ifError(sentError);
    assert.equal(sent.length, adaptiveBudget);
    assert.ok(sent.some((interest) => interest.to_user_id === recipient.user.id));

    const recipients = new Set(firstClaim.slice(0, adaptiveBudget).map((item) => item.candidate_id));
    const thirdPerson = primaryCandidates.find((guest) => !recipients.has(guest.user.id));
    const { data: thirdIncoming, error: thirdError } = await thirdPerson.client.rpc("interested_in_you", { p_room_id: primaryRoom.id });
    assert.ifError(thirdError);
    assert.ok(thirdIncoming.every((interest) => interest.from_user_id !== viewer.user.id));
    assert.ok((await organizer.rpc("interested_in_you", { p_room_id: primaryRoom.id })).error);
    assert.ok((await organizer.from("interests").select("*")).error);
  });

  await t.test("S2-M — Drops, assignments and Interests stay inside their Room", async () => {
    assert.ok((await viewer.client.rpc("room_drop_state", { p_room_id: otherRoom.id })).error);
    assert.ok((await otherRoomGuest.client.rpc("room_drop_state", { p_room_id: primaryRoom.id })).error);
    const { data: visibleDrops, error } = await otherRoomGuest.client.from("drops").select("room_id");
    assert.ifError(error);
    assert.ok(visibleDrops.every((drop) => drop.room_id === otherRoom.id));
    assert.ok((await otherRoomGuest.client.rpc("sent_interests", { p_room_id: primaryRoom.id })).error);
  });

  for (const item of firstClaim.slice(adaptiveBudget)) {
    if (item.id === firstClaim[adaptiveBudget].id) {
      assert.ifError((await viewer.client.rpc("pass_drop_item", { p_drop_item_id: item.id })).error);
    } else {
      await markAndPass(viewer, item);
    }
  }

  await openDrop(organizer, drop2.id);
  const { data: secondClaim, error: secondClaimError } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop2.id });
  assert.ifError(secondClaimError);

  await t.test("S2-N — next Drop uses unseen candidates before any repeat", async () => {
    const seen = new Set(firstClaim.map((item) => item.candidate_id));
    assert.equal(secondClaim.length, 1);
    assert.ok(secondClaim.every((item) => !seen.has(item.candidate_id)));
  });
  for (const item of secondClaim) await markAndPass(viewer, item);

  await openDrop(organizer, drop3.id);
  const { data: exhaustedClaim, error: exhaustedError } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop3.id });
  assert.ifError(exhaustedError);

  await t.test("S2-O — exhausted pool returns no repeats or fake profiles", async () => {
    assert.equal(exhaustedClaim.length, 0);
    const { data: state, error } = await viewer.client.rpc("room_drop_state", { p_room_id: primaryRoom.id });
    assert.ifError(error);
    assert.equal(Number(state[0].eligible_count), 0);
    assert.equal(Number(state[0].active_candidate_count), 11);
  });

  const smallRoom = await createRoom(organizer, organizerAuth.user.id, "RYNOW Low Density");
  roomsToClose.push(smallRoom.id);
  const smallViewer = await joinExistingGuest(viewer, smallRoom.join_code);
  await joinExistingGuest(primaryCandidates[0], smallRoom.join_code);
  const smallDrop = await createDrop(organizer, smallRoom.id, futureTimes[0], { size: 3, unlock: 2, budget: 1 });
  await openDrop(organizer, smallDrop.id);

  await t.test("S2-D — low-density state unlocks only after enough real people join", async () => {
    const { data: forming, error: formingError } = await smallViewer.client.rpc("claim_your_drop", { p_drop_id: smallDrop.id });
    assert.ifError(formingError);
    assert.equal(forming.length, 0);
    const { data: formingState } = await smallViewer.client.rpc("room_drop_state", { p_room_id: smallRoom.id });
    assert.equal(Number(formingState[0].eligible_count), 1);
    await joinExistingGuest(primaryCandidates[1], smallRoom.join_code);
    const { data: unlocked, error: unlockedError } = await smallViewer.client.rpc("claim_your_drop", { p_drop_id: smallDrop.id });
    assert.ifError(unlockedError);
    assert.equal(unlocked.length, 2);
  });

  const fairRoom = await createRoom(organizer, organizerAuth.user.id, "RYNOW Fair Exposure");
  roomsToClose.push(fairRoom.id);
  const fairGuests = primaryCandidates.slice(0, 10);
  for (const fairGuest of fairGuests) await joinExistingGuest(fairGuest, fairRoom.join_code);
  const fairDrop = await createDrop(organizer, fairRoom.id, futureTimes[0], { size: 4, unlock: 1, budget: 3 });
  await openDrop(organizer, fairDrop.id);
  const popularTarget = fairGuests[0];
  const exposure = new Map(fairGuests.map((guest) => [guest.user.id, 0]));
  const orders = new Set();
  let targetInterests = 0;

  for (const fairViewer of fairGuests) {
    const { data: items, error } = await fairViewer.client.rpc("claim_your_drop", { p_drop_id: fairDrop.id });
    assert.ifError(error);
    orders.add(items.map((item) => item.candidate_id).join(","));
    for (const item of items) {
      exposure.set(item.candidate_id, (exposure.get(item.candidate_id) || 0) + 1);
      assert.ifError((await fairViewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: item.id })).error);
      if (item.candidate_id === popularTarget.user.id) {
        assert.ifError((await fairViewer.client.rpc("send_interest", { p_drop_item_id: item.id })).error);
        targetInterests += 1;
      } else {
        assert.ifError((await fairViewer.client.rpc("pass_drop_item", { p_drop_item_id: item.id })).error);
      }
    }
  }

  await t.test("S2-H — viewed exposure is balanced with bounded randomization", async () => {
    const counts = [...exposure.values()];
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 40);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 3, `Exposure spread was ${counts.join(", ")}`);
    assert.ok(orders.size > 1);
  });

  await t.test("S2-I — a profile with more Interests receives no popularity boost", async () => {
    assert.ok(targetInterests >= 2);
    const { data: targetIncoming, error: incomingError } = await popularTarget.client.rpc("interested_in_you", { p_room_id: fairRoom.id });
    assert.ifError(incomingError);
    assert.equal(targetIncoming.length, targetInterests);

    const probeViewers = [viewer, primaryCandidates[10]];
    for (const probe of probeViewers) await joinExistingGuest(probe, fairRoom.join_code);
    const probeDrop = await createDrop(organizer, fairRoom.id, futureTimes[1], { size: 1, unlock: 1, budget: 1 });
    await openDrop(organizer, probeDrop.id);
    const probeSelections = new Map();
    for (const probe of probeViewers) {
      const { data: items, error } = await probe.client.rpc("claim_your_drop", { p_drop_id: probeDrop.id });
      assert.ifError(error);
      for (const item of items) probeSelections.set(item.candidate_id, (probeSelections.get(item.candidate_id) || 0) + 1);
    }
    const targetSelections = probeSelections.get(popularTarget.user.id) || 0;
    assert.equal(targetSelections, 0);
  });
});

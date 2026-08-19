import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

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
  const { data: auth, error: authError } = await guest.auth.signInAnonymously();
  assert.ifError(authError);
  const avatarPath = `${auth.user.id}/sprint2-${crypto.randomUUID()}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  assert.ifError((await guest.storage.from("avatars").upload(avatarPath, png, { contentType: "image/png" })).error);
  assert.ifError((await guest.from("profiles").insert({ id: auth.user.id, display_name: name, avatar_path: avatarPath, age_confirmed_18: true })).error);
  assert.ifError((await guest.rpc("join_room_by_code", { p_join_code: joinCode })).error);
  return { client: guest, user: auth.user };
}

test("Sprint 2 live acceptance — Drops, Fair Exposure and Interests", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  const organizer = client();
  const generatedEmail = `here-sprint2-${crypto.randomUUID()}@example.com`;
  const generatedPassword = `Here-${crypto.randomUUID()}-Aa1!`;
  const { data: organizerAuth, error: organizerError } = organizerEmail && organizerPassword
    ? await organizer.auth.signInWithPassword({ email: organizerEmail, password: organizerPassword })
    : await organizer.auth.signUp({ email: generatedEmail, password: generatedPassword });
  assert.ifError(organizerError);

  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 3_600_000).toISOString();
  const { data: room, error: roomError } = await organizer.from("rooms").insert({ organizer_id: organizerAuth.user.id, name: "HERE Sprint 2 Acceptance", venue_name: "Drop Lab", city: "Riga", starts_at: start, ends_at: end, status: "open" }).select().single();
  assert.ifError(roomError);

  const viewer = await createGuest("Viewer", room.join_code);
  const anna = await createGuest("Anna", room.join_code);
  const mark = await createGuest("Mark", room.join_code);
  const sofia = await createGuest("Sofia", room.join_code);
  const guestById = new Map([anna, mark, sofia].map((guest) => [guest.user.id, guest]));

  const futureTime = new Date(Date.now() + 3_600_000).toISOString();
  const { data: drop, error: dropError } = await organizer.rpc("create_room_drop", { p_room_id: room.id, p_scheduled_at: futureTime, p_drop_size: 2, p_min_unlock_count: 2, p_interest_budget: 1 });
  assert.ifError(dropError);

  await t.test("scheduled Drop cannot be claimed before database time", async () => {
    const { error } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop.id });
    assert.match(error?.message || "", /not open yet/i);
  });

  assert.ifError((await organizer.rpc("open_drop_now", { p_drop_id: drop.id })).error);
  const { data: firstClaim, error: firstClaimError } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop.id });
  assert.ifError(firstClaimError);

  await t.test("Your Drop is server-generated, limited and persistent", async () => {
    assert.equal(firstClaim.length, 2);
    assert.ok(firstClaim.every((item) => item.candidate_id !== viewer.user.id));
    assert.ok(firstClaim.every((item) => item.first_seen_at === null));
    const { data: repeated, error } = await viewer.client.rpc("claim_your_drop", { p_drop_id: drop.id });
    assert.ifError(error);
    assert.deepEqual(repeated.map((item) => [item.id, item.candidate_id, item.item_position]), firstClaim.map((item) => [item.id, item.candidate_id, item.item_position]));
  });

  const firstItem = firstClaim[0];
  const secondItem = firstClaim[1];
  const { data: firstSeen, error: firstSeenError } = await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: firstItem.id });
  assert.ifError(firstSeenError);
  const { data: repeatedSeen, error: repeatedSeenError } = await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: firstItem.id });
  assert.ifError(repeatedSeenError);
  assert.equal(repeatedSeen, firstSeen);
  const { data: remainingBudget, error: interestError } = await viewer.client.rpc("send_interest", { p_drop_item_id: firstItem.id });
  assert.ifError(interestError);
  assert.equal(remainingBudget, 0);

  await t.test("recipient sees the real sender and organizer cannot inspect Interests", async () => {
    const recipient = guestById.get(firstItem.candidate_id);
    const { data: incoming, error } = await recipient.client.rpc("interested_in_you", { p_room_id: room.id });
    assert.ifError(error);
    assert.ok(incoming.some((item) => item.from_user_id === viewer.user.id && item.display_name === "Viewer"));
    const { error: organizerPrivateError } = await organizer.rpc("interested_in_you", { p_room_id: room.id });
    assert.ok(organizerPrivateError);
  });

  assert.ifError((await viewer.client.rpc("mark_drop_item_seen", { p_drop_item_id: secondItem.id })).error);
  await t.test("Interest budget is enforced by the backend", async () => {
    const { error } = await viewer.client.rpc("send_interest", { p_drop_item_id: secondItem.id });
    assert.match(error?.message || "", /No Interests left/i);
    assert.ifError((await viewer.client.rpc("pass_drop_item", { p_drop_item_id: secondItem.id })).error);
  });

  await t.test("direct catalogue and arbitrary Interest writes are blocked", async () => {
    assert.ok((await viewer.client.from("drop_items").select("*")).error);
    assert.ok((await viewer.client.from("interests").insert({ room_id: room.id, drop_id: drop.id, drop_item_id: firstItem.id, from_user_id: viewer.user.id, to_user_id: sofia.user.id })).error);
  });

  const { data: secondDrop, error: secondDropError } = await organizer.rpc("create_room_drop", { p_room_id: room.id, p_scheduled_at: futureTime, p_drop_size: 2, p_min_unlock_count: 1, p_interest_budget: 1 });
  assert.ifError(secondDropError);
  assert.ifError((await organizer.rpc("open_drop_now", { p_drop_id: secondDrop.id })).error);
  const { data: secondClaim, error: secondClaimError } = await viewer.client.rpc("claim_your_drop", { p_drop_id: secondDrop.id });
  assert.ifError(secondClaimError);

  await t.test("seen candidates do not repeat across Drops", async () => {
    const seenIds = new Set(firstClaim.map((item) => item.candidate_id));
    assert.ok(secondClaim.length >= 1);
    assert.ok(secondClaim.every((item) => !seenIds.has(item.candidate_id)));
  });

  const { data: smallRoom, error: smallRoomError } = await organizer.from("rooms").insert({ organizer_id: organizerAuth.user.id, name: "Low Density", venue_name: "Small Room", city: "Riga", starts_at: start, ends_at: end, status: "open" }).select().single();
  assert.ifError(smallRoomError);
  const smallViewer = await createGuest("Small Viewer", smallRoom.join_code);
  await createGuest("Only Candidate", smallRoom.join_code);
  const { data: formingDrop, error: formingDropError } = await organizer.rpc("create_room_drop", { p_room_id: smallRoom.id, p_scheduled_at: futureTime, p_drop_size: 3, p_min_unlock_count: 2, p_interest_budget: 1 });
  assert.ifError(formingDropError);
  assert.ifError((await organizer.rpc("open_drop_now", { p_drop_id: formingDrop.id })).error);

  await t.test("low-density Drop forms without fake candidates", async () => {
    const { data: claim, error } = await smallViewer.client.rpc("claim_your_drop", { p_drop_id: formingDrop.id });
    assert.ifError(error);
    assert.equal(claim.length, 0);
    const { data: state, error: stateError } = await smallViewer.client.rpc("room_drop_state", { p_room_id: smallRoom.id });
    assert.ifError(stateError);
    assert.equal(Number(state[0].eligible_count), 1);
    assert.equal(Number(state[0].min_unlock_count), 2);
  });

  await organizer.from("rooms").update({ status: "closed" }).in("id", [room.id, smallRoom.id]);
});

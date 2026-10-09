import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

async function createGuest(name) {
  const guest = client();
  let { data: auth, error: authError } = await guest.auth.signInAnonymously(anonymousSignInCredentials());
  if (authError?.message?.match(/rate limit/i) && allowPermanentGuestFallback()) {
    const passwordAuth = await retryAuthRateLimit(() => guest.auth.signUp(withAuthCaptcha({
      email: `rynow-sprint1-guest-${crypto.randomUUID()}@example.com`,
      password: `Rynow-${crypto.randomUUID()}-Aa1!`,
    })));
    auth = passwordAuth.data;
    authError = passwordAuth.error;
  }
  assert.ifError(authError);
  assert.ok(auth.user && auth.session);
  const avatarPath = `${auth.user.id}/acceptance-${crypto.randomUUID()}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const { error: uploadError } = await guest.storage.from("avatars").upload(avatarPath, png, { contentType: "image/png" });
  assert.ifError(uploadError);
  const { error: profileError } = await guest.from("profiles").insert({ id: auth.user.id, display_name: name, avatar_path: avatarPath, age_confirmed_18: true, gender: "prefer_not_to_say", discovery_preference: "everyone" });
  assert.ifError(profileError);
  return { client: guest, user: auth.user, session: auth.session, avatarPath, isAnonymous: auth.user.is_anonymous === true };
}

test("Acceptance A–G against a configured Supabase project", { skip: enabled ? false : "Set HERE_TEST_SUPABASE_URL, HERE_TEST_SUPABASE_PUBLISHABLE_KEY and organizer credentials" }, async (t) => {
  const organizer = client();
  const generatedEmail = `rynow-sprint1-${crypto.randomUUID()}@example.com`;
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

  const suffix = crypto.randomUUID().slice(0, 8);
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 3_600_000).toISOString();
  const { data: room, error: roomError } = await organizer.from("rooms").insert({ organizer_id: organizerAuth.user.id, name: "RYNOW Test Party", venue_name: "Acceptance Venue", city: "Riga", starts_at: start, ends_at: end, status: "open" }).select().single();
  assert.ifError(roomError);
  roomsToClose.push(room.id);
  assert.match(room.join_code, /^[a-f0-9]{24}$/);
  await t.test("A — Room persists and has a real QR join code", async () => {
    const { data, error } = await organizer.from("rooms").select("id, join_code").eq("id", room.id).single();
    assert.ifError(error);
    assert.equal(data.id, room.id);
    assert.equal(data.join_code, room.join_code);
  });

  const anna = await createGuest("Anna");
  const { error: annaJoinError } = await anna.client.rpc("join_room_by_code", { p_join_code: room.join_code });
  assert.ifError(annaJoinError);
  await t.test("B — anonymous guest creates profile and membership", async () => {
    const { data: profile, error: profileError } = await anna.client.from("profiles").select("id, display_name, age_confirmed_18, gender, discovery_preference").eq("id", anna.user.id).single();
    const { data: membership, error: membershipError } = await anna.client.from("room_members").select("room_id, user_id").eq("room_id", room.id).eq("user_id", anna.user.id).single();
    assert.ifError(profileError);
    assert.ifError(membershipError);
    assert.equal(profile.id, anna.user.id);
    assert.equal(profile.age_confirmed_18, true);
    assert.equal(profile.gender, "prefer_not_to_say");
    assert.equal(profile.discovery_preference, "everyone");
    assert.equal(membership.user_id, anna.user.id);
  });

  await t.test("C — restored browser session keeps identity and idempotent membership", async () => {
    const restored = client();
    const { error: sessionError } = await restored.auth.setSession({ access_token: anna.session.access_token, refresh_token: anna.session.refresh_token });
    assert.ifError(sessionError);
    const { data: restoredUser, error: restoredUserError } = await restored.auth.getUser();
    assert.ifError(restoredUserError);
    assert.equal(restoredUser.user.id, anna.user.id);
    assert.ifError((await restored.rpc("join_room_by_code", { p_join_code: room.join_code })).error);
    const { data: rows, error: rowsError } = await restored.from("room_members").select("user_id").eq("room_id", room.id).eq("user_id", anna.user.id);
    assert.ifError(rowsError);
    assert.equal((rows || []).length, 1);
  });

  const mark = await createGuest("Mark");
  assert.ifError((await mark.client.rpc("join_room_by_code", { p_join_code: room.join_code })).error);
  await t.test("D — second device produces a real count of two", async () => {
    const { data: count, error } = await anna.client.rpc("room_joined_count", { p_room_id: room.id });
    assert.ifError(error);
    assert.equal(Number(count), 2);
    const { data: wall, error: wallError } = await anna.client.rpc("room_wall_profiles", { p_room_id: room.id, p_limit: 12 });
    assert.ifError(wallError);
    assert.deepEqual(new Set((wall || []).map((person) => person.display_name)), new Set(["Anna", "Mark"]));
  });

  const { data: roomTwo, error: roomTwoError } = await organizer.from("rooms").insert({ organizer_id: organizerAuth.user.id, name: `Second Room ${suffix}`, venue_name: "Other Venue", city: "Riga", starts_at: start, ends_at: end, status: "open" }).select().single();
  assert.ifError(roomTwoError);
  roomsToClose.push(roomTwo.id);
  const isolated = await createGuest(`Isolated ${suffix}`);
  assert.ifError((await isolated.client.rpc("join_room_by_code", { p_join_code: roomTwo.join_code })).error);
  await t.test("E — Room membership is isolated", async () => {
    const { data: firstRoomRows, error: firstRoomError } = await anna.client.from("room_members").select("user_id").eq("room_id", room.id);
    assert.ifError(firstRoomError);
    assert.ok(!(firstRoomRows || []).some((row) => row.user_id === isolated.user.id));
    const { data: hiddenRows, error: hiddenRoomError } = await anna.client.from("room_members").select("user_id").eq("room_id", roomTwo.id);
    assert.ifError(hiddenRoomError);
    assert.equal((hiddenRows || []).length, 0);
  });

  assert.ifError((await organizer.from("rooms").update({ status: "closed" }).eq("id", room.id)).error);
  const phoneC = await createGuest(`Phone C ${suffix}`);
  await t.test("F — closed Room rejects new membership", async () => {
    const { error } = await phoneC.client.rpc("join_room_by_code", { p_join_code: room.join_code });
    assert.match(error?.message || "", /Room has ended/i);
    const { data, error: membershipError } = await phoneC.client.from("room_members").select("room_id").eq("room_id", room.id);
    assert.ifError(membershipError);
    assert.equal((data || []).length, 0);
  });

  await t.test("G — RLS rejects cross-user and cross-Room writes", async () => {
    assert.equal(anna.isAnonymous, true, "The Room privilege probe must use an actual anonymous Supabase user");
    const { data: directPeerProfile, error: peerReadError } = await anna.client.from("profiles").select("id, display_name").eq("id", mark.user.id);
    assert.ifError(peerReadError);
    assert.equal((directPeerProfile || []).length, 0);
    const { data: profileWrite } = await anna.client.from("profiles").update({ display_name: "Hacked" }).eq("id", mark.user.id).select();
    assert.equal((profileWrite || []).length, 0);
    const { error: forgedMembership } = await anna.client.from("room_members").insert({ room_id: roomTwo.id, user_id: mark.user.id });
    assert.ok(forgedMembership);
    const { error: forgedAvatar } = await anna.client.storage.from("avatars").upload(
      `${mark.user.id}/forged-${crypto.randomUUID()}.png`,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
      { contentType: "image/png" },
    );
    assert.ok(forgedAvatar);
    const { error: anonymousRoomInsert } = await anna.client.from("rooms").insert({
      organizer_id: anna.user.id,
      name: "Forged Room",
      starts_at: start,
      ends_at: end,
      status: "open",
    });
    assert.ok(anonymousRoomInsert);
    const { data: roomWrite } = await anna.client.from("rooms").update({ name: "Hacked Room" }).eq("id", roomTwo.id).select();
    assert.equal((roomWrite || []).length, 0);
    const foreignMembershipProbe = await anna.client.rpc("is_room_member", { target_room: roomTwo.id, target_user: isolated.user.id });
    assert.ok(foreignMembershipProbe.error || foreignMembershipProbe.data === false, "Helper RPC must not reveal another user's Room membership");
    const forgedSharedRoomProbe = await anna.client.rpc("shares_active_room", { viewer: isolated.user.id, target: isolated.user.id });
    assert.ok(forgedSharedRoomProbe.error || forgedSharedRoomProbe.data === false, "Helper RPC must bind viewer to auth.uid()");
    const clientSource = await readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8");
    assert.doesNotMatch(clientSource, /service[_-]?role/i);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const organizerEmail = process.env.HERE_TEST_ORGANIZER_EMAIL;
const organizerPassword = process.env.HERE_TEST_ORGANIZER_PASSWORD;
const allowGeneratedOrganizer = process.env.HERE_TEST_CREATE_ORGANIZER === "true";
const enabled = Boolean(url && key && ((organizerEmail && organizerPassword) || allowGeneratedOrganizer));
const liveClients = new Set();

function client() {
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  liveClients.add(supabase);
  return supabase;
}

async function createGuest(name, joinCode) {
  const guest = client();
  let { data: auth, error: authError } = await guest.auth.signInAnonymously();
  if (authError && /rate limit/i.test(authError.message)) {
    const email = `here-actor-${crypto.randomUUID()}@example.com`;
    const password = `Here-${crypto.randomUUID()}-Aa1!`;
    const permanent = await guest.auth.signUp({ email, password });
    auth = permanent.data;
    authError = permanent.error;
  }
  assert.ifError(authError);
  assert.ok(auth.user);
  assert.ok(auth.session?.access_token);
  await guest.realtime.setAuth(auth.session.access_token);
  const avatarPath = `${auth.user.id}/sprint3-${crypto.randomUUID()}.png`;
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
    venue_name: "HERE Safety Lab",
    city: "Riga",
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    status: "open",
  }).select().single();
  assert.ifError(error);
  return data;
}

async function createOpenDrop(organizer, roomId, { size, unlock = 1, budget = 3 }) {
  const { data: drop, error } = await organizer.rpc("create_room_drop", {
    p_room_id: roomId,
    p_scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    p_drop_size: size,
    p_min_unlock_count: unlock,
    p_interest_budget: budget,
  });
  assert.ifError(error);
  assert.ifError((await organizer.rpc("open_drop_now", { p_drop_id: drop.id })).error);
  return drop;
}

async function interestIn(guest, dropId, candidateId) {
  const { data: items, error } = await guest.client.rpc("claim_your_drop", { p_drop_id: dropId });
  assert.ifError(error);
  const item = items.find((candidate) => candidate.candidate_id === candidateId);
  assert.ok(item, "Expected candidate was not in assigned Your Drop");
  assert.ifError((await guest.client.rpc("mark_drop_item_seen", { p_drop_item_id: item.id })).error);
  assert.ifError((await guest.client.rpc("send_interest", { p_drop_item_id: item.id })).error);
  return { item, items };
}

function subscribeForMessage(supabase, matchId, expectedBody) {
  let readyResolve;
  let readyReject;
  let messageResolve;
  let messageReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const message = new Promise((resolve, reject) => { messageResolve = resolve; messageReject = reject; });
  const readyTimer = setTimeout(() => readyReject(new Error("Realtime subscription timeout")), 12_000);
  const messageTimer = setTimeout(() => messageReject(new Error("Realtime message timeout")), 12_000);
  const channel = supabase
    .channel(`acceptance-${matchId}-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` }, (payload) => {
      if (payload.new.body === expectedBody) {
        clearTimeout(messageTimer);
        messageResolve(payload.new);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(readyTimer); readyResolve(); }
      if (status === "CHANNEL_ERROR") { clearTimeout(readyTimer); readyReject(new Error("Realtime channel error")); }
    });
  return { ready, message, cleanup: () => supabase.removeChannel(channel) };
}

test("Sprint 3 live acceptance — S3-A through S3-N", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  t.after(async () => {
    for (const supabase of liveClients) {
      await supabase.removeAllChannels();
      supabase.realtime.disconnect();
    }
  });
  const organizer = client();
  const generatedEmail = `here-sprint3-${crypto.randomUUID()}@example.com`;
  const generatedPassword = `Here-${crypto.randomUUID()}-Aa1!`;
  const { data: organizerAuth, error: organizerError } = organizerEmail && organizerPassword
    ? await organizer.auth.signInWithPassword({ email: organizerEmail, password: organizerPassword })
    : await organizer.auth.signUp({ email: generatedEmail, password: generatedPassword });
  assert.ifError(organizerError);
  assert.ok(organizerAuth.user && !organizerAuth.user.is_anonymous);
  const roomsToClose = [];

  const room = await createRoom(organizer, organizerAuth.user.id, "HERE Sprint 3 Social Loop");
  roomsToClose.push(room.id);
  const pavel = await createGuest("Pavel", room.join_code);
  const anna = await createGuest("Anna", room.join_code);
  const mark = await createGuest("Mark", room.join_code);
  const firstDrop = await createOpenDrop(organizer, room.id, { size: 2, unlock: 2, budget: 2 });
  await interestIn(pavel, firstDrop.id, anna.user.id);

  const { data: annaIncoming, error: annaIncomingError } = await anna.client.rpc("interested_in_you", { p_room_id: room.id });
  assert.ifError(annaIncomingError);
  const pavelInterest = annaIncoming.find((interest) => interest.from_user_id === pavel.user.id);
  assert.ok(pavelInterest);
  const { data: matchId, error: acceptError } = await anna.client.rpc("respond_to_interest", { p_interest_id: pavelInterest.interest_id, p_interested: true });
  assert.ifError(acceptError);

  await t.test("S3-A — reciprocal Interest creates exactly one Match", async () => {
    assert.ok(matchId);
    const { data: matches, error } = await pavel.client.from("matches").select("id, room_id, user_a_id, user_b_id").eq("id", matchId);
    assert.ifError(error);
    assert.equal(matches.length, 1);
    assert.deepEqual(new Set([matches[0].user_a_id, matches[0].user_b_id]), new Set([pavel.user.id, anna.user.id]));
  });

  await t.test("S3-B — repeated accept is idempotent", async () => {
    const { data: repeatedId, error } = await anna.client.rpc("respond_to_interest", { p_interest_id: pavelInterest.interest_id, p_interested: true });
    assert.ifError(error);
    assert.equal(repeatedId, matchId);
    const { data: matches, error: countError } = await anna.client.from("matches").select("id").eq("room_id", room.id);
    assert.ifError(countError);
    assert.equal(matches.filter((match) => match.id === matchId).length, 1);
  });

  const markDrop = await createOpenDrop(organizer, room.id, { size: 2, unlock: 1, budget: 1 });
  await interestIn(mark, markDrop.id, anna.user.id);
  const { data: secondIncoming } = await anna.client.rpc("interested_in_you", { p_room_id: room.id });
  const markInterest = secondIncoming.find((interest) => interest.from_user_id === mark.user.id);
  assert.ok(markInterest);

  await t.test("S3-C — decline archives inbox item without Match or negative notification", async () => {
    const { data: declinedMatch, error } = await anna.client.rpc("respond_to_interest", { p_interest_id: markInterest.interest_id, p_interested: false });
    assert.ifError(error);
    assert.equal(declinedMatch, null);
    const { data: afterDecline } = await anna.client.rpc("interested_in_you", { p_room_id: room.id });
    assert.ok(afterDecline.every((interest) => interest.interest_id !== markInterest.interest_id));
    const { data: sent, error: sentError } = await mark.client.rpc("sent_interests", { p_room_id: room.id });
    assert.ifError(sentError);
    assert.ok(sent.some((interest) => interest.interest_id === markInterest.interest_id));
    const { data: markMatches } = await mark.client.from("matches").select("id").eq("room_id", room.id);
    assert.equal(markMatches.length, 0);
  });

  await t.test("S3-D — Match is private from third participant and organizer", async () => {
    assert.equal((await pavel.client.from("matches").select("id").eq("id", matchId)).data.length, 1);
    assert.equal((await anna.client.from("matches").select("id").eq("id", matchId)).data.length, 1);
    assert.equal((await mark.client.from("matches").select("id").eq("id", matchId)).data.length, 0);
    assert.equal((await organizer.from("matches").select("id").eq("id", matchId)).data.length, 0);
  });

  await t.test("S3-E — both participants receive text messages through Realtime", async () => {
    const annaRealtime = subscribeForMessage(anna.client, matchId, "Hi Anna");
    try {
      await annaRealtime.ready;
      assert.ifError((await pavel.client.rpc("send_match_message", { p_match_id: matchId, p_body: "Hi Anna" })).error);
      assert.equal((await annaRealtime.message).body, "Hi Anna");
    } finally {
      await annaRealtime.cleanup();
    }

    const pavelRealtime = subscribeForMessage(pavel.client, matchId, "Hey Pavel");
    try {
      await pavelRealtime.ready;
      assert.ifError((await anna.client.rpc("send_match_message", { p_match_id: matchId, p_body: "Hey Pavel" })).error);
      assert.equal((await pavelRealtime.message).body, "Hey Pavel");
    } finally {
      await pavelRealtime.cleanup();
    }
  });

  await t.test("S3-F — conversation persists in order", async () => {
    const { data: pavelMessages, error } = await pavel.client.from("messages").select("body, created_at").eq("match_id", matchId).order("created_at");
    assert.ifError(error);
    assert.deepEqual(pavelMessages.map((message) => message.body), ["Hi Anna", "Hey Pavel"]);
    const { data: annaMessages } = await anna.client.from("messages").select("body").eq("match_id", matchId).order("created_at");
    assert.deepEqual(annaMessages.map((message) => message.body), ["Hi Anna", "Hey Pavel"]);
  });

  await t.test("S3-G — third user cannot read or send Match messages", async () => {
    const { data, error } = await mark.client.from("messages").select("id").eq("match_id", matchId);
    assert.ifError(error);
    assert.equal(data.length, 0);
    assert.match((await mark.client.rpc("send_match_message", { p_match_id: matchId, p_body: "attack" })).error?.message || "", /Match access required/i);
  });

  await t.test("S3-H — direct fake Match creation is rejected", async () => {
    const first = mark.user.id < anna.user.id ? mark.user.id : anna.user.id;
    const second = mark.user.id < anna.user.id ? anna.user.id : mark.user.id;
    const { error } = await mark.client.from("matches").insert({ room_id: room.id, user_a_id: first, user_b_id: second });
    assert.ok(error);
  });

  await t.test("S3-I — Block hides Match and prevents new messages", async () => {
    assert.ifError((await anna.client.rpc("block_user", { p_blocked_id: pavel.user.id })).error);
    assert.equal((await anna.client.rpc("room_matches", { p_room_id: room.id })).data.length, 0);
    assert.equal((await pavel.client.rpc("room_matches", { p_room_id: room.id })).data.length, 0);
    assert.match((await pavel.client.rpc("send_match_message", { p_match_id: matchId, p_body: "blocked" })).error?.message || "", /unavailable/i);
  });

  const safetyRoom = await createRoom(organizer, organizerAuth.user.id, "HERE Block Eligibility");
  roomsToClose.push(safetyRoom.id);
  const blocker = await createGuest("Blocker", safetyRoom.join_code);
  const blocked = await createGuest("Blocked", safetyRoom.join_code);
  const safeCandidate = await createGuest("Safe Candidate", safetyRoom.join_code);
  assert.ifError((await blocker.client.rpc("block_user", { p_blocked_id: blocked.user.id })).error);
  const safetyDrop = await createOpenDrop(organizer, safetyRoom.id, { size: 2, unlock: 1, budget: 1 });

  await t.test("S3-J — blocked pair is excluded before Drop ranking", async () => {
    const { data: blockerItems, error } = await blocker.client.rpc("claim_your_drop", { p_drop_id: safetyDrop.id });
    assert.ifError(error);
    assert.ok(blockerItems.every((item) => item.candidate_id !== blocked.user.id));
    assert.ok(blockerItems.some((item) => item.candidate_id === safeCandidate.user.id));
    const { data: blockedItems, error: blockedError } = await blocked.client.rpc("claim_your_drop", { p_drop_id: safetyDrop.id });
    assert.ifError(blockedError);
    assert.ok(blockedItems.every((item) => item.candidate_id !== blocker.user.id));
  });

  await t.test("S3-K — Report is stored privately from reported user", async () => {
    const { data: reportId, error } = await anna.client.rpc("submit_report", { p_reported_user_id: pavel.user.id, p_room_id: room.id, p_match_id: matchId, p_reason: "Safety concern", p_details: "Acceptance test", p_block: false });
    assert.ifError(error);
    assert.equal((await anna.client.from("reports").select("id").eq("id", reportId)).data.length, 1);
    assert.equal((await pavel.client.from("reports").select("id, reporter_id").eq("id", reportId)).data.length, 0);
    assert.equal((await organizer.from("reports").select("id").eq("id", reportId)).data.length, 0);
  });

  await t.test("S3-L — Report and Block completes both operations", async () => {
    const { data: reportId, error } = await mark.client.rpc("submit_report", { p_reported_user_id: pavel.user.id, p_room_id: room.id, p_match_id: null, p_reason: "Spam", p_details: null, p_block: true });
    assert.ifError(error);
    assert.ok(reportId);
    assert.equal((await mark.client.from("blocks").select("blocked_id").eq("blocked_id", pavel.user.id)).data.length, 1);
    assert.equal((await mark.client.from("reports").select("id").eq("id", reportId)).data.length, 1);
  });

  const closedRoom = await createRoom(organizer, organizerAuth.user.id, "HERE Closed Match");
  roomsToClose.push(closedRoom.id);
  const carol = await createGuest("Carol", closedRoom.join_code);
  const dan = await createGuest("Dan", closedRoom.join_code);
  const eli = await createGuest("Eli", closedRoom.join_code);
  const closedDrop = await createOpenDrop(organizer, closedRoom.id, { size: 2, unlock: 1, budget: 2 });
  const { items: carolItems } = await interestIn(carol, closedDrop.id, dan.user.id);
  const eliItem = carolItems.find((item) => item.candidate_id === eli.user.id);
  assert.ifError((await carol.client.rpc("mark_drop_item_seen", { p_drop_item_id: eliItem.id })).error);
  const { data: danIncoming } = await dan.client.rpc("interested_in_you", { p_room_id: closedRoom.id });
  const { data: closedMatchId, error: closedAcceptError } = await dan.client.rpc("respond_to_interest", { p_interest_id: danIncoming[0].interest_id, p_interested: true });
  assert.ifError(closedAcceptError);
  assert.ifError((await organizer.from("rooms").update({ status: "closed" }).eq("id", closedRoom.id)).error);

  await t.test("S3-M — closed Room keeps Match/chat but rejects new Interest", async () => {
    assert.equal((await carol.client.rpc("room_matches", { p_room_id: closedRoom.id })).data.length, 1);
    assert.ifError((await carol.client.rpc("send_match_message", { p_match_id: closedMatchId, p_body: "Still connected" })).error);
    assert.equal((await dan.client.from("messages").select("body").eq("match_id", closedMatchId)).data[0].body, "Still connected");
    assert.match((await carol.client.rpc("send_interest", { p_drop_item_id: eliItem.id })).error?.message || "", /Room has ended/i);
  });

  const popularityRoom = await createRoom(organizer, organizerAuth.user.id, "HERE Match Popularity Isolation");
  roomsToClose.push(popularityRoom.id);
  const popularityGuests = [];
  for (let index = 1; index <= 6; index += 1) popularityGuests.push(await createGuest(`Popularity ${index}`, popularityRoom.join_code));
  const popular = popularityGuests[0];
  const admirer = popularityGuests[1];
  const popularityDrop = await createOpenDrop(organizer, popularityRoom.id, { size: 5, unlock: 1, budget: 1 });
  await interestIn(admirer, popularityDrop.id, popular.user.id);
  const { data: popularIncoming } = await popular.client.rpc("interested_in_you", { p_room_id: popularityRoom.id });
  const { data: popularityMatchId } = await popular.client.rpc("respond_to_interest", { p_interest_id: popularIncoming[0].interest_id, p_interested: true });
  for (let index = 0; index < 5; index += 1) {
    const sender = index % 2 === 0 ? admirer : popular;
    assert.ifError((await sender.client.rpc("send_match_message", { p_match_id: popularityMatchId, p_body: `Message ${index}` })).error);
  }
  const fairDrop = await createOpenDrop(organizer, popularityRoom.id, { size: 3, unlock: 1, budget: 1 });

  await t.test("S3-N — Matches and messages do not boost Fair Exposure", async () => {
    const selections = new Map();
    for (const probe of popularityGuests.slice(2)) {
      const { data: items, error } = await probe.client.rpc("claim_your_drop", { p_drop_id: fairDrop.id });
      assert.ifError(error);
      for (const item of items) selections.set(item.candidate_id, (selections.get(item.candidate_id) || 0) + 1);
    }
    const popularCount = selections.get(popular.user.id) || 0;
    const maxCount = Math.max(...selections.values());
    assert.ok(popularCount <= maxCount);
    assert.ok(popularCount < popularityGuests.slice(2).length);
  });

  const stillOpen = roomsToClose.filter((id) => id !== closedRoom.id);
  assert.ifError((await organizer.from("rooms").update({ status: "closed" }).in("id", stillOpen)).error);
});

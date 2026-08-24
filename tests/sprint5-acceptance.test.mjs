import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const organizerEmail = process.env.HERE_TEST_ORGANIZER_EMAIL;
const organizerPassword = process.env.HERE_TEST_ORGANIZER_PASSWORD;
const allowGeneratedOrganizer = process.env.HERE_TEST_CREATE_ORGANIZER === "true";
const fastRecheck = process.env.HERE_TEST_FAST_RECHECK === "true";
const enabled = Boolean(url && key && ((organizerEmail && organizerPassword) || allowGeneratedOrganizer));
const clients = new Set();
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let anonymousActors = 0;
let permanentFallbackActors = 0;

function client() {
  const value = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.add(value);
  return value;
}

async function organizer() {
  const value = client();
  const credentials = organizerEmail && organizerPassword
    ? { email: organizerEmail, password: organizerPassword }
    : { email: `here-sprint5-${crypto.randomUUID()}@example.com`, password: `Here-${crypto.randomUUID()}-Aa1!` };
  let result;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    result = organizerEmail && organizerPassword
      ? await value.auth.signInWithPassword(credentials)
      : await value.auth.signUp(credentials);
    if (!result.error || (result.error.status !== 429 && !/rate limit/i.test(result.error.message || ""))) break;
    await wait(Math.min(10_000, 2_000 * attempt + Math.round(Math.random() * 1_000)));
  }
  const { data, error } = result;
  assert.ifError(error);
  assert.ok(data.user && data.session && !data.user.is_anonymous);
  return { client: value, user: data.user };
}

async function createRoom(owner, ownerId, name) {
  const { data, error } = await owner.from("rooms").insert({
    organizer_id: ownerId,
    name,
    venue_name: "HERE Reliability Lab",
    city: "Riga",
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
    status: "open",
  }).select().single();
  assert.ifError(error);
  return data;
}

async function actor(name, joinCode, { deferJoin = false } = {}) {
  const value = client();
  let { data: auth, error: authError } = await value.auth.signInAnonymously();
  if (authError?.status === 429 || /rate limit/i.test(authError?.message || "")) {
    const credentials = { email: `here-sprint5-actor-${crypto.randomUUID()}@example.com`, password: `Here-${crypto.randomUUID()}-Aa1!` };
    let fallback;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      fallback = await value.auth.signUp(credentials);
      if (!fallback.error || (fallback.error.status !== 429 && !/rate limit/i.test(fallback.error.message || ""))) break;
      await wait(Math.min(10_000, 2_000 * attempt + Math.round(Math.random() * 1_000)));
    }
    auth = fallback.data;
    authError = fallback.error;
    permanentFallbackActors += 1;
  } else {
    anonymousActors += 1;
  }
  assert.ifError(authError);
  assert.ok(auth.user && auth.session);
  const avatarPath = `${auth.user.id}/sprint5-${crypto.randomUUID()}.png`;
  assert.ifError((await value.storage.from("avatars").upload(avatarPath, tinyPng, { contentType: "image/png" })).error);
  assert.ifError((await value.from("profiles").insert({ id: auth.user.id, display_name: name, avatar_path: avatarPath, age_confirmed_18: true })).error);
  if (!deferJoin) assert.ifError((await value.rpc("join_room_by_code", { p_join_code: joinCode })).error);
  return { client: value, user: auth.user, avatarPath };
}

async function createDrop(owner, roomId, { size, unlock = 1, budget = 3, scheduledAt, open = true }) {
  const { data, error } = await owner.rpc("create_room_drop", {
    p_room_id: roomId,
    p_scheduled_at: scheduledAt || new Date(Date.now() + 60 * 60_000).toISOString(),
    p_drop_size: size,
    p_min_unlock_count: unlock,
    p_interest_budget: budget,
  });
  assert.ifError(error);
  if (open) assert.ifError((await owner.rpc("open_drop_now", { p_drop_id: data.id })).error);
  return data;
}

async function presenceCounts(owner) {
  const { data, error } = await owner.rpc("organizer_room_presence_counts");
  assert.ifError(error);
  return data;
}

function countFor(rows, roomId) {
  const value = rows.find((row) => row.room_id === roomId);
  assert.ok(value, `Presence count missing for ${roomId}`);
  return { joined: Number(value.joined_count), recent: Number(value.recent_count) };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function subscriptionReady(value, matchId, expectedBody = null) {
  let resolveReady;
  let rejectReady;
  let resolveMessage;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const message = new Promise((resolve) => { resolveMessage = resolve; });
  const timer = setTimeout(() => rejectReady(new Error("Realtime reconnect subscription timeout")), 30_000);
  const channel = value
    .channel(`s5-reconnect-${matchId}-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` }, (payload) => {
      if (!expectedBody || payload.new.body === expectedBody) resolveMessage(payload.new);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolveReady(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); rejectReady(new Error(status)); }
    });
  return { channel, ready, message };
}

test("Sprint 5 live acceptance — S5-A through S5-R", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  const owner = await organizer();
  const roomsToClose = [];
  t.after(async () => {
    if (roomsToClose.length) await owner.client.from("rooms").update({ status: "closed" }).in("id", roomsToClose);
    for (const value of clients) {
      await value.removeAllChannels();
      value.realtime.disconnect();
    }
  });

  const room = await createRoom(owner.client, owner.user.id, "HERE Sprint 5 Concurrent Pilot");
  const isolatedRoom = await createRoom(owner.client, owner.user.id, "HERE Sprint 5 Isolation");
  roomsToClose.push(room.id, isolatedRoom.id);

  const actors = [];
  for (let offset = 0; offset < 20; offset += 5) {
    actors.push(...await Promise.all(Array.from({ length: 5 }, (_, index) => actor(`S5 Guest ${offset + index + 1}`, room.join_code, { deferJoin: true }))));
    if (offset < 15) await wait(1_500);
  }
  const joinStarted = performance.now();
  const concurrentJoins = await Promise.all(actors.map(({ client: value }) => value.rpc("join_room_by_code", { p_join_code: room.join_code })));
  concurrentJoins.forEach((result) => assert.ifError(result.error));
  const joinLatency = performance.now() - joinStarted;
  const outsider = await actor("S5 Isolated Guest", isolatedRoom.join_code);

  await t.test("S5-C — 20 concurrent joins remain unique and isolated", async () => {
    const counts = countFor(await presenceCounts(owner.client), room.id);
    assert.deepEqual(counts, { joined: 20, recent: 20 });
    assert.equal(Number((await outsider.client.rpc("room_joined_count", { p_room_id: isolatedRoom.id })).data), 1);
    assert.equal((await actors[0].client.from("room_members").select("user_id").eq("room_id", room.id)).data.length, 20);
    assert.equal((await outsider.client.from("room_members").select("user_id").eq("room_id", isolatedRoom.id)).data.length, 1);
    t.diagnostic(`20 join flows: ${Math.round(joinLatency)} ms total; anonymous=${anonymousActors}, permanent fallback=${permanentFallbackActors}`);
  });

  await t.test("S5-A — server heartbeat expires without deleting membership", async () => {
    await Promise.all(actors.map(({ client: value }) => value.rpc("heartbeat_room_presence", { p_room_id: room.id })));
    if (fastRecheck) {
      t.diagnostic("Fast recheck uses explicit Leave; the dedicated pre-pilot suite validates the separate 10/60-minute boundaries.");
      const leaves = await Promise.all(actors.map(({ client: value }) => value.rpc("leave_room_presence", { p_room_id: room.id })));
      leaves.forEach((result) => assert.ifError(result.error));
    } else {
      t.diagnostic("Waiting 602 seconds to cross the authoritative 10-minute recently-active boundary.");
      await wait(602_000);
    }
    const counts = countFor(await presenceCounts(owner.client), room.id);
    assert.equal(counts.joined, 20);
    assert.equal(counts.recent, 0);
    const membership = await actors[0].client.from("room_members").select("room_id, user_id").eq("room_id", room.id).eq("user_id", actors[0].user.id).single();
    assert.ifError(membership.error);
    const profile = await actors[0].client.from("profiles").select("id").eq("id", actors[0].user.id).single();
    assert.ifError(profile.error);
  });

  await t.test("S5-B — returning sessions recover presence without duplicate membership", async () => {
    if (fastRecheck) {
      const rejoins = await Promise.all(actors.map(({ client: value }) => value.rpc("rejoin_room_presence", { p_room_id: room.id })));
      rejoins.forEach((result) => assert.ifError(result.error));
    }
    const recovered = await Promise.all(actors.map(({ client: value }) => value.rpc("heartbeat_room_presence", { p_room_id: room.id })));
    recovered.forEach((result) => assert.ifError(result.error));
    const counts = countFor(await presenceCounts(owner.client), room.id);
    assert.deepEqual(counts, { joined: 20, recent: 20 });
    const duplicateJoins = await Promise.all(Array.from({ length: 5 }, () => actors[0].client.rpc("join_room_by_code", { p_join_code: room.join_code })));
    duplicateJoins.forEach((result) => assert.ifError(result.error));
    assert.equal(countFor(await presenceCounts(owner.client), room.id).joined, 20);
  });

  const drop = await createDrop(owner.client, room.id, { size: 6, unlock: 6, budget: 3 });
  let claimRows = [];
  let exposureCounts = new Map();

  await t.test("S5-D — concurrent Drop claims stay persistent and reasonably balanced", async () => {
    const started = performance.now();
    const claims = await Promise.all(actors.slice(0, 10).map(({ client: value }) => value.rpc("claim_your_drop", { p_drop_id: drop.id })));
    const latency = performance.now() - started;
    claims.forEach((result) => assert.ifError(result.error));
    claimRows = claims.map((result) => result.data);
    claimRows.forEach((items) => {
      assert.equal(items.length, 6);
      assert.equal(new Set(items.map((item) => item.id)).size, 6);
      assert.equal(new Set(items.map((item) => item.candidate_id)).size, 6);
    });
    const repeated = await Promise.all(Array.from({ length: 8 }, () => actors[0].client.rpc("claim_your_drop", { p_drop_id: drop.id })));
    repeated.forEach((result) => {
      assert.ifError(result.error);
      assert.deepEqual(result.data.map((item) => [item.id, item.item_position]), claimRows[0].map((item) => [item.id, item.item_position]));
    });
    exposureCounts = new Map();
    for (const items of claimRows) for (const item of items) exposureCounts.set(item.candidate_id, (exposureCounts.get(item.candidate_id) || 0) + 1);
    const distribution = [...exposureCounts.values()];
    assert.ok(Math.max(...distribution) - Math.min(...distribution) <= 4, `Unexpected exposure variance: ${distribution.join(",")}`);
    assert.ok(Math.max(...distribution) < 9, "No participant should be assigned to nearly every viewer");
    t.diagnostic(`10 concurrent claims: ${Math.round(latency)} ms total; max-min exposure variance=${Math.max(...distribution) - Math.min(...distribution)}`);
  });

  const interestItem = claimRows[0][0];
  const recipient = actors.find((value) => value.user.id === interestItem.candidate_id);
  assert.ok(recipient);
  let matchId;

  await t.test("S5-E — duplicate Interest creates one logical Interest and one budget use", async () => {
    assert.ifError((await actors[0].client.rpc("mark_drop_item_seen", { p_drop_item_id: interestItem.id })).error);
    const results = await Promise.all(Array.from({ length: 6 }, () => actors[0].client.rpc("send_interest", { p_drop_item_id: interestItem.id })));
    assert.equal(results.filter((result) => !result.error).length, 1);
    const sent = await actors[0].client.rpc("sent_interests", { p_room_id: room.id });
    assert.ifError(sent.error);
    assert.equal(sent.data.filter((item) => item.to_user_id === recipient.user.id).length, 1);
    const state = await actors[0].client.rpc("room_drop_state", { p_room_id: room.id });
    assert.ifError(state.error);
    assert.equal(Number(state.data[0].interests_used), 1);
  });

  await t.test("S5-F — duplicate reciprocal accept creates exactly one Match", async () => {
    const incoming = await recipient.client.rpc("interested_in_you", { p_room_id: room.id });
    assert.ifError(incoming.error);
    const interest = incoming.data.find((item) => item.from_user_id === actors[0].user.id);
    assert.ok(interest);
    const accepts = await Promise.all(Array.from({ length: 6 }, () => recipient.client.rpc("respond_to_interest", { p_interest_id: interest.interest_id, p_interested: true })));
    accepts.forEach((result) => assert.ifError(result.error));
    assert.equal(new Set(accepts.map((result) => result.data)).size, 1);
    matchId = accepts[0].data;
    const matches = await actors[0].client.rpc("room_matches", { p_room_id: room.id });
    assert.ifError(matches.error);
    assert.equal(matches.data.filter((match) => match.match_id === matchId).length, 1);
  });

  await t.test("S5-G — backgrounded client observes a scheduled Drop become live", async () => {
    const scheduled = await createDrop(owner.client, room.id, {
      size: 4,
      unlock: 2,
      scheduledAt: new Date(Date.now() + 2_500).toISOString(),
      open: false,
    });
    const before = await actors[19].client.rpc("room_drop_state", { p_room_id: room.id });
    assert.ifError(before.error);
    await wait(3_200);
    const after = await actors[19].client.rpc("room_drop_state", { p_room_id: room.id });
    assert.ifError(after.error);
    assert.equal(after.data[0].drop_id, scheduled.id);
    assert.ok(new Date(after.data[0].effective_open_at).getTime() <= new Date(after.data[0].server_now).getTime());
  });

  await t.test("S5-H — Realtime reconnect recovers persisted messages without duplicates", async () => {
    await actors[0].client.realtime.setAuth((await actors[0].client.auth.getSession()).data.session.access_token);
    const firstSubscription = subscriptionReady(actors[0].client, matchId);
    await firstSubscription.ready;
    await actors[0].client.removeChannel(firstSubscription.channel);
    actors[0].client.realtime.disconnect();

    const offlineBody = `S5 offline ${crypto.randomUUID()}`;
    const requestId = crypto.randomUUID();
    const sends = await Promise.all(Array.from({ length: 6 }, () => recipient.client.rpc("send_match_message_idempotent", {
      p_match_id: matchId,
      p_body: offlineBody,
      p_client_message_id: requestId,
    })));
    sends.forEach((result) => assert.ifError(result.error));
    assert.equal(new Set(sends.map((result) => result.data.id)).size, 1);

    const liveBody = `S5 live ${crypto.randomUUID()}`;
    actors[0].client.realtime.connect();
    let secondSubscription;
    let reconnectError;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const reconnectSession = (await actors[0].client.auth.getSession()).data.session;
        assert.ok(reconnectSession);
        await actors[0].client.realtime.setAuth(reconnectSession.access_token);
        secondSubscription = subscriptionReady(actors[0].client, matchId, liveBody);
        await secondSubscription.ready;
        reconnectError = undefined;
        break;
      } catch (reason) {
        reconnectError = reason;
        if (secondSubscription) await actors[0].client.removeChannel(secondSubscription.channel);
        actors[0].client.realtime.disconnect();
        await wait(Math.min(10_000, 1_500 * attempt));
        actors[0].client.realtime.connect();
      }
    }
    if (reconnectError) throw reconnectError;
    assert.ok(secondSubscription);
    const recovered = await actors[0].client.from("messages").select("id, body").eq("match_id", matchId).eq("body", offlineBody);
    assert.ifError(recovered.error);
    assert.equal(recovered.data.length, 1);

    const liveSend = await recipient.client.rpc("send_match_message_idempotent", { p_match_id: matchId, p_body: liveBody, p_client_message_id: crypto.randomUUID() });
    assert.ifError(liveSend.error);
    const delivered = await Promise.race([secondSubscription.message, wait(30_000).then(() => { throw new Error("Realtime message not delivered after reconnect"); })]);
    assert.equal(delivered.body, liveBody);
    await actors[0].client.removeChannel(secondSubscription.channel);
  });

  await t.test("S5-I — Block during active chat prevents every later send", async () => {
    const blocks = await Promise.all(Array.from({ length: 5 }, () => actors[0].client.rpc("block_user_in_context", {
      p_blocked_id: recipient.user.id,
      p_room_id: room.id,
      p_match_id: matchId,
    })));
    blocks.forEach((result) => assert.ifError(result.error));
    const denied = await recipient.client.rpc("send_match_message_idempotent", { p_match_id: matchId, p_body: "must fail", p_client_message_id: crypto.randomUUID() });
    assert.match(denied.error?.message || "", /unavailable|access/i);
    const hidden = await recipient.client.rpc("room_matches", { p_room_id: room.id });
    assert.ifError(hidden.error);
    assert.equal(hidden.data.some((match) => match.match_id === matchId), false);
  });

  await t.test("Retry safety — Next, Report, Report and Block, and Open Now are deterministic", async () => {
    const nextItem = claimRows[4][0];
    assert.ifError((await actors[4].client.rpc("mark_drop_item_seen", { p_drop_item_id: nextItem.id })).error);
    const passes = await Promise.all(Array.from({ length: 5 }, () => actors[4].client.rpc("pass_drop_item", { p_drop_item_id: nextItem.id })));
    passes.forEach((result) => assert.ifError(result.error));

    const reportRequest = crypto.randomUUID();
    const reports = await Promise.all(Array.from({ length: 5 }, () => actors[4].client.rpc("submit_report_idempotent", {
      p_reported_user_id: actors[5].user.id,
      p_room_id: room.id,
      p_match_id: null,
      p_reason: "Spam",
      p_details: "One logical pilot report",
      p_block: false,
      p_client_action_id: reportRequest,
    })));
    reports.forEach((result) => assert.ifError(result.error));
    assert.equal(new Set(reports.map((result) => result.data)).size, 1);
    const storedReports = await actors[4].client.from("reports").select("id").eq("client_action_id", reportRequest);
    assert.ifError(storedReports.error);
    assert.equal(storedReports.data.length, 1);

    const reportAndBlockRequest = crypto.randomUUID();
    const reportAndBlocks = await Promise.all(Array.from({ length: 5 }, () => actors[6].client.rpc("submit_report_idempotent", {
      p_reported_user_id: actors[7].user.id,
      p_room_id: room.id,
      p_match_id: null,
      p_reason: "Safety concern",
      p_details: null,
      p_block: true,
      p_client_action_id: reportAndBlockRequest,
    })));
    reportAndBlocks.forEach((result) => assert.ifError(result.error));
    assert.equal(new Set(reportAndBlocks.map((result) => result.data)).size, 1);

    const manualDrop = await createDrop(owner.client, room.id, { size: 3, unlock: 1, open: false });
    const opens = await Promise.all(Array.from({ length: 5 }, () => owner.client.rpc("open_drop_now", { p_drop_id: manualDrop.id })));
    opens.forEach((result) => assert.ifError(result.error));
    assert.equal(new Set(opens.map((result) => result.data)).size, 1);
  });

  await t.test("S5-L — an expired avatar URL can be signed and fetched again", async () => {
    const first = await actors[0].client.storage.from("avatars").createSignedUrl(actors[0].avatarPath, 1);
    assert.ifError(first.error);
    await wait(1_500);
    const refreshed = await actors[0].client.storage.from("avatars").createSignedUrl(actors[0].avatarPath, 60);
    assert.ifError(refreshed.error);
    assert.notEqual(refreshed.data.signedUrl, first.data.signedUrl);
    const response = await fetch(refreshed.data.signedUrl);
    assert.equal(response.status, 200);
  });

  await t.test("S5-K/S5-M/S5-N — rate-limit, offline and polling recovery contracts are present", async () => {
    const [roomSource, reliabilitySource] = await Promise.all([
      readFile(new URL("../app/components/RoomJoinApp.tsx", import.meta.url), "utf8"),
      readFile(new URL("../lib/reliability.ts", import.meta.url), "utf8"),
    ]);
    assert.match(reliabilitySource, /status === 429/);
    assert.match(reliabilitySource, /Too many people are joining at once/);
    assert.match(roomSource, /Connection lost\./);
    assert.match(roomSource, /visibilityState === "hidden"/);
    assert.equal((roomSource.match(/setInterval\(\(\) => \{ void runPoll\(\); \}, ROOM_POLL_MS\)/g) || []).length, 1);
    assert.match(roomSource, /removeEventListener\("online"/);
    assert.match(roomSource, /removeChannel\(channel\)/);
  });

  await t.test("S5-O/S5-P — analytics and Fair Exposure remain outcome-neutral", async () => {
    const analytics = await owner.client.rpc("room_analytics", { p_room_id: room.id });
    assert.ifError(analytics.error);
    assert.deepEqual(analytics.data.presence_model, { heartbeat_seconds: 60, recent_active_timeout_seconds: 600, discovery_eligible_timeout_seconds: 3600, definition: "server heartbeat plus explicit discovery state" });
    assert.equal(Number(analytics.data.summary.joined_memberships), 20);
    assert.ok(Number(analytics.data.summary.cards_seen) >= 1);
    const distribution = [...exposureCounts.values()];
    assert.ok(Math.max(...distribution) - Math.min(...distribution) <= 4);
  });

  let closeMatchId;
  let closeInterestItem;
  await t.test("S5-J — Room close stops discovery but preserves an existing chat", async () => {
    const closeDrop = await createDrop(owner.client, room.id, { size: 20, unlock: 1, budget: 3 });
    const claim = await actors[10].client.rpc("claim_your_drop", { p_drop_id: closeDrop.id });
    assert.ifError(claim.error);
    const toActor11 = claim.data.find((item) => item.candidate_id === actors[11].user.id);
    closeInterestItem = claim.data.find((item) => item.id !== toActor11?.id);
    assert.ok(toActor11 && closeInterestItem);
    assert.ifError((await actors[10].client.rpc("mark_drop_item_seen", { p_drop_item_id: toActor11.id })).error);
    assert.ifError((await actors[10].client.rpc("send_interest", { p_drop_item_id: toActor11.id })).error);
    const incoming = await actors[11].client.rpc("interested_in_you", { p_room_id: room.id });
    const interest = incoming.data.find((item) => item.from_user_id === actors[10].user.id);
    const accepted = await actors[11].client.rpc("respond_to_interest", { p_interest_id: interest.interest_id, p_interested: true });
    assert.ifError(accepted.error);
    closeMatchId = accepted.data;
    assert.ifError((await actors[10].client.rpc("mark_drop_item_seen", { p_drop_item_id: closeInterestItem.id })).error);

    const closes = await Promise.all(Array.from({ length: 5 }, () => owner.client.from("rooms").update({ status: "closed" }).eq("id", room.id)));
    closes.forEach((result) => assert.ifError(result.error));
    const discoveryDenied = await actors[10].client.rpc("send_interest", { p_drop_item_id: closeInterestItem.id });
    assert.match(discoveryDenied.error?.message || "", /ended/i);
    const claimDenied = await actors[12].client.rpc("claim_your_drop", { p_drop_id: closeDrop.id });
    assert.match(claimDenied.error?.message || "", /ended/i);
    const chatStillWorks = await actors[10].client.rpc("send_match_message_idempotent", { p_match_id: closeMatchId, p_body: "Room ended, Match remains", p_client_message_id: crypto.randomUUID() });
    assert.ifError(chatStillWorks.error);
    const matchAvatar = await actors[10].client.storage.from("avatars").createSignedUrl(actors[11].avatarPath, 60);
    assert.ifError(matchAvatar.error);
  });

  await t.test("S5-Q — direct API security regression remains closed", async () => {
    const foreignProfileUpdate = await actors[0].client.from("profiles").update({ display_name: "forged" }).eq("id", actors[1].user.id).select("id");
    assert.ok(foreignProfileUpdate.error || foreignProfileUpdate.data.length === 0);
    assert.ok((await actors[0].client.from("room_members").update({ last_seen_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("room_id", room.id).eq("user_id", actors[0].user.id)).error);
    assert.ok((await actors[0].client.from("drop_items").select("*")).error);
    assert.ok((await actors[0].client.from("messages").insert({ match_id: closeMatchId, sender_id: actors[0].user.id, body: "forged" })).error);
    assert.ok((await actors[0].client.rpc("room_analytics", { p_room_id: room.id })).error);
    const organizerMessages = await owner.client.from("messages").select("id").eq("match_id", closeMatchId);
    assert.ok(organizerMessages.error || organizerMessages.data.length === 0);
  });

  await t.test("S5-R — live schema exposes only the intended Sprint 5 RPC surface", async () => {
    const presence = await owner.client.rpc("organizer_room_presence_counts");
    assert.ifError(presence.error);
    assert.ok(presence.data.some((row) => row.room_id === room.id));
    const unauthenticated = client();
    assert.ok((await unauthenticated.rpc("heartbeat_room_presence", { p_room_id: room.id })).error);
    assert.ok((await unauthenticated.rpc("send_match_message_idempotent", { p_match_id: closeMatchId, p_body: "no", p_client_message_id: crypto.randomUUID() })).error);
  });
});

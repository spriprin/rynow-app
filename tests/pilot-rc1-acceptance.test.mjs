import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { assertIsolatedPublishableKey, assertIsolatedTurnstileTestEnvironment, assertRepeatableTurnstileTestEnvironment } from "./live-auth-helpers.mjs";

const enabled = process.env.HERE_TEST_PILOT_RC1 === "true";
const securityEnabled = process.env.HERE_TEST_PILOT_RC1_SECURITY === "true";
const url = process.env.HERE_TEST_SUPABASE_URL || "";
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY || "";
const captchaToken = process.env.HERE_TEST_TURNSTILE_TOKEN || "";
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const client = () => createClient(url, key, options);
const one = (value) => Array.isArray(value) ? value[0] : value;

async function assertHardenedClientSurface(api, roomId = crypto.randomUUID(), matchId = crypto.randomUUID()) {
  for (const [rpc, args] of [
    ["explore_state", { p_room_id: roomId }],
    ["sent_interests", { p_room_id: roomId }],
    ["send_match_message", { p_match_id: matchId, p_body: "legacy path" }],
  ]) {
    const retired = await api.rpc(rpc, args);
    assert.ok(retired.error, `${rpc} must not be client-executable`);
  }

  const historicalDrops = await api.from("drops").select("id").limit(1);
  assert.ok(historicalDrops.error, "historical Drops must not be client-readable");
}

async function guest(name, gender) {
  const api = client();
  const signed = await api.auth.signInAnonymously({ options: { captchaToken } });
  assert.ifError(signed.error);
  const id = signed.data.user.id;
  assert.ifError((await api.from("profiles").insert({
    id, display_name: name, avatar_path: id + "/rc1-test.jpg", age_confirmed_18: true,
    gender, discovery_preference: "everyone",
  })).error);
  assert.ifError((await api.rpc("accept_pilot_terms", { p_version: "pilot-rc1-draft-2026-09-14" })).error);
  return { api, id, session: signed.data.session };
}

test("Pilot RC1 staging acceptance — identity, continuous Explore, social loop, safety and aggregates", { skip: !enabled && "Set HERE_TEST_PILOT_RC1=true for an isolated migrated Supabase project" }, async () => {
  assertIsolatedTurnstileTestEnvironment(url);
  assertRepeatableTurnstileTestEnvironment(url);
  assertIsolatedPublishableKey(key);
  assert.ok(captchaToken, "A configured isolated CAPTCHA proof is required");
  assert.ok(process.env.HERE_TEST_ORGANIZER_EMAIL, "HERE_TEST_ORGANIZER_EMAIL is required");
  assert.ok(process.env.HERE_TEST_ORGANIZER_PASSWORD, "HERE_TEST_ORGANIZER_PASSWORD is required");
  const organizer = client();
  const auth = await organizer.auth.signInWithPassword({
    email: process.env.HERE_TEST_ORGANIZER_EMAIL, password: process.env.HERE_TEST_ORGANIZER_PASSWORD,
    options: { captchaToken },
  });
  assert.ifError(auth.error);

  const suffix = crypto.randomUUID().slice(0, 8);
  const starts = new Date(Date.now() - 60_000).toISOString();
  const ends = new Date(Date.now() + 3_600_000).toISOString();
  const created = await organizer.from("rooms").insert({
    organizer_id: auth.data.user.id, name: "RC1 " + suffix, venue_name: "Isolated test",
    city: "Riga", starts_at: starts, ends_at: ends, status: "open",
  }).select("id,join_code").single();
  assert.ifError(created.error);
  const room = created.data;

  const [alice, bob] = await Promise.all([guest("Alice " + suffix, "female"), guest("Bob " + suffix, "male")]);
  for (const actor of [alice, bob]) assert.ifError((await actor.api.rpc("join_room_by_code", { p_join_code: room.join_code })).error);

  const initialMembership = await alice.api.from("room_members").select("room_id,user_id,joined_at,left_at,discovery_enabled").eq("room_id", room.id).eq("user_id", alice.id).single();
  assert.ifError(initialMembership.error);
  const bobMembershipBefore = await bob.api.from("room_members").select("joined_at").eq("room_id", room.id).eq("user_id", bob.id).single();
  assert.ifError(bobMembershipBefore.error);
  const claim = await alice.api.rpc("claim_explore_batch", { p_room_id: room.id });
  assert.ifError(claim.error);
  const item = claim.data.items.find((candidate) => candidate.candidate_id === bob.id);
  assert.ok(item, "Bob must be selected server-side for Alice");
  assert.ifError((await alice.api.rpc("mark_explore_item_seen", { p_explore_item_id: item.id })).error);
  assert.ifError((await alice.api.rpc("send_explore_interest", { p_explore_item_id: item.id })).error);
  assert.ifError((await alice.api.rpc("send_explore_interest", { p_explore_item_id: item.id })).error, "same request is idempotent");

  const incoming = await bob.api.rpc("interested_in_you", { p_room_id: room.id });
  assert.ifError(incoming.error);
  assert.equal(incoming.data.length, 1);
  const interestId = incoming.data[0].interest_id;
  const responses = await Promise.all([
    bob.api.rpc("respond_to_interest", { p_interest_id: interestId, p_interested: true }),
    bob.api.rpc("respond_to_interest", { p_interest_id: interestId, p_interested: true }),
  ]);
  assert.ok(responses.some((result) => !result.error));
  const aliceConnections = await alice.api.rpc("user_connections");
  assert.ifError(aliceConnections.error);
  assert.equal(aliceConnections.data.filter((match) => match.room_id === room.id).length, 1);
  const match = aliceConnections.data.find((entry) => entry.room_id === room.id);
  assert.ok(match);

  const notifications = await bob.api.rpc("notification_state");
  assert.ifError(notifications.error);
  assert.ok(Number(notifications.data.interest) >= 1);
  const messageId = crypto.randomUUID();
  assert.ifError((await alice.api.rpc("send_match_message_idempotent", { p_match_id: match.match_id, p_body: "Meet by the bar", p_client_message_id: messageId })).error);
  assert.ifError((await alice.api.rpc("send_match_message_idempotent", { p_match_id: match.match_id, p_body: "Meet by the bar", p_client_message_id: messageId })).error);
  const bobNotifications = await bob.api.rpc("notification_state");
  assert.ok(Number(bobNotifications.data.message) >= 1);

  const charlie = await guest("Charlie " + suffix, "male");
  assert.ifError((await charlie.api.rpc("join_room_by_code", { p_join_code: room.join_code })).error);
  const charlieClaim = await alice.api.rpc("claim_explore_batch", { p_room_id: room.id });
  assert.ifError(charlieClaim.error);
  const charlieItem = charlieClaim.data.items.find((candidate) => candidate.candidate_id === charlie.id);
  assert.ok(charlieItem, "a newly joined eligible guest must appear without restarting Alice's session");
  assert.ifError((await alice.api.rpc("mark_explore_item_seen", { p_explore_item_id: charlieItem.id })).error);
  assert.ifError((await alice.api.rpc("send_explore_interest", { p_explore_item_id: charlieItem.id })).error);
  const charlieIncoming = await charlie.api.rpc("interested_in_you", { p_room_id: room.id });
  assert.ifError(charlieIncoming.error);
  assert.ifError((await charlie.api.rpc("respond_to_interest", {
    p_interest_id: charlieIncoming.data[0].interest_id, p_interested: false,
  })).error);
  assert.ifError((await alice.api.rpc("send_explore_interest", { p_explore_item_id: charlieItem.id })).error, "network retry remains idempotent after rejection");
  const afterRejection = await alice.api.rpc("claim_explore_batch", { p_room_id: room.id });
  assert.ifError(afterRejection.error);
  assert.equal(afterRejection.data.items.some((candidate) => candidate.candidate_id === charlie.id), false, "a rejected pair is never assigned again");

  const dana = await guest("Dana " + suffix, "female");
  assert.ifError((await dana.api.rpc("join_room_by_code", { p_join_code: room.join_code })).error);
  const laterClaim = await alice.api.rpc("claim_explore_batch", { p_room_id: room.id });
  assert.ifError(laterClaim.error);
  assert.ok(laterClaim.data.items.some((candidate) => candidate.candidate_id === dana.id), "a later eligible guest appears in continuous Explore");

  assert.ifError((await alice.api.rpc("leave_room_presence", { p_room_id: room.id })).error);
  const restored = client();
  assert.ifError((await restored.auth.setSession({ access_token: alice.session.access_token, refresh_token: alice.session.refresh_token })).error);
  assert.ifError((await restored.rpc("join_room_by_code", { p_join_code: room.join_code })).error);
  const left = one((await restored.rpc("room_presence_state", { p_room_id: room.id })).data);
  assert.equal(left.discovery_enabled, false);
  assert.ok(left.left_at);
  assert.ifError((await restored.rpc("rejoin_room_presence", { p_room_id: room.id })).error);
  const rejoined = await restored.from("room_members").select("joined_at,left_at,discovery_enabled").eq("room_id", room.id).eq("user_id", alice.id).single();
  assert.ifError(rejoined.error);
  assert.equal(rejoined.data.joined_at, initialMembership.data.joined_at);
  assert.equal(rejoined.data.left_at, null);
  assert.equal(rejoined.data.discovery_enabled, true);

  const ordinaryReturn = client();
  assert.ifError((await ordinaryReturn.auth.setSession({ access_token: bob.session.access_token, refresh_token: bob.session.refresh_token })).error);
  assert.ifError((await ordinaryReturn.rpc("join_room_by_code", { p_join_code: room.join_code })).error);
  const normalPresence = one((await ordinaryReturn.rpc("room_presence_state", { p_room_id: room.id })).data);
  assert.equal(normalPresence.discovery_enabled, true);
  assert.equal(normalPresence.left_at, null);
  const bobMembershipAfter = await ordinaryReturn.from("room_members").select("joined_at").eq("room_id", room.id).eq("user_id", bob.id);
  assert.ifError(bobMembershipAfter.error);
  assert.equal(bobMembershipAfter.data.length, 1);
  assert.equal(bobMembershipAfter.data[0].joined_at, bobMembershipBefore.data.joined_at);
  const bobProfileAfter = await ordinaryReturn.from("profiles").select("id").eq("id", bob.id);
  assert.ifError(bobProfileAfter.error);
  assert.deepEqual(bobProfileAfter.data.map((row) => row.id), [bob.id]);

  const profileAttack = await restored.from("profiles").update({ display_name: "ATTACK" }).eq("id", bob.id).select("id");
  assert.ok(profileAttack.error || profileAttack.data?.length === 0, "RLS must reject or affect zero rows for another profile update");
  assert.ok((await organizer.rpc("admin_operations_rooms")).error, "Room ownership does not grant platform admin");

  assert.ifError((await restored.rpc("submit_report_rc1", {
    p_reported_user_id: bob.id, p_room_id: room.id, p_match_id: match.match_id,
    p_category: "Spam", p_details: "Isolated RC1 test", p_block: false,
    p_share_with_event_staff: false, p_client_action_id: crypto.randomUUID(),
  })).error);
  assert.ifError((await organizer.from("rooms").update({ status: "closed" }).eq("id", room.id)).error);
  assert.ifError((await restored.rpc("record_match_irl_feedback", { p_match_id: match.match_id, p_answer: "yes" })).error);
  assert.ifError((await ordinaryReturn.rpc("record_match_irl_feedback", { p_match_id: match.match_id, p_answer: "no" })).error);
  const ownFeedback = await restored.from("match_irl_feedback").select("match_id,respondent_id,answer").eq("match_id", match.match_id);
  assert.ifError(ownFeedback.error);
  assert.deepEqual(ownFeedback.data.map((row) => row.respondent_id), [alice.id]);

  const analytics = await organizer.rpc("room_analytics", { p_room_id: room.id });
  assert.ifError(analytics.error);
  assert.equal(Number(analytics.data.summary.matches_created), 1);
  assert.equal(Number(analytics.data.summary.interests_sent), 2, "idempotent/rejected retries do not create duplicate Interests");
  assert.equal(Number(analytics.data.summary.conversations_started), 1);
  assert.equal(Number(analytics.data.summary.irl_yes), 1);
  assert.equal(Number(analytics.data.summary.irl_no), 1);
  assert.equal(Number(analytics.data.summary.reports_count), 1);
  assert.doesNotMatch(JSON.stringify(analytics.data), /Alice|Bob|Meet by the bar|reported_user|reporter/i);

  const legacy = await restored.rpc("room_drop_state", { p_room_id: room.id });
  assert.ok(legacy.error, "deprecated discovery RPC must not be client-executable");

  await assertHardenedClientSurface(restored, room.id, match.match_id);
});

test("Pilot RC1 staging hardening — retired RPCs and historical Drops are closed", { skip: !securityEnabled && "Set HERE_TEST_PILOT_RC1_SECURITY=true for an isolated migrated Supabase project" }, async () => {
  assertIsolatedTurnstileTestEnvironment(url);
  assertRepeatableTurnstileTestEnvironment(url);
  assertIsolatedPublishableKey(key);
  assert.ok(captchaToken, "A configured isolated CAPTCHA proof is required");

  const api = client();
  const signed = await api.auth.signInAnonymously({ options: { captchaToken } });
  assert.ifError(signed.error);
  await assertHardenedClientSurface(api);
});

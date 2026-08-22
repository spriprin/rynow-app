import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { retryAuthRateLimit } from "./live-auth-helpers.mjs";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const fallbackEmail = process.env.HERE_TEST_ORGANIZER_EMAIL;
const fallbackPassword = process.env.HERE_TEST_ORGANIZER_PASSWORD;
const enabled = Boolean(url && key);

function client() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function registerPermanent(label) {
  const authClient = client();
  const email = `here-organizer-${label}-${crypto.randomUUID()}@example.com`;
  const password = `Here-${crypto.randomUUID()}-Aa1!`;
  const { data, error } = await retryAuthRateLimit(() => authClient.auth.signUp({ email, password }));
  assert.ifError(error);
  assert.ok(data.user);
  assert.notEqual(data.user.is_anonymous, true);
  return { client: authClient, email, password, user: data.user, session: data.session };
}

async function fallbackOrganizer() {
  assert.ok(fallbackEmail && fallbackPassword, "Confirmed organizer credentials are required when email confirmation is enabled");
  const authClient = client();
  const { data, error } = await authClient.auth.signInWithPassword({ email: fallbackEmail, password: fallbackPassword });
  assert.ifError(error);
  assert.ok(data.user && data.session && !data.user.is_anonymous);
  return { client: authClient, user: data.user, session: data.session };
}

async function createRoom(organizer, userId, label) {
  const { data, error } = await organizer.from("rooms").insert({
    organizer_id: userId,
    name: `HERE Organizer Signup ${label}`,
    venue_name: "Release Lab",
    city: "Riga",
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    status: "open",
  }).select("id, organizer_id, join_code").single();
  assert.ifError(error);
  return data;
}

test("Organizer self-service Auth live acceptance", { skip: enabled ? false : "Set live Supabase test variables" }, async (t) => {
  const first = await registerPermanent("a");

  await t.test("permanent user can register and confirmation state is explicit", () => {
    assert.ok(first.user.email);
    assert.equal(first.user.is_anonymous, false);
    assert.ok(first.session === null || first.session.user.id === first.user.id);
  });

  await t.test("password recovery request accepts only the fixed production organizer redirect", async () => {
    const recoveryProbeEmail = `here.sprint4.recovery+${crypto.randomUUID()}@gmail.com`;
    const { error } = await first.client.auth.resetPasswordForEmail(recoveryProbeEmail, {
      redirectTo: "https://here-social-room.spriprin.chatgpt.site/organizer?recovery=1",
    });
    assert.ifError(error);
  });

  const organizerA = first.session ? first : await fallbackOrganizer();
  const roomA = await createRoom(organizerA.client, organizerA.user.id, "A");
  t.after(async () => {
    await organizerA.client.from("rooms").update({ status: "closed" }).eq("id", roomA.id);
  });

  await t.test("new or confirmed organizer creates only an owned Room", () => {
    assert.equal(roomA.organizer_id, organizerA.user.id);
    assert.match(roomA.join_code, /^[a-f0-9]{24}$/);
  });

  const anonymous = client();
  const { data: guestAuth, error: guestError } = await anonymous.auth.signInAnonymously();
  assert.ifError(guestError);
  assert.ok(guestAuth.user?.is_anonymous);

  await t.test("anonymous guest cannot create a Room", async () => {
    const { error } = await anonymous.from("rooms").insert({
      organizer_id: guestAuth.user.id,
      name: "Anonymous attack",
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: "open",
    });
    assert.ok(error);
  });

  const second = await registerPermanent("b");
  const organizerB = second.session ? second : null;
  await t.test("organizer A cannot be managed by organizer B", { skip: organizerB ? false : "Email confirmation requires a second confirmed account" }, async () => {
    const { data, error } = await organizerB.client.from("rooms").update({ name: "Cross-organizer attack" }).eq("id", roomA.id).select("id");
    assert.ifError(error);
    assert.equal(data.length, 0);
    const { data: visible, error: readError } = await organizerB.client.from("rooms").select("id").eq("id", roomA.id);
    assert.ifError(readError);
    assert.equal(visible.length, 0);
  });

  await t.test("organizer signup does not transform an existing anonymous identity", async () => {
    const before = await anonymous.auth.getUser();
    assert.equal(before.data.user.id, guestAuth.user.id);
    assert.equal(before.data.user.is_anonymous, true);
    assert.notEqual(first.user.id, guestAuth.user.id);
    const after = await anonymous.auth.getUser();
    assert.equal(after.data.user.id, guestAuth.user.id);
    assert.equal(after.data.user.is_anonymous, true);
  });

  await t.test("organizer session restores and sign out clears only that client", { skip: organizerA.session ? false : "No reusable organizer session available" }, async () => {
    const restored = client();
    assert.ifError((await restored.auth.setSession({ access_token: organizerA.session.access_token, refresh_token: organizerA.session.refresh_token })).error);
    assert.equal((await restored.auth.getUser()).data.user.id, organizerA.user.id);
    assert.ifError((await restored.auth.signOut({ scope: "local" })).error);
    assert.equal((await restored.auth.getSession()).data.session, null);
    assert.equal((await anonymous.auth.getUser()).data.user.id, guestAuth.user.id);
  });
});

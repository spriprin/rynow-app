import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  assertIsolatedPublishableKey,
  assertIsolatedTurnstileTestEnvironment,
  OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN,
} from "./live-auth-helpers.mjs";

const enabled = process.env.HERE_TEST_PROFILE_EDIT === "true";

test("returning guest can replace only the current persisted profile fields", { skip: enabled ? false : "Set HERE_TEST_PROFILE_EDIT=true for the isolated live profile-edit test" }, async () => {
  const url = process.env.HERE_TEST_SUPABASE_URL || "";
  const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY || "";
  assertIsolatedTurnstileTestEnvironment(url);
  assertIsolatedPublishableKey(key);

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: auth, error: authError } = await client.auth.signInAnonymously({
    options: { captchaToken: OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN },
  });
  assert.ifError(authError);
  assert.ok(auth.user && auth.session);

  const userId = auth.user.id;
  const suffix = randomUUID();
  const oldAvatarPath = `${userId}/profile-edit-old-${suffix}.png`;
  const newAvatarPath = `${userId}/profile-edit-new-${suffix}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

  assert.ifError((await client.storage.from("avatars").upload(oldAvatarPath, png, { contentType: "image/png", cacheControl: "2" })).error);
  assert.ifError((await client.from("profiles").insert({
    id: userId,
    display_name: "Before Edit",
    avatar_path: oldAvatarPath,
    age_confirmed_18: true,
  })).error);
  const oldSignedBefore = await client.storage.from("avatars").createSignedUrl(oldAvatarPath, 600);
  assert.ifError(oldSignedBefore.error);
  assert.ok(oldSignedBefore.data?.signedUrl);

  assert.ifError((await client.storage.from("avatars").upload(newAvatarPath, png, { contentType: "image/png", cacheControl: "300" })).error);
  const { data: updated, error: updateError } = await client.from("profiles")
    .update({ display_name: "After Edit", avatar_path: newAvatarPath })
    .eq("id", userId)
    .select("id, display_name, avatar_path, age_confirmed_18")
    .single();
  assert.ifError(updateError);
  assert.deepEqual(updated, {
    id: userId,
    display_name: "After Edit",
    avatar_path: newAvatarPath,
    age_confirmed_18: true,
  });

  const oldSigned = await client.storage.from("avatars").createSignedUrl(oldAvatarPath, 60);
  assert.ifError(oldSigned.error, "the owner must retain read access needed by the Storage delete operation");
  assert.ifError((await client.storage.from("avatars").createSignedUrl(newAvatarPath, 60)).error);

  const unrelatedClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: unrelatedAuthError } = await unrelatedClient.auth.signInAnonymously({
    options: { captchaToken: OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN },
  });
  assert.ifError(unrelatedAuthError);
  const unrelatedOldSigned = await unrelatedClient.storage.from("avatars").createSignedUrl(oldAvatarPath, 60);
  assert.ok(unrelatedOldSigned.error, "another authenticated user must not sign a replaced avatar path");

  const preissuedBeforeCleanup = await fetch(oldSignedBefore.data.signedUrl);
  assert.ok(preissuedBeforeCleanup.ok, "a pre-issued URL remains valid until object cleanup or its short expiry");

  const { data: currentUser, error: userError } = await client.auth.getUser();
  assert.ifError(userError);
  assert.equal(currentUser.user.id, userId);
  const { data: memberships, error: membershipError } = await client.from("room_members").select("room_id").eq("user_id", userId);
  assert.ifError(membershipError);
  assert.equal((memberships || []).length, 0);

  const { data: removedObjects, error: removeError } = await client.storage.from("avatars").remove([oldAvatarPath]);
  assert.ifError(removeError);
  assert.ok((removedObjects || []).some((object) => object.name === oldAvatarPath), "Storage must confirm physical removal of the exact replaced object");
  const ownerOldSignedAfterCleanup = await client.storage.from("avatars").createSignedUrl(oldAvatarPath, 60);
  assert.ok(ownerOldSignedAfterCleanup.error, "the owner cannot create a new signed URL after physical cleanup");
});

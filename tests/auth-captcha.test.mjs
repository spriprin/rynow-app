import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  assertIsolatedPublishableKey,
  assertIsolatedTurnstileTestEnvironment,
  assertRepeatableTurnstileTestEnvironment,
  OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN,
} from "./live-auth-helpers.mjs";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const validToken = process.env.HERE_TEST_TURNSTILE_TOKEN;
const requested = process.env.HERE_TEST_AUTH_CAPTCHA === "true";
const phase = process.env.HERE_TEST_AUTH_CAPTCHA_PHASE;
const productionProjectHost = "xwycdnyxuluuhylcnnjh.supabase.co";

function client() {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function assertCaptchaFailure(error, label) {
  assert.ok(error, `${label}: the request unexpectedly succeeded without valid CAPTCHA proof`);
  assert.notEqual(error.status, 429, `${label}: Auth capacity is depleted, so this is not clean CAPTCHA evidence`);
  assert.match(`${error.code || ""} ${error.message || ""}`, /captcha/i, `${label}: expected a CAPTCHA-specific rejection`);
}

test("PP-R — Supabase Auth CAPTCHA provider verification", {
  skip: requested ? false : "Set HERE_TEST_AUTH_CAPTCHA=true and isolated-environment Supabase/Turnstile test variables",
}, async (t) => {
  assert.ok(url && key, "PP-R was requested without the isolated Supabase URL/key");
  assert.ok(["accept", "reject", "production-negative"].includes(phase), "Set HERE_TEST_AUTH_CAPTCHA_PHASE=accept, reject, or production-negative");

  if (phase === "accept" || phase === "reject") {
    assert.equal(validToken, OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN, "Isolated provider tests require Cloudflare's official dummy token");
    assertIsolatedTurnstileTestEnvironment(url);
    assertRepeatableTurnstileTestEnvironment(url);
    assertIsolatedPublishableKey(key);
  }
  if (phase === "production-negative") {
    assert.equal(new URL(url).host, productionProjectHost, "production-negative must target the HERE production project");
    assert.equal(validToken, undefined, "production-negative must not receive a reusable test token");
  }

  await t.test("missing CAPTCHA token is rejected before provider verification", async () => {
    const { data, error } = await client().auth.signInAnonymously();
    assert.equal(data.session, null);
    assertCaptchaFailure(error, "missing token");
  });

  if (phase === "accept") {
    await t.test("official always-pass proof creates one genuinely fresh anonymous identity", async () => {
      const { data, error } = await client().auth.signInAnonymously({
        options: { captchaToken: validToken },
      });
      assert.ifError(error);
      assert.ok(data.session && data.user?.is_anonymous);
      assert.equal(data.session.user.id, data.user.id);
    });
  }

  if (phase === "reject") await t.test("official always-fail provider configuration rejects official dummy proof", async () => {
    const { data, error } = await client().auth.signInAnonymously({
      options: { captchaToken: validToken },
    });
    assert.equal(data.session, null);
    assertCaptchaFailure(error, "invalid token");
  });

  if (phase === "production-negative") await t.test("production rejects malformed proof", async () => {
    const { data, error } = await client().auth.signInAnonymously({
      options: { captchaToken: `invalid-${crypto.randomUUID()}` },
    });
    assert.equal(data.session, null);
    assertCaptchaFailure(error, "malformed production token");
  });
});

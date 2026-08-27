import assert from "node:assert/strict";
import test from "node:test";
import {
  allowPermanentGuestFallback,
  assertAuthorizedIsolatedAuthLoad,
  assertIsolatedPublishableKey,
  assertIsolatedTurnstileTestEnvironment,
  assertRepeatableTurnstileTestEnvironment,
  HERE_PRODUCTION_PROJECT_REF,
  OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN,
} from "./live-auth-helpers.mjs";

const temporaryProjectRef = "abcdefghijklmnopqrst";
const temporaryProjectUrl = `https://${temporaryProjectRef}.supabase.co`;
const managedVariables = [
  "HERE_REQUIRE_RELEASE_GATES",
  "HERE_TEST_ISOLATED_PROJECT_REF",
  "HERE_TEST_ISOLATED_SUPABASE",
  "HERE_TEST_TURNSTILE_MODE",
  "HERE_TEST_TURNSTILE_TOKEN",
  "HERE_TEST_ISOLATED_AUTH_LOAD_ALLOWED",
  "HERE_TEST_DELETE_ISOLATED_PROJECT_AFTER_RUN",
];

async function withEnvironment(values, operation) {
  const previous = Object.fromEntries(managedVariables.map((name) => [name, process.env[name]]));
  for (const name of managedVariables) delete process.env[name];
  Object.assign(process.env, values);
  try {
    await operation();
  } finally {
    for (const name of managedVariables) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

const isolatedEnvironment = {
  HERE_TEST_ISOLATED_PROJECT_REF: temporaryProjectRef,
  HERE_TEST_ISOLATED_SUPABASE: "true",
  HERE_TEST_TURNSTILE_MODE: "isolated-repeatable",
  HERE_TEST_TURNSTILE_TOKEN: OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN,
};

test("isolated Auth harness rejects the HERE production project even when it is mislabeled", async () => {
  await withEnvironment({
    ...isolatedEnvironment,
    HERE_TEST_ISOLATED_PROJECT_REF: HERE_PRODUCTION_PROJECT_REF,
  }, () => {
    assert.throws(
      () => assertIsolatedTurnstileTestEnvironment(`https://${HERE_PRODUCTION_PROJECT_REF}.supabase.co`),
      /production project can never be marked/i,
    );
  });
});

test("isolated Auth harness binds the exact hosted URL to the authorized project ref", async () => {
  await withEnvironment(isolatedEnvironment, () => {
    assert.doesNotThrow(() => assertIsolatedTurnstileTestEnvironment(temporaryProjectUrl));
    assert.throws(
      () => assertIsolatedTurnstileTestEnvironment("https://differentprojectref1.supabase.co"),
      /must exactly match/i,
    );
    assert.throws(
      () => assertIsolatedTurnstileTestEnvironment(`${temporaryProjectUrl}/auth/v1`),
      /must exactly match/i,
    );
  });
});

test("repeatable CAPTCHA proof is exactly Cloudflare's official always-pass token", async () => {
  await withEnvironment({
    ...isolatedEnvironment,
    HERE_TEST_TURNSTILE_TOKEN: "not-the-official-token",
  }, () => {
    assert.throws(
      () => assertRepeatableTurnstileTestEnvironment(temporaryProjectUrl),
      /official always-pass dummy token/i,
    );
  });
});

test("isolated Auth harness rejects elevated keys and requires explicit load/deletion acknowledgements", async () => {
  await withEnvironment(isolatedEnvironment, () => {
    assert.throws(() => assertIsolatedPublishableKey("sb_secret_example"), /publishable key/i);
    assert.throws(
      () => assertAuthorizedIsolatedAuthLoad(temporaryProjectUrl, "sb_publishable_example"),
      /AUTH_LOAD_ALLOWED/i,
    );
  });

  await withEnvironment({
    ...isolatedEnvironment,
    HERE_TEST_ISOLATED_AUTH_LOAD_ALLOWED: "true",
    HERE_TEST_DELETE_ISOLATED_PROJECT_AFTER_RUN: "true",
  }, () => {
    assert.doesNotThrow(() => assertAuthorizedIsolatedAuthLoad(temporaryProjectUrl, "sb_publishable_example"));
  });
});

test("strict release regression never masks anonymous Auth failures with permanent users", async () => {
  await withEnvironment({ HERE_REQUIRE_RELEASE_GATES: "true" }, () => {
    assert.equal(allowPermanentGuestFallback(), false);
  });
  await withEnvironment({}, () => {
    assert.equal(allowPermanentGuestFallback(), true);
  });
});

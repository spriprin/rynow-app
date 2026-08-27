import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HERE_PRODUCTION_PROJECT_REF,
  OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN,
} from "./live-auth-helpers.mjs";

const runner = fileURLToPath(new URL("../scripts/run-live-acceptance.mjs", import.meta.url));
const completeEvidence = {
  HERE_REQUIRE_RELEASE_GATES: "true",
  HERE_TEST_AUTH_CAPACITY_VERIFIED: "true",
  HERE_TEST_AUTH_CAPTCHA_ACCEPT_VERIFIED: "true",
  HERE_TEST_AUTH_CAPTCHA_REJECT_VERIFIED: "true",
  HERE_TEST_PRODUCTION_CAPTCHA_NEGATIVE_VERIFIED: "true",
  HERE_TEST_REAL_TURNSTILE_BROWSER_VERIFIED: "true",
  HERE_TEST_TURNSTILE_MODE: "isolated-repeatable",
  HERE_TEST_ISOLATED_SUPABASE: "true",
  HERE_TEST_TURNSTILE_TOKEN: OFFICIAL_TURNSTILE_ALWAYS_PASS_TOKEN,
  HERE_TEST_AUTH_ANONYMOUS_RATE_PER_HOUR: "1800",
  HERE_TEST_CREATE_ORGANIZER: "true",
  HERE_TEST_EMAIL_CONFIRMATION_DISABLED_VERIFIED: "true",
  HERE_TEST_FAST_RECHECK: "false",
  HERE_TEST_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_preflight_only",
};

function runPreflight(overrides) {
  return spawnSync(process.execPath, [runner], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...completeEvidence, ...overrides },
    encoding: "utf8",
  });
}

test("release runner rejects a missing dedicated Auth gate before spawning live suites", () => {
  const result = runPreflight({
    HERE_TEST_AUTH_CAPTCHA_ACCEPT_VERIFIED: "false",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /HERE_TEST_AUTH_CAPTCHA_ACCEPT_VERIFIED/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Organizer self-service Auth live acceptance/);
});

test("release runner rejects the production project before spawning live suites", () => {
  const result = runPreflight({
    HERE_TEST_ISOLATED_PROJECT_REF: HERE_PRODUCTION_PROJECT_REF,
    HERE_TEST_SUPABASE_URL: `https://${HERE_PRODUCTION_PROJECT_REF}.supabase.co`,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /production project can never be marked/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Organizer self-service Auth live acceptance/);
});

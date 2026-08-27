import { spawnSync } from "node:child_process";
import {
  assertIsolatedPublishableKey,
  assertIsolatedTurnstileTestEnvironment,
  assertRepeatableTurnstileTestEnvironment,
} from "../tests/live-auth-helpers.mjs";

const releaseGate = process.env.HERE_REQUIRE_RELEASE_GATES === "true";
let releaseRefillWaitMs = 0;

if (releaseGate) {
  const verifiedDedicatedGates = [
    "HERE_TEST_AUTH_CAPACITY_VERIFIED",
    "HERE_TEST_AUTH_CAPTCHA_ACCEPT_VERIFIED",
    "HERE_TEST_AUTH_CAPTCHA_REJECT_VERIFIED",
    "HERE_TEST_PRODUCTION_CAPTCHA_NEGATIVE_VERIFIED",
    "HERE_TEST_REAL_TURNSTILE_BROWSER_VERIFIED",
  ].filter((name) => process.env[name] !== "true");
  const missingValues = [
    "HERE_TEST_SUPABASE_URL",
    "HERE_TEST_SUPABASE_PUBLISHABLE_KEY",
    "HERE_TEST_ISOLATED_PROJECT_REF",
    "HERE_TEST_TURNSTILE_TOKEN",
    "HERE_TEST_AUTH_ANONYMOUS_RATE_PER_HOUR",
  ].filter((name) => !process.env[name]);
  if (verifiedDedicatedGates.length > 0 || missingValues.length > 0) {
    throw new Error(`Release regression cannot start before dedicated Auth evidence/configuration is complete: ${[...verifiedDedicatedGates, ...missingValues].join(", ")}`);
  }
  assertIsolatedTurnstileTestEnvironment(process.env.HERE_TEST_SUPABASE_URL);
  assertRepeatableTurnstileTestEnvironment(process.env.HERE_TEST_SUPABASE_URL);
  assertIsolatedPublishableKey(process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY);
  const configuredRate = Number(process.env.HERE_TEST_AUTH_ANONYMOUS_RATE_PER_HOUR);
  if (!Number.isFinite(configuredRate) || configuredRate < 1_800) {
    throw new Error("Release regression requires the inspected anonymous Auth refill rate of at least 1800/hour");
  }
  releaseRefillWaitMs = Math.ceil((30 * 3_600_000) / configuredRate) + 2_000;
  if (process.env.HERE_TEST_CREATE_ORGANIZER !== "true") {
    throw new Error("Release regression requires HERE_TEST_CREATE_ORGANIZER=true so every organizer isolation case is exercised");
  }
  if (process.env.HERE_TEST_EMAIL_CONFIRMATION_DISABLED_VERIFIED !== "true") {
    throw new Error("Release regression requires verified immediate organizer sessions in the temporary project");
  }
  if (process.env.HERE_TEST_FAST_RECHECK !== "false") {
    throw new Error("Release regression requires HERE_TEST_FAST_RECHECK=false so Sprint 5 crosses the real 10-minute boundary");
  }
}

const regressionSuites = [
  "tests/organizer-auth-acceptance.test.mjs",
  "tests/supabase-acceptance.test.mjs",
  "tests/sprint2-acceptance.test.mjs",
  "tests/sprint3-acceptance.test.mjs",
  "tests/sprint4-acceptance.test.mjs",
  "tests/sprint5-acceptance.test.mjs",
  "tests/pre-pilot-acceptance.test.mjs",
];
const dedicatedGateSuites = [
  "tests/auth-captcha.test.mjs",
  "tests/auth-capacity.test.mjs",
];
const suites = releaseGate ? regressionSuites : [...regressionSuites, ...dedicatedGateSuites];

let failed = false;
for (const [index, suite] of suites.entries()) {
  const waitBeforeSuiteMs = releaseGate ? releaseRefillWaitMs : (index > 0 ? 7_500 : 0);
  if (waitBeforeSuiteMs > 0) {
    if (releaseGate) console.log(`Waiting ${waitBeforeSuiteMs}ms for a full anonymous Auth bucket before ${suite}`);
    await new Promise((resolve) => setTimeout(resolve, waitBeforeSuiteMs));
  }
  const result = spawnSync(process.execPath, ["--test", `--test-reporter=${releaseGate ? "tap" : "spec"}`, suite], {
    cwd: process.cwd(),
    env: process.env,
    stdio: releaseGate ? "pipe" : "inherit",
    encoding: releaseGate ? "utf8" : undefined,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (releaseGate) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (/# SKIP\b/i.test(`${result.stdout || ""}\n${result.stderr || ""}`)) {
      console.error(`Release regression rejected an unexpected skip in ${suite}`);
      failed = true;
    }
  }
  if (result.status !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;

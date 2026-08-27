import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { anonymousSignInCredentials, assertAuthorizedIsolatedAuthLoad } from "./live-auth-helpers.mjs";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const requested = process.env.HERE_TEST_AUTH_CAPACITY === "true";
const configuredRatePerHour = Number(process.env.HERE_TEST_AUTH_ANONYMOUS_RATE_PER_HOUR);
const bucketCapacity = 30;

function fullBucketRefillMs() {
  assert.ok(Number.isFinite(configuredRatePerHour) && configuredRatePerHour >= 1_800, "AUTH-P1/P2 require an inspected anonymous Auth refill rate of at least 1800/hour");
  return Math.ceil((bucketCapacity * 3_600_000) / configuredRatePerHour) + 2_000;
}

async function runLoadPattern({ label, target, batchSize, batchPauseMs }) {
  const startedAt = new Date();
  const started = performance.now();
  const observations = [];

  for (let offset = 0; offset < target; offset += batchSize) {
    const currentBatchSize = Math.min(batchSize, target - offset);
    const batch = await Promise.all(Array.from({ length: currentBatchSize }, async (_, index) => {
      const requestStarted = performance.now();
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.signInAnonymously(anonymousSignInCredentials());
      return {
        sequence: offset + index + 1,
        user_id: data.user?.id || null,
        success: Boolean(data.session && data.user),
        status: error?.status || (data.session ? 200 : 0),
        code: error?.code || null,
        message: error?.message || null,
        latency_ms: Math.round(performance.now() - requestStarted),
      };
    }));
    observations.push(...batch);
    if (offset + currentBatchSize < target) await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
  }

  const elapsedMs = Math.round(performance.now() - started);
  const successes = observations.filter((item) => item.success);
  const rateLimited = observations.filter((item) => item.status === 429 || /rate limit/i.test(item.message || ""));
  const otherFailures = observations.filter((item) => !item.success && !rateLimited.includes(item));
  const userIds = new Set(successes.map((item) => item.user_id));
  const latencies = observations.map((item) => item.latency_ms).sort((a, b) => a - b);

  return {
    label,
    started_at: startedAt.toISOString(),
    egress_model: "one test runner / one NAT egress",
    request_pattern: `${target} fresh sessions; ${batchSize} concurrent every ${batchPauseMs}ms`,
    target,
    elapsed_ms: elapsedMs,
    success_count: successes.length,
    distinct_user_count: userIds.size,
    rate_limited_429_count: rateLimited.length,
    other_failure_count: otherFailures.length,
    other_failures: otherFailures.map(({ sequence, status, code, message }) => ({ sequence, status, code, message })),
    latency_ms: {
      min: latencies[0],
      median: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      max: latencies.at(-1),
    },
  };
}

function assertCapacityReport(report) {
  assert.equal(report.rate_limited_429_count, 0, `${report.label}: unacceptable Auth 429; report=${JSON.stringify(report)}`);
  assert.equal(report.other_failure_count, 0, `${report.label}: non-rate-limit failures require investigation; report=${JSON.stringify(report)}`);
  assert.equal(report.success_count, report.target, `${report.label}: not every fresh session succeeded; report=${JSON.stringify(report)}`);
  assert.equal(report.distinct_user_count, report.target, `${report.label}: reused users cannot count toward capacity; report=${JSON.stringify(report)}`);
}

test("AUTH-P1/AUTH-P2 — controlled same-egress anonymous Auth capacity", { skip: requested ? false : "Set HERE_TEST_AUTH_CAPACITY=true for the deliberate 10-minute capacity run" }, async (t) => {
  assert.ok(url && key, "AUTH-P1/P2 were requested without HERE_TEST_SUPABASE_URL and HERE_TEST_SUPABASE_PUBLISHABLE_KEY");
  assert.ok(process.env.HERE_TEST_TURNSTILE_TOKEN, "AUTH-P1/P2 require the official repeatable Turnstile test token");
  assertAuthorizedIsolatedAuthLoad(url, key);
  const refillWaitMs = fullBucketRefillMs();
  t.diagnostic(`Inspected anonymous refill=${configuredRatePerHour}/hour; waiting ${refillWaitMs}ms for supported token-bucket refill before each clean pattern`);

  await new Promise((resolve) => setTimeout(resolve, refillWaitMs));

  await t.test("AUTH-P1 / PP-Q — 100 fresh guests over approximately 10 minutes", async (subtest) => {
    const report = await runLoadPattern({ label: "AUTH-P1", target: 100, batchSize: 10, batchPauseMs: 65_000 });
    subtest.diagnostic(JSON.stringify(report));
    assertCapacityReport(report);
  });

  await new Promise((resolve) => setTimeout(resolve, refillWaitMs));

  await t.test("AUTH-P2 / PP-P — 50 fresh guests within approximately one minute", async (subtest) => {
    const report = await runLoadPattern({ label: "AUTH-P2", target: 50, batchSize: 10, batchPauseMs: 12_000 });
    subtest.diagnostic(JSON.stringify(report));
    assertCapacityReport(report);
    assert.ok(report.elapsed_ms <= 70_000, `AUTH-P2 exceeded the one-minute target window: ${report.elapsed_ms}ms`);
  });
});

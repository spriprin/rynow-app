import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.HERE_TEST_SUPABASE_URL;
const key = process.env.HERE_TEST_SUPABASE_PUBLISHABLE_KEY;
const enabled = process.env.HERE_TEST_AUTH_CAPACITY === "true" && Boolean(url && key);
const target = 100;
const batchSize = 10;
const batchPauseMs = 1_500;

test("PP-P/PP-Q — controlled same-egress anonymous Auth capacity", { skip: enabled ? false : "Set HERE_TEST_AUTH_CAPACITY=true for the deliberate 100-session test" }, async (t) => {
  const startedAt = new Date();
  const started = performance.now();
  const observations = [];

  for (let offset = 0; offset < target; offset += batchSize) {
    const batch = await Promise.all(Array.from({ length: batchSize }, async (_, index) => {
      const requestStarted = performance.now();
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.signInAnonymously();
      return {
        sequence: offset + index + 1,
        success: Boolean(data.session && data.user),
        status: error?.status || (data.session ? 200 : 0),
        message: error?.message || null,
        latency_ms: Math.round(performance.now() - requestStarted),
      };
    }));
    observations.push(...batch);
    if (offset + batchSize < target) await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
  }

  const elapsedMs = Math.round(performance.now() - started);
  const successes = observations.filter((item) => item.success).length;
  const rateLimited = observations.filter((item) => item.status === 429 || /rate limit/i.test(item.message || "")).length;
  const otherFailures = observations.length - successes - rateLimited;
  const latencies = observations.map((item) => item.latency_ms).sort((a, b) => a - b);
  const report = {
    started_at: startedAt.toISOString(),
    egress_model: "one test runner / one NAT egress",
    request_pattern: `${target} fresh sessions; ${batchSize} concurrent every ${batchPauseMs}ms`,
    elapsed_ms: elapsedMs,
    success_count: successes,
    rate_limited_429_count: rateLimited,
    other_failure_count: otherFailures,
    latency_ms: {
      min: latencies[0],
      median: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      max: latencies.at(-1),
    },
  };
  t.diagnostic(JSON.stringify(report));

  await t.test("PP-P — minimum 50 fresh anonymous sessions", () => {
    assert.ok(successes >= 50, `PP-P BLOCKED: ${successes}/50 minimum succeeded; 429=${rateLimited}; report=${JSON.stringify(report)}`);
  });
  await t.test("PP-Q — target 100 fresh anonymous sessions", () => {
    assert.equal(successes, 100, `PP-Q LIMITED/BLOCKED: ${successes}/100 succeeded; 429=${rateLimited}; report=${JSON.stringify(report)}`);
  });
});

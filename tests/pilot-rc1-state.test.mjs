import assert from "node:assert/strict";
import test from "node:test";
import {
  CAUGHT_UP_COPY, REPORT_CATEGORIES, isExplicitlyLeft, mergeExploreBuffer,
  needsExploreRefill, notificationCounts, restorationMode,
} from "../lib/rc1-state.ts";

test("explicit Leave cold-restores to Rejoin while ordinary close restores Room", () => {
  const active = { discovery_enabled: true, left_at: null };
  const left = { discovery_enabled: false, left_at: "2026-09-14T20:00:00Z" };
  assert.equal(isExplicitlyLeft(active), false);
  assert.equal(isExplicitlyLeft(left), true);
  assert.equal(restorationMode(true, left), "rejoin");
  assert.equal(restorationMode(true, active), "restore");
  assert.equal(restorationMode(true, null), "join");
  assert.equal(restorationMode(false, left), "connections");
});

test("Explore buffer is bounded, de-duplicated and drops server-invalidated or handled cards", () => {
  const make = (id, candidateId, firstSeenAt = null, action = null) => ({ id, candidateId, firstSeenAt, action });
  const current = [make("old", "a", "seen"), make("gone", "gone"), make("handled", "h")];
  const server = [make("old", "a"), make("duplicate-candidate", "a"), ...Array.from({ length: 12 }, (_, i) => make("n" + i, "c" + i))];
  const result = mergeExploreBuffer(current, server);
  assert.equal(result.length, 10);
  assert.equal(result[0].id, "old");
  assert.equal(result[0].firstSeenAt, "seen");
  assert.equal(result.some((item) => item.id === "gone" || item.id === "handled"), false);
  assert.equal(new Set(result.map((item) => item.candidateId)).size, result.length);
});

test("continuous Explore refills at three and caught-up copy is truthful", () => {
  assert.equal(needsExploreRefill(4), false);
  assert.equal(needsExploreRefill(3), true);
  assert.equal(needsExploreRefill(0), true);
  assert.equal(CAUGHT_UP_COPY, "You’ve seen everyone available right now. New people will appear here as they join the event.");
});

test("notification badges count only unread supported event types", () => {
  assert.deepEqual(notificationCounts([
    { kind: "interest", read_at: null }, { kind: "match", read_at: null },
    { kind: "message", read_at: null }, { kind: "message", read_at: "read" },
    { kind: "unknown", read_at: null },
  ]), { interest: 1, match: 1, message: 1 });
});

test("report categories match the Pilot RC1 product contract exactly", () => {
  assert.deepEqual([...REPORT_CATEGORIES], [
    "Harassment / inappropriate behaviour", "Spam", "Fake profile / impersonation",
    "Inappropriate profile/content", "Safety concern", "Other",
  ]);
});

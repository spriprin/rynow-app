export const LEGAL_VERSION = "pilot-rc1-draft-2026-09-14";
export const CAUGHT_UP_COPY = "You’ve seen everyone available right now. New people will appear here as they join the event.";
export const REPORT_CATEGORIES = [
  "Harassment / inappropriate behaviour", "Spam", "Fake profile / impersonation",
  "Inappropriate profile/content", "Safety concern", "Other",
] as const;
export const IRL_ANSWERS = [
  { value: "yes", label: "Yes" }, { value: "no", label: "No" },
  { value: "not_yet", label: "Not yet" }, { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export function isExplicitlyLeft(presence: { discovery_enabled: boolean; left_at: string | null } | null | undefined) {
  return Boolean(presence && (!presence.discovery_enabled || presence.left_at !== null));
}

export function restorationMode(roomOpen: boolean, membership: { discovery_enabled: boolean; left_at: string | null } | null) {
  if (!roomOpen) return "connections";
  if (!membership) return "join";
  return isExplicitlyLeft(membership) ? "rejoin" : "restore";
}

// Server owns membership of the buffer. Preserve local order/seen acknowledgements,
// but never preserve a card removed by server authorization/invalidation.
export function mergeExploreBuffer<T extends { id: string; candidateId: string; action: string | null; firstSeenAt: string | null }>(current: T[], server: T[]): T[] {
  const allowed = new Map(server.filter((item) => item.action === null).map((item) => [item.id, item]));
  const merged: T[] = [];
  const candidates = new Set<string>();
  for (const item of [...current, ...server]) {
    const next = allowed.get(item.id);
    if (!next || item.action !== null || candidates.has(next.candidateId)) continue;
    candidates.add(next.candidateId);
    merged.push({ ...next, firstSeenAt: next.firstSeenAt || item.firstSeenAt });
  }
  return merged.slice(0, 10);
}

export function needsExploreRefill(remaining: number) { return remaining <= 3; }
export function notificationCounts(items: Array<{ kind: string; read_at: string | null }>) {
  return items.filter((item) => !item.read_at).reduce((counts, item) => {
    if (item.kind === "interest" || item.kind === "match" || item.kind === "message") counts[item.kind]++;
    return counts;
  }, { interest: 0, match: 0, message: 0 });
}

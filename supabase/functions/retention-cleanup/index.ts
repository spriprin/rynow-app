// Server-only daily cleanup. A Vault-held token authorizes the scheduler;
// the injected service credential never leaves this Edge Function.
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

const response = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
  const token = request.headers.get("x-retention-token");
  if (!token || token.length < 32) return response(401, { error: "unauthorized" });

  const url = Deno.env.get("SUPABASE_URL");
  const namedSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = namedSecrets
    ? (JSON.parse(namedSecrets) as Record<string, string>).default
    : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return response(503, { error: "worker_not_configured" });
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authorization = await client.rpc("retention_worker_authorized", { p_token: token });
  if (authorization.error || authorization.data !== true) {
    return response(401, { error: "unauthorized" });
  }

  let rooms = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await client.rpc("retention_delete_expired_rooms", { p_limit: 25 });
    if (result.error) return response(500, { error: "room_cleanup_failed", rooms });
    const removed = Number(result.data ?? 0);
    rooms += removed;
    if (removed < 25) break;
  }
  const detached = await client.rpc("retention_prune_detached");
  if (detached.error) return response(500, { error: "detached_cleanup_failed", rooms });

  let guests = 0;
  let failures = 0;
  const due = await client.rpc("retention_due_anonymous_users", { p_limit: 100 });
  if (due.error) return response(500, { error: "guest_lookup_failed", rooms });
  for (const row of due.data ?? []) {
    const userId = row.user_id as string;
    // The account may have become active since the first lookup.
    const recheck = await client.rpc("retention_user_due", { p_user_id: userId });
    if (recheck.error || recheck.data !== true) {
      failures += Number(Boolean(recheck.error));
      continue;
    }
    let removedAllObjects = false;
    for (let page = 0; page < 20; page += 1) {
      const listed = await client.storage.from("avatars").list(userId, { limit: 100 });
      if (listed.error) break;
      const paths = (listed.data ?? [])
        .filter((item) => item.name && item.id)
        .map((item) => `${userId}/${item.name}`);
      if (paths.length === 0) {
        removedAllObjects = true;
        break;
      }
      const removed = await client.storage.from("avatars").remove(paths);
      if (removed.error) break;
    }
    if (!removedAllObjects) {
      failures += 1;
      continue;
    }
    const finalCheck = await client.rpc("retention_user_due", { p_user_id: userId });
    if (finalCheck.error || finalCheck.data !== true) {
      failures += Number(Boolean(finalCheck.error));
      continue;
    }
    const deleted = await client.auth.admin.deleteUser(userId);
    if (deleted.error) failures += 1;
    else guests += 1;
  }
  return response(failures ? 500 : 200, {
    rooms,
    detached: detached.data,
    guests,
    failures,
  });
});

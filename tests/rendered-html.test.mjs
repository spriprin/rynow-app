import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", host: "localhost" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the product landing page", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Meet the people/);
  assert.match(html, /who are already/);
  assert.match(html, /Join live room/);
  assert.match(html, /Turn your event into/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the QR destination and organizer dashboard renderable", async () => {
  const [roomResponse, organizerResponse] = await Promise.all([
    render("/r/friday-social"),
    render("/organizer"),
  ]);
  assert.equal(roomResponse.status, 200);
  assert.equal(organizerResponse.status, 200);
  assert.match(await roomResponse.text(), /Join room/i);
  const organizerHtml = await organizerResponse.text();
  assert.match(organizerHtml, /My rooms/);
  assert.match(organizerHtml, /Your QR is ready/);
});

test("database migration enforces the core trust boundaries", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608110001_initial.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter table public\.messages enable row level security/i);
  assert.match(migration, /create or replace function public\.send_interest/i);
  assert.match(migration, /new\.sender_id := auth\.uid\(\)/i);
  assert.match(migration, /unique \(room_id, user_a, user_b\)/i);
  assert.match(migration, /room\.status = 'LIVE'/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.messages/i);
  assert.doesNotMatch(migration, /create policy [^\n]*matches[^\n]* for insert/i);
});

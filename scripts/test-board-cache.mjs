import assert from "node:assert/strict";
import { createBoardCache } from "../src/lib/board-cache.ts";
let manifestCalls = 0, downloads = 0, bytes = 0;
let week = 5;
let weekly = { id: "A-weekly", revision: 1, content_version: 1, suspension_reason: null };
let future = { id: "A-future", revision: 1, content_version: 1 };
let denied = false;
const cache = createBoardCache(async (league) => {
  manifestCalls++;
  if (denied) return null;
  return { week, weekly: { ...weekly, id: league + "-weekly" },
    future: future && { ...future, id: league + "-future" } };
}, async (league, type) => {
  downloads++;
  const value = { board: { ...(type === "weekly" ? weekly : future), id: `${league}-${type}` },
    week, markets: Array.from({ length: 800 }, (_, i) => ({ id: `${league}-${type}-${i}`, text: "x".repeat(600) })) };
  bytes += Buffer.byteLength(JSON.stringify(value));
  return value;
});
await Promise.all([cache.load("owner", "A"), cache.load("owner", "A")]);
assert.equal(downloads, 2);
assert.equal(manifestCalls, 1, "Concurrent viewers share one in-flight manifest");
const initialBytes = bytes;
for (let i = 0; i < 120; i++) await cache.load("owner", "A");
assert.equal(downloads, 2, "Unchanged hour downloads no further full boards");
assert.equal(bytes, initialBytes);
weekly = { ...weekly, suspension_reason: "Source unavailable" };
assert.equal((await cache.load("owner", "A")).weekly.board.suspension_reason, "Source unavailable");
assert.equal(downloads, 2, "Availability changes propagate without quote-body downloads");
weekly.content_version++;
await cache.load("owner", "A"); assert.equal(downloads, 3);
future.revision++;
await cache.load("owner", "A"); assert.equal(downloads, 4);
await cache.load("owner", "B"); assert.equal(downloads, 6);
assert((await cache.load("owner", "B")).weekly.markets.every((m) => m.id.startsWith("B-")));
await cache.load("other-user", "A"); assert.equal(downloads, 8);
denied = true;
await assert.rejects(cache.load("other-user", "A"), /authorization/);
denied = false;
await cache.load("other-user", "A"); assert.equal(downloads, 10, "Revocation discards private cached bodies");
cache.clear(); await cache.load("other-user", "A"); assert.equal(downloads, 12);
week = 6; weekly = { ...weekly, id: "new-week", revision: 2 }; future = null;
const next = await cache.load("other-user", "A");
assert.equal(next.weekly.week, 6); assert.equal(next.future.board, null);

let release;
const wait = new Promise((resolve) => { release = resolve; });
const racing = createBoardCache(async () => { await wait; return { week: 5, weekly, future }; },
  async () => ({ week: 5, board: weekly, markets: [] }));
const stale = racing.load("user-A", "A");
racing.clear(); release();
await assert.rejects(stale, /Account changed/);
let futureFails = true, weeklyLoads = 0;
const independent = createBoardCache(async () => ({ week: 5, weekly, future: weekly }),
  async (_league, type) => {
    if (type === "future" && futureFails) throw new Error("Synthetic futures outage");
    if (type === "weekly") weeklyLoads++;
    return { week: 5, board: weekly, markets: [{ id: type }] };
  });
const partial = await independent.load("owner", "A");
assert.equal(partial.weekly.markets[0].id, "weekly");
assert.match(partial.errors.future.message, /outage/);
assert.equal(partial.errors.weekly, undefined);
futureFails = false;
assert.equal((await independent.load("owner", "A")).future.markets[0].id, "future");
assert.equal(weeklyLoads, 1, "An unavailable futures board must not refetch or starve weekly prices");
console.log("Passed 120 unchanged polls (zero repeated full-board downloads), content/revision invalidation, suspension, concurrent deduplication, revocation and account/league isolation. Byte counts are synthetic payload sizes, not measured wire traffic.");

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Observation<T> = { payload: T; checked_at: string };
const pending = new Map<string, Promise<Observation<unknown>>>();
const retained = new Map<
  string,
  { value: Observation<unknown>; expires: number; bytes: number }
>();
const ttl = { state: 15000, games: 15000, players: 86400000, league: 30000 };
function remember(
  identity: string,
  scope: keyof typeof ttl,
  value: Observation<unknown>,
) {
  const expires = Date.parse(value.checked_at) + ttl[scope];
  if (!Number.isFinite(expires) || expires <= Date.now()) return value;
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > 1048576 + 1024) return value;
  retained.delete(identity);
  for (const [key, entry] of retained)
    if (entry.expires <= Date.now()) retained.delete(key);
  const used = () =>
    [...retained.values()].reduce((n, entry) => n + entry.bytes, 0);
  while (retained.size >= 64 || used() + bytes > 8388608)
    retained.delete(retained.keys().next().value!);
  retained.set(identity, { value, expires, bytes });
  return value;
}
export const starterContext = (value: string) =>
  createHash("sha256")
    .update("starter-display-v1:" + value)
    .digest("hex");

// Auth and membership must be checked BEFORE calling this helper. The database
// owns TTLs/leases across cold instances; RAM only coalesces concurrent promises.
export async function cachedStarter<T>(
  db: SupabaseClient,
  namespace: string,
  scope: "state" | "games" | "players" | "league",
  key: string,
  context: string,
  source: () => Promise<Observation<T>>,
  deadline = Date.now() + 22000,
): Promise<Observation<T>> {
  const identity = JSON.stringify([namespace, scope, key, context]);
  // Avoid moving a daily player directory through database egress every minute.
  // This RAM tier uses the same original source-time TTL and is bounded globally.
  const local = retained.get(identity);
  if (local && local.expires > Date.now()) return local.value as Observation<T>;
  retained.delete(identity);
  const existing = pending.get(identity);
  if (existing) return existing as Promise<Observation<T>>;
  if (pending.size >= 64)
    throw new Error("Starter status is busy. Retry shortly.");
  const args = { p_scope: scope, p_key: key, p_context: context };
  const operation = (async () => {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() >= deadline)
        throw new Error("Starter status timed out. Retry shortly.");
      const claim = await db
        .rpc("claim_starter_status", args)
        .abortSignal(AbortSignal.timeout(3000));
      if (claim.error) throw new Error("Starter cache is unavailable.");
      if (claim.data?.state === "hit")
        return remember(identity, scope, {
          payload: claim.data.payload as T,
          checked_at: claim.data.checked_at as string,
        });
      if (claim.data?.state === "claimed") {
        const token = claim.data.token;
        try {
          const value = await source();
          if (!Number.isFinite(Date.parse(value.checked_at)))
            throw new Error("Starter observation time is unavailable.");
          const published = await db
            .rpc("publish_starter_status", {
              ...args,
              p_token: token,
              p_payload: value.payload,
              p_checked: value.checked_at,
            })
            .abortSignal(AbortSignal.timeout(3000));
          if (published.error || published.data !== true)
            throw new Error(
              "Starter status changed while loading. Retry shortly.",
            );
          return remember(identity, scope, value);
        } catch (error) {
          await db
            .rpc("fail_starter_status", { ...args, p_token: token })
            .abortSignal(AbortSignal.timeout(2000));
          throw error;
        }
      }
      if (claim.data?.state !== "busy" || Date.now() >= deadline)
        throw new Error("Starter status is unavailable. Retry shortly.");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 + attempt * 1000, 3000)),
      );
    }
  })().finally(() => {
    if (pending.get(identity) === operation) pending.delete(identity);
  });
  pending.set(identity, operation);
  return operation as Promise<Observation<T>>;
}

export function projectStarterPlayers(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Player directory is unavailable.");
  const result: Record<
    string,
    { team: string | null; full_name?: string; injury_status?: string }
  > = {};
  for (const [id, value] of Object.entries(input)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const p = value as Record<string, unknown>;
    if (typeof p.team !== "string") {
      result[id] = { team: null };
      continue;
    }
    result[id] = {
      team: typeof p.team === "string" ? p.team : null,
      ...(typeof p.full_name === "string" ? { full_name: p.full_name } : {}),
      ...(typeof p.injury_status === "string"
        ? { injury_status: p.injury_status }
        : {}),
    };
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 1048576)
    throw new Error("Player directory exceeds its read budget.");
  return result;
}

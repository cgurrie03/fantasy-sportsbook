import type { SupabaseClient } from "@supabase/supabase-js";

// Optional retirement must not hold up authoritative weekly work indefinitely.
// Aborting the HTTP wait is not a guarantee that PostgreSQL cancels its statement.
export async function runWorkerCleanup(
  db: SupabaseClient,
  kind: "refresh" | "evaluation",
) {
  const task =
    kind === "refresh"
      ? { name: "cleanup_terminal_refresh_payloads", limit: 5 }
      : { name: "cleanup_evaluated_samples", limit: 2 };
  try {
    return await db
      .rpc(task.name, { p_limit: task.limit })
      .abortSignal(AbortSignal.timeout(3000));
  } catch {
    return { data: null, error: { code: "MAINTENANCE_UNAVAILABLE" } };
  }
}

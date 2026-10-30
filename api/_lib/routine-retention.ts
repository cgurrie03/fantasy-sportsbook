import type { SupabaseClient } from '@supabase/supabase-js';

/** Run after authoritative work and mail; maintenance failure never retries it. */
export async function retireRoutinePayloads(db: SupabaseClient) {
  try {
    const result = await db.rpc('cleanup_routine_payloads', { p_limit: 10 })
      .abortSignal(AbortSignal.timeout(3000));
    return result.error ? { failed: true } : result.data;
  } catch {
    return { failed: true };
  }
}

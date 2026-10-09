import { useEffect, useState } from "react";
import { supabase } from "./supabase";
export interface StarterSnapshot {
  observed_at: string;
  rosters: {
    roster_id: number;
    playing: { id: string; name: string }[];
    incomplete: boolean;
  }[];
}
export function useStarterActivity(
  leagueId: string,
  review?: StarterSnapshot,
  isReview = false,
) {
  const [snapshot, setSnapshot] = useState<StarterSnapshot | null>(
    review ?? null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [loadedLeague, setLoadedLeague] = useState(leagueId);
  useEffect(() => {
    if (isReview || !supabase) return;
    let active = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const session = (await supabase!.auth.getSession()).data.session;
        if (!session) throw new Error("Sign in required.");
        const response = await fetch(
          `/api/active-starters?league_id=${encodeURIComponent(leagueId)}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            signal: AbortSignal.timeout(25000),
          },
        );
        if (!response.ok) throw new Error("Starter status unavailable.");
        const result = (await response.json()) as StarterSnapshot;
        if (active) {
          setLoadedLeague(leagueId);
          setSnapshot(result);
          setUnavailable(false);
        }
      } catch {
        if (active) {
          setLoadedLeague(leagueId);
          setSnapshot(null);
          setUnavailable(true);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [leagueId, isReview, review]);
  return {
    snapshot: loadedLeague === leagueId ? snapshot : null,
    unavailable: loadedLeague === leagueId && unavailable,
  };
}

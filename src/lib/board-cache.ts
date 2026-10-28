// Account and league scoped, bounded to the active account. Authorization is
// checked by the manifest on every read, even when the quote body is unchanged.
export interface VersionedBoard {
  id: string;
  revision: number;
  content_version?: number;
}
type Snapshot<B, M> = { board: B | null; markets: M[]; week: number };
type BoardPair<B, M> = { weekly: Snapshot<B, M>; future: Snapshot<B, M>;
  errors: { weekly?: unknown; future?: unknown } };
export function createBoardCache<B extends VersionedBoard, M>(
  manifest: (league: string) => Promise<{ week: number; weekly: B | null; future: B | null }>,
  snapshot: (league: string, type: "weekly" | "future") => Promise<Snapshot<B, M>>,
) {
  let account = "";
  const entries = new Map<string, { weekly?: Snapshot<B, M>; future?: Snapshot<B, M> }>();
  const pending = new Map<string, Promise<BoardPair<B, M>>>();
  let generation = 0;
  function clear() { entries.clear(); pending.clear(); generation++; }
  return {
    clear,
    async load(user: string, league: string) {
      if (!user) { clear(); throw new Error("Sign in to load markets."); }
      if (account !== user) { clear(); account = user; }
      const existing = pending.get(league);
      if (existing) return existing;
      const version = generation;
      const operation = (async () => {
        const current = await manifest(league);
        if (!current || !Number.isInteger(current.week) || current.week < 1 || current.week > 18)
          throw new Error("League period or authorization is unavailable.");
        const cached = entries.get(league) ?? {};
        const get = async (type: "weekly" | "future"): Promise<Snapshot<B, M>> => {
          const board = current[type], old = cached[type];
          if (!board) return { board: null, markets: [], week: current.week };
          if (old?.board && old.board.id === board.id && old.board.revision === board.revision &&
              old.board.content_version === board.content_version)
            return { board, markets: old.markets, week: current.week };
          return snapshot(league, type);
        };
        const [weeklyResult, futureResult] = await Promise.allSettled([get("weekly"), get("future")]);
        if (generation !== version) throw new Error("Account changed while markets loaded.");
        const empty = { board: null, markets: [], week: current.week };
        const weekly = weeklyResult.status === "fulfilled" ? weeklyResult.value : empty;
        const future = futureResult.status === "fulfilled" ? futureResult.value : empty;
        const errors = {
          ...(weeklyResult.status === "rejected" ? { weekly: weeklyResult.reason } : {}),
          ...(futureResult.status === "rejected" ? { future: futureResult.reason } : {}),
        };
        if (entries.size >= 4 && !entries.has(league)) entries.delete(entries.keys().next().value!);
        entries.set(league, {
          ...(weeklyResult.status === "fulfilled" ? { weekly } : {}),
          ...(futureResult.status === "fulfilled" ? { future } : {}),
        });
        return { weekly, future, errors };
      })().catch((error) => { if (generation === version) entries.delete(league); throw error; })
        .finally(() => { if (generation === version) pending.delete(league); });
      pending.set(league, operation);
      return operation;
    },
  };
}

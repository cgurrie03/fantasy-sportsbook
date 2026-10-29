import { marketCategories, marketCategory } from "./market-categories.ts";
import type { MarketCategory } from "./market-categories.ts";
import type { VersionedBoard } from "./board-cache.ts";
type Snapshot<B, M> = { board: B | null; markets: M[]; week: number };
type Manifest<B> = { week: number; weekly: B | null; future: B | null };
export function createCategoryBoardCache<
  B extends VersionedBoard,
  M extends { id: string; board_id: string; kind: string },
>(
  manifest: (league: string) => Promise<Manifest<B>>,
  snapshot: (
    league: string,
    category: MarketCategory,
    board: B,
  ) => Promise<Snapshot<B, M>>,
) {
  type Entry = {
    anchors: { weekly: string; future: string };
    categories: Map<MarketCategory, Snapshot<B, M>>;
  };
  let account = "",
    generation = 0;
  const entries = new Map<string, Entry>(),
    manifests = new Map<string, Promise<Manifest<B>>>();
  const categoryReads = new Map<string, Promise<Snapshot<B, M>>>(),
    operations = new Map<string, Promise<ReturnType<typeof combine>>>();
  const key = (board: B | null) =>
    board ? `${board.id}:${board.revision}:${board.content_version ?? 0}` : "";
  const type = (category: MarketCategory) =>
    category === "Season Futures" ? "future" : "weekly";
  function clear() {
    entries.clear();
    manifests.clear();
    categoryReads.clear();
    operations.clear();
    generation++;
  }
  function combine(
    current: Manifest<B>,
    values: Map<MarketCategory, Snapshot<B, M>>,
    errors: Partial<Record<MarketCategory, unknown>>,
  ) {
    const markets = (boardType: "weekly" | "future") =>
      [...values.entries()]
        .filter(([category]) => type(category) === boardType)
        .flatMap(([, value]) => value.markets);
    return {
      weekly: {
        board: current.weekly,
        week: current.week,
        markets: markets("weekly"),
      },
      future: {
        board: current.future,
        week: current.week,
        markets: markets("future"),
      },
      loaded: [...values.keys()],
      errorsByCategory: errors,
      errors: {
        weekly: marketCategories
          .filter((c) => type(c) === "weekly")
          .map((c) => errors[c])
          .find(Boolean),
        future: errors["Season Futures"],
      },
    };
  }
  async function readManifest(league: string) {
    const pending = manifests.get(league);
    if (pending) return pending;
    const version = generation;
    const operation = manifest(league).finally(() => {
      if (generation === version && manifests.get(league) === operation)
        manifests.delete(league);
    });
    manifests.set(league, operation);
    return operation;
  }
  function state(league: string, current: Manifest<B>) {
    let entry = entries.get(league);
    if (!entry) {
      if (entries.size >= 4) entries.delete(entries.keys().next().value!);
      entry = { anchors: { weekly: "", future: "" }, categories: new Map() };
      entries.set(league, entry);
    }
    for (const boardType of ["weekly", "future"] as const) {
      const anchor = key(current[boardType]);
      if (entry.anchors[boardType] !== anchor) {
        for (const category of entry.categories.keys())
          if (type(category) === boardType) entry.categories.delete(category);
        entry.anchors[boardType] = anchor;
      }
    }
    return entry;
  }
  async function loadOnce(
    league: string,
    wanted: MarketCategory[],
    version: number,
  ) {
    const current = await readManifest(league);
    if (generation !== version)
      throw new Error("Account changed while markets loaded.");
    if (
      !current ||
      !Number.isInteger(current.week) ||
      current.week < 1 ||
      current.week > 18
    )
      throw new Error("League period or authorization is unavailable.");
    const entry = state(league, current),
      values = new Map<MarketCategory, Snapshot<B, M>>(),
      errors: Partial<Record<MarketCategory, unknown>> = {};
    let changed = false;
    await Promise.all(
      wanted.map(async (category) => {
        const boardType = type(category),
          board = current[boardType],
          anchor = key(board);
        if (!board) {
          values.set(category, {
            board: null,
            markets: [],
            week: current.week,
          });
          return;
        }
        try {
          let value = entry.categories.get(category);
          if (!value) {
            const readKey = `${league}:${category}:${anchor}`;
            let operation = categoryReads.get(readKey);
            if (!operation) {
              if (categoryReads.size >= 64)
                throw new Error("Too many market reads. Retry shortly.");
              operation = snapshot(league, category, board).finally(() => {
                if (
                  generation === version &&
                  categoryReads.get(readKey) === operation
                )
                  categoryReads.delete(readKey);
              });
              categoryReads.set(readKey, operation);
            }
            value = await operation;
            if (generation !== version)
              throw new Error("Account changed while markets loaded.");
            if (
              key(value.board) !== anchor ||
              value.week !== current.week ||
              entry.anchors[boardType] !== anchor
            ) {
              changed = true;
              return;
            }
            if (
              !Array.isArray(value.markets) ||
              value.markets.some(
                (m) =>
                  m.board_id !== board.id ||
                  marketCategory(m.kind) !== category,
              ) ||
              new TextEncoder().encode(JSON.stringify(value)).length > 1048576
            )
              throw new Error(
                "Market category is incomplete or exceeds its read budget.",
              );
            entry.categories.set(category, value);
          }
          values.set(category, { ...value, board, week: current.week });
        } catch (error) {
          errors[category] = error;
        }
      }),
    );
    if (generation !== version)
      throw new Error("Account changed while markets loaded.");
    if (changed) return null;
    const retainedBytes = () =>
      [...entry.categories.values()].reduce(
        (n, v) => n + new TextEncoder().encode(JSON.stringify(v)).length,
        0,
      );
    if (retainedBytes() > 4194304) {
      for (const category of entry.categories.keys())
        if (!wanted.includes(category)) {
          entry.categories.delete(category);
          if (retainedBytes() <= 4194304) break;
        }
    }
    if (retainedBytes() > 4194304) {
      entries.delete(league);
      throw new Error("Selected markets exceed the client cache budget.");
    }
    return combine(current, values, errors);
  }
  return {
    clear,
    async load(user: string, league: string, wanted: MarketCategory[]) {
      if (!user) {
        clear();
        throw new Error("Sign in to load markets.");
      }
      if (account !== user) {
        clear();
        account = user;
      }
      if (wanted.some((category) => !marketCategories.includes(category)))
        throw new Error("Unknown market category.");
      const categories = marketCategories.filter((category) =>
          wanted.includes(category),
        ),
        operationKey = league + ":" + categories.join("|");
      const pending = operations.get(operationKey);
      if (pending) return pending;
      if (operations.size >= 16)
        throw new Error("Too many pending market views. Retry shortly.");
      const version = generation;
      const operation = (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await loadOnce(league, categories, version);
          if (result) return result;
        }
        throw new Error(
          "Market versions changed while loading. Refresh lines.",
        );
      })()
        .catch((error) => {
          if (generation === version) entries.delete(league);
          throw error;
        })
        .finally(() => {
          if (
            generation === version &&
            operations.get(operationKey) === operation
          )
            operations.delete(operationKey);
        });
      operations.set(operationKey, operation);
      return operation;
    },
  };
}

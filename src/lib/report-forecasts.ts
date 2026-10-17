import { deduplicateForecasts } from "./reporting.ts";
import { readAllRows } from "./pagination.ts";
import type { Forecast } from "./reporting.ts";

export const forecastMetadataColumns =
  "id,board_id,revision,nfl_season,market_week,board_type,captured_at,opens_at,closes_at,provenance";

// Keep all version metadata for counts, but do not download the same weekly
// slate on every recalculation. Reports grade the immutable opening snapshot;
// futures charts retain every saved season snapshot.
export async function loadReportForecasts(
  metadata: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  quotes: (
    ids: string[],
  ) => PromiseLike<{
    data: { id: string; quotes: Forecast["quotes"] }[] | null;
    error: unknown;
  }>,
) {
  const result = await readAllRows(metadata);
  const versions = (result.data as Forecast[]).map((f) => ({
    ...f,
    quotes: [],
  }));
  const needed = new Set([
    ...deduplicateForecasts(versions).map((f) => f.id),
    ...versions.filter((f) => f.board_type === "future").map((f) => f.id),
  ]);
  const loaded = new Map<string, Forecast["quotes"]>();
  const ids = [...needed];
  for (let start = 0; start < ids.length; start += 20) {
    const response = await quotes(ids.slice(start, start + 20));
    if (response.error) throw response.error;
    for (const row of response.data ?? []) loaded.set(row.id, row.quotes);
  }
  if (ids.some((id) => !loaded.has(id)))
    throw Error(
      "Archived forecast details could not load. Refresh reports to retry.",
    );
  return {
    data: versions.map((f) => ({ ...f, quotes: loaded.get(f.id) ?? [] })),
    error: null,
  };
}

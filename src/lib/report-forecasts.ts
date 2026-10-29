import { deduplicateForecasts } from "./reporting.ts";
import type { Forecast } from "./reporting.ts";

export const forecastMetadataColumns =
  "id,board_id,revision,nfl_season,market_week,board_type,captured_at,opens_at,closes_at,provenance,horizon";

// The database selects fixed horizons before JSON hydration. Never fetch every
// historical revision, and fail visibly if a scoped season exceeds its budget.
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
  const data: unknown[]=[];
  for(let from=0;;from+=64) {
    const page=await metadata(from,from+63);
    if(page.error)throw page.error;
    data.push(...(page.data??[]));
    if(data.length>256)throw Error("Forecast horizon metadata exceeded the season budget.");
    if((page.data?.length??0)<64)break;
  }
  const versions = (data as Forecast[]).map((f) => ({
    ...f,
    quotes: [],
  }));
  const needed = new Set([
    ...deduplicateForecasts(versions).map((f) => f.id),
    ...versions.filter((f) => f.board_type === "future").map((f) => f.id),
  ]);
  const loaded = new Map<string, Forecast["quotes"]>();
  const ids = [...needed];
  for (let start = 0; start < ids.length; start += 2) {
    const response = await quotes(ids.slice(start, start + 2));
    if (response.error) throw response.error;
    for (const row of response.data ?? []) loaded.set(row.id, row.quotes);
  }
  if (ids.some((id) => !loaded.has(id)))
    throw Error(
      "Fixed-horizon forecast details could not load. Refresh reports to retry.",
    );
  return {
    data: versions.map((f) => ({ ...f, quotes: loaded.get(f.id) ?? [] })),
    error: null,
  };
}

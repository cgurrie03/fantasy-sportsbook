export async function readAssessmentRows(
  db: any,
  table: string,
  league: string,
  columns: string,
  scope: { season?: number; week?: number; pageSize?: number } = {},
) {
  if (!columns || columns.split(",").some((column) => column.trim() === "*"))
    throw new Error("Assessment reads require explicit columns.");
  const pageSize = scope.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
    throw new Error("Invalid assessment page size.");
  const rows: any[] = [];
  for (let offset = 0; offset < 30000; offset += pageSize) {
    let query = db.from(table).select(columns).eq("league_id", league);
    if (scope.season !== undefined) query = query.eq("nfl_season", scope.season);
    if (scope.week !== undefined) query = query.eq("market_week", scope.week);
    const r = await query
      .order("captured_at")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (r.error) throw new Error(r.error.message);
    rows.push(...r.data);
    if (r.data.length < pageSize) return rows;
  }
  throw new Error(
    "Assessment pagination safety limit reached; review deferred.",
  );
}

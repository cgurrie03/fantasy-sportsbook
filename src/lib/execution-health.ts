export interface ExecutionRun {
  id: string;
  operation: string;
  nfl_season?: number;
  market_week: number;
  created_at: string;
  summary?: Record<string, any>;
}
export interface ExecutionJob {
  id: string;
  operation: string;
  market_week?: number;
  status: string;
  last_error: string | null;
  created_at: string;
  scheduled_for?: string;
  lease_until?: string | null;
  completed_at?: string | null;
  attempts?: number;
}
export const operationName = (operation: string) =>
  operation.replace(/^interval_/, "").replaceAll("_", " ");
export function executionOutcome(run: ExecutionRun) {
  const s = run.summary;
  if (!s) return "Outcome unavailable for this older record";
  if (run.operation === "replenishment") {
    const changed = Number(s.replenished ?? 0);
    const blocked = Number(s.blocked ?? 0);
    const skipped = Number(s.already_processed ?? 0);
    return `${blocked ? "Waiting / held" : changed ? "Completed" : "No balance changes"} · ${changed} replenished · ${blocked} held · ${skipped} already processed`;
  }
  if (s.status) return `Completed · ${String(s.status).toLowerCase()}`;
  return "Completed · result recorded";
}
export function groupedExecutions(runs: ExecutionRun[]) {
  const groups = new Map<
    string,
    { latest: ExecutionRun; attempts: ExecutionRun[] }
  >();
  for (const run of [...runs].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    // A settlement is a separate logical operation for each accepted ticket.
    const key = `${run.nfl_season ?? ""}:${run.market_week}:${run.operation}:${run.operation === "settlement" ? (run.summary?.ticket_id ?? run.id) : ""}`;
    const group = groups.get(key);
    if (group) group.attempts.push(run);
    else groups.set(key, { latest: run, attempts: [run] });
  }
  return [...groups.values()];
}
export function jobState(job: ExecutionJob, now = Date.now()) {
  if (job.status === "done") return "Completed";
  if (job.status === "failed")
    return job.lease_until && Date.parse(job.lease_until) < now
      ? "Failed · retry overdue"
      : "Failed · retry scheduled";
  if (job.status === "running")
    return job.lease_until && Date.parse(job.lease_until) < now
      ? "Overdue · lease expired"
      : "Running";
  if (job.last_error && /waiting|verified results/i.test(job.last_error))
    return "Waiting for verified results";
  const due = Math.max(
    Date.parse(job.scheduled_for ?? job.created_at),
    Date.parse(job.lease_until ?? job.scheduled_for ?? job.created_at),
  );
  return now - due > 5 * 60000 ? "Overdue" : "Scheduled";
}
export function safeJobDetail(message: string | null) {
  if (!message) return "";
  return /timeout|statement|ECONN|fetch failed|gateway|database|relation/i.test(
    message,
  )
    ? "The operation could not finish. Check service health, then retry."
    : message;
}

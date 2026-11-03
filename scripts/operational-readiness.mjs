import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const archiveTargets = [
  "model_forecast_runs",
  "forecast_snapshots",
  "line_refresh_stages",
];
export function historicalCleanupPlan(inventory) {
  if (
    !inventory ||
    !Array.isArray(inventory.relations) ||
    inventory.relations.length > 256 ||
    !Number.isFinite(Date.parse(inventory.captured_at))
  )
    throw Error("Dated catalog inventory required.");
  const targets = archiveTargets.map((name) => {
    const t = inventory.relations.find(
      (r) => r.schema === "public" && r.name === name,
    );
    if (
      !t ||
      !Number.isSafeInteger(Number(t.total_bytes)) ||
      Number(t.total_bytes) < 0
    )
      throw Error("Complete measured archive inventory required.");
    return {
      relation: "public." + name,
      physical_bytes: Number(t.total_bytes),
      estimated_rows: t.estimated_rows,
      estimate_only: true,
      referenced_by: t.referenced_by,
      preparation:
        name === "model_forecast_runs"
          ? "Preserve fixed-horizon evaluation summaries, model-version identity, unresolved evaluation work and promotion evidence before any bulk retirement."
          : name === "forecast_snapshots"
            ? "Preserve report/publication summaries and accepted/reopening quote dependencies; do not substitute a raw JSON deletion for a useful summary."
            : "Retain staging/running/leased cycles and unresolved publish retries. Only terminal, fenced cycles can become cleanup candidates.",
    };
  });
  return {
    format: "boff-historical-cleanup-plan-v1",
    captured_at: inventory.captured_at,
    executable: false,
    targets,
    archive_total_bytes: targets.reduce((n, t) => n + t.physical_bytes, 0),
    protected_relations: [
      "tickets",
      "ticket_legs",
      "wallets",
      "wallet_ledger",
      "user_wallets",
      "user_wallet_entries",
      "sportsbook_markets",
      "sportsbook_reopening_reviews",
      "league_policy_versions",
      "sportsbook_policy_versions",
    ],
    required_gates: {
      full_platform_recovery: false,
      exact_source_and_migrations: false,
      owner_approved_target_plan: false,
      useful_summary_checksums: false,
      unresolved_and_lease_exclusions: false,
      financial_before_after_digest: false,
    },
    execution_plan: [
      "Freeze the exact source/schema and explicit candidate IDs behind an approved recovery checkpoint.",
      "Run resumable small batches with summary counts/checksums and lease fences; stop on any changed candidate.",
      "Verify all accepted financial facts, unresolved work and report usefulness after every batch.",
      "Measure physical relation/database size afterward; logical deletion does not itself prove disk reclamation.",
    ],
    note: "Read-only planning artifact. No DELETE, UPDATE, VACUUM, hosted client, credential or executor is included. Foreign-key absence is not proof that application or recovery consumers no longer need a record.",
  };
}
export function capacityReadiness(
  observations,
  {
    source,
    allowance_bytes,
    wire_allowance_bytes,
    reserve_fraction,
    max_daily_growth_bytes,
    now = Date.now(),
  } = {},
) {
  const reasons = [];
  if (!/^[a-f0-9]{40}$/.test(source ?? ""))
    reasons.push("Exact final source is unavailable.");
  if (
    !Number.isSafeInteger(wire_allowance_bytes) ||
    wire_allowance_bytes <= 0 ||
    !Number.isSafeInteger(allowance_bytes) ||
    allowance_bytes <= 0 ||
    !Number.isFinite(reserve_fraction) ||
    reserve_fraction < 0.1 ||
    reserve_fraction > 0.5 ||
    !Number.isSafeInteger(max_daily_growth_bytes) ||
    max_daily_growth_bytes < 0
  )
    reasons.push(
      "Measured allowance and reviewed reserve/growth policy are required.",
    );
  if (!Array.isArray(observations) || observations.length > 64)
    throw Error("At most 64 compact observations are supported.");
  const records = [...observations].sort(
    (a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at),
  );
  for (const r of records) {
    if (
      !Number.isFinite(Date.parse(r.captured_at)) ||
      Date.parse(r.captured_at) > now + 60000 ||
      r.source !== source ||
      r.synthetic === true ||
      r.scope !== "combined-development-production" ||
      !["supabase-dashboard", "verified-meter-export"].includes(
        r.meter_source,
      ) ||
      ![r.database_bytes, r.shared_wire_bytes].every(
        (x) => Number.isSafeInteger(x) && x >= 0,
      )
    )
      reasons.push(
        "An observation lacks actual combined physical/wire evidence for the final source.",
      );
  }
  if (
    records.some(
      (r) =>
        r.shared_wire_bytes > wire_allowance_bytes * (1 - reserve_fraction),
    )
  )
    reasons.push(
      "Metered shared wire usage exceeds the reviewed wire reserve.",
    );
  const dates = new Set(records.map((r) => String(r.captured_at).slice(0, 10))),
    first = records[0],
    last = records.at(-1);
  const elapsed =
    first && last
      ? (Date.parse(last.captured_at) - Date.parse(first.captured_at)) /
        86400000
      : 0;
  if (dates.size < 15 || elapsed < 14)
    reasons.push(
      "At least 15 daily observations spanning 14 real elapsed days are required.",
    );
  if (last && now - Date.parse(last.captured_at) > 36 * 3600000)
    reasons.push("The latest observation is stale.");
  let maxGrowth = 0;
  for (let i = 1; i < records.length; i++) {
    const days =
      (Date.parse(records[i].captured_at) -
        Date.parse(records[i - 1].captured_at)) /
      86400000;
    if (days <= 0 || days > 1.5)
      reasons.push("Daily observation continuity is missing.");
    else
      maxGrowth = Math.max(
        maxGrowth,
        (records[i].database_bytes - records[i - 1].database_bytes) / days,
      );
  }
  if (maxGrowth > max_daily_growth_bytes)
    reasons.push(
      "Observed physical growth exceeds the reviewed plateau bound.",
    );
  const projected = last
    ? last.database_bytes + Math.max(0, maxGrowth) * 30
    : null;
  if (
    projected !== null &&
    Number.isFinite(allowance_bytes) &&
    projected > allowance_bytes * (1 - reserve_fraction)
  )
    reasons.push(
      "Thirty-day projected physical usage exceeds the reviewed reserve.",
    );
  return {
    format: "boff-capacity-readiness-v1",
    status: reasons.length ? "evidence_incomplete" : "ready_for_owner_review",
    reasons: [...new Set(reasons)],
    observations: records.length,
    distinct_days: dates.size,
    elapsed_days: elapsed,
    max_daily_growth_bytes: maxGrowth,
    projected_database_bytes_30_days: projected,
    production_approved: false,
    note: "Local evidence validation, not remote attestation. Shared wire must be compared to its own metered allowance in the release review. No synthetic sample or backdated record establishes an actual plateau.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [mode, file] = process.argv.slice(2);
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const result =
      mode === "cleanup-plan"
        ? historicalCleanupPlan(data)
        : mode === "capacity"
          ? capacityReadiness(data.observations, data.policy)
          : null;
    if (!result)
      throw Error(
        "Use cleanup-plan <catalog.json> or capacity <evidence.json>.",
      );
    console.log(JSON.stringify(result, null, 2));
    if (mode === "capacity" && result.status !== "ready_for_owner_review")
      process.exitCode = 2;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import {
  historicalCleanupPlan,
  capacityReadiness,
} from "./operational-readiness.mjs";
const source = "a".repeat(40),
  now = Date.UTC(2026, 10, 30),
  policy = {
    source,
    allowance_bytes: 1000000,
    wire_allowance_bytes: 100000,
    reserve_fraction: 0.2,
    max_daily_growth_bytes: 10,
    now,
  };
const observations = Array.from({ length: 15 }, (_, i) => ({
  source,
  captured_at: new Date(now - (14 - i) * 86400000).toISOString(),
  scope: "combined-development-production",
  meter_source: "verified-meter-export",
  database_bytes: 100000,
  shared_wire_bytes: 5000,
}));
assert.equal(
  capacityReadiness(observations, policy).status,
  "ready_for_owner_review",
);
assert.equal(
  capacityReadiness(observations.slice(1), policy).status,
  "evidence_incomplete",
);
for (const mutate of [
  (r) => (r.synthetic = true),
  (r) => (r.source = "b".repeat(40)),
  (r) => delete r.shared_wire_bytes,
  (r) => (r.captured_at = new Date(now + 86400000).toISOString()),
  (r) => (r.database_bytes = 999999),
]) {
  const rows = structuredClone(observations);
  mutate(rows[7]);
  assert.equal(capacityReadiness(rows, policy).status, "evidence_incomplete");
}
assert.equal(
  capacityReadiness(observations, { ...policy, allowance_bytes: undefined })
    .status,
  "evidence_incomplete",
);
const plan = historicalCleanupPlan({
  captured_at: new Date(now).toISOString(),
  relations: [
    "model_forecast_runs",
    "forecast_snapshots",
    "line_refresh_stages",
  ].map((name) => ({
    schema: "public",
    name,
    total_bytes: 100,
    estimated_rows: 10,
    referenced_by: [],
  })),
});
assert.equal(plan.executable, false);
assert.equal(plan.archive_total_bytes, 300);
assert(Object.values(plan.required_gates).every((v) => v === false));
assert(plan.protected_relations.includes("tickets"));
assert.throws(
  () =>
    historicalCleanupPlan({
      captured_at: new Date().toISOString(),
      relations: [],
    }),
  /Complete/,
);
console.log(
  "Cleanup planning never authorizes execution. Capacity evidence rejects synthetic/mixed-source/missing/stale/short/over-budget data and requires actual elapsed daily evidence.",
);

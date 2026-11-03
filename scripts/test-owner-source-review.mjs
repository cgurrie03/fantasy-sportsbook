import assert from "node:assert/strict";
import { verifyOwnerMetadata } from "./owner-source-review.mjs";
const sha = "a".repeat(40),
  repo = "cgurrie03/fantasy-sportsbook";
const baseline = {
  context: {
    repository: repo,
    actor: "cgurrie03",
    event: "workflow_dispatch",
    sha,
    ref: "refs/heads/release-reviewed",
    run_id: "100",
    evidence_run_id: "99",
  },
  environment: {
    id: 7,
    name: "Production",
    can_admins_bypass: false,
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: false,
        reviewers: [{ type: "User", reviewer: { login: "cgurrie03" } }],
      },
    ],
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
  },
  branches: { branch_policies: [{ type: "branch", name: "release-reviewed" }] },
  ciRun: {
    id: 99,
    name: "Project Checks",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_repository: { full_name: repo },
  },
  currentRun: {
    id: 100,
    head_sha: sha,
    event: "workflow_dispatch",
    actor: { login: "cgurrie03" },
    head_repository: { full_name: repo },
  },
  approvals: [
    {
      state: "approved",
      user: { login: "cgurrie03" },
      environments: [{ id: 7, name: "Production" }],
    },
  ],
};
assert.equal(verifyOwnerMetadata(baseline).production_authorized, false);
for (const change of [
  (x) => (x.context.actor = "other"),
  (x) => (x.environment.can_admins_bypass = true),
  (x) => (x.environment.protection_rules = []),
  (x) =>
    x.environment.protection_rules[0].reviewers.push({
      type: "User",
      reviewer: { login: "other" },
    }),
  (x) => (x.environment.protection_rules[0].prevent_self_review = true),
  (x) => (x.branches.branch_policies[0].name = "*"),
  (x) => (x.ciRun.head_sha = "b".repeat(40)),
  (x) => (x.ciRun.event = "pull_request"),
  (x) => (x.ciRun.conclusion = "failure"),
  (x) => (x.currentRun.id = 101),
  (x) => (x.approvals = []),
  (x) => (x.approvals[0].user.login = "other"),
  (x) => (x.approvals[0].state = "rejected"),
]) {
  const copy = structuredClone(baseline);
  change(copy);
  assert.throws(() => verifyOwnerMetadata(copy));
}
console.log(
  "Owner source review rejects absent/bypassed/wrong-owner protection, mixed/fork/failed CI, wrong source/run/branch and missing or rejected approval. It never grants production permission.",
);

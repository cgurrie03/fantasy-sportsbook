import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sourceIdentity, verifyEvidence } from "./release-evidence.mjs";
import { releaseSuites } from "./release-suite-plan.mjs";
const repository = "cgurrie03/fantasy-sportsbook",
  owner = "cgurrie03";
export function verifyOwnerMetadata({
  context,
  environment,
  branches,
  ciRun,
  currentRun,
  approvals,
}) {
  if (
    context.repository !== repository ||
    context.actor !== owner ||
    context.event !== "workflow_dispatch" ||
    !/^[a-f0-9]{40}$/.test(context.sha) ||
    !/^\d+$/.test(String(context.run_id)) ||
    !/^\d+$/.test(String(context.evidence_run_id))
  )
    throw Error("Owner dispatch and exact source/run identities required.");
  const reviewers = environment.protection_rules?.find(
    (r) => r.type === "required_reviewers",
  );
  if (
    environment.name !== "Production" ||
    environment.can_admins_bypass !== false ||
    reviewers?.prevent_self_review !== false ||
    reviewers.reviewers?.length !== 1 ||
    reviewers.reviewers[0].type !== "User" ||
    reviewers.reviewers[0].reviewer?.login !== owner
  )
    throw Error(
      "Production environment must require the sole owner reviewer, permit their self-review and disable administrator bypass.",
    );
  if (
    environment.deployment_branch_policy?.custom_branch_policies !== true ||
    environment.deployment_branch_policy?.protected_branches !== false ||
    branches.branch_policies?.length !== 1 ||
    branches.branch_policies[0].type !== "branch" ||
    context.ref !== "refs/heads/" + branches.branch_policies[0].name
  )
    throw Error("One exact permitted source branch is required.");
  if (
    ciRun.id !== Number(context.evidence_run_id) ||
    ciRun.name !== "Project Checks" ||
    ciRun.head_sha !== context.sha ||
    ciRun.status !== "completed" ||
    ciRun.conclusion !== "success" ||
    ciRun.event !== "push" ||
    ciRun.head_repository?.full_name !== repository
  )
    throw Error(
      "Successful same-repository push CI for the exact source is required.",
    );
  if (
    currentRun.id !== Number(context.run_id) ||
    currentRun.head_sha !== context.sha ||
    currentRun.event !== "workflow_dispatch" ||
    currentRun.actor?.login !== owner ||
    currentRun.head_repository?.full_name !== repository
  )
    throw Error("Current owner workflow run does not match this source.");
  const relevant = approvals.filter((a) =>
    a.environments?.some(
      (e) => e.id === environment.id && e.name === "Production",
    ),
  );
  if (
    relevant.some((a) => a.state === "rejected") ||
    !relevant.some((a) => a.state === "approved" && a.user?.login === owner)
  )
    throw Error(
      "An explicit owner approval for this run/environment is required; admin bypass is not approval.",
    );
  return {
    repository,
    source_sha: context.sha,
    reviewer: owner,
    workflow_run_id: Number(context.run_id),
    evidence_run_id: Number(context.evidence_run_id),
    environment_id: environment.id,
    owner_source_reviewed: true,
    production_authorized: false,
  };
}
async function metadata(context) {
  const token = process.env.GITHUB_TOKEN;
  if (!token)
    throw Error("Ephemeral read-only GitHub workflow token required.");
  const get = async (suffix) => {
    const r = await fetch(
      "https://api.github.com/repos/" + repository + suffix,
      {
        redirect: "error",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok)
      throw Error("Required GitHub metadata unavailable (" + r.status + ").");
    return r.json();
  };
  const [environment, branches, ciRun, currentRun, approvals] =
    await Promise.all([
      get("/environments/Production"),
      get("/environments/Production/deployment-branch-policies"),
      get("/actions/runs/" + context.evidence_run_id),
      get("/actions/runs/" + context.run_id),
      get("/actions/runs/" + context.run_id + "/approvals"),
    ]);
  return verifyOwnerMetadata({
    context,
    environment,
    branches,
    ciRun,
    currentRun,
    approvals,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const context = {
      repository: process.env.GITHUB_REPOSITORY,
      actor: process.env.GITHUB_ACTOR,
      event: process.env.GITHUB_EVENT_NAME,
      sha: process.env.SOURCE_SHA,
      ref: process.env.GITHUB_REF,
      run_id: process.env.GITHUB_RUN_ID,
      evidence_run_id: process.env.EVIDENCE_RUN_ID,
    };
    // Validate numeric/source fields before placing any input into API paths.
    if (
      !/^[a-f0-9]{40}$/.test(context.sha ?? "") ||
      !/^\d+$/.test(context.evidence_run_id ?? "") ||
      !/^\d+$/.test(context.run_id ?? "")
    )
      throw Error("Validated source and numeric run IDs required.");
    const attestation = await metadata(context);
    if (process.argv[2] === "metadata") {
      console.log(
        "Verified exact-source CI and externally protected owner review metadata. No production permission granted.",
      );
    } else {
      const evidence = JSON.parse(
          await fs.readFile("work/release-checks/provenance.json", "utf8"),
        ),
        results = JSON.parse(
          await fs.readFile("work/release-checks/results.json", "utf8"),
        ),
        current = sourceIdentity();
      if (current.sha !== context.sha)
        throw Error("Checked-out source differs from owner review.");
      verifyEvidence(evidence, results, current, releaseSuites);
      await fs.mkdir("work/owner-source-review", { recursive: true });
      await fs.writeFile(
        "work/owner-source-review/" + context.sha + ".json",
        JSON.stringify(
          {
            ...attestation,
            source: current,
            results_sha256: evidence.results_sha256,
            evidence_sha256: createHash("sha256")
              .update(JSON.stringify(evidence))
              .digest("hex"),
            reviewed_at: new Date().toISOString(),
            scope:
              "Owner source review only. Recovery, capacity, residual audit, exact production migration plan and separately authorized promotion remain required.",
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
      console.log(
        "Recorded owner-reviewed exact source. No deployment, migration, secret access or production authorization performed.",
      );
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

# Supported-profile journeys and browser audit

November 4, 2026. Milestone 22 continues. **18 complete / 6 remaining**; this work does not close the owner, hosted-load or production gates.

## Reproduced defects and corrections

- **B011, P1:** a final flag with only two of eight league scores could settle a new weekly scorer as won. Newly generated high/low scorer terms now freeze expected_team_count. Partial, nonfinite or malformed coverage stays OPEN; complete winners, losers and ties resolve. Accepted legacy terms lacking this field retain their upstream-finalization contract. No historical accepted terms are rewritten. Baseline regression failed WON versus expected OPEN.
- **B012, P2:** archived price_rounding_step described default 10/25/50 despite an effective custom policy. Metadata now records the effective family step; fixed-price markets record null.
- **B013, P1:** the legacy futures generator returned through archive before shared-policy normalization. Normalization now occurs in the common archive path, applying the effective odds cap/rounding, featured boost and policy revision to both branches. A separate legacy futures fixture verifies custom step25/cap1000/revision1 through actual publication. Imported futures remain unsupported.

- **B014, P2:** visual enlarged-text review exposed clipped moneyline prices, totals, column labels and promotion text despite no page-level horizontal overflow. The baseline inner-scroll assertion reproduces clipping. Prices now wrap within buttons, headers grow with content and promotion strips retain a minimum rather than fixed height. Normal-size card alignment remains covered by existing featured-card regressions.

## Meaningful local evidence

The supported-journeys fixture runs the compiled API and actual installed SQL migrations in disposable PGlite, with intercepted provider requests and an explicit REST bridge. Five profiles cover 8/10/12/14/16 teams, PPR/4-point passing versus half-PPR/6-point passing, two/three starters and four/six playoff teams. Each exercises inactive import, effective custom policies, explicit capability approval/publication, independent same-team co-owner cutover/wallet acceptance, two-pick tickets, minimum stakes, tenant and request-substitution negatives, idempotency, failed-provider board preservation, owner repricing with frozen accepted terms, boosted settlement once, linked next-season renewal and old-season receipts/settlement retry. A local fixture-only trigger-disabled operations flag seeds activation; this is not evidence of real activation/capacity approval. All financial operations afterward use restored triggers and actual transactions. Synthetic funding stays in the disposable database.

The browser audit uses the existing intercepted localhost harness in Chromium and WebKit at seven sizes/orientations (360x800 through 1440x900 and 844x390). It checks both themes, reduced motion, keyboard focus/skip navigation, five guide pages, modal focus containment/restoration, reduced-height slip reachability, league-switch clearing and actual rendered-card doubled-font reflow without horizontal or row collision. Desktop WebKit is not physical iOS. WebKit skip-link focus is explicit because its default keyboard configuration skips links; Chromium verifies natural Tab discovery. Doubled DOM fonts are not OS zoom or native Dynamic Type. No screen-reader user test is claimed.

New tests are included in the existing weekly and quick-start suites; the stable release count remains43. Local GitHub workflow now installs both browser engines; this file has not been pushed. Browser installation adds about58.7MiB of local WebKit tools, no server/service or application database history. Runtime fixes add one small integer per new high/low quote/snapshot; other metadata fields replace existing values. Local screenshots/logs are ignored work artifacts. No extra provider call, table, cron, paid resource or production write is introduced.

## Acceptance still required

The owner selected **iPhone/Safari plus desktop** for this release; Android is explicitly unverified. Owner confirmed the requested physical iPhone functional check passed on November4, with many visual improvements still desired. Owner also confirmed provider-account MFA/recovery/access/deployment-hook review: "All checked and protected." These are owner attestations, not an independent security audit or visual-design approval. Actual Auth template/branding and redirected onboarding previews remain separately unverified. Hosted simultaneous peak/settlement/outage/rate-limit acceptance remains22/23; real wire/physical allowances and14-day observations remain23. Backups stay owner-deferred. No fabricated phone, security, capacity or Auth evidence is permitted.

Ignored evidence: work/supported-journeys.json and log, work/settlement-coverage-baseline.log, work/audit-accessibility/{chromium,webkit}.json and screenshots. Qualification/deployment receipt will identify the exact clean source after the release gate.

## Qualified and deployed delivery

Clean source **74dd9cc54e96e5fb8a8553ece903cbf3272dd10f** passed **43/43** in **368.505 seconds** (16:18:06–16:24:15 UTC). The earlier interrupted run was discarded after visual review found B014. Final qualification includes both engines and the stricter internal-clipping assertion; focused featured-card alignment regressions also passed. Ignored browser artifacts total3,731,250 bytes at closeout; they are local, not application storage.

Protected Preview **dpl_Hw8LnW5UWeXdvoVYziCTtmNFKrc7** is READY, generated host `fantasy-sportsbook-7c744nvyv-cooper-gurrie-projects.vercel.app`. Hosted identity/independent owner/closed-signup/capture/manual guards and compiled API runtime tests passed, with no TypeScript/error events. Only DEV Preview BOFF_BUILD_SHA was updated; the deployment used committed filtered source files without a GitHub push. All three DEV aliases were assigned sequentially after READY. All three and the generated host return signed-out302 to vercel.com; project all-deployment SSO remains enabled.

Production remains READY **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ**. No migration, real ticket/funding, mail, activation, backup export, production change or new schedule occurred. No fresh financial digest or security advisor scan is claimed for this source-only delivery. Prior scheduler migration remains20261104153625. Exact-source unapproved review is prepared at `work/release-reviews/74dd9cc54e96e5fb8a8553ece903cbf3272dd10f/manifest.json`; it grants no production permission.

B011–B014 are fixed/qualified/hosted in Development. **Milestone22 remains open**, and the counter stays **18 complete /6 remaining**. Owner device/security answers are now recorded; actual Auth preview and hosted peak/outage/rate-limit evidence are still required. Android is explicitly unverified under the owner's iPhone-plus-desktop release scope; this is not a universal mobile/accessibility or capacity sign-off. Later documentation-only HEAD is not the qualified/deployed source.

Delivery receipt: `work/audit-completion-receipt.json`; qualified copies `work/audit-qualified-{provenance,results}-74dd9cc.json`; full log `work/audit-release.log`; clipping baseline `work/audit-clip-baseline.log`.

## Owner acceptance update — November4

The owner replied to the exact requested iPhone functional checklist: "there are a ton of visual updates that can be made, but as far as functionality is concerned, iphone passed". Record the physical functional check as passed, including the requested league/guide/orientation/text/native-keyboard journey. Do not interpret this as visual-design approval or an unrequested VoiceOver/assistive-technology test. The owner separately answered "All checked and protected" to the GitHub/Vercel/Supabase/email or shared Google MFA, saved recovery access and reviewed grants/deployment-hooks question. That closes the owner attestation in A16; independently enforced release controls remain milestone21.

Visual refinement is tracked as F015 in the Markdown feature roadmap, pending specific observations and priorities. No new design, paid resource or production action is inferred. Milestone22 remains open for actual Auth template/onboarding review, remaining actual assistive/OS accessibility evidence and measured hosted peak/settlement/outage/rate-limit acceptance. Counter remains18 complete/6 remaining.

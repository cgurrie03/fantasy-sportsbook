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

The owner selected **iPhone/Safari plus desktop** for this release; Android is explicitly unverified. Pending owner checks cover physical iPhone portrait/landscape, text/native keyboard and guide/league switching, and provider-account MFA/recovery/access review. Actual Auth template/branding and redirected onboarding previews remain separately unverified. Hosted simultaneous peak/settlement/outage/rate-limit acceptance remains22/23; real wire/physical allowances and14-day observations remain23. Backups stay owner-deferred. No fabricated phone, security, capacity or Auth evidence is permitted.

Ignored evidence: work/supported-journeys.json and log, work/settlement-coverage-baseline.log, work/audit-accessibility/{chromium,webkit}.json and screenshots. Qualification/deployment receipt will identify the exact clean source after the release gate.

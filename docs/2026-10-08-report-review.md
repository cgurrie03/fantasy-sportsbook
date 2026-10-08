# Report quality review — October 8, 2026

Reports appear in this priority order. Each has a description, report-specific summary metrics, selected-filter exports and a comparison suited to its purpose.

| Report | Comparison / visual |
| --- | --- |
| Projected vs. actual | Weekly score-minus-projection heatmap, biggest deviations |
| Model accuracy & special trends | Probability calibration, sample size, point error and Brier score by model/market |
| Standings & playoff race | Record standings and playoff probability bars |
| Regular-season win outlook | Expected wins, posted half-win line and simulated 80% interval |
| Betting performance | Diverging settled profit, stake and ROI |
| Weekly storylines | League scoring range and weekly average |
| Scoring trends | Shared-scale team score paths across final weeks |
| Schedule luck & all-play | Actual selected-week win-equivalents versus all-play expectation |
| Scoring consistency | Team minimum, mean and maximum scores; standard deviation |
| Lineup efficiency & review | Missed lineup points from archived eligible players only |
| Championship & #1 pick outlook | Paired champion and last-place probabilities |
| Open ticket exposure | Weekly/futures open stakes stacked by owner |
| Popular selections | Selection counts, not cash volume |
| Wallet activity | Known cash credits versus deductions; opening entries excluded |
| Automation health | Execution status by operation |
| Email delivery health | Delivery status by communication type |

## Accuracy safeguards

- Final results only for retrospective scoring comparisons; live results are labelled separately.
- Original archived opening forecasts are distinguished from reconstructed historical starter projections. Missing data is not replaced with zero.
- Season outlooks use the latest applicable archived forecast. Revisions do not count as independent predictions.
- Unresolved season futures remain pending rather than being assigned guessed outcomes.
- Standings rank the full league before applying the team display filter; record ties use available final season scores.
- Schedule luck uses matching time periods, with half credit for ties.
- Betting ROI excludes open and voided tickets. Wallet credits include replenishments and are explicitly distinct from betting profit.
- History queries paginate beyond the database's default 1,000-row response limit.
- Week/team filters are disabled when they do not apply to the report.

## Exports and verification

PNG and landscape PDF export the selected report, filter context, summary metrics, chart and detail table. Detail exports cap tables at 40 rows and disclose the cap; CSV preserves the complete selected detail. Wide season heatmaps split into five-week groups for PDF readability. Public Sleeper avatars use a fixed-host image proxy; unavailable images fall back to initials.

Reviewed all 16 report views with local league fixtures and current published futures snapshots. Verified PNG output and rendered the downloaded PDF to inspect layout. Production compilation and API/reporting/account regression checks pass. These checks validate calculations and presentation; prediction accuracy must be measured against future settled results.

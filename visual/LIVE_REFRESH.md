# Dev Live Refresh — Iteration 18

Dev: https://dev.sportsbook.coopergurrie.com/1312126153980391424/matchups?view=live

This is a real, scheduled **source-data connection**, not a completed live sportsbook. Current Sleeper matchups/scores, identities, NFL status and refresh metadata are connected. Weekly projections, optimized unlocked lineups, calibrated prices, quote-version acceptance, settlement, replenishment and real notification delivery are still to be implemented. Archived design prices are never presented as refreshed live prices.

## Schedule Now Running

| Process | Cadence | How It Decides |
|---|---|---|
| Shared NFL state and schedule | Every 5 minutes | Sleeper state plus its current-season schedule; retain current week only |
| Current league scores/lineups | Every 5 minutes during an active NFL game | Actual schedule status `in_game`, not a guessed Thursday/Sunday window |
| Game day before kickoff / unknown game status | Every 15 minutes | Sleeper provides a game date but no precise kickoff in this endpoint; conservatively refresh throughout the relevant day |
| Final confirmation | Every 15 minutes for an hour after first observing a final | One final-observed timestamp per current NFL game |
| Inactive period | Every 60 minutes | No active, unknown or due game-day event |
| League identities/rosters/settings | Hourly, or when the week changes | One shared metadata refresh, not one per visitor |
| Browser source reads | Every 60 seconds while visible | Reads the protected cache endpoint; never fetches providers or writes snapshots |

Weekly loading is Tuesday 1:00 AM through Wednesday 6:00 AM **America/New_York**, including daylight-saving offsets. That display transition is checked by the shared job. This does not yet run Tuesday 7 AM settlement/replenishment or the 8 AM email.

The dev scheduler runs in Supabase because Vercel Cron does not execute preview-deployment jobs. It invokes a dedicated Edge Function, separate from the legacy production worker. Due times align to scheduler boundaries to prevent five-minute cadence drifting into ten-minute gaps. A short atomic lease prevents concurrent duplicate refreshes. Provider errors retain the last successful payload and timestamp and expose a delayed state; no invented score or quote is substituted.

## Storage And Strain

The old October 28 audit identified large retained forecast runs, snapshots and refresh-stage payloads as the dominant storage consumers. Those old measurements are not a measurement of today's production usage. The new dev process writes none of those archives.

Observed after repeated refreshes: **3 rows**, approximately **5,142 bytes per league payload**, **2,410 shared NFL bytes**, and **81,920 bytes of allocated table/index/TOAST space**. One row contains the internal authentication hash; two contain current data. Physical allocation differs from payload size because Postgres has pages, indexes, row versions and vacuum. Updating rows creates WAL and dead tuples; replacement is not zero I/O.

| Leagues Like This Sample | Estimated Current JSON Payload |
|---|---:|
| 1 | 7.4 KiB |
| 5 | 27.5 KiB |
| 10 | 52.6 KiB |

These are extrapolations from this 12-team sample, **not measurements of five or ten active leagues**, and exclude tickets, wallets, indexes, transient WAL, provider logs, model inputs and future account data. Postseason brackets add a small current payload. Real multi-league load tests remain necessary before enrollment. The current dev collector intentionally allows only the supplied real league; adding leagues requires extending the allowlist/configuration and measuring it.

Each payload has a 128 KiB database ceiling, with a smaller application-side safety budget. Current data replaces the existing rows. No poll history, player-image files or whole-season player catalog is retained. This job's cron history is pruned to 24 hours; pg_net responses have the platform's default six-hour retention. Those small operational records are separate from current data.

The eventual expensive pieces are projection calculation, player-source traffic, and accepted-ticket retention—especially if repeated per visitor or if every version is archived. Fetch common NFL/player inputs once across leagues, calculate once per league/refresh, retain current outputs, and store immutable accepted terms only when a ticket is placed. Keep compact calibration aggregates rather than complete per-refresh forecasts.

## Postseason Foundation And Limits

The source connection continues beyond the regular season and fetches Sleeper's actual winners/losers brackets. Known single-week rounds are matched by actual roster pairs and bracket graph. The graph identifies championship, semifinal, quarterfinal and placement games; loser-advancing and winner-advancing lower brackets are distinct. Unresolved/byes do not become invented two-team games. No live featured boosts are applied.

Explicit source seeds are preferred. Standard, division-free seeding can be captured at the playoff boundary and then retained. Custom seeds, division qualification, multi-week rounds and other unsupported mappings must be verified before wagering; ambiguous live formats use a neutral Postseason label. This release does **not** claim every league format is ready for betting. Historical review uses the real 2025 six-team bracket and regular-season seeds; current names are shown for recognition. Toilet Bowl is an explicitly labeled format illustration, not a claim that this league used that format.

## Isolation And Verification

Only dev Supabase `whlcnlacueweaqpsupqs` and dev Vercel `prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts` were changed. The table denies anon/authenticated reads; service access stays behind the protected dev endpoint. The Edge Function checks an opaque Vault credential, uses an atomic lease and verifies the database environment marker. No service key is in frontend code. Application participant authorization still needs the rebuilt membership backend; Vercel preview protection is not a replacement for it.

Supabase reports an informational RLS-without-policy notice for this intentionally service-only table. That is expected: granting a browser policy would weaken its intended access model. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## References

- [Sleeper API: league, roster, matchup and playoff bracket contracts](https://docs.sleeper.com/)
- [Observed Sleeper schedule endpoint](https://api.sleeper.app/schedule/nfl/regular/2026): live status/date structure verified directly; this endpoint is not documented in the public v1 reference and is treated as best effort, not an acceptance/settlement guarantee.
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase pg_net response retention](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Vercel cron configuration](https://vercel.com/docs/project-configuration/vercel-json)


## Iteration 20

Alternate panel titles are 18px; team/Over–Under column headers are 14px on desktop and 13px on mobile, with larger avatars. Preset selection behaviour is unchanged. Dev source refresh now omits an unchanged payload from database PATCH updates while retaining truthful successful-check timestamps. Object-key ordering is normalized for comparison. Ticket compaction was audited read-only and remains future backend work; see STORAGE_EFFICIENCIES.md.

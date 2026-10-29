# Lazy member categories and shared starter display — October 29, 2026

Milestone 15 implementation. Delivery remains pending until the tested source,
development migration mapping, protected deployment and postflight below are
recorded. Production and historical cleanup are unchanged.

## Read inventory and resulting behavior

| Owner / trigger | Scope / columns | Cadence and budget | Action / retention |
|---|---|---|---|
| Member board manifest | Authorized selected league, current NFL season/week; scalar weekly/future board metadata | Each visible 30-second check, focus/resume or category/slip change; concurrent calls share one request | Reauthorize every check; metadata-only history checks retain rollover detection |
| Member category snapshot | Explicit current league/board/category; active quotes, public fields and immutable member metadata projection | Only selected category plus slip dependencies; 1 MiB per category; cached by board ID/revision/content version | Unchanged checks do not download quote bodies; never call/materialize the full quote snapshot |
| Player Points / Head to Head | Selected family plus small Matchups family used for matchup grouping | Same cache/request budgets | Preserve grouping and default user matchup; other families stay deferred |
| Slip refresh | Every non-fixed pick's family, even while browsing another category/history | Shares category reads; normal revision/price approval remains | Fixed promotion receipt legs retain their immutable supplied terms |
| Browser category cache | At most four league entries; 4 MiB retained logical JSON per league; 16 pending views / 64 pending category reads | Account changes clear cache; generation and scope fences discard obsolete results | Version changes evict affected board families; failures do not mix old and new bodies or starve healthy categories |
| Starter display browser | Matchups on Home only; private/no-store API response | Visible-only 60-second timer and immediate resume; unmount/category/league changes abort obsolete client fetch | Does not poll on unused categories/history; unavailable remains explicit |
| Starter API access | Fresh authenticated user plus RLS/member-checked `starter_status_access`; only Sleeper ID/NFL season | Every private request, including warm hits | No cached authorization, membership or user client; no provider/cache read after denied access |
| Public NFL state | Small Sleeper state JSON, server-side | Shared 15-second source-time TTL; 16 KiB stored payload | Service-only cross-instance cache; no browser upstream downloads |
| Public game status | Parsed three-date ESPN scoreboard result, server-side | Shared 15-second source-time TTL; 128 KiB | Display-only; pricing, kickoff/settlement and worker freshness continue their existing authoritative paths |
| Public player directory | Only team/name/injury status; known unassigned players retain a null-team marker | Shared 24-hour TTL; 1 MiB projection; raw response admission 8 MiB | Raw directory is not persisted; avoids repeated full upstream directory requests per viewer/cold instance |
| League starter output | Actual Sleeper lineup IDs mapped to public game status; no hypothetical optimal lineup | Shared 30-second source-time TTL; 32 KiB; config hash includes provider league/NFL season/API format | Fresh config changes invalidate the private result; observed time remains the original game-status check |
| Cache coordination | Service-only invoker RPCs/table, RLS on, no anon/authenticated table grant | 25-second lease, token/context CAS, 15-second failure backoff; bounded wait/backoff, no provider bypass on cache failure | At most 131 contexts and 8 MiB logical JSON; per-scope limits are tighter; misses reclaim at most 20 expired/unleased slots |
| Existing refresh/weekly worker | Existing shared once-per-minute dispatch, common public source inputs, league-specific scoring/roster outputs | Existing leases, manual development automation and acceptance fences | No additional scheduler, polling heartbeat, live/teaser launch or production operation |

Cache expiry means a payload is no longer served. Physical expired rows can remain
until a subsequent miss reclaims them; the fixed admission ceiling bounds this
idle footprint. No claim of automatic idle physical deletion or a measured
database plateau is made. A verified service client is reused only within a warm
process and discarded on key/target changes; user identity checks remain fresh.
The server RAM tier retains at most 64 source/config contexts and 8 MiB logical
JSON using the same original observation expiry. It avoids transferring the
projected directory from the database again on every minute's lineup rebuild;
cross-instance leases/database expiry remain the cold-start coordination layer.

The narrow category predicate uses `(board_id, kind) WHERE active`. An expression
predicate initially caused a sequential scan under member RLS; the final typed
kind-array predicate uses the category index without weakening RLS. The pure
private metadata projection receives authenticated EXECUTE, but no archive/table
privileges or security-definer category wrapper is added.

## Evidence and limits

- SQL fixtures verify active/category/member/draft/foreign-board isolation and
  exact line/odds/member metadata parity with the former full member view.
- A synthetic current board with 1,000 additional player rows returns about
  4.1 kB for Matchups versus 486 kB for the full weekly member projection; the
  RLS query plan selects the category index. These are logical JSON bytes.
- An unchanged 120-check synthetic hour downloads the requested category once;
  manifests still reauthorize. Category/body request sharing, content/suspension
  freshness, version races, account reset, denial and admission tests pass.
- Intercepted phone/desktop browser tests exercise category dependencies, caching,
  slip-family price refresh/approval, category failure/retry, hidden pause/resume
  and metadata-only history. Response JSON sizes are captured under
  `work/category-loading`; they are not production compressed wire/billing data.
- The real API path with fully intercepted sources independently authorizes 20
  concurrent requests and shares six provider calls: one state, three scoreboard
  dates, one directory and one league lineup. A second league reuses public
  inputs and fetches its own lineup. Warm hits preserve observation time;
  config changes invalidate output; revoked auth/membership never reads cache.
- Database tests cover service-only privileges, fresh member config access,
  token/context/expiry fencing, failure backoff, size/row admission and expired
  slot reclamation. Cache errors fail closed without provider retry amplification.
  Sixty warm directory reuses perform one claim and publish, with no repeated
  database directory transfer.

Capacity milestone 23 retains actual wire bytes, physical storage/write cost,
production-sized workload/queue fairness, shared quota and two-week plateau
measurements. This delivery does not activate another real league or claim the
whole efficiency/capacity audit is closed. Full release/postflight follows.

## Development database verification

The independently checked marker remains development / `whlcnlacueweaqpsupqs` /
`https://dev.sportsbook.coopergurrie.com`. CLI-created local migrations map to
managed development ledger entries as follows:

| Local source | Hosted development version |
|---|---|
| `20261029192510_category_market_snapshots.sql` | `20261029195933_category_market_snapshots` |
| `20261029194513_shared_starter_status_cache.sql` | `20261029195935_shared_starter_status_cache` |

A hosted transaction probe, acting as the existing authenticated owner and then
the service role, verified category projection/line parity/private metadata
removal, fresh member config access, foreign/anonymous denial, lease/busy/publish/
hit behavior and non-exposure of the cache RPC/table. The one-quote category
response was 1,027 logical JSON bytes. All fixture inserts rolled back; subsequent
checks show zero probe markets, zero boards and zero cache rows.

Security advisors retain 37 authenticated-definer, two anonymous-definer and one
Auth password warning; no new warning category appears. RLS-without-policy INFO
increases from 10 to 11 because the new service-only cache intentionally grants
neither anon nor authenticated access. This is not a clean-security-audit claim.

The full release run passed **36/36** suites. After adding the memory-tier egress
guard, the starter SQL/helper/real-API fixture suite, explicit API TypeScript
check, lint and fixture build were rerun. No production schema/data operation,
GitHub push, owner session use, actual bet or email send occurred.

# Dev Storage Efficiencies — Iteration 20

> November 10 update: the dev storage foundation is now implemented. See [STORAGE_IMPLEMENTATION.md](STORAGE_IMPLEMENTATION.md) for deployed status, measured results and remaining integration work. Estimates and audit observations below retain their original date; any earlier "not implemented" status is superseded by that report.
## Implemented Now

The dev source refresher compares canonical JSON values with the existing cached payload. If unchanged, its PATCH omits the payload column and updates only freshness, next due time, lease/error state and refresh counter. Object-key order does not create false changes; array ordering and null/missing distinctions remain meaningful. Changed scores still save normally. No additional provider or database read is introduced.

This reduces unnecessary large-value rewrites; it does not remove retained ticket data or claim the allocated database shrinks immediately. PostgreSQL still updates the small row metadata and generates some WAL. Its documentation explains that unchanged out-of-line values normally avoid TOAST update costs: [PostgreSQL 17 TOAST](https://www.postgresql.org/docs/17/storage-toast.html).

The deployed worker refreshed successfully. The shared NFL payload hash stayed unchanged while its successful-check counter and timestamp advanced. Request-shape tests verify unchanged payload is omitted, changed data is written, nested object-key order is ignored, array order is preserved, null differs from missing, undefined JSON fields are omitted, and the payload size budget still applies.

## Ticket Audit — Read Only

The production sample has 257 legs: approximately 698,469 bytes of leg-row values, of which 640,278 bytes are settlement_context values (about 91.7%). These are field/row measurements, not the whole table's allocated disk size. 197 legs have context, with 166 distinct full contexts. Metadata includes copied lineups, eligible-player lists, scoring settings and model/policy descriptions.

Examples of repeated metadata:

| Data | Copies | Distinct Values |
|---|---:|---:|
| Scoring settings | 197 | 1 |
| Roster positions | 122 | 1 |
| Price policy | 117 | 1 |
| Model config | 117 | 1 |
| Away lineup | 102 | 39 |
| Home lineup | 102 | 41 |

136 of the context values already use PostgreSQL pglz compression. Another compression layer is therefore not automatically the biggest win. Large values are already handled transparently by the database's [TOAST mechanism](https://www.postgresql.org/docs/17/storage-toast.html).

These findings do not mean 91.7% can be deleted. Accepted terms and necessary result evidence must remain reproducible. No ticket, wallet, settlement context or production data was changed for this audit. Real production receipts were not copied into the synthetic dev leagues.

## Recommended Next Dev Work

1. **Compact receipt records.** Keep ticket ID, participant/league reference, stake, accepted combined price/payout and boost, placement time, market/line/odds/subject per leg, and result/evidence references. Preserve original accepted terms even when current lines change.
2. **Shared immutable context versions.** Store identical scoring/roster/model/settlement policy once within the relevant league/version scope, then reference it. Share required lineup/evidence versions where identical rather than copying whole forecast metadata into every leg. Validate reads and settlement against the existing receipt interpretation before switching writers.
3. **Current-season history, one copy.** My Bets, All Bets and balance history should query shared records with pagination and filters. Keep credit movements individually explainable; do not collapse away wagers, refunds, payouts or replenishments just to reduce bytes.
4. **Shared progress and notifications.** Reuse one current source observation for everyone following tickets. Store ticket/user references and the last delivered event, not a score snapshot for every user on every poll.
5. **Bounded calibration and operational records.** Keep compact error/calibration summaries and the opening ATS benchmark where needed, not every full model run. Retain unresolved futures and all referenced evidence until resolved. The live worker already bounds its own cron history and keeps only current source payloads.
6. **On-demand share images.** Generate from the receipt when requested; don't accumulate permanent images. The inspected projects currently have no object-storage files.

The earlier roughly 50 MB moderate-season budget assumes compact receipts reach the proposed target. That target is **not implemented yet**. Ticket compaction belongs in the rebuilt acceptance/read/settlement backend; current visual tickets remain local examples, and live pricing/acceptance are still disconnected. Before enabling a new storage format, measure the actual normalized records, context references, indexes and query behaviour rather than claiming a fixed percentage saving from this sample.

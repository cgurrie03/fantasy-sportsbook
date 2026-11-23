# Current-season ticket retention: initial estimates

November 8, 2026 • Planning comparison, not achieved storage measurements

The selected product behavior is to show current-season tickets in My Bets and All Bets. The following compares different retained lengths so the cost is visible; it is not a proposal to discard current-season receipts.

## What is measured

The production sample has 89 tickets and 257 legs. Average observed row sizes are 440 bytes/ticket, 2,718 bytes/leg, and 199 bytes/legacy ledger entry. The sample is small and does not cover the future participant-wallet implementation or heavier live-week usage.

Current ticket counts by placement week are 19 (Week 3), 28 (Week 5), 12 (Week 6), 6 (Week 7), 17 (Week 8), and 7 (Week 9). Week 9 is incomplete at observation and the counts include imported history, so they are not used as a guaranteed future traffic rate. No Week 4 placement row was returned; that is not independent proof of no historical activity outside this database.

## Comparison assumptions

- Standard traffic: eight tickets per participant per week, four selections per ticket.
- Busy traffic: twenty tickets per participant per week, six selections per ticket.
- Compact target: 1,000 bytes/leg, not yet implemented, plus measured 440-byte ticket and two 199-byte credit movements/ticket.
- Multiply row estimates by two for illustrative index/page overhead. This is not a measured factor or a separate operating reserve.
- Team count and participant count are different: a 12-team league may have 14 participants, each with their own balance.
- Decimal MB. Values include estimated ticket/leg/credit-history allocation only. They exclude current boards, provider caches, staging, Auth, replenishment/correction movements beyond the simplifying allowance, long-lived future dependencies, shared database overhead, and operating reserve. Those must be added for full capacity sizing.

Formula: `participants × ticketsPerParticipantPerWeek × weeks × (440 + legsPerTicket × legBytes + 2 × 199) × 2` bytes.

| Usage | 1 retained week | 4 weeks | 8 weeks | 18 weeks / modeled season |
| --- | ---: | ---: | ---: | ---: |
| 12 participants; standard | 0.93 MB | 3.72 MB | 7.43 MB | 16.72 MB |
| 14 participants; standard | 1.08 MB | 4.33 MB | 8.67 MB | 19.51 MB |
| 16 participants; busy | 4.38 MB | 17.51 MB | 35.01 MB | 78.77 MB |

The retention horizon here uses 18 NFL weeks as a planning convention, not a claim that every league runs exactly 18 sportsbook periods. Configure actual league regular/playoff season coverage and then recalculate.

## One, five, and ten leagues

| Ticket-history scenario, modeled 18-week season | 1 league | 5 leagues | 10 leagues |
| --- | ---: | ---: | ---: |
| 12 participants/league; standard compact target | 16.72 MB | 83.60 MB | 167.20 MB |
| 14 participants/league; standard compact target | 19.51 MB | 97.53 MB | 195.07 MB |
| 16 participants/league; busy compact target | 78.77 MB | 393.87 MB | 787.74 MB |

All values exclude the other resources listed above. In particular, the 787.74 MB figure is not a total database estimate; it is receipt/history allocation under busy assumptions.

## Why compact accepted terms matter

For 12 participants at standard traffic over 18 weeks, retaining the current average 2,718-byte leg instead of reaching the proposed 1,000-byte target raises this simplified ticket-history estimate from **16.72 MB to 40.47 MB per league**. For the 16-participant busy scenario it rises from **78.77 MB to 197.52 MB per league**. The modeled reductions are about 59% and 60%, respectively; they are potential savings requiring implementation and measurement, not already reclaimed space.

The primary target is redundant accepted contexts, not deleting members' current-season tickets. Keep readable selections, accepted prices/lines/boosts, outcome evidence, ticket identity, and necessary credit movements. Share compact immutable rule/context versions rather than repeating full lineups and scoring settings. Reusing one required version may save less than assumed if real dependency records are large; include those records in later measurements.

My Bets and All Bets should read the same ticket/leg records with different access/filter views. They must not store two copies of the history. Page summaries and load details on expansion. Shared receipt images are generated on demand rather than permanently stored.

During development, measure real accepted and settled records, per-user wallet entries, indexes, version/context dependencies, and actual season traffic. Re-estimate at 1/5/10 leagues and check both retained bytes and physical allocation. Closed weeks do not expire unresolved futures or unsettled evidence.

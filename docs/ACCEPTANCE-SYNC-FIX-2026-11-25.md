# Current-board acceptance repair

Production rejected a valid player-points parlay because the current ticket engine still consulted `line_refresh_runtime`, which belongs to the retired worker. The published Week 12 book was fresh; the obsolete record was last observed November 24. A fixed three-minute legacy timeout also conflicted with the current publisher's variable refresh cadence.

Regular placement and the reward engine (also used by weekly offers) now require the same current book, board ID, observation timestamp, and expiry used by the published board. The lease must be unexpired and free of source errors. Existing revision, suspension, selection availability, wallet, and account checks remain in place. Futures retain their separate season-board checks. Legacy engines remain isolated from the current app.

The migration was applied to Production and Development. A Production two-leg player-points acceptance probe succeeded inside a subtransaction that was deliberately rolled back; ticket counts, wallet entries, and balance were unchanged.

Automated coverage includes regular and reward engines, stale/failed/started legacy records, expired or failed current books, mismatched observation/expiry timestamps, old revisions, and repeat-safe migration application. The current-book regression runs in `test:user-wallets`, part of the regular release suite. The restored Production runtime rehearsal also accepts a two-leg player-points parlay with a stale legacy record and rejects invalid current leases.

Featured badges now provide anchored, dismissible explanations on hover or tap. Historical matchup scores are loaded independently of projection/ATS availability so a missing reconstructed spread does not hide a prior Revenge Game result. This reuses the existing authenticated season archive request and adds no polling or database writes.

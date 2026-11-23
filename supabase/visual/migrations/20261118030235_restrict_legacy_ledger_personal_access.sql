-- Legacy rows are team-owned archives, with no immutable user attribution.
-- A replacement primary manager must not acquire another person's ledger.
-- Personal history is read from user_wallet_entries using the exact wallet ID.
alter policy wallet_ledger_read on public.wallet_ledger
using (exists (
  select 1 from public.teams t
  where t.id = wallet_ledger.team_id
    and sportsbook_private.is_admin(t.league_id)
));

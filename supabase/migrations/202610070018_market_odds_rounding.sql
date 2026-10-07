begin;
-- Round market prices at persistence, never accepted ticket snapshots or parlay payouts.
drop trigger round_special_odds on public.sportsbook_markets;
drop trigger round_future_odds on public.sportsbook_markets;
create function sportsbook_private.round_market_odds() returns trigger
language plpgsql set search_path='' as $$
declare increment integer;
begin
 increment:=case when new.kind like 'future_%' then 50 when new.kind like 'weekly_%' then 25 else 10 end;
 new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/increment::numeric)*increment);
 return new;
end $$;
revoke all on function sportsbook_private.round_market_odds() from public,anon,authenticated;
create trigger round_market_odds before insert or update of odds,kind on public.sportsbook_markets
 for each row execute function sportsbook_private.round_market_odds();
-- Existing market quotes follow the new policy. Already accepted ticket odds stay unchanged.
update public.sportsbook_markets set odds=odds;
update public.sportsbook_boards set revision=revision+1;
commit;

begin;
-- Week 5 is the approved pilot week. Advance on Tuesdays at 8 AM Eastern,
-- including daylight saving changes; stop at Week 18 pending season rollover.
alter table public.leagues add column active_week integer not null default 5 check(active_week between 1 and 18);
alter table public.leagues add column week_anchor timestamptz not null default '2026-10-06T08:00:00-04:00';
create function public.sportsbook_period(p_league uuid)
returns table(league_season integer,nfl_season integer,week integer)
language sql stable security definer set search_path='' as $$
 select l.league_season,l.nfl_season,
 least(18,l.active_week+greatest(0,floor(extract(epoch from ((now() at time zone 'America/New_York')-(l.week_anchor at time zone 'America/New_York')))/604800)::integer))
 from public.leagues l where l.id=p_league;
$$;
revoke all on function public.sportsbook_period(uuid) from public;
grant execute on function public.sportsbook_period(uuid) to anon,authenticated;
comment on function public.sportsbook_period(uuid) is 'Public season/week label only. Does not advance markets, settle tickets or replenish balances. The weekly operational job must use this same period.';
commit;

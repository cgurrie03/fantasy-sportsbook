begin;
create or replace function sportsbook_private.round_market_odds() returns trigger
language plpgsql set search_path='' as $$
declare increment integer;
begin
 increment:=case when new.kind like 'future_%' then 50 when new.kind like 'weekly_%' then 25 else 10 end;
 new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/increment::numeric)*increment);
 if new.kind like 'future_%' then new.odds:=greatest(-10000,least(10000,new.odds)); end if;
 return new;
end $$;
-- Only live market quotes change. Accepted ticket snapshots retain their price.
with changed as (
 update public.sportsbook_markets set odds=odds
 where kind like 'future_%' and abs(odds)>10000 returning board_id
)
update public.sportsbook_boards set revision=revision+1
where id in(select board_id from changed);
commit;

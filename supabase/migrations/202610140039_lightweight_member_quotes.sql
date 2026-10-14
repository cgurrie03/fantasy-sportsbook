begin;
-- Full lineups/eligibility inputs remain in the stored quotes and immutable
-- forecast archive used by reports. Member quote loading does not use them.
do $$
declare d text; original text;
begin
 select pg_get_functiondef('public.sportsbook_quote_snapshot(uuid)'::regprocedure) into d;
 original:=d;
 d:=replace(d,'jsonb_agg(to_jsonb(m) order by m.market_key,m.side)',
 'jsonb_agg((to_jsonb(m) || jsonb_build_object(''metadata'',m.metadata - array[''home_lineup'',''away_lineup'',''home_eligible_players'',''away_eligible_players'',''scoring_settings''])) order by m.market_key,m.side)');
 if d=original then raise exception 'Quote snapshot serialization anchor changed.'; end if;
 execute d;
end $$;
commit;

begin;
grant select on public.sportsbook_boards to boff_evaluation_retention;
create policy retention_read on public.sportsbook_boards for select to boff_evaluation_retention using(true);
grant boff_evaluation_retention to postgres;
do $$declare d text;anchor text;begin
 select pg_get_functiondef('sportsbook_private.cleanup_evaluated_samples(integer)'::regprocedure) into d;
 anchor:='union select nfl_season*100+market_week from public.model_evaluation_summaries where league_id=l.id';
 if position(anchor in d)=0 then raise exception 'Unresolved future health anchor changed.';end if;
 execute replace(d,anchor,$patch$
 union select x.nfl_season*100+x.market_week from public.model_evaluation_samples x
  where x.league_id=l.id and x.category='Season Futures' and exists(select 1 from public.sportsbook_boards b where b.league_id=x.league_id
   and b.nfl_season=x.nfl_season and b.board_type='future' and b.closes_at<clock_timestamp()-interval '14 days')
  and not exists(select 1 from public.model_evaluation_summaries done where done.league_id=x.league_id and done.nfl_season=x.nfl_season and done.summary->>'future_final'='true')
 union select x.nfl_season*100+x.market_week from public.published_forecast_samples x join public.sportsbook_boards b on b.id=x.board_id and b.league_id=x.league_id
  where x.league_id=l.id and x.board_type='future' and b.closes_at<clock_timestamp()-interval '14 days'
  and not exists(select 1 from public.model_evaluation_summaries done where done.league_id=x.league_id and done.nfl_season=x.nfl_season and done.summary->>'future_final'='true')
 union select nfl_season*100+market_week from public.model_evaluation_summaries where league_id=l.id$patch$);
end $$;
revoke boff_evaluation_retention from postgres;
commit;

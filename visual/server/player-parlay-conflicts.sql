-- Different players may share a fantasy matchup without sharing an outcome.
DO $migration$
DECLARE body text;
 old_guard text := $old$if (a.kind in ('player_h2h','player_milestone','team_milestone','winning_margin') or b.kind in ('player_h2h','player_milestone','team_milestone','winning_margin')) and a.matchup_key is not null and a.matchup_key=b.matchup_key then return true; end if;$old$;
 new_guard text := $new$if a.matchup_key is not null and a.matchup_key=b.matchup_key then
   if a.kind in ('position_group','team_milestone','winning_margin') or b.kind in ('position_group','team_milestone','winning_margin') then return true; end if;
   if a.kind in ('player_points','player_milestone','player_h2h') and b.kind in ('player_points','player_milestone','player_h2h')
    and exists(select 1 from unnest(array[a.metadata->>'player_id',case when a.kind='player_h2h' then a.metadata->>'opponent_player_id' end]) x
     where x is not null and x=any(array[b.metadata->>'player_id',case when b.kind='player_h2h' then b.metadata->>'opponent_player_id' end])) then return true; end if;
 end if;$new$;
 old_insert text := $old$if exists(select 1 from public.ticket_legs l where l.ticket_id=new.ticket_id and l.settlement_context->>'home_team_id'=new.settlement_context->>'home_team_id' and l.settlement_context->>'away_team_id'=new.settlement_context->>'away_team_id') then raise exception 'New market selections require separate fantasy matchups in a parlay.'; end if;$old$;
 new_insert text := $new$if exists(select 1 from public.ticket_legs l where l.ticket_id=new.ticket_id
  and l.settlement_context->>'home_team_id'=new.settlement_context->>'home_team_id'
  and l.settlement_context->>'away_team_id'=new.settlement_context->>'away_team_id'
  and (k in ('position_group','team_milestone','winning_margin') or l.settlement_context->>'kind' in ('position_group','team_milestone','winning_margin')))
 then raise exception 'Position groups, team milestones and winning margins require separate fantasy matchups in a parlay.'; end if;$new$;
BEGIN
 IF public.application_environment_identity()->>'project_ref' NOT IN ('bmvjcdgxwxqalaohpsnw','whlcnlacueweaqpsupqs') THEN RAISE EXCEPTION 'Known hosted environment required'; END IF;
 SELECT pg_get_functiondef('public.sportsbook_special_conflict(public.sportsbook_markets,public.sportsbook_markets)'::regprocedure) INTO body;
 IF strpos(body,new_guard)=0 THEN
  IF strpos(body,old_guard)=0 THEN RAISE EXCEPTION 'Player conflict guard changed'; END IF;
  EXECUTE replace(body,old_guard,new_guard);
 END IF;
 SELECT pg_get_functiondef('sportsbook_private.validate_extra_leg()'::regprocedure) INTO body;
 IF strpos(body,new_insert)=0 THEN
  IF strpos(body,old_insert)=0 THEN RAISE EXCEPTION 'Player insertion guard changed'; END IF;
  EXECUTE replace(body,old_insert,new_insert);
 END IF;
END $migration$;

-- The current publisher owns both the displayed board and its acceptance lease.
-- Never consult the retired worker's line_refresh_runtime for this board.
DO $migration$
DECLARE signature text; body text;
 old_guard text := $old$if v_board.board_type<>'future' and exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or (r.week_started and not sportsbook_private.valid_reopening(v_board,p_picks)) or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;$old$;
 new_guard text := $new$if v_board.board_type='weekly' then
   perform 1 from public.dev_current_book c
   where c.league_id=v_board.league_id and c.board_id=v_board.id
    and c.valid_until>clock_timestamp() and c.last_error is null
    and c.observed_at=v_board.source_observed_at and c.valid_until=v_board.quote_valid_until
   for share;
   if not found then raise exception 'Published prices are out of date. Wait for the next refresh and review your picks.'; end if;
 end if;$new$;
BEGIN
 IF public.application_environment_identity()->>'project_ref' NOT IN ('bmvjcdgxwxqalaohpsnw','whlcnlacueweaqpsupqs') THEN
  RAISE EXCEPTION 'Known hosted application environment required';
 END IF;
 FOREACH signature IN ARRAY ARRAY[
  'boff_dev_internal.place_ticket(uuid,integer,uuid[],numeric,uuid)',
  'boff_dev_internal.place_reward_ticket(uuid,integer,uuid[],numeric,uuid,numeric)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO body;
  IF strpos(body,new_guard)>0 THEN CONTINUE; END IF;
  IF strpos(body,old_guard)=0 THEN RAISE EXCEPTION 'Acceptance guard changed: %',signature; END IF;
  EXECUTE replace(body,old_guard,new_guard);
 END LOOP;
END $migration$;

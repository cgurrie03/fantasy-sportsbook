begin;
do $$declare definition text;anchor text;begin
 select pg_get_functiondef('public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb)'::regprocedure) into definition;
 anchor:='slots integer;used_bytes bigint;';
 if position(anchor in definition)=0 then raise exception 'Compact declaration anchor changed.';end if;
 definition:=replace(definition,anchor,'prediction_time timestamptz;latest_prediction timestamptz;slots integer;used_bytes bigint;');
 anchor:='slim:=sportsbook_private.compact_evaluation_payload(p_payload);new_bytes:=octet_length(slim::text);';
 if position(anchor in definition)=0 then raise exception 'Compact normalization anchor changed.';end if;
 definition:=replace(definition,anchor,$patch$
 begin prediction_time:=coalesce((p_payload->>'generated_at')::timestamptz,clock_timestamp());
 exception when invalid_datetime_format or datetime_field_overflow then
   perform sportsbook_private.evaluation_gap(p_league,'unknown_cutoff',p_season,p_week,p_category);return p_run;
 end;
 if prediction_time<clock_timestamp()-interval '5 minutes' or prediction_time>clock_timestamp()+interval '30 seconds' then
   perform sportsbook_private.evaluation_gap(p_league,'unknown_cutoff',p_season,p_week,p_category);return p_run;
 end if;
 slim:=sportsbook_private.compact_evaluation_payload(p_payload)||jsonb_build_object('prediction_at',prediction_time);
 new_bytes:=octet_length(slim::text);
 $patch$);
 anchor:='select id into context_id from public.model_prediction_contexts where league_id=p_league and fingerprint=context_hash;';
 if position(anchor in definition)=0 then raise exception 'Compact identity anchor changed.';end if;
 definition:=replace(definition,anchor,$patch$
 if exists(select 1 from public.model_evaluation_samples s join public.model_prediction_contexts v on v.id=s.context_version and v.league_id=s.league_id
   where s.league_id=p_league and s.run_id=p_run and
   ((s.payload-'prediction_at')<>(slim-'prediction_at') or s.model_version<>p_version or v.fingerprint<>context_hash)) then
   raise exception 'Retained forecast run collision.';
 end if;
 -- A retained run retry is idempotent even after a newer final slot was saved.
 if exists(select 1 from public.model_evaluation_samples where league_id=p_league and run_id=p_run) then return p_run;end if;
 select max(coalesce((payload->>'prediction_at')::timestamptz,captured_at)) into latest_prediction
   from public.model_evaluation_samples where league_id=p_league and nfl_season=p_season and market_week=p_week and category=p_category;
 -- An overwritten intermediate run has no permanent tombstone. Its generation
 -- time still prevents a late delivery from replacing newer retained evidence.
 if latest_prediction is not null and prediction_time<=latest_prediction then return p_run;end if;
 select id into context_id from public.model_prediction_contexts where league_id=p_league and fingerprint=context_hash;
 $patch$);
 definition:=replace(definition,'if deadline<=now() then','if deadline<=clock_timestamp() then');
 anchor:='market_week,category,horizon,cutoff,model_version,context_version,payload)';
 if position(anchor in definition)=0 then raise exception 'Compact insertion anchor changed.';end if;
 definition:=replace(definition,anchor,'market_week,category,horizon,captured_at,cutoff,model_version,context_version,payload)');
 anchor:='p_week,p_category,h,deadline,p_version,context_id,slim)';
 if position(anchor in definition)=0 then raise exception 'Compact timestamp anchor changed.';end if;
 definition:=replace(definition,anchor,'p_week,p_category,h,clock_timestamp(),deadline,p_version,context_id,slim)');
 execute definition;
end $$;
commit;

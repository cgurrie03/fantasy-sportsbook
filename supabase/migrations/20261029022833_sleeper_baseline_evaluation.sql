begin;
do $$declare definition text;anchor text;begin
 select pg_get_functiondef('sportsbook_private.compact_evaluation_payload(jsonb)'::regprocedure) into definition;
 anchor:='array[''id'',''expected'',''assessment_sd'',''injury'',''positions'']';
 if position(anchor in definition)=0 then raise exception 'Compact player baseline anchor changed.';end if;
 definition:=replace(definition,anchor,'array[''id'',''expected'',''assessment_sd'',''injury'',''positions'',''sleeper_projection'']');
 anchor:='''expected_points'',''expected_wins'',''win_distribution''';
 if position(anchor in definition)=0 then raise exception 'Compact quote baseline anchor changed.';end if;
 definition:=replace(definition,anchor,'''expected_points'',''expected_wins'',''sleeper_projection'',''win_distribution''');
 execute definition;

 select pg_get_functiondef('public.save_model_forecast(uuid,uuid,integer,integer,text,uuid,jsonb,jsonb)'::regprocedure) into definition;
 anchor:='''expected_points'',''expected_wins'')';
 if position(anchor in definition)=0 then raise exception 'Numeric baseline validation anchor changed.';end if;
 definition:=replace(definition,anchor,'''expected_points'',''expected_wins'',''sleeper_projection'')');
 anchor:='begin deadline:=';
 if position(anchor in definition)=0 then raise exception 'Player baseline validation anchor changed.';end if;
 definition:=replace(definition,anchor,$patch$
 if exists(select 1 from jsonb_array_elements(p_payload->'pool') p where p->'sleeper_projection' is not null
   and p->'sleeper_projection'<>'null'::jsonb and jsonb_typeof(p->'sleeper_projection')<>'number') then raise exception 'Invalid Sleeper input benchmark.';end if;
 begin deadline:=$patch$);
 execute definition;

 select pg_get_functiondef('public.control_model(uuid,text,text,uuid,uuid)'::regprocedure) into definition;
 anchor:='select * into strict r from public.model_weekly_reviews where id=p_review and league_id=p_league;';
 if position(anchor in definition)=0 then raise exception 'Model benchmark promotion anchor changed.';end if;
 definition:=replace(definition,anchor,anchor||$patch$
 if r.report->>'assessment_version' like 'weekly-review-v3%' then
   if r.comparison->>'require_sleeper' is distinct from 'true'
     or (select count(distinct t->>'phase') from jsonb_array_elements(r.comparison->'tests') t)<>2
     or exists(select 1 from jsonb_array_elements(r.comparison->'tests') t where
       t->>'phase' not in ('validation','holdout') or t->>'sleeper_passed' is distinct from 'true'
       or coalesce((t->>'sleeper_observations')::integer,0)<case when t->>'phase'='holdout' then 40 else 120 end
       or coalesce((t->'sleeper_interval'->>'low')::numeric,-1)<0)
     then raise exception 'Sleeper input benchmark gates failed.';end if;
 end if;
 $patch$);
 execute definition;
end $$;
commit;

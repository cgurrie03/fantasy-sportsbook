begin;
alter table public.sportsbook_markets drop constraint sportsbook_markets_kind_check;
alter table public.sportsbook_markets add constraint sportsbook_markets_kind_check check(kind in ('spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','future_champion','future_playoffs','future_first_pick'));
do $$ declare definition text; original text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'''weekly_any_200'')) then raise exception', '''weekly_any_200'',''weekly_count_projection'',''weekly_average'',''weekly_highest_score'')) then raise exception');
 if definition=original then raise exception 'Weekly singles guard anchor changed.'; end if;
 execute definition;
 select pg_get_functiondef('sportsbook_private.label_weekly_special()'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'case new.settlement_context->>''kind''', 'case new.settlement_context->>''kind''
 when ''weekly_count_projection'' then new.market_type:=''Teams Beating Projection'';
 when ''weekly_average'' then new.market_type:=''League Average Score'';
 when ''weekly_highest_score'' then new.market_type:=''Highest Weekly Score'';');
 if definition=original then raise exception 'Weekly label anchor changed.'; end if;
 execute definition;
end $$;
-- Extend existing contradiction checks while retaining all prior rules.
create function sportsbook_private.more_special_conflict(a public.sportsbook_markets,b public.sportsbook_markets) returns boolean
language plpgsql immutable set search_path='' as $$
declare h public.sportsbook_markets; s public.sportsbook_markets; c public.sportsbook_markets; target numeric;
begin
 if a.kind='weekly_highest_score' then h:=a;s:=b; elsif b.kind='weekly_highest_score' then h:=b;s:=a; end if;
 if h.id is not null and h.side='under' then
  if s.kind='weekly_any_200' and s.side='yes' and h.line<=200 then return true; end if;
  if s.kind in ('team_total','weekly_average') and s.side='over' and s.line>=h.line then return true; end if;
  if s.kind='weekly_count_150' and s.line>0 and h.line<=150 then return true; end if;
 end if;
 if h.id is not null and h.side='over' and s.kind='weekly_any_200' and s.side='no' and h.line>=200 then return true; end if;
 if a.kind='weekly_count_projection' then c:=a;s:=b; elsif b.kind='weekly_count_projection' then c:=b;s:=a; end if;
 if c.id is not null then
  if s.kind='team_total' then
   target:=(c.metadata->'projection_targets'->>s.team_id::text)::numeric;
   if c.line=0 and s.side='over' and s.line>=target then return true; end if;
   if c.line=(c.metadata->>'expected_team_count')::int and s.side='under' and s.line<=target then return true; end if;
  elsif s.kind='weekly_average' then
   select avg(value::numeric) into target from jsonb_each_text(c.metadata->'projection_targets');
   if c.line=0 and s.side='over' and s.line>=target then return true; end if;
   if c.line=(c.metadata->>'expected_team_count')::int and s.side='under' and s.line<=target then return true; end if;
  end if;
 end if;
 return false;
end $$;
revoke all on function sportsbook_private.more_special_conflict(public.sportsbook_markets,public.sportsbook_markets) from public,anon,authenticated;
do $$ declare definition text; original text;
begin
 select pg_get_functiondef('public.sportsbook_special_conflict(public.sportsbook_markets,public.sportsbook_markets)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'return false;', 'return sportsbook_private.more_special_conflict(a,b);');
 if definition=original then raise exception 'Special conflict anchor changed.'; end if;
 execute definition;
end $$;
commit;

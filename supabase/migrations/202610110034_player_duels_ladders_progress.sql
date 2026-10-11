begin;
alter table public.sportsbook_markets drop constraint sportsbook_markets_kind_check;
alter table public.sportsbook_markets add constraint sportsbook_markets_kind_check check(kind in ('spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','future_champion','future_playoffs','future_first_pick','future_win_total','player_h2h','player_milestone','team_milestone','winning_margin'));
alter table public.sportsbook_markets add constraint milestone_shape check(kind not in ('player_milestone','team_milestone') or (line>0 and side='at_least' and team_id is not null and (kind<>'player_milestone' or metadata->>'player_id' is not null)) is true);
alter table public.sportsbook_markets add constraint head_to_head_shape check(kind<>'player_h2h' or (side in ('home','away') and metadata->>'player_id' is not null and metadata->>'opponent_player_id' is not null and (metadata->>'player_id'<>metadata->>'opponent_player_id' or metadata->>'lineup_locked'='true') and metadata->>'slot' is not null) is true);
alter table public.sportsbook_markets add constraint margin_shape check(kind<>'winning_margin' or (team_id in (home_team_id,away_team_id) and (metadata->>'margin_lower')::numeric>=0 and metadata ? 'margin_upper' and (metadata->>'margin_upper' is null or (metadata->>'margin_upper')::numeric>(metadata->>'margin_lower')::numeric)) is true);

-- Extend the existing transactional acceptance; preserve wallet locks, idempotency and all live gates.
do $$ declare d text; anchor text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into d;
 anchor:='''weekly_count_projection'',''weekly_average'',''weekly_highest_score''';
 if position(anchor in d)=0 then raise exception 'Single-pick guard anchor changed.'; end if;
 d:=replace(d,anchor,anchor||',''player_h2h'',''player_milestone'',''team_milestone'',''winning_margin''');
 execute d;
 select pg_get_functiondef('public.sportsbook_special_conflict(public.sportsbook_markets,public.sportsbook_markets)'::regprocedure) into d;
 if position(E'begin\n' in d)=0 then raise exception 'Conflict guard anchor changed.'; end if;
 d:=replace(d,E'begin\n',E'begin\n if (a.kind in (''player_h2h'',''player_milestone'',''team_milestone'',''winning_margin'') or b.kind in (''player_h2h'',''player_milestone'',''team_milestone'',''winning_margin'')) and a.matchup_key is not null and a.matchup_key=b.matchup_key then return true; end if;\n');
 execute d;
end $$;
create function sportsbook_private.validate_extra_leg() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text:=new.settlement_context->>'kind'; cutoff timestamptz;
begin
 if k not in ('player_h2h','player_milestone','team_milestone','winning_margin') then return new; end if;
 if k in ('player_h2h','player_milestone') then
  cutoff:=(new.settlement_context->'metadata'->>'cutoff_at')::timestamptz;
  if cutoff is null or cutoff<=now() then raise exception 'This player market has reached kickoff or its kickoff is unavailable.'; end if;
 end if;
 if exists(select 1 from public.ticket_legs l where l.ticket_id=new.ticket_id and l.settlement_context->>'home_team_id'=new.settlement_context->>'home_team_id' and l.settlement_context->>'away_team_id'=new.settlement_context->>'away_team_id') then raise exception 'New market selections require separate fantasy matchups in a parlay.'; end if;
 new.market_type:=case k when 'player_h2h' then 'Head to Head' when 'player_milestone' then 'Player Milestone' when 'team_milestone' then 'Team Milestone' else 'Winning Margin' end;
 return new;
end $$;
revoke all on function sportsbook_private.validate_extra_leg() from public,anon,authenticated,service_role;
create trigger extra_leg_validation before insert on public.ticket_legs for each row execute function sportsbook_private.validate_extra_leg();

create table public.ticket_score_observations (
 league_id uuid not null references public.leagues(id), nfl_season integer not null check(nfl_season between 2020 and 2100),
 market_week integer not null check(market_week between 1 and 18), fetched_at timestamptz not null,
 cadence_minutes integer not null check(cadence_minutes in (15,120)),payload jsonb not null check(jsonb_typeof(payload)='object'),
 primary key(league_id,nfl_season,market_week)
);
alter table public.ticket_score_observations enable row level security;
revoke all on public.ticket_score_observations from public,anon,authenticated;
grant select on public.ticket_score_observations to authenticated;
grant select,insert,update on public.ticket_score_observations to service_role;
create policy ticket_observations_member_read on public.ticket_score_observations for select to authenticated using(sportsbook_private.is_member(league_id));
comment on table public.ticket_score_observations is 'Provisional fantasy scores, updated by the worker at 15 minutes in games and two hours otherwise; fetched_at is not provider observation time.';
commit;

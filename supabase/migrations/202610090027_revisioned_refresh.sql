begin;
alter table public.sportsbook_boards add column phase text not null default 'pregame' check(phase in ('pregame','live'));
alter table public.sportsbook_boards add column source_observed_at timestamptz;
alter table public.sportsbook_boards add column quote_valid_until timestamptz;
alter table public.sportsbook_boards add column suspension_reason text;
alter table public.sportsbook_markets add column market_state text not null default 'open' check(market_state in ('open','suspended','closed','settled'));
alter table public.sportsbook_markets add column suspension_reason text;
create table public.line_refresh_runtime (
 league_id uuid primary key references public.leagues(id), market_week integer not null,
 source text not null default 'ESPN public scoreboard (cadence only)', observed_at timestamptz,
 any_in_progress boolean not null default false, week_started boolean not null default false,
 interval_minutes integer not null default 120 check(interval_minutes in (15,120)),
 next_due_at timestamptz not null default now(), last_success_at timestamptz, last_error text,
 games jsonb not null default '[]',
 live_families jsonb not null default '{"matchups":false,"players":false,"specials":false,"futures":false}'
);
create table public.line_refresh_cycles (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id),
 market_week integer not null, slot bigint not null, status text not null default 'staging' check(status in ('staging','published','suspended','superseded','skipped')),
 weekly_board uuid references public.sportsbook_boards(id), weekly_revision integer,
 future_board uuid references public.sportsbook_boards(id), future_revision integer,
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(league_id,market_week,slot)
);
create table public.line_refresh_stages (
 cycle_id uuid not null references public.line_refresh_cycles(id), family text not null check(family in ('matchups','players','specials','futures')),
 quotes jsonb not null check(jsonb_typeof(quotes)='array'), observed_at timestamptz not null,
 primary key(cycle_id,family)
);
create table public.line_refresh_sources (
 cycle_id uuid not null references public.line_refresh_cycles(id), path text not null,
 payload jsonb not null, fetched_at timestamptz not null default now(), primary key(cycle_id,path)
);
alter table public.line_refresh_sources enable row level security;
revoke all on public.line_refresh_sources from public,anon,authenticated;
grant select,insert on public.line_refresh_sources to service_role;
alter table public.automation_jobs add column refresh_cycle_id uuid references public.line_refresh_cycles(id);
create index automation_refresh_cycle_idx on public.automation_jobs(refresh_cycle_id) where refresh_cycle_id is not null;
create index line_refresh_league_created_idx on public.line_refresh_cycles(league_id,created_at desc);
alter table public.line_refresh_runtime enable row level security;
alter table public.line_refresh_cycles enable row level security;
alter table public.line_refresh_stages enable row level security;
revoke all on public.line_refresh_runtime,public.line_refresh_cycles,public.line_refresh_stages from public,anon,authenticated;
grant select on public.line_refresh_runtime,public.line_refresh_cycles to authenticated,service_role;
grant select on public.line_refresh_stages to service_role;
create policy refresh_runtime_read on public.line_refresh_runtime for select to authenticated using(sportsbook_private.is_member(league_id));
create policy refresh_cycle_read on public.line_refresh_cycles for select to authenticated using(sportsbook_private.is_admin(league_id));

-- A heartbeat polls actual state even when the next quote refresh is two hours away.
-- No browser, Git push, email, replenishment or week rollover is involved here.
create function public.observe_line_refresh(p_status jsonb,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare s record; w integer; r public.line_refresh_runtime; c uuid; minutes integer; slot bigint; family text; b public.sportsbook_boards; f public.sportsbook_boards;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 if p_error is null and (jsonb_typeof(p_status->'games') is distinct from 'array' or jsonb_typeof(p_status->'any_in_progress') is distinct from 'boolean' or jsonb_typeof(p_status->'week_started') is distinct from 'boolean') then raise exception 'Invalid game observation.'; end if;
 for s in select * from public.weekly_schedule where automation_enabled order by league_id loop
  select week into w from public.sportsbook_period(s.league_id);
  insert into public.line_refresh_runtime(league_id,market_week) values(s.league_id,w) on conflict do nothing;
  select * into r from public.line_refresh_runtime where league_id=s.league_id for update;
  minutes:=case when coalesce((p_status->>'any_in_progress')::boolean,r.any_in_progress) then 15 else 120 end;
  update public.line_refresh_runtime set market_week=w,observed_at=case when p_error is null then now() else observed_at end,
   any_in_progress=coalesce((p_status->>'any_in_progress')::boolean,any_in_progress),
   week_started=case when r.market_week<>w then coalesce((p_status->>'week_started')::boolean,false) else week_started or coalesce((p_status->>'week_started')::boolean,false) end,
   games=coalesce(p_status->'games',games),interval_minutes=minutes,last_error=coalesce(p_error,p_status->>'reason'),
   next_due_at=case when r.market_week<>w or minutes<>r.interval_minutes then now() else next_due_at end
  where league_id=s.league_id returning * into r;
  if r.last_error is not null or r.week_started then
   update public.sportsbook_boards set phase=case when r.week_started and board_type='weekly' then 'live' else phase end,suspension_reason=coalesce(r.last_error,'Live pricing unavailable: observed starter points and a validated remaining-points model are required.')
   where league_id=s.league_id and nfl_season=(select nfl_season from public.leagues where id=s.league_id) and (market_week=w or board_type='future');
  end if;
  if p_error is not null or r.last_error is not null or r.next_due_at>now() then continue; end if;
  -- One bounded cycle at a time. Abandoned cycles expire; missed slots coalesce.
  if exists(select 1 from public.line_refresh_cycles where league_id=s.league_id and status='staging' and created_at>now()-interval '20 minutes') then continue; end if;
  update public.line_refresh_cycles set status='superseded',completed_at=now() where league_id=s.league_id and status='staging';
  update public.automation_jobs set status='done',completed_at=now(),summary='{"superseded":true}' where league_id=s.league_id and refresh_cycle_id is not null and status in ('pending','failed') and refresh_cycle_id in(select id from public.line_refresh_cycles where status='superseded');
  select * into b from public.sportsbook_boards where league_id=s.league_id and nfl_season=(select nfl_season from public.leagues where id=s.league_id) and market_week=w and board_type='weekly';
  select * into f from public.sportsbook_boards where league_id=s.league_id and nfl_season=(select nfl_season from public.leagues where id=s.league_id) and board_type='future';
  slot:=floor(extract(epoch from now())/ (minutes*60));
  insert into public.line_refresh_cycles(league_id,market_week,slot,weekly_board,weekly_revision,future_board,future_revision)
  values(s.league_id,w,slot,b.id,b.revision,f.id,f.revision) on conflict do nothing returning id into c;
  if c is null then continue; end if;
  foreach family in array array['matchups','players','specials','futures'] loop
   insert into public.automation_jobs(league_id,event_key,operation,market_week,refresh_cycle_id)
   values(s.league_id,'interval:'||c||':'||family,'interval_'||family,w,c) on conflict do nothing;
  end loop;
  update public.line_refresh_runtime set next_due_at=now()+make_interval(mins=>minutes) where league_id=s.league_id;
 end loop;
end $$;
revoke all on function public.observe_line_refresh(jsonb,text) from public,anon,authenticated;
grant execute on function public.observe_line_refresh(jsonb,text) to service_role;

-- Preserve all existing scheduled events. Only change priority and lease recovery.
do $$ declare d text; original text;
begin
 select pg_get_functiondef('public.claim_automation_job()'::regprocedure) into d; original:=d;
 d:=replace(d,'order by j.created_at,case j.operation when ''settlement'' then 0 when ''recheck'' then 1 when ''replenishment'' then 2 when ''recap'' then 6 else 3 end,j.event_key',
 'order by case when j.operation like ''interval_%'' then 9 when j.operation=''settlement'' then 0 when j.operation=''recheck'' then 1 when j.operation=''replenishment'' then 2 when j.operation=''cutoff'' then 3 else 4 end,j.created_at,j.event_key');
 if d=original then raise exception 'Claim priority anchor changed.'; end if;
 execute d;
end $$;

-- Stage all categories, then take the board locks in deterministic order and
-- replace both boards in ONE transaction. A partial category is never visible.
create function public.stage_line_refresh(p_job uuid,p_attempt integer,p_quotes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs; c public.line_refresh_cycles; r public.line_refresh_runtime; b public.sportsbook_boards; q jsonb; v_family text; reason text; result jsonb; published_count integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=now() then raise exception 'Refresh lease lost.'; end if;
 select * into strict r from public.line_refresh_runtime where league_id=j.league_id for update;
 select * into strict c from public.line_refresh_cycles where id=j.refresh_cycle_id for update;
 if c.status<>'staging' then return jsonb_build_object('superseded',true); end if;
 if c.market_week<>r.market_week then raise exception 'Refresh week changed.'; end if;
 v_family:=replace(j.operation,'interval_','');
 if v_family not in ('matchups','players','specials','futures') or jsonb_typeof(p_quotes) is distinct from 'array' then raise exception 'Invalid refresh stage.'; end if;
 insert into public.line_refresh_stages values(c.id,v_family,p_quotes,now()) on conflict(cycle_id,family) do update set quotes=excluded.quotes,observed_at=excluded.observed_at;
 if (select count(*) from public.line_refresh_stages where cycle_id=c.id)<>4 then return '{"staged":true}'; end if;
 reason:=case when r.observed_at is null or r.observed_at<now()-interval '3 minutes' then 'NFL status source is stale.' when r.last_error is not null then r.last_error when r.week_started then 'Live pricing unavailable: observed starter points and a validated remaining-points model are required.' else null end;
 perform 1 from public.sportsbook_boards where id in(c.weekly_board,c.future_board) order by id for update;
 if exists(select 1 from public.sportsbook_boards where (id=c.weekly_board and revision<>c.weekly_revision) or (id=c.future_board and revision<>c.future_revision)) then
  update public.line_refresh_cycles set status='superseded',completed_at=now() where id=c.id;
  update public.line_refresh_runtime set next_due_at=now(),last_error='Board changed during refresh; retry with current revision.' where league_id=j.league_id;
  return '{"superseded":true}';
 end if;
 if (select publication_paused from public.weekly_schedule where league_id=j.league_id) then reason:='Publication paused by administrator.'; end if;
 if reason is null and (c.created_at<now()-interval '10 minutes' or exists(select 1 from public.line_refresh_stages where cycle_id=c.id and observed_at<now()-interval '10 minutes')) then reason:='Staged pricing inputs expired.'; end if;
 for b in select * from public.sportsbook_boards where id in(c.weekly_board,c.future_board) order by id loop
  if reason is not null then update public.sportsbook_boards set suspension_reason=reason where id=b.id; continue; end if;
  -- Closed/draft boards and Thursday promo deadlines remain authoritative.
  if b.status<>'published' or b.closes_at<=now() then continue; end if;
  select coalesce(jsonb_agg(x.value),'[]') into q from public.line_refresh_stages st cross join lateral jsonb_array_elements(st.quotes) x
   where st.cycle_id=c.id and case when b.board_type='future' then st.family='futures' else st.family<>'futures' end;
  if jsonb_array_length(q)=0 then raise exception 'A complete refresh cannot publish an empty board.'; end if;
  result:=public.worker_operation(j.league_id,case when b.board_type='future' then 'save_future_board' else 'save_board' end,
   jsonb_build_object('board',b.id,'week',b.market_week,'opens',b.opens_at,'closes',b.closes_at,'quotes',q,'status',b.status));
  update public.sportsbook_boards set source_observed_at=r.observed_at,quote_valid_until=now()+interval '130 minutes',suspension_reason=null where id=b.id;
  published_count:=published_count+1;
 end loop;
 update public.line_refresh_cycles set status=case when reason is not null then 'suspended' when published_count>0 then 'published' else 'skipped' end,completed_at=now() where id=c.id;
 update public.line_refresh_runtime set last_success_at=case when published_count>0 then now() else last_success_at end,last_error=reason where league_id=j.league_id;
 return jsonb_build_object('published',published_count>0,'boards_published',published_count,'suspension_reason',reason);
end $$;
revoke all on function public.stage_line_refresh(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.stage_line_refresh(uuid,integer,jsonb) to service_role;

-- Keep the authoritative wallet/revision/idempotency transaction. Fail closed
-- for live acceptance; a pricing implementation must replace this gate only
-- after per-family tests, provider freshness and starter locks are verified.
do $$ declare d text; anchor text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into d;
 anchor:='if v_board.revision is distinct from p_revision then';
 if position(anchor in d)=0 then raise exception 'Acceptance gate anchor changed.'; end if;
 d:=replace(d,anchor,'if v_board.phase=''live'' then raise exception ''Live acceptance is disabled until pricing checks pass.''; end if;
 if v_board.suspension_reason is not null then raise exception ''Markets suspended: %'',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception ''Quotes expired; wait for a successful refresh.''; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type=''future'') and (r.observed_at is null or r.observed_at<now()-interval ''3 minutes'' or r.week_started or r.last_error is not null)) then raise exception ''Current game state cannot support pregame acceptance.''; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>''open'' or suspension_reason is not null or metadata->>''resolved''=''true'')) then raise exception ''A selection is suspended or resolved.''; end if;
 '||anchor);
 execute d;
end $$;

create function sportsbook_private.preserve_accepted_terms() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='ticket_legs' then
  if (to_jsonb(new)-array['status','actual_value','result_evidence']) is distinct from (to_jsonb(old)-array['status','actual_value','result_evidence']) then raise exception 'Accepted leg terms are immutable.'; end if;
 else
  if (to_jsonb(new)-array['status','actual_payout','settled_at','ticket_type','net_profit']) is distinct from (to_jsonb(old)-array['status','actual_payout','settled_at','ticket_type','net_profit']) then raise exception 'Accepted ticket terms are immutable.'; end if;
 end if;
 return new;
end $$;
revoke all on function sportsbook_private.preserve_accepted_terms() from public,anon,authenticated,service_role;
create trigger preserve_accepted_leg before update on public.ticket_legs for each row execute function sportsbook_private.preserve_accepted_terms();
-- ticket_type is assigned immediately after INSERT by existing acceptance.
create trigger preserve_accepted_ticket before update on public.tickets for each row execute function sportsbook_private.preserve_accepted_terms();
-- Invoker rights preserve existing board/market membership RLS. One statement
-- returns a coherent board and quote set even during a concurrent publication.
create function public.sportsbook_quote_snapshot(p_board uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('board',to_jsonb(b),'markets',coalesce((select jsonb_agg(to_jsonb(m) order by m.market_key,m.side) from public.sportsbook_markets m where m.board_id=b.id and m.active),'[]'::jsonb)) from public.sportsbook_boards b where b.id=p_board
$$;
revoke all on function public.sportsbook_quote_snapshot(uuid) from public,anon;
grant execute on function public.sportsbook_quote_snapshot(uuid) to authenticated;
commit;

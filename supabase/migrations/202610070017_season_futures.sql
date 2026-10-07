begin;
alter table public.sportsbook_boards add column board_type text not null default 'weekly' check(board_type in ('weekly','future'));
alter table public.sportsbook_boards drop constraint sportsbook_boards_league_id_nfl_season_market_week_key;
alter table public.sportsbook_boards add unique(league_id,nfl_season,market_week,board_type);
create unique index sportsbook_future_season_idx on public.sportsbook_boards(league_id,nfl_season) where board_type='future';
alter table public.sportsbook_markets drop constraint sportsbook_markets_kind_check;
alter table public.sportsbook_markets add constraint sportsbook_markets_kind_check check(kind in ('spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','future_champion','future_playoffs','future_first_pick'));

create function public.save_future_board(p_board uuid,p_league uuid,p_quotes jsonb,p_status text default 'draft') returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.leagues; b public.sportsbook_boards; q jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can manage futures.'; end if;
 if p_status not in ('draft','published','closed') or p_status is null or jsonb_typeof(p_quotes) is distinct from 'array' or jsonb_array_length(p_quotes)>100 then raise exception 'Invalid futures board.'; end if;
 select * into l from public.leagues where id=p_league;
 if not found then raise exception 'League unavailable.'; end if;
 select * into b from public.sportsbook_boards where id=p_board for update;
 if found and (b.league_id<>p_league or b.nfl_season<>l.nfl_season or b.board_type<>'future') then raise exception 'Futures board identity does not match.'; end if;
 if p_status='published' and jsonb_array_length(p_quotes)=0 then raise exception 'Generate futures before publishing.'; end if;
 for q in select value from jsonb_array_elements(p_quotes) loop
  if q->>'kind' is null or q->>'kind' not in ('future_champion','future_playoffs','future_first_pick') or coalesce((q->>'boost_pct')::integer,0)<>0 then raise exception 'Futures board accepts only standalone season markets.'; end if;
  if not exists(select 1 from public.teams where id=(q->>'team_id')::uuid and league_id=p_league) then raise exception 'Future selection must belong to this league.'; end if;
  if not exists(select 1 from public.teams where id=(q->>'team_id')::uuid and roster_id=(q->'metadata'->>'roster_id')::int) then raise exception 'Accepted season roster does not match its team.'; end if;
  if (q->>'kind'='future_playoffs' and q->>'side' not in ('make','miss')) or (q->>'kind'<>'future_playoffs' and q->>'side' is distinct from q->>'team_id') then raise exception 'Invalid futures selection.'; end if;
  if exists(select 1 from public.sportsbook_markets where id=(q->>'id')::uuid and board_id<>p_board) then raise exception 'A quote belongs to a different board.'; end if;
  if q->>'kind'='future_first_pick' and (q->'metadata'->>'last_place_basis' is distinct from 'regular_season' or not exists(select 1 from public.teams where id=(q->'metadata'->>'pick_owner_team_id')::uuid and league_id=p_league)) then raise exception 'First-pick outcome or owner is unavailable.'; end if;
 end loop;
 insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,board_type,opens_at,closes_at,status)
 values(p_board,p_league,1,l.nfl_season,l.league_season,'future',now()-interval '1 second',make_timestamptz(l.nfl_season+1,3,1,0,0,0,'America/New_York'),p_status)
 on conflict(id) do update set status=excluded.status,revision=public.sportsbook_boards.revision+1;
 update public.sportsbook_markets set active=false where board_id=p_board;
 for q in select value from jsonb_array_elements(p_quotes) loop
  insert into public.sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,team_id,home_projection,metadata)
  values((q->>'id')::uuid,p_board,q->>'market_key',q->>'kind',q->>'label',q->>'subject',q->>'side',null,(q->>'odds')::integer,(q->>'team_id')::uuid,(q->>'home_projection')::numeric,q->'metadata')
  on conflict(board_id,market_key,side) do update set label=excluded.label,subject=excluded.subject,odds=excluded.odds,home_projection=excluded.home_projection,metadata=excluded.metadata||case when public.sportsbook_markets.metadata->>'resolved'='true' then jsonb_build_object('resolved',true) else '{}'::jsonb end,active=coalesce(public.sportsbook_markets.metadata->>'resolved','false')<>'true';
 end loop;
 return p_board;
end $$;
revoke all on function public.save_future_board(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.save_future_board(uuid,uuid,jsonb,text) to authenticated;

-- Keep placement transactional and retain the existing wallet lock, request key,
-- quote validation, accepted odds, wager ledger, and confirmation outbox.
do $$ declare definition text; original text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'if cardinality(p_picks)=1 and exists','if v_board.board_type=''future'' and cardinality(p_picks)<>1 then raise exception ''Season Futures are standalone bets.''; end if;
 if v_board.board_type=''weekly'' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like ''future_%'') then raise exception ''Futures require a season board.''; end if;
 if v_board.board_type=''future'' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like ''future_%'') then raise exception ''Only futures belong on a season board.''; end if;
 if v_board.board_type<>''future'' and cardinality(p_picks)=1 and exists');
 definition:=replace(definition,'for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;', 'if v_board.board_type=''future'' then update public.tickets set ticket_type=''future'' where id=v_id; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;');
 if definition=original or position('set ticket_type=''future''' in definition)=0 then raise exception 'Placement migration anchors changed.'; end if;
 execute definition;
end $$;

create function public.label_future_leg() returns trigger language plpgsql set search_path='' as $$
begin
 new.market_type:=case new.settlement_context->>'kind' when 'future_champion' then 'League Winner' when 'future_playoffs' then 'Make / Miss Playoffs' when 'future_first_pick' then '#1 Pick' else new.market_type end;
 return new;
end $$;
revoke all on function public.label_future_leg() from public,anon,authenticated;
create trigger zz_label_future_leg before insert on public.ticket_legs for each row execute function public.label_future_leg();
create function public.round_future_odds() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind like 'future_%' then new.odds:=sign(new.odds)*greatest(100,round(abs(new.odds)/10.0)*10); end if;
 return new;
end $$;
revoke all on function public.round_future_odds() from public,anon,authenticated;
create trigger round_future_odds before insert or update of odds,kind on public.sportsbook_markets for each row execute function public.round_future_odds();

-- The shared settlement transaction can safely pay season tickets too: callers
-- provide outcomes from confirmed season evidence rather than weekly points.
do $$ declare definition text;
begin
 select pg_get_functiondef('public.settle_weekly_ticket(uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if v_ticket.ticket_type=''future'' then raise exception ''Futures are not weekly tickets.''; end if;','');
 execute definition;
end $$;

create or replace function public.replenish_weekly_balances(p_league uuid,p_season integer,p_week integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w record; k text; added integer:=0; blocked integer:=0; skipped integer:=0; committed numeric; target numeric;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can replenish balances.'; end if;
 if p_week not between 1 and 18 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Invalid season or week.'; end if;
 for w in select x.* from public.wallets x join public.teams t on t.id=x.team_id where t.league_id=p_league order by x.team_id for update of x loop
  k:='weekly:replenish:'||p_season||':'||p_week||':'||w.team_id;
  if exists(select 1 from public.wallet_ledger where event_key=k) then skipped:=skipped+1; continue; end if;
  if w.balance is null or exists(select 1 from public.tickets where team_id=w.team_id and ticket_type<>'future' and nfl_season=p_season and ((market_week>=p_week and status<>'VOIDED') or (market_week<p_week and status='OPEN'))) then blocked:=blocked+1; continue; end if;
  select coalesce(sum(stake),0) into committed from public.tickets where team_id=w.team_id and ticket_type='future' and status='OPEN';
  target:=greatest(25,100-committed);
  insert into public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(w.team_id,k,'weekly_replenishment',greatest(0,target-w.balance),w.balance,greatest(target,w.balance),'Week '||p_week||' replenishment; open futures stakes $'||committed||'; cash floor $'||target);
  if w.balance<target then update public.wallets set balance=target,updated_at=now() where team_id=w.team_id; added:=added+1; end if;
 end loop;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(p_league,p_season,p_week,'replenishment',jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped));
 return jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped);
end $$;
create function public.resolve_future_markets(p_league uuid,p_kinds text[]) returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can resolve futures.'; end if;
 if p_kinds is null or not (p_kinds <@ array['future_champion','future_playoffs','future_first_pick']) then raise exception 'Invalid season market kinds.'; end if;
 update public.sportsbook_markets m set active=false,metadata=metadata||jsonb_build_object('resolved',true)
 from public.sportsbook_boards b join public.leagues l on l.id=b.league_id
 where m.board_id=b.id and b.league_id=p_league and b.nfl_season=l.nfl_season and b.board_type='future' and m.kind=any(p_kinds);
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.resolve_future_markets(uuid,text[]) from public,anon;
grant execute on function public.resolve_future_markets(uuid,text[]) to authenticated;

do $$ declare definition text; original text;
begin
 select pg_get_functiondef('public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'v_board.league_id<>p_league or v_board.market_week<>p_week','v_board.league_id<>p_league or v_board.market_week<>p_week or v_board.board_type<>''weekly''');
 if definition=original then raise exception 'Weekly board guard anchor changed.'; end if;
 execute definition;
 select pg_get_functiondef('public.worker_operation(uuid,text,jsonb)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'else raise exception ''Unknown worker operation.'';', 'elsif p_operation=''save_future_board'' then
  return to_jsonb(public.save_future_board((p_args->>''board'')::uuid,p_league,p_args->''quotes'',p_args->>''status''));
 elsif p_operation=''resolve_futures'' then
  return to_jsonb(public.resolve_future_markets(p_league,array(select jsonb_array_elements_text(p_args->''kinds''))));
 else raise exception ''Unknown worker operation.'';');
 if definition=original then raise exception 'Worker bridge anchor changed.'; end if;
 execute definition;
 select pg_get_functiondef('public.claim_automation_job()'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition, '(''generate_matchups'',', '(''generate_futures'',(s.job_times->>''generation'')::time,2),(''generate_matchups'',');
 if definition=original then raise exception 'Futures schedule anchor changed.'; end if;
 execute definition;
end $$;
commit;

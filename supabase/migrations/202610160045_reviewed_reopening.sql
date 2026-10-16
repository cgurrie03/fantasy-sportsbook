begin;
create table public.sportsbook_reopening_reviews (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),
 nfl_season integer not null,market_week integer not null check(market_week between 1 and 18),
 weekly_board uuid not null references public.sportsbook_boards(id),future_board uuid references public.sportsbook_boards(id),
 weekly_revision integer not null,future_revision integer,
 original_future_closes timestamptz,original_future_status text,
 checked_at timestamptz not null,created_at timestamptz not null default now(),closes_at timestamptz not null,
 status text not null default 'review' check(status in ('review','approved','expired','superseded')),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 weekly_quotes jsonb not null check(jsonb_typeof(weekly_quotes)='array' and jsonb_array_length(weekly_quotes) between 1 and 1500),
 future_quotes jsonb not null check(jsonb_typeof(future_quotes)='array' and jsonb_array_length(future_quotes)<=1500),
 context jsonb not null,approved_by uuid references auth.users(id),approved_at timestamptz
);
create index reopening_league_created_idx on public.sportsbook_reopening_reviews(league_id,created_at desc);
create unique index reopening_one_approved_idx on public.sportsbook_reopening_reviews(league_id) where status='approved';
alter table public.sportsbook_reopening_reviews enable row level security;
revoke all on public.sportsbook_reopening_reviews from public,anon,authenticated,service_role;
grant select on public.sportsbook_reopening_reviews to authenticated,service_role;
create policy reopening_admin_read on public.sportsbook_reopening_reviews for select to authenticated using(sportsbook_private.is_admin(league_id));
alter table public.sportsbook_boards add column reopening_id uuid references public.sportsbook_reopening_reviews(id);
alter table public.sportsbook_boards add column reopening_until timestamptz;
alter table public.outbound_emails add column reopening_id uuid references public.sportsbook_reopening_reviews(id);
alter table public.outbound_emails drop constraint outbound_emails_kind_check;
alter table public.outbound_emails add constraint outbound_emails_kind_check check(kind in ('opening','reminder','recap','attention','confirmation','monday_watch','reopening'));

create function public.stage_reopening_review(p_league uuid,p_week integer,p_season integer,p_closes timestamptz,p_checked timestamptz,p_hash text,p_weekly jsonb,p_futures jsonb,p_context jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.sportsbook_boards; f public.sportsbook_boards; result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 if p_closes<=now() or p_closes>now()+interval '7 days' or extract(isodow from p_closes at time zone 'America/New_York')<>7 or (p_closes at time zone 'America/New_York')::time<>'12:00:00'::time then raise exception 'Reopening ends at Sunday noon Eastern.'; end if;
 if p_checked<now()-interval '3 minutes' or p_checked>now()+interval '30 seconds' or p_context->>'model' is distinct from 'between-games-conditional-v1' or jsonb_typeof(p_context->'games') is distinct from 'array' then raise exception 'Fresh verified reopening inputs are required.'; end if;
 select * into b from public.sportsbook_boards where league_id=p_league and nfl_season=p_season and market_week=p_week and board_type='weekly';
 if not found then raise exception 'The current weekly board is unavailable.'; end if;
 select * into f from public.sportsbook_boards where league_id=p_league and nfl_season=p_season and board_type='future';
 if exists(select 1 from jsonb_array_elements(p_weekly||p_futures) q where q->'metadata'->>'reopening_model' is distinct from 'between-games-conditional-v1' or jsonb_typeof(q->'metadata'->'reopening_game_ids') is distinct from 'array') then raise exception 'Every quote needs reopening provenance.'; end if;
 insert into public.sportsbook_reopening_reviews(league_id,nfl_season,market_week,weekly_board,future_board,weekly_revision,future_revision,original_future_closes,original_future_status,checked_at,closes_at,snapshot_hash,weekly_quotes,future_quotes,context)
 values(p_league,p_season,p_week,b.id,f.id,b.revision,f.revision,f.closes_at,f.status,p_checked,p_closes,p_hash,p_weekly,p_futures,p_context) returning id into result;
 return result;
end $$;
revoke all on function public.stage_reopening_review(uuid,integer,integer,timestamptz,timestamptz,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stage_reopening_review(uuid,integer,integer,timestamptz,timestamptz,text,jsonb,jsonb,jsonb) to service_role;

create function public.activate_reopening_review(p_review uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='90s' set work_mem='16MB' as $$
declare w public.sportsbook_reopening_reviews;r public.line_refresh_runtime;b public.sportsbook_boards;v_quotes jsonb;
begin
 select * into w from public.sportsbook_reopening_reviews where id=p_review;
 if not found or not sportsbook_private.is_admin(w.league_id) then raise exception 'Only this league admin can approve a reopening.'; end if;
 perform pg_advisory_xact_lock(hashtext('reopening:'||w.league_id));
 select * into w from public.sportsbook_reopening_reviews where id=p_review for update;
 if w.snapshot_hash is distinct from p_hash then raise exception 'Review the exact reopening snapshot before approval.'; end if;
 if w.status='approved' then return jsonb_build_object('id',w.id,'duplicate',true); end if;
 if w.status<>'review' or w.checked_at<now()-interval '3 minutes' or w.closes_at<=now() then raise exception 'This preview expired. Refresh and review the current lines.'; end if;
 select * into r from public.line_refresh_runtime where league_id=w.league_id;
 if not found or r.market_week<>w.market_week or r.observed_at<now()-interval '3 minutes' or r.observed_at is null or r.last_error is not null then raise exception 'The current game-state source is unavailable.'; end if;
 if exists(select 1 from public.sportsbook_reopening_reviews where league_id=w.league_id and status='approved' and closes_at>now()) then raise exception 'A reopening window is already approved.'; end if;
 update public.sportsbook_reopening_reviews set status='expired' where league_id=w.league_id and status='approved' and closes_at<=now();
 perform 1 from public.sportsbook_boards where id in(w.weekly_board,w.future_board) order by id for update;
 if exists(select 1 from public.sportsbook_boards where (id=w.weekly_board and revision<>w.weekly_revision) or(id=w.future_board and revision<>w.future_revision)) then raise exception 'The board changed. Refresh and review the updated prices.'; end if;
 if not exists(select 1 from jsonb_array_elements(w.weekly_quotes) q where not coalesce((q->'metadata'->>'reopening_locked')::boolean,false) and not coalesce((q->'metadata'->>'lineup_locked')::boolean,false)) then raise exception 'No eligible weekly bets are available.'; end if;
 for b in select * from public.sportsbook_boards where id in(w.weekly_board,w.future_board) order by id loop
  select jsonb_agg(x||jsonb_build_object('metadata',x->'metadata'||jsonb_build_object('reopening_review_id',w.id))) into v_quotes from jsonb_array_elements(case when b.board_type='weekly' then w.weekly_quotes else w.future_quotes end)x;
  if v_quotes is null or jsonb_array_length(v_quotes)=0 then continue; end if;
  if b.board_type='weekly' then perform public.save_market_board(b.id,b.league_id,b.market_week,now(),w.closes_at,v_quotes,'published');
  else perform public.save_future_board(b.id,b.league_id,v_quotes,'published'); end if;
  update public.sportsbook_boards set reopening_id=w.id,reopening_until=w.closes_at,closes_at=least(w.closes_at,case when board_type='weekly' then w.closes_at else closes_at end),suspension_reason=null,source_observed_at=w.checked_at,quote_valid_until=least(w.closes_at,w.checked_at+interval '130 minutes') where id=b.id;
 end loop;
 update public.sportsbook_reopening_reviews set status='approved',approved_by=auth.uid(),approved_at=now() where id=w.id;
 update public.line_refresh_runtime set next_due_at=now() where league_id=w.league_id;
 return jsonb_build_object('id',w.id,'closes_at',w.closes_at,'email_queued',false);
end $$;
revoke all on function public.activate_reopening_review(uuid,text) from public,anon;
grant execute on function public.activate_reopening_review(uuid,text) to authenticated;

create function sportsbook_private.valid_reopening(p_board public.sportsbook_boards,p_picks uuid[]) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare w public.sportsbook_reopening_reviews;r public.line_refresh_runtime;q public.sportsbook_markets; game_id text; g jsonb;
begin
 if p_board.reopening_id is null or p_board.reopening_until<=now() then return false; end if;
 select * into w from public.sportsbook_reopening_reviews where id=p_board.reopening_id and league_id=p_board.league_id and status='approved' and closes_at>now();
 if not found then return false; end if;
 select * into r from public.line_refresh_runtime where league_id=w.league_id;
 if not found or r.market_week<>w.market_week or r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.last_error is not null then return false; end if;
 for q in select * from public.sportsbook_markets where id=any(p_picks) and board_id=p_board.id and active loop
  if q.metadata->>'reopening_model' is distinct from 'between-games-conditional-v1' or q.metadata->>'reopening_review_id' is distinct from w.id::text or coalesce((q.metadata->>'reopening_locked')::boolean,true) or coalesce((q.metadata->>'lineup_locked')::boolean,false) or coalesce(jsonb_array_length(q.metadata->'reopening_game_ids'),0)=0 then return false; end if;
  for game_id in select jsonb_array_elements_text(q.metadata->'reopening_game_ids') loop
   select value into g from jsonb_array_elements(r.games) where value->>'id'=game_id;
   if g is null or not exists(select 1 from jsonb_array_elements(q.metadata->'reopening_events') as prior(value) where prior.value->>'id'=game_id and prior.value->>'state'=g->>'state' and prior.value->>'starts_at'=g->>'starts_at') or g->>'state' not in ('scheduled','final') or (g->>'state'='scheduled' and (g->>'starts_at')::timestamptz<=now()) or (coalesce((q.metadata->>'reopening_player_market')::boolean,false) and g->>'state'<>'scheduled') then return false; end if;
  end loop;
 end loop;
 return true;
end $$;
revoke all on function sportsbook_private.valid_reopening(public.sportsbook_boards,uuid[]) from public,anon,authenticated,service_role;
do $migration$
declare d text;old text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into d;old:=d;
 d:=replace(d,'if v_board.phase=''live'' then','if v_board.reopening_id is not null and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception ''Reopening prices or game state changed. Refresh your picks.''; end if; if v_board.phase=''live'' and not sportsbook_private.valid_reopening(v_board,p_picks) then');
 if d=old then raise exception 'Live gate anchor changed.'; end if;old:=d;
 d:=replace(d,'r.week_started or r.last_error is not null','(r.week_started and not sportsbook_private.valid_reopening(v_board,p_picks)) or r.last_error is not null');
 if d=old then raise exception 'Game-state gate anchor changed.'; end if;
 execute d;
end $migration$;

create function public.queue_reopening_announcement(p_review uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare w public.sportsbook_reopening_reviews;n integer;
begin
 select * into w from public.sportsbook_reopening_reviews where id=p_review;
 if not found or not sportsbook_private.is_admin(w.league_id) then raise exception 'Only this league admin can send this announcement.'; end if;
 if w.status<>'approved' or w.closes_at<=now() or not exists(select 1 from public.line_refresh_runtime where league_id=w.league_id and market_week=w.market_week and observed_at>=now()-interval '3 minutes' and last_error is null) or not exists(select 1 from public.sportsbook_boards where id=w.weekly_board and status='published' and reopening_id=w.id and suspension_reason is null and quote_valid_until>now()) then raise exception 'The reopening must be verified and open before sending.'; end if;
 insert into public.outbound_emails(league_id,event_key,kind,recipient,team_id,market_week,reopening_id)
 select w.league_id,'reopening:'||w.id||':'||m.id,'reopening',m.invited_email,m.team_id,w.market_week,w.id from public.league_memberships m where m.league_id=w.league_id on conflict(event_key) do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.queue_reopening_announcement(uuid) from public,anon;
grant execute on function public.queue_reopening_announcement(uuid) to authenticated;
commit;

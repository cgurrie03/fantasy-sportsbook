begin;
-- Immutable, atomic copies AFTER all quotes have been saved. Accepted tickets remain untouched.
create table public.forecast_snapshots (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id),
 board_id uuid not null references public.sportsbook_boards(id), revision integer not null,
 nfl_season integer not null, market_week integer not null, board_type text not null,
 captured_at timestamptz not null default now(), opens_at timestamptz not null, closes_at timestamptz not null,
 provenance text not null default 'published_snapshot' check(provenance in ('published_snapshot','existing_board_at_install')),
 quotes jsonb not null check(jsonb_typeof(quotes)='array'), unique(board_id,revision)
);
create index forecast_league_season_idx on public.forecast_snapshots(league_id,nfl_season,market_week,captured_at);
alter table public.forecast_snapshots enable row level security;
create policy forecast_admin_read on public.forecast_snapshots for select to authenticated using(sportsbook_private.is_admin(league_id));
grant select on public.forecast_snapshots to authenticated,service_role;
create function sportsbook_private.capture_forecast(p_board uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.forecast_snapshots(league_id,board_id,revision,nfl_season,market_week,board_type,opens_at,closes_at,quotes)
 select b.league_id,b.id,b.revision,b.nfl_season,b.market_week,b.board_type,b.opens_at,b.closes_at,
 coalesce((select jsonb_agg(to_jsonb(m) order by m.market_key,m.side) from public.sportsbook_markets m where m.board_id=b.id and m.active),'[]'::jsonb)
 from public.sportsbook_boards b where b.id=p_board and b.status='published'
 on conflict(board_id,revision) do nothing;
end $$;
revoke all on function sportsbook_private.capture_forecast(uuid) from public,anon,authenticated,service_role;
do $$ declare d text; signature text;
begin
 foreach signature in array array['public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text)','public.save_future_board(uuid,uuid,jsonb,text)'] loop
  select pg_get_functiondef(signature::regprocedure) into d;
  if position('return p_board;' in d)=0 then raise exception 'Forecast capture anchor changed.'; end if;
  execute replace(d,'return p_board;','perform sportsbook_private.capture_forecast(p_board); return p_board;');
 end loop;
end $$;
insert into public.forecast_snapshots(league_id,board_id,revision,nfl_season,market_week,board_type,opens_at,closes_at,quotes,provenance)
select b.league_id,b.id,b.revision,b.nfl_season,b.market_week,b.board_type,b.opens_at,b.closes_at,
coalesce((select jsonb_agg(to_jsonb(m) order by m.market_key,m.side) from public.sportsbook_markets m where m.board_id=b.id and m.active),'[]'::jsonb),'existing_board_at_install'
from public.sportsbook_boards b where b.status='published';

create table public.league_result_weeks (
 league_id uuid not null references public.leagues(id), nfl_season integer not null, market_week integer not null check(market_week between 1 and 18),
 final boolean not null, source text not null default 'Sleeper', fetched_at timestamptz not null default now(), results jsonb not null,
 primary key(league_id,nfl_season,market_week)
);
alter table public.league_result_weeks enable row level security;
create policy results_admin_read on public.league_result_weeks for select to authenticated using(sportsbook_private.is_admin(league_id));
grant select on public.league_result_weeks to authenticated,service_role;
create function public.save_report_results(p_league uuid,p_season integer,p_week integer,p_final boolean,p_results jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can refresh reports.'; end if;
 if not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) or jsonb_typeof(p_results) is distinct from 'object' then raise exception 'Invalid report results.'; end if;
 insert into public.league_result_weeks values(p_league,p_season,p_week,p_final,'Sleeper',now(),p_results)
 on conflict(league_id,nfl_season,market_week) do update set final=excluded.final,fetched_at=excluded.fetched_at,results=excluded.results;
end $$;
revoke all on function public.save_report_results(uuid,integer,integer,boolean,jsonb) from public,anon;
grant execute on function public.save_report_results(uuid,integer,integer,boolean,jsonb) to authenticated;

create table public.admin_change_log (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id), actor_id uuid not null,
 category text not null, reason text not null, before_value jsonb not null, after_value jsonb not null, created_at timestamptz not null default now()
);
create index admin_change_league_idx on public.admin_change_log(league_id,created_at desc);
alter table public.admin_change_log enable row level security;
create policy admin_change_read on public.admin_change_log for select to authenticated using(sportsbook_private.is_admin(league_id));
grant select on public.admin_change_log to authenticated;
create function public.save_league_identity(p_league uuid,p_name text,p_avatar text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare old public.leagues;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can edit settings.'; end if;
 if length(trim(p_name)) not between 3 and 100 or length(trim(p_reason)) not between 5 and 500 or (p_avatar<>'' and p_avatar !~ '^https://') or length(p_avatar)>1000 then raise exception 'Provide a league name, HTTPS image URL, and change reason.'; end if;
 select * into strict old from public.leagues where id=p_league for update;
 update public.leagues set name=trim(p_name),avatar_url=nullif(trim(p_avatar),'') where id=p_league;
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value) values(p_league,auth.uid(),'identity',trim(p_reason),jsonb_build_object('name',old.name,'avatar_url',old.avatar_url),jsonb_build_object('name',trim(p_name),'avatar_url',nullif(trim(p_avatar),'')));
end $$;
revoke all on function public.save_league_identity(uuid,text,text,text) from public,anon;
grant execute on function public.save_league_identity(uuid,text,text,text) to authenticated;
commit;

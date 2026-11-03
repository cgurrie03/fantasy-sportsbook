begin;
create table sportsbook_private.sportsbook_policy_versions(
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues,revision integer not null check(revision between 1 and 64),
 nfl_season integer not null check(nfl_season between 2020 and 2100),market_week integer not null check(market_week between 1 and 18),
 overrides jsonb not null check(octet_length(overrides::text)<=2048),actor uuid not null references auth.users,reason text not null check(length(reason)between 8 and 400),created_at timestamptz not null default clock_timestamp(),
 unique(league_id,revision),unique(league_id,nfl_season,market_week));
alter table sportsbook_private.sportsbook_policy_versions enable row level security;
revoke all on sportsbook_private.sportsbook_policy_versions from public,anon,authenticated,service_role;
create trigger sportsbook_policy_immutable before update or delete on sportsbook_private.sportsbook_policy_versions for each row execute function sportsbook_private.promo_snapshot_immutable();
create function sportsbook_private.sportsbook_defaults()returns jsonb language sql immutable set search_path=''as $$select '{"featured_boost_pct":25,"matchup_odds_step":10,"weekly_odds_step":25,"futures_odds_step":50,"futures_max_odds":10000,"matchups_enabled":true,"players_enabled":true,"specials_enabled":true,"futures_enabled":true}'::jsonb$$;
create function sportsbook_private.sportsbook_policy(p_league uuid,p_season integer,p_week integer)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('contract','sportsbook-policy-v1','revision',coalesce(v.revision,0),'values',sportsbook_private.sportsbook_defaults()||coalesce(v.overrides,'{}'))from(select 1)anchor left join lateral
 (select revision,overrides from sportsbook_private.sportsbook_policy_versions where league_id=p_league and(nfl_season,market_week)<=(p_season,p_week)order by nfl_season desc,market_week desc limit 1)v on true
$$;
create function sportsbook_private.validate_sportsbook_policy(p_overrides jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
declare v jsonb;k text;x jsonb;begin
 if p_overrides is null or jsonb_typeof(p_overrides)<>'object'or octet_length(p_overrides::text)>2048 then raise exception 'Typed sportsbook overrides required.';end if;
 for k,x in select * from jsonb_each(p_overrides)loop
  if not sportsbook_private.sportsbook_defaults()?k then raise exception 'Unsupported sportsbook policy field.';end if;
  if right(k,8)='_enabled'then if jsonb_typeof(x)<>'boolean'then raise exception 'Boolean market family flag required.';end if;
  elsif jsonb_typeof(x)<>'number'or(x#>>'{}')::numeric<>trunc((x#>>'{}')::numeric)then raise exception 'Whole policy values required.';end if;
 end loop;
 v:=sportsbook_private.sportsbook_defaults()||p_overrides;
 if(v->>'featured_boost_pct')::integer not between 0 and 50 or(v->>'matchup_odds_step')::integer not in(10,25,50)or(v->>'weekly_odds_step')::integer not in(10,25,50)or(v->>'futures_odds_step')::integer not in(25,50,100)
  or(v->>'futures_max_odds')::integer not between 1000 and 10000 or(v->>'futures_max_odds')::integer%(v->>'futures_odds_step')::integer<>0 then raise exception 'Unsupported sportsbook pricing bounds.';end if;
 return v;
end $$;
create function public.sportsbook_policy(p_league uuid,p_season integer,p_week integer)returns jsonb language plpgsql stable security definer set search_path=''as $$begin
 if auth.role()is distinct from 'service_role'and not sportsbook_private.is_member(p_league)and not sportsbook_private.is_admin(p_league)then raise exception 'Selected league access required.';end if;
 if p_season not between 2020 and 2100 or p_week not between 1 and 18 or p_season is null or p_week is null or not exists(select 1 from public.leagues where id=p_league)then raise exception 'Supported league period required.';end if;
 return sportsbook_private.sportsbook_policy(p_league,p_season,p_week);
end $$;
create function public.sportsbook_policy_review(p_league uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$declare p record;begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 select * into p from public.sportsbook_period(p_league);if p.nfl_season is null then raise exception 'Selected league unavailable.';end if;
 return jsonb_build_object('season',p.nfl_season,'week',p.week,'latest_revision',coalesce((select max(revision)from sportsbook_private.sportsbook_policy_versions where league_id=p_league),0),'current',sportsbook_private.sportsbook_policy(p_league,p.nfl_season,p.week),
 'versions',(select coalesce(jsonb_agg(x order by revision desc),'[]')from(select revision,nfl_season,market_week,overrides,reason from sportsbook_private.sportsbook_policy_versions where league_id=p_league order by revision desc limit 64)x));
end $$;
create function public.save_sportsbook_policy(p_league uuid,p_expected integer,p_season integer,p_week integer,p_overrides jsonb,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$
declare p record;r integer;prior jsonb;begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 perform sportsbook_private.validate_sportsbook_policy(p_overrides);
 if p_reason is null or length(trim(p_reason))not between 8 and 400 then raise exception 'Policy review reason required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('sportsbook-policy:'||p_league,0));perform 1 from public.leagues where id=p_league for update;
 if not found then raise exception 'Selected league unavailable.';end if;
 select * into p from public.sportsbook_period(p_league);
 if p_season is null or p_week is null or p_season not between p.nfl_season and p.nfl_season+1 or p_week not between 1 and 18 or(p_season,p_week)<(p.nfl_season,p.week)then raise exception 'Current or future supported period required.';end if;
 if exists(select 1 from public.leagues where id=p_league and operations_enabled)or exists(select 1 from public.weekly_schedule where league_id=p_league and automation_enabled)then raise exception 'Pause operations and automation before policy changes.';end if;
 select coalesce(max(revision),0)into r from sportsbook_private.sportsbook_policy_versions where league_id=p_league;
 if exists(select 1 from sportsbook_private.sportsbook_policy_versions where league_id=p_league and revision=p_expected+1 and nfl_season=p_season and market_week=p_week and overrides=p_overrides and reason=trim(p_reason)and actor=auth.uid())then return jsonb_build_object('revision',p_expected+1,'duplicate',true);end if;
 if p_expected is distinct from r then raise exception 'Policy changed; reload before saving.';end if;
 if r>=64 then raise exception 'Policy history budget reached.';end if;
 if exists(select 1 from sportsbook_private.sportsbook_policy_versions where league_id=p_league and(nfl_season,market_week)>=(p_season,p_week))then raise exception 'Effective policy periods must increase.';end if;
 if exists(select 1 from public.tickets where league_id=p_league and status<>'VOIDED'and(nfl_season,placement_week)>=(p_season,p_week))or exists(select 1 from public.sportsbook_boards where league_id=p_league and status='published'and(nfl_season,market_week)>=(p_season,p_week))then raise exception 'Published boards or accepted tickets exist; choose a later period.';end if;
 prior:=sportsbook_private.sportsbook_policy(p_league,p_season,p_week);
 insert into sportsbook_private.sportsbook_policy_versions(league_id,revision,nfl_season,market_week,overrides,actor,reason)values(p_league,r+1,p_season,p_week,p_overrides,auth.uid(),trim(p_reason));
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)values(p_league,auth.uid(),'sportsbook_policy',trim(p_reason),prior,sportsbook_private.sportsbook_policy(p_league,p_season,p_week));
 return jsonb_build_object('revision',r+1,'duplicate',false);
end $$;
create function sportsbook_private.quote_family(p_kind text)returns text language sql immutable set search_path=''as $$select case when p_kind like 'future_%'then 'futures'when p_kind in('player_points','player_h2h','player_milestone')then 'players'when p_kind like 'weekly_%'then 'specials'else 'matchups'end$$;
create function sportsbook_private.check_policy_quote(q public.sportsbook_markets)returns void language plpgsql security definer set search_path=''as $$declare b public.sportsbook_boards;v jsonb;expected integer:=0;period record;begin
 select * into b from public.sportsbook_boards where id=q.board_id;perform pg_advisory_xact_lock_shared(hashtextextended('sportsbook-policy:'||b.league_id,0));select * into period from public.sportsbook_period(b.league_id);v:=sportsbook_private.sportsbook_policy(b.league_id,b.nfl_season,case when b.board_type='future'then case when b.nfl_season<period.nfl_season then 18 else period.week end else b.market_week end)->'values';
 if not(v->>(sportsbook_private.quote_family(q.kind)||'_enabled'))::boolean then raise exception 'Market family disabled by effective policy.';end if;
 if(q.featured='Game of the Week'and q.kind='moneyline')or(q.featured='Tank Bowl'and(q.kind='moneyline'or(q.kind='match_total'and q.side='over')))then expected:=(v->>'featured_boost_pct')::integer;end if;
 if coalesce(q.metadata->>'sportsbook_policy_revision','0')<>(sportsbook_private.sportsbook_policy(b.league_id,b.nfl_season,case when b.board_type='future'then case when b.nfl_season<period.nfl_season then 18 else period.week end else b.market_week end)->>'revision')then raise exception 'Quote policy changed; regenerate before publication.';end if;
 if b.board_type='future'and abs(q.odds)>(v->>'futures_max_odds')::integer then raise exception 'Futures price exceeds effective policy cap.';end if;
 if q.boost_pct<>0 and q.boost_pct<>expected then raise exception 'Featured boost does not match effective policy.';end if;
end $$;
create function sportsbook_private.policy_quote_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.active then perform sportsbook_private.check_policy_quote(new);end if;return new;
end $$;
create function sportsbook_private.policy_publication_guard()returns trigger language plpgsql security definer set search_path=''as $$declare q public.sportsbook_markets;begin
 if exists(select 1 from public.sportsbook_boards where id=new.id and status='published')then for q in select * from public.sportsbook_markets where board_id=new.id and active loop perform sportsbook_private.check_policy_quote(q);end loop;end if;return null;
end $$;
do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.sportsbook_markets'::regclass and contype='c'and pg_get_constraintdef(oid)like '%boost_pct%'loop execute format('alter table public.sportsbook_markets drop constraint %I',c.conname);end loop;end $$;
alter table public.sportsbook_markets add constraint sportsbook_boost_bounds check(boost_pct between 0 and 50);
create trigger policy_quote_guard before insert or update of active,odds,boost_pct,featured,kind,side,board_id,metadata on public.sportsbook_markets for each row execute function sportsbook_private.policy_quote_guard();
create constraint trigger policy_publication_guard after insert or update on public.sportsbook_boards deferrable initially deferred for each row execute function sportsbook_private.policy_publication_guard();
revoke all on function sportsbook_private.sportsbook_defaults(),sportsbook_private.sportsbook_policy(uuid,integer,integer),sportsbook_private.validate_sportsbook_policy(jsonb),sportsbook_private.quote_family(text),sportsbook_private.check_policy_quote(public.sportsbook_markets),sportsbook_private.policy_quote_guard(),sportsbook_private.policy_publication_guard()from public,anon,authenticated,service_role;
revoke all on function public.sportsbook_policy(uuid,integer,integer),public.sportsbook_policy_review(uuid),public.save_sportsbook_policy(uuid,integer,integer,integer,jsonb,text)from public,anon;
revoke all on function public.sportsbook_policy_review(uuid),public.save_sportsbook_policy(uuid,integer,integer,integer,jsonb,text)from service_role;
grant execute on function public.sportsbook_policy(uuid,integer,integer)to authenticated,service_role;
grant execute on function public.sportsbook_policy_review(uuid),public.save_sportsbook_policy(uuid,integer,integer,integer,jsonb,text)to authenticated;
create function public.current_sportsbook_policy(p_league uuid)returns jsonb language sql stable security invoker set search_path=''as $$select public.sportsbook_policy(p_league,p.nfl_season,p.week)from public.sportsbook_period(p_league)p$$;
revoke all on function public.current_sportsbook_policy(uuid)from public,anon,service_role;
grant execute on function public.current_sportsbook_policy(uuid)to authenticated;
do $$declare d text;needle text:=$a$'wallet_model',case$a$;begin
 select pg_get_functiondef('public.league_capabilities(uuid)'::regprocedure)into d;
 if strpos(d,needle)=0 then raise exception 'Capability pricing anchor drift';end if;
 execute replace(d,needle,$b$'pricing_policy',public.current_sportsbook_policy(l.id),'wallet_model',case$b$);
end $$;
alter table public.tickets add column sportsbook_policy_snapshot jsonb check(sportsbook_policy_snapshot is null or octet_length(sportsbook_policy_snapshot::text)<=2048);
create function sportsbook_private.capture_sportsbook_policy()returns trigger language plpgsql security definer set search_path=''as $$declare p record;begin
 if tg_op='UPDATE'then if new.sportsbook_policy_snapshot is distinct from old.sportsbook_policy_snapshot then raise exception 'Accepted sportsbook policy is immutable.';end if;return new;end if;
 if new.source_batch is not null then new.sportsbook_policy_snapshot:=null;return new;end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('sportsbook-policy:'||new.league_id,0));select * into p from public.sportsbook_period(new.league_id);
 new.sportsbook_policy_snapshot:=sportsbook_private.sportsbook_policy(new.league_id,new.nfl_season,p.week);return new;
end $$;
create trigger capture_sportsbook_policy before insert or update of sportsbook_policy_snapshot on public.tickets for each row execute function sportsbook_private.capture_sportsbook_policy();
create function sportsbook_private.accept_enabled_family()returns trigger language plpgsql security definer set search_path=''as $$declare t public.tickets;q public.sportsbook_markets;begin
 select * into t from public.tickets where id=new.ticket_id;if t.source_batch is not null or new.market_quote_id is null then return new;end if;
 select * into q from public.sportsbook_markets where id=new.market_quote_id;perform sportsbook_private.check_policy_quote(q);
 if t.sportsbook_policy_snapshot is not null and not(t.sportsbook_policy_snapshot->'values'->>(sportsbook_private.quote_family(q.kind)||'_enabled'))::boolean then raise exception 'Market family disabled by accepted placement policy.';end if;return new;
end $$;
create trigger accept_enabled_family before insert on public.ticket_legs for each row execute function sportsbook_private.accept_enabled_family();
revoke all on function sportsbook_private.capture_sportsbook_policy(),sportsbook_private.accept_enabled_family()from public,anon,authenticated,service_role;
do $$declare d text;needle text;begin
 select pg_get_functiondef('public.patch_future_board(uuid,integer,jsonb,text)'::regprocedure)into d;
 needle:='between 100 and 10000';if strpos(d,needle)=0 then raise exception 'Futures cap source drift';end if;
 d:=replace(d,needle,$x$between 100 and(public.current_sportsbook_policy(b.league_id)->'values'->>'futures_max_odds')::integer$x$);
 needle:='mod((q->>''odds'')::numeric,50)';if strpos(d,needle)=0 then raise exception 'Futures rounding source drift';end if;
 d:=replace(d,needle,$x$mod((q->>'odds')::numeric,(public.current_sportsbook_policy(b.league_id)->'values'->>'futures_odds_step')::integer)$x$);execute d;
end $$;
do $$declare d text;needle text:=$a$if jsonb_array_length(q)=0 then raise exception 'A complete refresh cannot publish an empty board.'; end if;$a$;begin
 select pg_get_functiondef('public.stage_line_refresh(uuid,integer,jsonb)'::regprocedure)into d;
 if strpos(d,needle)=0 then raise exception 'Refresh empty-board anchor drift';end if;
 execute replace(d,needle,$b$if jsonb_array_length(q)=0 then
 if(b.board_type='future'and not(public.sportsbook_policy(j.league_id,b.nfl_season,c.market_week)->'values'->>'futures_enabled')::boolean)or(b.board_type<>'future'and not(public.sportsbook_policy(j.league_id,b.nfl_season,c.market_week)->'values'->>'matchups_enabled')::boolean and not(public.sportsbook_policy(j.league_id,b.nfl_season,c.market_week)->'values'->>'players_enabled')::boolean and not(public.sportsbook_policy(j.league_id,b.nfl_season,c.market_week)->'values'->>'specials_enabled')::boolean)then
 update public.sportsbook_boards set suspension_reason='Market families disabled by effective policy.'where id=b.id;continue;
 end if;raise exception 'A complete refresh cannot publish an empty board.';end if;$b$);
end $$;
commit;

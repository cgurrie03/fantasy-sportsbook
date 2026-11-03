begin;
-- Optional provider-owned season linkage; retain compatibility with existing v1 snapshots.
do $$declare d text;needle text:=$a$'settings','teams'))$a$;begin
 select pg_get_functiondef('sportsbook_private.validate_intake_source(jsonb,jsonb)'::regprocedure)into d;
 if strpos(d,needle)=0 then raise exception 'Intake optional-link anchor drift';end if;
 d:=replace(d,needle,$b$'settings','teams','previous_league_id'))$b$);
 d:=replace(d,'declare t jsonb;k text;v jsonb;begin',$c$declare t jsonb;k text;v jsonb;begin
 if s?'previous_league_id'and(jsonb_typeof(s->'previous_league_id')is distinct from 'string'or coalesce(s->>'previous_league_id','')!~'^[0-9]{1,32}$')then raise exception 'Invalid provider previous-season ID.';end if;$c$);execute d;
end $$;

alter table public.leagues add column provider_review_required boolean generated always as(provider_contract is not null)stored;
create function sportsbook_private.capability_source(p_source jsonb)returns jsonb language sql immutable set search_path=''as $$
 select jsonb_build_object('contract',p_source->'contract','provider',p_source->'provider','league_id',p_source->'league_id','previous_league_id',p_source->'previous_league_id','season',p_source->'season','status',p_source->'status','total_rosters',p_source->'total_rosters','scoring',p_source->'scoring','positions',p_source->'positions','settings',
 (select coalesce(jsonb_object_agg(key,value),'{}')from jsonb_each(p_source->'settings')where key in('divisions','league_average_match','playoff_seed_type','playoff_round_type','playoff_week_start','playoff_teams','playoff_type','playoff_best_ball','type','taxi_slots','reserve_slots')))
$$;
revoke all on function sportsbook_private.capability_source(jsonb)from public,anon,authenticated,service_role;
-- One bounded current observation; historical decisions contain hashes only.
create table sportsbook_private.provider_capability_state(
 league_id uuid primary key references public.leagues,source jsonb not null check(octet_length(source::text)<=32768),rosters jsonb not null check(octet_length(rosters::text)<=16384),
 observed_hash text not null,observed_at timestamptz not null,build_sha text not null check(build_sha~'^[a-f0-9]{40}$'),approved_hash text,approved_by uuid references auth.users,approved_at timestamptz,revision integer not null default 0 check(revision between 0 and 64));
create table sportsbook_private.provider_capability_decisions(
 league_id uuid not null references public.leagues,revision integer not null check(revision between 1 and 64),review_hash text not null,build_sha text not null,actor uuid not null references auth.users,reason text not null check(length(reason)between 8 and 400),created_at timestamptz not null default clock_timestamp(),primary key(league_id,revision));
alter table sportsbook_private.provider_capability_state enable row level security;
alter table sportsbook_private.provider_capability_decisions enable row level security;
revoke all on sportsbook_private.provider_capability_state,sportsbook_private.provider_capability_decisions from public,anon,authenticated,service_role;
create trigger provider_decision_immutable before update or delete on sportsbook_private.provider_capability_decisions for each row execute function sportsbook_private.promo_snapshot_immutable();
create function sportsbook_private.provider_configuration_hash(p_league uuid)returns text language sql stable security definer set search_path=''as $$
 select encode(sha256(convert_to(jsonb_build_object('nfl_season',l.nfl_season,'league_season',l.league_season,'wallet',sportsbook_private.wallet_policy(l.id,p.nfl_season,p.week),'pricing',sportsbook_private.sportsbook_policy(l.id,p.nfl_season,p.week),'branding',jsonb_build_array(l.name,l.email_sender,l.sportsbook_url),
 'schedule',(select to_jsonb(s)-array['updated_at','automation_enabled','activation_requested','publication_paused']from public.weekly_schedule s where s.league_id=l.id))::text,'UTF8')),'hex')
 from public.leagues l cross join lateral public.sportsbook_period(l.id)p where l.id=p_league
$$;
create function public.observe_provider_capability(p_league uuid,p_source jsonb,p_report jsonb,p_build text,p_started timestamptz)returns jsonb language plpgsql security definer set search_path=''as $$
declare l public.leagues;source jsonb;rosters jsonb;h text;s sportsbook_private.provider_capability_state;begin
 if auth.role()is distinct from 'service_role'then raise exception 'Verified server observation only.';end if;
 if p_build is null or p_build!~'^[a-f0-9]{40}$'then raise exception 'Qualified build identity required.';end if;
 if p_started is null or p_started>clock_timestamp()+interval '30 seconds'or p_started<clock_timestamp()-interval '15 minutes'then raise exception 'Fresh server observation time required.';end if;
 perform sportsbook_private.validate_intake_source(p_source,p_report);
 perform pg_advisory_xact_lock(hashtextextended('provider-capability:'||p_league,0));
 select * into l from public.leagues where id=p_league for share;
 if not found or l.provider_contract is null or(l.sleeper_league_id is distinct from p_source->>'league_id'and not coalesce(p_source->>'previous_league_id'=l.sleeper_league_id and(p_source->>'season')::integer=l.nfl_season+1,false))then raise exception 'Imported provider identity required.';end if;
 if exists(select 1 from sportsbook_private.provider_capability_state where league_id=p_league and observed_at>p_started)then raise exception 'A newer provider observation already exists; retry with current inputs.';end if;
 source:=p_source-'teams';
 select jsonb_agg(jsonb_build_object('roster_id',t->'roster_id','owner_id',t->'owner_id','co_owner_ids',(select coalesce(jsonb_agg(value order by value),'[]')from jsonb_array_elements(t->'co_owner_ids')))order by(t->>'roster_id')::integer)into rosters from jsonb_array_elements(p_source->'teams')t;
 h:=encode(sha256(convert_to(jsonb_build_object('source',sportsbook_private.capability_source(source),'rosters',rosters,'configuration',sportsbook_private.provider_configuration_hash(p_league),'build',p_build)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('provider-capability:'||p_league,0));
 insert into sportsbook_private.provider_capability_state(league_id,source,rosters,observed_hash,observed_at,build_sha)values(p_league,source,rosters,h,p_started,p_build)
 on conflict(league_id)do update set source=excluded.source,rosters=excluded.rosters,observed_hash=excluded.observed_hash,observed_at=excluded.observed_at,build_sha=excluded.build_sha,
 approved_hash=case when sportsbook_private.provider_capability_state.observed_hash=excluded.observed_hash then sportsbook_private.provider_capability_state.approved_hash else null end,
 approved_by=case when sportsbook_private.provider_capability_state.observed_hash=excluded.observed_hash then sportsbook_private.provider_capability_state.approved_by else null end,
 approved_at=case when sportsbook_private.provider_capability_state.observed_hash=excluded.observed_hash then sportsbook_private.provider_capability_state.approved_at else null end;
 return jsonb_build_object('review_hash',h,'build_sha',p_build,'observed_at',p_started,'renewal_required',(p_source->>'season')::integer<>l.nfl_season);
end $$;
create function sportsbook_private.require_provider_capability(p_league uuid)returns void language plpgsql security definer set search_path=''as $$
declare l public.leagues;s sportsbook_private.provider_capability_state;h text;begin
 select * into l from public.leagues where id=p_league;if l.provider_contract is null then return;end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('provider-capability:'||p_league,0))then raise exception 'Provider review changed or is in progress; retry after review.';end if;
 select * into s from sportsbook_private.provider_capability_state where league_id=p_league;
 if not found then raise exception 'Provider capability review required.';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('source',sportsbook_private.capability_source(s.source),'rosters',s.rosters,'configuration',sportsbook_private.provider_configuration_hash(p_league),'build',s.build_sha)::text,'UTF8')),'hex');
 if s.approved_hash is null or s.approved_hash<>s.observed_hash or s.observed_hash<>h or(s.source->>'season')::integer<>l.nfl_season or s.observed_at<clock_timestamp()-interval '24 hours'then raise exception 'Provider rules, settings, season or review freshness changed; owner review required.';end if;
end $$;
create function public.provider_capability_review(p_league uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare s sportsbook_private.provider_capability_state;valid boolean;begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 select * into s from sportsbook_private.provider_capability_state where league_id=p_league;
 if not found then return jsonb_build_object('league_id',p_league,'state','observation_required');end if;
 valid:=s.approved_hash=s.observed_hash and s.observed_at>now()-interval '24 hours'and s.observed_hash=encode(sha256(convert_to(jsonb_build_object('source',sportsbook_private.capability_source(s.source),'rosters',s.rosters,'configuration',sportsbook_private.provider_configuration_hash(p_league),'build',s.build_sha)::text,'UTF8')),'hex')and(s.source->>'season')::integer=(select nfl_season from public.leagues where id=p_league);
 return jsonb_build_object('league_id',p_league,'state',case when coalesce(valid,false)then 'owner_reviewed'else 'review_required'end,'review_hash',s.observed_hash,'build_sha',s.build_sha,'observed_at',s.observed_at,'revision',s.revision,'season',s.source->'season',
 'current_season',(select nfl_season from public.leagues where id=p_league),'approval_current',coalesce(valid,false));
end $$;
create function public.approve_provider_capability(p_league uuid,p_hash text,p_expected integer,p_build text,p_reason text,p_coverage_reviewed boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare s sportsbook_private.provider_capability_state;l public.leagues;v jsonb;slots text[];begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 if p_reason is null or length(trim(p_reason))not between 8 and 400 or p_coverage_reviewed is distinct from true then raise exception 'Explicit projection/results coverage and supported house-rule review required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-capability:'||p_league,0));
 select * into l from public.leagues where id=p_league for update;select * into s from sportsbook_private.provider_capability_state where league_id=p_league for update;
 if s.approved_hash=p_hash and s.observed_hash=p_hash and exists(select 1 from sportsbook_private.provider_capability_decisions where league_id=p_league and revision=p_expected+1 and review_hash=p_hash and build_sha=p_build and actor=auth.uid()and reason=trim(p_reason))then
  perform sportsbook_private.require_provider_capability(p_league);return jsonb_build_object('revision',p_expected+1,'duplicate',true,'activation',false);
 end if;
 if s.league_id is null or s.observed_hash is distinct from p_hash or s.build_sha is distinct from p_build or s.revision is distinct from p_expected or s.observed_at<clock_timestamp()-interval '15 minutes'then raise exception 'Review changed or expired; prepare a fresh observation.';end if;
 if l.operations_enabled or exists(select 1 from public.weekly_schedule where league_id=p_league and automation_enabled)then raise exception 'Pause operations and automation first.';end if;
 if(s.source->>'season')::integer<>l.nfl_season then raise exception 'Renew the league season before approval.';end if;
 -- Declare support narrowly. Futures/draft compatibility needs separate rule evidence.
 select sportsbook_private.sportsbook_policy(l.id,p.nfl_season,p.week)->'values'into v from public.sportsbook_period(l.id)p;
 if(v->>'futures_enabled')::boolean then raise exception 'Imported capability profile supports reviewed weekly families only; disable season futures before approval.';end if;
 if(s.source->>'total_rosters')::integer not between 8 and 16 or(s.source->>'total_rosters')::integer%2<>0 then raise exception 'Supported even 8-16-team field required.';end if;
 if exists(select 1 from jsonb_array_elements_text(s.source->'positions')x where x not in('QB','RB','WR','TE','K','DEF','FLEX','SUPER_FLEX','REC_FLEX','WRRB_FLEX','BN','IR','TAXI'))or(select count(*)from jsonb_array_elements_text(s.source->'positions')x where x not in('BN','IR','TAXI'))>16 then raise exception 'Unsupported lineup profile.';end if;
 if coalesce((s.source->'settings'->>'divisions')::integer,0)>0 or coalesce((s.source->'settings'->>'league_average_match')::integer,0)>0 or coalesce((s.source->'settings'->>'playoff_round_type')::integer,0)>0 then raise exception 'Unsupported divisions, median wins or multiweek profile.';end if;
 if s.source->>'status' is distinct from 'in_season'then raise exception 'Current in-season provider status required.';end if;
 if s.revision>=64 then raise exception 'Capability decision budget reached.';end if;
 -- Recompute all configuration bindings before accepting the exact review.
 if s.observed_hash<>encode(sha256(convert_to(jsonb_build_object('source',sportsbook_private.capability_source(s.source),'rosters',s.rosters,'configuration',sportsbook_private.provider_configuration_hash(l.id),'build',s.build_sha)::text,'UTF8')),'hex')then raise exception 'Configuration changed; prepare a fresh review.';end if;
 update sportsbook_private.provider_capability_state set approved_hash=observed_hash,approved_by=auth.uid(),approved_at=clock_timestamp(),revision=revision+1 where league_id=p_league;
 insert into sportsbook_private.provider_capability_decisions(league_id,revision,review_hash,build_sha,actor,reason)values(p_league,s.revision+1,p_hash,p_build,auth.uid(),trim(p_reason));
 return jsonb_build_object('revision',s.revision+1,'owner_attested_coverage',true,'activation',false);
end $$;
create function public.renew_provider_season(p_league uuid,p_hash text,p_expected_season integer,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$
declare s sportsbook_private.provider_capability_state;l public.leagues;next_season integer;begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 if p_reason is null or length(trim(p_reason))not between 8 and 400 then raise exception 'Season renewal review reason required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-capability:'||p_league,0));
 select * into l from public.leagues where id=p_league for update;select * into s from sportsbook_private.provider_capability_state where league_id=p_league for update;
 if l.nfl_season is distinct from p_expected_season or s.observed_hash is distinct from p_hash or s.observed_at<clock_timestamp()-interval '15 minutes' then raise exception 'Renewal review changed or expired.';end if;
 next_season:=(s.source->>'season')::integer;
 if s.source->>'league_id'is distinct from l.sleeper_league_id and s.source->>'previous_league_id'is distinct from l.sleeper_league_id then raise exception 'Provider previous-season link changed.';end if;
 if next_season<>l.nfl_season+1 or l.league_season>=100 then raise exception 'Only the next supported NFL season can be renewed.';end if;
 if l.operations_enabled or exists(select 1 from public.weekly_schedule where league_id=p_league and automation_enabled)or exists(select 1 from public.tickets where league_id=p_league and status='OPEN')then raise exception 'Pause operations and resolve all open tickets before renewal.';end if;
 if(select jsonb_agg(roster_id order by roster_id)from public.teams where league_id=p_league)is distinct from(select jsonb_agg((x->>'roster_id')::integer order by(x->>'roster_id')::integer)from jsonb_array_elements(s.rosters)x)then raise exception 'Roster field changed; explicit team mapping review required.';end if;
 update public.sportsbook_boards set status='closed'where league_id=p_league and status<>'closed';
 update public.leagues set sleeper_league_id=s.source->>'league_id',nfl_season=next_season,league_season=league_season+1,active_week=1,week_anchor=clock_timestamp(),provider_contract=jsonb_build_object('version',1,'source',s.source,'capabilities',provider_contract->'capabilities','review_status','pending')where id=p_league;
 update sportsbook_private.provider_capability_state set approved_hash=null,approved_by=null,approved_at=null where league_id=p_league;
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)values(p_league,auth.uid(),'provider_season_renewal',trim(p_reason),jsonb_build_object('nfl_season',l.nfl_season,'league_season',l.league_season),jsonb_build_object('nfl_season',next_season,'league_season',l.league_season+1,'financial_changes',false,'activation',false));
 return jsonb_build_object('nfl_season',next_season,'activation',false,'financial_changes',false,'fresh_review_required',true);
end $$;
revoke all on function public.renew_provider_season(uuid,text,integer,text)from public,anon,service_role;
grant execute on function public.renew_provider_season(uuid,text,integer,text)to authenticated;
create or replace function sportsbook_private.intake_operation_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.provider_contract is not null and new.operations_enabled then perform sportsbook_private.require_provider_capability(new.id);end if;return new;
end $$;
create function sportsbook_private.provider_ticket_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.source_batch is null then perform sportsbook_private.require_provider_capability(new.league_id);end if;return new;
end $$;
create trigger provider_ticket_guard before insert on public.tickets for each row execute function sportsbook_private.provider_ticket_guard();
create function sportsbook_private.provider_publication_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.status='published'then perform sportsbook_private.require_provider_capability(new.league_id);end if;return new;
end $$;
create trigger provider_publication_guard before insert or update of status on public.sportsbook_boards for each row execute function sportsbook_private.provider_publication_guard();
revoke all on function sportsbook_private.provider_configuration_hash(uuid),sportsbook_private.require_provider_capability(uuid),sportsbook_private.provider_ticket_guard(),sportsbook_private.provider_publication_guard()from public,anon,authenticated,service_role;
revoke all on function public.observe_provider_capability(uuid,jsonb,jsonb,text,timestamptz)from public,anon,authenticated;
grant execute on function public.observe_provider_capability(uuid,jsonb,jsonb,text,timestamptz)to service_role;
revoke all on function public.provider_capability_review(uuid),public.approve_provider_capability(uuid,text,integer,text,text,boolean)from public,anon,service_role;
grant execute on function public.provider_capability_review(uuid),public.approve_provider_capability(uuid,text,integer,text,text,boolean)to authenticated;
commit;

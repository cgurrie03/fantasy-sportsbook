begin;
create table sportsbook_private.opening_editorial_editions(
 league_id uuid primary key references public.leagues,
 current_document jsonb not null check(octet_length(current_document::text)<=65536),
 previous_document jsonb check(previous_document is null or octet_length(previous_document::text)<=65536),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp());
alter table sportsbook_private.opening_editorial_editions enable row level security;
revoke all on sportsbook_private.opening_editorial_editions from public,anon,authenticated,service_role;

create function public.opening_editorial_context(p_league uuid,p_season integer,p_week integer,p_window_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;e sportsbook_private.opening_editorial_editions;previous jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Editorial worker only.';end if;
 c:=public.notification_window(p_league,p_season,p_week,'opening');
 if c->>'eligible' is distinct from 'true' or c->>'window_key' is distinct from p_window_key then raise exception 'Current opening window required for editorial evidence.';end if;
 select * into e from sportsbook_private.opening_editorial_editions where league_id=p_league;
 if e.current_document->'facts'->>'window_key'=p_window_key and e.current_document->'facts'->>'nfl_season'=p_season::text and e.current_document->'facts'->>'market_week'=p_week::text then return jsonb_build_object('current',e.current_document,'previous',null);end if;
 if e.current_document->'facts'->>'nfl_season'=p_season::text then
  if e.current_document->'facts'->>'market_week'=p_week::text then previous:=e.previous_document;
  elsif (e.current_document->'facts'->>'market_week')::integer=p_week-1 then previous:=e.current_document;end if;
 end if;
 return jsonb_build_object('current',case when e.current_document->'facts'->>'window_key'=p_window_key and e.current_document->'facts'->>'nfl_season'=p_season::text and e.current_document->'facts'->>'market_week'=p_week::text then e.current_document else null end,'previous',previous);
end $$;
revoke all on function public.opening_editorial_context(uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.opening_editorial_context(uuid,integer,integer,text) to service_role;

create function public.publish_opening_editorial(p_league uuid,p_document jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f jsonb:=p_document->'facts';s jsonb;x jsonb;c jsonb;b public.sportsbook_boards;l public.leagues;e sportsbook_private.opening_editorial_editions;
 previous jsonb;scope_ids text[];begin
 if auth.role() is distinct from 'service_role' then raise exception 'Editorial worker only.';end if;
 if p_document->>'contract' is distinct from 'opening-editorial-edition-v1' or f->>'contract' is distinct from 'opening-editorial-facts-v1'
  or jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'prepared_at') is distinct from 'string' or not(f ?& array['contract','league_id','nfl_season','league_season','market_week','board_id','board_revision','window_key','prepared_at','team_ids','teams','matchups','championship']) or f->>'league_id' is distinct from p_league::text or octet_length(p_document::text)>65536
  or exists(select 1 from jsonb_object_keys(p_document)k where k not in('contract','facts','stories'))
  or exists(select 1 from jsonb_object_keys(f)k where k not in('contract','league_id','nfl_season','league_season','market_week','board_id','board_revision','window_key','prepared_at','team_ids','teams','matchups','championship'))
 then raise exception 'Invalid bounded editorial document.';end if;
 if exists(select 1 from unnest(array['team_ids','teams','matchups','championship'])k where jsonb_typeof(f->k) is distinct from 'array')
  or jsonb_array_length(f->'team_ids')>128 or jsonb_array_length(f->'teams')>128 or jsonb_array_length(f->'matchups')>64 or jsonb_array_length(f->'championship')>16
  or jsonb_typeof(p_document->'stories') is distinct from 'array' or jsonb_array_length(p_document->'stories')>3
 then raise exception 'Editorial segment budget exceeded.';end if;
 perform pg_advisory_xact_lock(hashtextextended('opening-editorial:'||p_league,0));
 select * into l from public.leagues where id=p_league;
 select * into b from public.sportsbook_boards where id=(f->>'board_id')::uuid and league_id=p_league for share;
 if not found or f->>'nfl_season' is distinct from l.nfl_season::text or f->>'league_season' is distinct from l.league_season::text
  or f->>'board_revision' is distinct from b.revision::text or (f->>'prepared_at')::timestamptz<now()-interval '5 minutes' or (f->>'prepared_at')::timestamptz>now()+interval '30 seconds'
 then raise exception 'Editorial source revision or preparation time changed.';end if;
 c:=public.notification_window(p_league,l.nfl_season,(f->>'market_week')::integer,'opening');
 if c->>'eligible' is distinct from 'true' or c->>'window_key' is distinct from f->>'window_key' or c->>'board_id' is distinct from b.id::text then raise exception 'Opening window changed before editorial publication.';end if;
 select coalesce(array_agg(id::text order by id),'{}') into scope_ids from public.teams where league_id=p_league;
 if jsonb_array_length(f->'team_ids')<>cardinality(scope_ids) or exists(select 1 from jsonb_array_elements_text(f->'team_ids')t where t<>all(scope_ids))
  or (select count(distinct t) from jsonb_array_elements_text(f->'team_ids')t)<>cardinality(scope_ids) then raise exception 'Editorial team field changed.';end if;
 for x in select value from jsonb_array_elements(f->'teams') loop
  if coalesce(x->>'id','')<>all(scope_ids) or jsonb_typeof(x->'name') is distinct from 'string' or octet_length(x->>'name')>160 or jsonb_typeof(x->'projected') is distinct from 'number' or (x->>'projected')::numeric<=0 or (x->>'projected')::numeric>1000
   or not exists(select 1 from public.sportsbook_markets q where q.board_id=b.id and q.active and q.kind='spread' and ((q.home_team_id::text=x->>'id' and abs(q.home_projection-(x->>'projected')::numeric)<.000001)or(q.away_team_id::text=x->>'id' and abs(q.away_projection-(x->>'projected')::numeric)<.000001)))
   or exists(select 1 from jsonb_object_keys(x)k where k not in('id','name','projected')) then raise exception 'Invalid team forecast evidence.';end if;
 end loop;
 for x in select value from jsonb_array_elements(f->'matchups') loop
  if jsonb_typeof(x->'id') is distinct from 'string' or length(x->>'id')>160 or coalesce(x->>'home','')<>all(scope_ids) or coalesce(x->>'away','')<>all(scope_ids) or x->>'home'=x->>'away'
   or jsonb_typeof(x->'home_projected') is distinct from 'number' or jsonb_typeof(x->'away_projected') is distinct from 'number'
   or (x->>'home_projected')::numeric not between .000001 and 1000 or (x->>'away_projected')::numeric not between .000001 and 1000
   or coalesce(x->>'featured','') not in('','Game of the Week','Tank Bowl')
   or not exists(select 1 from public.sportsbook_markets q where q.board_id=b.id and q.active and q.kind='spread' and q.matchup_key=x->>'id' and q.home_team_id::text=x->>'home' and q.away_team_id::text=x->>'away' and abs(q.home_projection-(x->>'home_projected')::numeric)<.000001 and abs(q.away_projection-(x->>'away_projected')::numeric)<.000001 and (x->>'featured' is null or q.featured=x->>'featured'))
   or exists(select 1 from jsonb_object_keys(x)k where k not in('id','home','away','home_projected','away_projected','featured'))
  then raise exception 'Invalid paired forecast evidence.';end if;
 end loop;
 for x in select value from jsonb_array_elements(f->'championship') loop
  if coalesce(x->>'id','')<>all(scope_ids) or jsonb_typeof(x->'team') is distinct from 'string' or jsonb_typeof(x->'owner') is distinct from 'string'
   or octet_length(x->>'team')>160 or octet_length(x->>'owner')>80 or jsonb_typeof(x->'odds') is distinct from 'number'
   or (x->>'odds')::numeric=0 or abs((x->>'odds')::numeric)>1000000 or (x->>'odds')::numeric<>trunc((x->>'odds')::numeric)
   or not exists(select 1 from public.sportsbook_markets q join public.sportsbook_boards z on z.id=q.board_id where z.league_id=p_league and z.nfl_season=l.nfl_season and z.board_type='future' and z.status='published' and z.opens_at<=now() and z.closes_at>now() and q.active and q.kind='future_champion' and q.team_id::text=x->>'id' and q.odds=(x->>'odds')::integer)
   or exists(select 1 from jsonb_object_keys(x)k where k not in('id','team','owner','odds')) then raise exception 'Invalid saved championship evidence.';end if;
 end loop;
 if (select count(distinct elem.value->>'id') from jsonb_array_elements(f->'teams')as elem(value))<>jsonb_array_length(f->'teams')
  or (select count(distinct elem.value->>'id') from jsonb_array_elements(f->'matchups')as elem(value))<>jsonb_array_length(f->'matchups')
  or (select count(distinct elem.value->>'id') from jsonb_array_elements(f->'championship')as elem(value))<>jsonb_array_length(f->'championship') then raise exception 'Editorial evidence identities must be unique.';end if;
 for s in select value from jsonb_array_elements(p_document->'stories') loop
  if jsonb_typeof(s->'key') is distinct from 'string' or length(s->>'key')>80 or jsonb_typeof(s->'group') is distinct from 'string' or length(s->>'group')>40
   or jsonb_typeof(s->'title') is distinct from 'string' or octet_length(s->>'title')>160 or jsonb_typeof(s->'text') is distinct from 'string' or octet_length(s->>'text')>4096
   or jsonb_typeof(s->'evidence') is distinct from 'array' or jsonb_array_length(s->'evidence')>8
   or exists(select 1 from jsonb_array_elements_text(s->'evidence')t where t<>all(scope_ids))
   or exists(select 1 from jsonb_object_keys(s)k where k not in('key','group','title','text','evidence')) then raise exception 'Invalid bounded editorial story.';end if;
 end loop;
 if (select count(distinct elem.value->>'group') from jsonb_array_elements(p_document->'stories')as elem(value))<>jsonb_array_length(p_document->'stories') then raise exception 'Editorial topics must be diverse.';end if;
 select * into e from sportsbook_private.opening_editorial_editions where league_id=p_league;
 if e.current_document->'facts'->>'nfl_season'=f->>'nfl_season' and e.current_document->'facts'->>'league_season'=f->>'league_season' then
  if (e.current_document->'facts'->>'market_week')::integer>(f->>'market_week')::integer then raise exception 'Editorial history cannot be rewound.';end if;
  if e.current_document->'facts'->>'market_week'=f->>'market_week' then
   if e.current_document->'facts'->>'window_key'=f->>'window_key' then return e.current_document;end if;
   previous:=e.previous_document;
  elsif (e.current_document->'facts'->>'market_week')::integer=(f->>'market_week')::integer-1 then previous:=e.current_document;end if;
 end if;
 insert into sportsbook_private.opening_editorial_editions(league_id,current_document,previous_document)values(p_league,p_document,previous)
 on conflict(league_id)do update set current_document=excluded.current_document,previous_document=excluded.previous_document,revision=opening_editorial_editions.revision+1,updated_at=clock_timestamp();
 return p_document;
end $$;
revoke all on function public.publish_opening_editorial(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_opening_editorial(uuid,jsonb) to service_role;
commit;

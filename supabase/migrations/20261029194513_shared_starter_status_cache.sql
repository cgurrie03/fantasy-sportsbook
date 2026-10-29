begin;
create table public.starter_status_cache (
 scope text not null check(scope in ('state','games','players','league')),
 cache_key text not null,
 context text not null check(length(context)=64),
 payload jsonb,
 checked_at timestamptz,
 expires_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 retry_after timestamptz,
 primary key(scope,cache_key),
 check((scope='league' and cache_key ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') or (scope<>'league' and cache_key='current')),
 check(payload is null or octet_length(payload::text)<=case scope when 'players' then 1048576 when 'games' then 131072 when 'state' then 16384 else 32768 end)
);
alter table public.starter_status_cache enable row level security;
revoke all on public.starter_status_cache from public,anon,authenticated;
grant select,insert,update,delete on public.starter_status_cache to service_role;

create function public.starter_status_access(p_league uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('sleeper_league_id',l.sleeper_league_id,'nfl_season',l.nfl_season)
 from public.leagues l where l.id=p_league and sportsbook_private.is_member(l.id)
$$;
revoke all on function public.starter_status_access(uuid) from public,anon,service_role;
grant execute on function public.starter_status_access(uuid) to authenticated;

-- Only service calls can coordinate public provider data / private league display
-- results. Memberships and credentials are never stored. No financial privileges.
create function public.claim_starter_status(p_scope text,p_key text,p_context text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.starter_status_cache;v_token uuid:=gen_random_uuid();v_now timestamptz:=clock_timestamp();
begin
 select * into r from public.starter_status_cache where scope=p_scope and cache_key=p_key;
 if r.context=p_context and r.expires_at>v_now and r.payload is not null then
  return jsonb_build_object('state','hit','payload',r.payload,'checked_at',r.checked_at);end if;
 perform pg_advisory_xact_lock(hashtextextended('starter-status-cache',0));
 select * into r from public.starter_status_cache where scope=p_scope and cache_key=p_key for update;
 if r.context=p_context then
  if r.expires_at>v_now and r.payload is not null then return jsonb_build_object('state','hit','payload',r.payload,'checked_at',r.checked_at);end if;
  if r.lease_until>v_now then return jsonb_build_object('state','busy');end if;
  if r.retry_after>v_now then return jsonb_build_object('state','unavailable');end if;
 end if;
 if r.scope is null then
  delete from public.starter_status_cache where (scope,cache_key) in
   (select scope,cache_key from public.starter_status_cache where coalesce(expires_at,'-infinity')<v_now
    and coalesce(lease_until,'-infinity')<v_now and coalesce(retry_after,'-infinity')<v_now
    order by expires_at nulls first limit 20);
  if (select count(*) from public.starter_status_cache)>=131 then raise exception 'Starter cache admission budget reached';end if;
 end if;
 insert into public.starter_status_cache(scope,cache_key,context,lease_token,lease_until)
 values(p_scope,p_key,p_context,v_token,v_now+interval '25 seconds')
 on conflict(scope,cache_key) do update set context=excluded.context,payload=null,checked_at=null,expires_at=null,
  lease_token=excluded.lease_token,lease_until=excluded.lease_until,retry_after=null;
 return jsonb_build_object('state','claimed','token',v_token);
end $$;

create function public.publish_starter_status(p_scope text,p_key text,p_context text,p_token uuid,p_payload jsonb,p_checked timestamptz) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp();v_ttl interval;v_size bigint;
begin
 if p_payload is null or p_checked is null or p_checked>v_now+interval '1 second' then raise exception 'Invalid starter cache observation';end if;
 v_ttl:=case p_scope when 'players' then interval '1 day' when 'league' then interval '30 seconds' else interval '15 seconds' end;
 if p_checked+v_ttl<=v_now then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('starter-status-cache',0));
 if not exists(select 1 from public.starter_status_cache where scope=p_scope and cache_key=p_key and context=p_context
  and lease_token=p_token and lease_until>v_now) then return false;end if;
 select coalesce(sum(octet_length(payload::text)),0) into v_size from public.starter_status_cache where (scope,cache_key)<>(p_scope,p_key);
 if v_size+octet_length(p_payload::text)>8388608 then raise exception 'Starter cache byte budget reached';end if;
 update public.starter_status_cache set payload=p_payload,checked_at=p_checked,expires_at=p_checked+v_ttl,
  lease_token=null,lease_until=null,retry_after=null
  where scope=p_scope and cache_key=p_key and context=p_context and lease_token=p_token;
 return found;
end $$;

create function public.fail_starter_status(p_scope text,p_key text,p_context text,p_token uuid) returns void
language sql security invoker set search_path=public,pg_temp as $$
 update public.starter_status_cache set payload=null,expires_at=null,lease_until=null,lease_token=null,retry_after=clock_timestamp()+interval '15 seconds'
 where scope=p_scope and cache_key=p_key and context=p_context and lease_token=p_token
$$;
revoke all on function public.claim_starter_status(text,text,text),public.publish_starter_status(text,text,text,uuid,jsonb,timestamptz),
 public.fail_starter_status(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_starter_status(text,text,text),public.publish_starter_status(text,text,text,uuid,jsonb,timestamptz),
 public.fail_starter_status(text,text,text,uuid) to service_role;
commit;

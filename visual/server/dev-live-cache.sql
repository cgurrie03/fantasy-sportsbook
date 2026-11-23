-- Dev-only, bounded current-state storage. No tickets, wallets, email, or production worker changes.
do $$ begin
 if public.application_environment_identity()->>'project_ref' <> 'whlcnlacueweaqpsupqs'
    or public.application_environment_identity()->>'environment' <> 'development' then raise exception 'Dev project required'; end if;
end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table public.dev_live_cache (
 key text primary key check (key in ('control','nfl','league:1312126153980391424')),
 payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 131072),
 fetched_at timestamptz,
 next_refresh_at timestamptz not null default now(),
 lease_until timestamptz not null default 'epoch',
 refresh_count bigint not null default 0,
 error_code text check (length(error_code)<=80)
);
alter table public.dev_live_cache enable row level security;
revoke all on public.dev_live_cache from public,anon,authenticated;
grant select,insert,update on public.dev_live_cache to service_role;
do $$ declare token text := encode(extensions.gen_random_bytes(32),'hex'); begin
 perform vault.create_secret(token,'boff_dev_live_refresh_token','Dev-only bounded refresh; never used for production');
 insert into public.dev_live_cache(key,payload) values('control',jsonb_build_object('tokenHash',encode(extensions.digest(token,'sha256'),'hex')));
end $$;
insert into public.dev_live_cache(key) values('nfl'),('league:1312126153980391424');
create schema if not exists boff_dev_internal;
revoke all on schema boff_dev_internal from public,anon,authenticated;
create function boff_dev_internal.request_live_refresh() returns bigint language plpgsql security invoker set search_path='' as $$
declare request_id bigint;
begin
 if public.application_environment_identity()->>'project_ref' <> 'whlcnlacueweaqpsupqs' then raise exception 'Dev only'; end if;
 if not exists(select 1 from public.dev_live_cache where key='nfl' and next_refresh_at<=now() and lease_until<=now()) then return null; end if;
 select net.http_post(
  url:='https://whlcnlacueweaqpsupqs.supabase.co/functions/v1/boff-dev-live-refresh',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='boff_dev_live_refresh_token')),
  body:='{}'::jsonb,timeout_milliseconds:=45000
 ) into request_id;
 -- Keep this job's scheduler history bounded; pg_net responses expire after six hours.
 delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname='boff-dev-live-refresh') and start_time<now()-interval '24 hours';
 return request_id;
end $$;
revoke all on function boff_dev_internal.request_live_refresh() from public,anon,authenticated,service_role;
select cron.schedule('boff-dev-live-refresh','*/5 * * * *','select boff_dev_internal.request_live_refresh()');

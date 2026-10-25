-- Run as the database owner after placing WEEKLY_WORKER_SECRET in Vault under
-- the name sportsbook_weekly_worker. The secret is never checked into Git.
create extension if not exists pg_cron;
create extension if not exists pg_net;
revoke all on net.http_request_queue,net._http_response from anon,authenticated;
create or replace function sportsbook_private.dispatch_weekly_worker() returns bigint
language plpgsql security definer set search_path='' as $$
declare secret text; request_id bigint; probe record; valid boolean:=false;
begin
 if not exists(select 1 from public.weekly_schedule where automation_enabled or activation_requested) then return null; end if;
 for probe in select s.league_id,r.status_code,r.content from public.weekly_schedule s join net._http_response r on r.id=s.worker_probe_id where s.activation_requested loop
  begin valid:=probe.status_code=200 and (probe.content::jsonb->>'ready')='true' and (probe.content::jsonb->>'email_configured')='true'; exception when others then valid:=false; end;
  if valid then update public.weekly_schedule set automation_enabled=true,activation_requested=false where league_id=probe.league_id; end if;
 end loop;
 select decrypted_secret into secret from vault.decrypted_secrets where name='sportsbook_weekly_worker';
 if secret is null then raise exception 'Scheduled worker secret is missing.'; end if;
 select net.http_post(
  url:='https://sportsbook.coopergurrie.com/api/weekly-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',secret),
  body:=case when exists(select 1 from public.weekly_schedule where automation_enabled) then '{}'::jsonb else '{"check":true}'::jsonb end,timeout_milliseconds:=130000
 ) into request_id;
 update public.weekly_schedule set worker_probe_id=request_id where activation_requested;
 return request_id;
end $$;
revoke all on function sportsbook_private.dispatch_weekly_worker() from public,anon,authenticated,service_role;
select cron.schedule('sportsbook-weekly-worker','* * * * *','select sportsbook_private.dispatch_weekly_worker();');
-- Set activation_requested=true after setup. The scheduler enables automation
-- only when a protected health check confirms the new deployment is ready.

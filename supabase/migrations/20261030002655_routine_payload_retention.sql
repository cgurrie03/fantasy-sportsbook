begin;
-- Existing rows stay version zero until separately approved conversion. Durable
-- event keys, delivery receipts, job IDs and all financial records are exempt.
alter table public.outbound_emails add column retention_version integer not null default 0,
 add column terminal_at timestamptz, add column body_retired_at timestamptz,
 add column payload_bytes integer generated always as (coalesce(octet_length(payload::text),0)) stored;
alter table public.outbound_emails alter column retention_version set default 1;
alter table public.automation_jobs add column retention_version integer not null default 0,
 add column diagnostic_retired_at timestamptz,
 add column summary_bytes integer generated always as (coalesce(octet_length(summary::text),0)) stored;
alter table public.automation_jobs alter column retention_version set default 1;
alter table public.promo_images add column retention_version integer not null default 0,
 add column png_bytes integer generated always as (octet_length(png)) stored;
alter table public.promo_images alter column retention_version set default 1;
create index routine_email_due on public.outbound_emails(terminal_at,id)
 where retention_version=1 and body_retired_at is null and status in ('sent','captured','skipped');
create index routine_job_due on public.automation_jobs(completed_at,id)
 where retention_version=1 and diagnostic_retired_at is null and status='done';
create index routine_image_due on public.promo_images(created_at,id) where retention_version=1;
create index routine_email_bytes on public.outbound_emails(league_id) include(payload_bytes) where payload is not null;
create index routine_job_bytes on public.automation_jobs(league_id) include(summary_bytes) where diagnostic_retired_at is null;

-- Removing a body cannot change its recipient. Do not let a subsequently
-- revoked membership prevent retirement of an already terminal body.
do $$declare d text;anchor text:='begin';begin
 select pg_get_functiondef('sportsbook_private.guard_outbox_recipient()'::regprocedure) into d;
 if position(anchor in d)=0 then raise exception 'Recipient guard anchor changed.';end if;
 execute replace(d,anchor,anchor||$guard$
 if tg_op='UPDATE' and new.payload is null and old.payload is not null
  and row(new.league_id,new.team_id,new.ticket_id,new.recipient,new.kind) is not distinct from
      row(old.league_id,old.team_id,old.ticket_id,old.recipient,old.kind) then return new;end if;
 $guard$);
end $$;

create function sportsbook_private.routine_payload_admission() returns trigger
language plpgsql security definer set search_path='' as $$
declare total bigint; scoped bigint; n integer;begin
 if tg_op='INSERT' then new.retention_version:=1;
 elsif new.retention_version<>old.retention_version then raise exception 'Retention version is immutable.';end if;
 if tg_table_name='outbound_emails' then
  if tg_op='UPDATE' and old.body_retired_at is not null and
    (new.payload is not null or new.status is distinct from old.status or new.body_retired_at is distinct from old.body_retired_at) then
   raise exception 'Retired email cannot be resent or regenerated.';end if;
  if new.status in ('sent','captured','skipped') then
   if tg_op='INSERT' then new.terminal_at:=coalesce(new.sent_at,clock_timestamp());
   elsif old.status not in ('sent','captured','skipped') then
    new.terminal_at:=case when new.sent_at is distinct from old.sent_at then coalesce(new.sent_at,clock_timestamp()) else clock_timestamp() end;
   elsif new.terminal_at is null then new.terminal_at:=clock_timestamp();end if;
  end if;
  if tg_op='INSERT' or new.payload is distinct from old.payload then
   if new.payload is not null then
    perform pg_advisory_xact_lock(83801201);
    n:=octet_length(new.payload::text);
    select coalesce(sum(payload_bytes),0),coalesce(sum(payload_bytes) filter(where league_id=new.league_id),0)
     into total,scoped from public.outbound_emails where id<>new.id and payload is not null;
    if n>262144 or scoped+n>8388608 or total+n>33554432 then raise exception 'Email body capacity reached; provider delivery was not authorized.';end if;
   end if;
  end if;
 elsif tg_table_name='automation_jobs' then
  if tg_op='INSERT' or new.summary is distinct from old.summary then
   if new.summary is not null then
    perform pg_advisory_xact_lock(83801202);
    n:=octet_length(new.summary::text);
    select coalesce(sum(summary_bytes),0),coalesce(sum(summary_bytes) filter(where league_id=new.league_id),0)
     into total,scoped from public.automation_jobs where id<>new.id and diagnostic_retired_at is null;
    if n>65536 or scoped+n>4194304 or total+n>16777216 then
     new.summary:=jsonb_build_object('detail_unavailable',true,'reason','Routine diagnostic capacity','original_bytes',n,'digest',md5(new.summary::text));
     new.diagnostic_retired_at:=clock_timestamp();
    elsif tg_op='UPDATE' and old.diagnostic_retired_at is not null and new.diagnostic_retired_at is not distinct from old.diagnostic_retired_at then
     new.diagnostic_retired_at:=null;
    end if;
   end if;
  end if;
 elsif tg_table_name='promo_images' then
  if tg_op='INSERT' or new.png is distinct from old.png then
   perform pg_advisory_xact_lock(83801203);
   select coalesce(sum(png_bytes),0),coalesce(sum(png_bytes) filter(where league_id=new.league_id),0),count(*) filter(where league_id=new.league_id)
    into total,scoped,n from public.promo_images where id<>new.id;
   if scoped+octet_length(new.png)>33554432 or total+octet_length(new.png)>67108864 or n>=128 then
    raise exception 'Promotion image capacity reached.';end if;
  end if;
 end if;
 if tg_table_name in ('outbound_emails','automation_jobs') then new.last_error:=left(new.last_error,256);end if;
 return new;
end $$;
revoke all on function sportsbook_private.routine_payload_admission() from public,anon,authenticated,service_role;
create trigger routine_admission before insert or update on public.outbound_emails for each row execute function sportsbook_private.routine_payload_admission();
create trigger routine_admission before insert or update on public.automation_jobs for each row execute function sportsbook_private.routine_payload_admission();
create trigger routine_admission before insert or update on public.promo_images for each row execute function sportsbook_private.routine_payload_admission();

-- Fixed cleanup authority cannot read or mutate wallets, tickets, ledger,
-- weekly_execution_runs, accepted offers or email_deliveries.
create role boff_routine_retention nologin noinherit;
grant usage on schema public,sportsbook_private to boff_routine_retention;
grant select on public.outbound_emails,public.automation_jobs,public.promo_images,public.promo_offers to boff_routine_retention;
grant update(payload,body_retired_at,last_error) on public.outbound_emails to boff_routine_retention;
grant update(summary,diagnostic_retired_at,last_error) on public.automation_jobs to boff_routine_retention;
grant delete on public.promo_images to boff_routine_retention;
-- PostgreSQL row locks require an UPDATE privilege; the fixed function never
-- changes this column. No role membership or function API exposes arbitrary SQL.
grant update(created_at) on public.promo_images to boff_routine_retention;
create policy routine_read on public.outbound_emails for select to boff_routine_retention using(true);
create policy routine_update on public.outbound_emails for update to boff_routine_retention using(true) with check(true);
create policy routine_read on public.automation_jobs for select to boff_routine_retention using(true);
create policy routine_update on public.automation_jobs for update to boff_routine_retention using(true) with check(true);
create policy routine_read on public.promo_images for select to boff_routine_retention using(true);
create policy routine_delete on public.promo_images for delete to boff_routine_retention using(true);
create policy routine_lock on public.promo_images for update to boff_routine_retention using(true) with check(true);
create policy routine_read on public.promo_offers for select to boff_routine_retention using(true);

create function sportsbook_private.cleanup_routine_payloads(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' set row_security='on' set statement_timeout='2s' set lock_timeout='200ms' as $$
declare emails integer;jobs integer;images integer;lim integer:=least(25,greatest(1,coalesce(p_limit,10)));begin
 with due as (select id from public.outbound_emails where retention_version=1 and body_retired_at is null
  and status in ('sent','captured','skipped') and terminal_at<clock_timestamp()-interval '7 days'
  and (lease_until is null or lease_until<clock_timestamp()) order by terminal_at,id limit lim for update skip locked)
 update public.outbound_emails e set payload=null,body_retired_at=clock_timestamp(),last_error=null from due where e.id=due.id;
 get diagnostics emails=row_count;
 with due as (select id from public.automation_jobs where retention_version=1 and diagnostic_retired_at is null
  and status='done' and completed_at<clock_timestamp()-interval '30 days'
  and (lease_until is null or lease_until<clock_timestamp()) order by completed_at,id limit lim for update skip locked)
 update public.automation_jobs j set summary=jsonb_build_object('detail_unavailable',true,'reason','Completed diagnostic expired',
  'original_bytes',j.summary_bytes,'digest',md5(j.summary::text)),diagnostic_retired_at=clock_timestamp(),last_error=null from due where j.id=due.id;
 get diagnostics jobs=row_count;
 with due as (select i.id from public.promo_images i where retention_version=1 and created_at<clock_timestamp()-interval '7 days'
  and not exists(select 1 from public.promo_offers o where o.image_id=i.id and o.league_id=i.league_id)
  order by created_at,id limit lim for update skip locked)
 delete from public.promo_images i using due where i.id=due.id;
 get diagnostics images=row_count;
 return jsonb_build_object('retired_email_bodies',emails,'retired_job_diagnostics',jobs,'removed_orphan_images',images,'batch_limit',lim);
end $$;
revoke all on function sportsbook_private.cleanup_routine_payloads(integer) from public,anon,authenticated,service_role;
grant execute on function sportsbook_private.cleanup_routine_payloads(integer) to postgres;
grant create on schema sportsbook_private to boff_routine_retention;
grant boff_routine_retention to postgres;
alter function sportsbook_private.cleanup_routine_payloads(integer) owner to boff_routine_retention;
revoke create on schema sportsbook_private from boff_routine_retention;
revoke boff_routine_retention from postgres;
create function public.cleanup_routine_payloads(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='3s' set lock_timeout='200ms' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 return sportsbook_private.cleanup_routine_payloads(p_limit);
end $$;
revoke all on function public.cleanup_routine_payloads(integer) from public,anon,authenticated;
grant execute on function public.cleanup_routine_payloads(integer) to service_role;
comment on function public.cleanup_routine_payloads(integer) is 'Prospective routine bodies only; preserves unresolved mail, retries, duplicate keys, financial audits and referenced promotion art. No legacy conversion.';
create function public.routine_retention_status(p_league uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League operator only.';end if;
 return jsonb_build_object('logical_bytes_only',true,'email',(select jsonb_build_object(
  'body_bytes',coalesce(sum(payload_bytes),0),'league_budget',8388608,
  'due',count(*) filter(where retention_version=1 and body_retired_at is null and status in ('sent','captured','skipped') and terminal_at<clock_timestamp()-interval '7 days'),
  'unresolved',count(*) filter(where payload is not null and status in ('pending','sending','failed','needs_review')),
  'last_retirement',max(body_retired_at)) from public.outbound_emails where league_id=p_league),
 'jobs',(select jsonb_build_object('detail_bytes',coalesce(sum(summary_bytes) filter(where diagnostic_retired_at is null),0),'league_budget',4194304,
  'due',count(*) filter(where retention_version=1 and diagnostic_retired_at is null and status='done' and completed_at<clock_timestamp()-interval '30 days'),
  'last_retirement',max(diagnostic_retired_at)) from public.automation_jobs where league_id=p_league),
 'images',(select jsonb_build_object('stored_text_bytes',coalesce(sum(png_bytes),0),'count',count(*),'league_budget',33554432,'league_count_budget',128)
  from public.promo_images where league_id=p_league));
end $$;
revoke all on function public.routine_retention_status(uuid) from public,anon,service_role;
grant execute on function public.routine_retention_status(uuid) to authenticated;
-- Status can aggregate sizes without granting access to PNG/base64 bodies.
grant select(id,league_id,png_bytes) on public.promo_images to authenticated;
create policy routine_image_status on public.promo_images for select to authenticated using(sportsbook_private.is_admin(league_id));
commit;

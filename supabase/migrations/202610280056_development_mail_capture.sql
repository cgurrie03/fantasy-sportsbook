begin;
alter table public.outbound_emails drop constraint outbound_emails_status_check;
alter table public.outbound_emails add constraint outbound_emails_status_check
  check(status in ('pending','sending','sent','failed','needs_review','skipped','captured'));
alter table public.email_deliveries drop constraint email_deliveries_status_check;
alter table public.email_deliveries add constraint email_deliveries_status_check
  check(status in ('pending','sent','failed','captured'));

create table sportsbook_private.development_mail_captures (
  email_id uuid primary key references public.outbound_emails(id),
  payload jsonb not null check(octet_length(payload::text) <= 131072),
  created_at timestamptz not null default now()
);
create index development_mail_captures_expiry_idx
  on sportsbook_private.development_mail_captures(created_at,email_id);
alter table sportsbook_private.development_mail_captures enable row level security;
revoke all on sportsbook_private.development_mail_captures from public,anon,authenticated,service_role;

create function public.capture_development_email(p_email uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_email public.outbound_emails;
begin
  if auth.role() is distinct from 'service_role' or not exists (
    select 1 from sportsbook_private.application_environment where singleton
      and environment='development' and project_ref='whlcnlacueweaqpsupqs') then
    raise exception 'Development capture requires the development server.';
  end if;
  -- Serialize the small global cap, including concurrent worker invocations.
  perform pg_advisory_xact_lock(20261028,56);
  select * into v_email from public.outbound_emails where id=p_email for update;
  if not found then raise exception 'Unknown outbox email.'; end if;
  if v_email.status='captured' then return; end if;
  if v_email.status<>'sending' then raise exception 'Email must be claimed before capture.'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_payload->'to' is distinct from jsonb_build_array(v_email.recipient)
    or p_payload ? 'cc' or p_payload ? 'bcc' then
    raise exception 'Capture recipient mismatch.';
  end if;
  delete from sportsbook_private.development_mail_captures
    where created_at < now()-interval '7 days';
  insert into sportsbook_private.development_mail_captures(email_id,payload)
    values(p_email,p_payload);
  delete from sportsbook_private.development_mail_captures where email_id in (
    select email_id from sportsbook_private.development_mail_captures
      order by created_at desc,email_id desc offset 20);
  update public.outbound_emails set status='captured',payload=null,
    provider_id=null,sent_at=null,last_error=null,lease_until=null where id=p_email;
  update public.email_deliveries set status='captured',provider_id=null,
    sent_at=null,last_error=null where ticket_id=v_email.ticket_id;
end;
$$;
revoke all on function public.capture_development_email(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.capture_development_email(uuid,jsonb) to service_role;
commit;

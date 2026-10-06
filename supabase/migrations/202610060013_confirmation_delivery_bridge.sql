begin;
-- Keep the new outbox consistent with confirmations sent by the previous API
-- while the deployment is in progress. This also supplies the legacy log.
create function sportsbook_private.confirmation_delivered() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='sent' then
  update public.outbound_emails set status='sent',provider_id=new.provider_id,sent_at=new.sent_at,last_error=null
  where ticket_id=new.ticket_id and status<>'sent';
 end if;
 return new;
end $$;
revoke all on function sportsbook_private.confirmation_delivered() from public,anon,authenticated;
create trigger confirmation_delivery_bridge after update of status on public.email_deliveries for each row execute function sportsbook_private.confirmation_delivered();
commit;

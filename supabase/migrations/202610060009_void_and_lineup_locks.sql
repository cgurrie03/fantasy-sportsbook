begin;
alter table public.tickets drop constraint tickets_status_check;
alter table public.tickets add constraint tickets_status_check check(status in ('OPEN','WON','LOST','PUSH','VOIDED'));
alter table public.ticket_legs drop constraint ticket_legs_status_check;
alter table public.ticket_legs add constraint ticket_legs_status_check check(status in ('OPEN','WON','LOST','PUSH','VOIDED'));
alter table public.wallet_ledger drop constraint wallet_ledger_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check check(kind in ('historical_opening','settlement','weekly_replenishment','wager','void_refund'));
create function public.void_sportsbook_ticket(p_ticket uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_ticket public.tickets; v_wallet public.wallets;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can void tickets.'; end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Provide a cancellation reason.'; end if;
 select * into v_wallet from public.wallets where team_id=v_ticket.team_id for update;
 if not found or v_wallet.balance is null then raise exception 'Wallet unavailable; no ticket was changed.'; end if;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status='VOIDED' then return jsonb_build_object('duplicate',true,'balance',v_wallet.balance); end if;
 if v_ticket.status<>'OPEN' then raise exception 'Only open tickets can be voided.'; end if;
 update public.tickets set status='VOIDED',actual_payout=stake,settled_at=now() where id=p_ticket;
 update public.ticket_legs set status='VOIDED',result_evidence='Voided by league admin: '||trim(p_reason) where ticket_id=p_ticket;
 update public.wallets set balance=balance+v_ticket.stake,updated_at=now() where team_id=v_ticket.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
 values(v_ticket.team_id,p_ticket,'ticket:void:'||p_ticket,'void_refund',v_ticket.stake,v_wallet.balance,v_wallet.balance+v_ticket.stake,'Ticket voided by admin: '||trim(p_reason));
 update public.email_deliveries set status='failed',last_error='Ticket voided; confirmation cancelled' where ticket_id=p_ticket and status<>'sent';
 return jsonb_build_object('duplicate',false,'balance',v_wallet.balance+v_ticket.stake,'refund',v_ticket.stake);
end $$;
revoke all on function public.void_sportsbook_ticket(uuid,text) from public,anon;
grant execute on function public.void_sportsbook_ticket(uuid,text) to authenticated;
create function sportsbook_private.reject_locked_quote() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.market_quote_id is not null and exists(select 1 from public.sportsbook_markets m where m.id=new.market_quote_id and m.metadata->>'lineup_locked'='true') then
  raise exception 'This market is locked because a complete projected lineup is unavailable. Regenerate lines before accepting bets.';
 end if;
 return new;
end $$;
revoke all on function sportsbook_private.reject_locked_quote() from public,anon,authenticated;
create trigger reject_locked_quote before insert on public.ticket_legs for each row execute function sportsbook_private.reject_locked_quote();
create or replace function public.league_leaderboard(p_league uuid)
returns table(team_id uuid,bets_placed bigint,bets_won bigint,bets_lost bigint,bets_push bigint,total_wagered numeric,total_payout numeric,net_profit numeric,roi numeric,win_percentage numeric,biggest_parlay_legs bigint,biggest_parlay_odds integer,biggest_payout numeric,current_balance numeric)
language sql stable security definer set search_path='' as $$
 select t.id,count(b.id),count(b.id) filter(where b.status='WON'),count(b.id) filter(where b.status='LOST'),count(b.id) filter(where b.status='PUSH'),coalesce(sum(b.stake),0),coalesce(sum(b.actual_payout),0),coalesce(sum(b.net_profit) filter(where b.status<>'OPEN'),0),
 coalesce(100*sum(b.net_profit) filter(where b.status<>'OPEN')/nullif(sum(b.stake) filter(where b.status<>'OPEN'),0),0),coalesce(100.0*count(b.id) filter(where b.status='WON')/nullif(count(b.id) filter(where b.status in ('WON','LOST')),0),0),
 coalesce(max((select count(*) from public.ticket_legs l where l.ticket_id=b.id)) filter(where b.status='WON'),0),max(b.accepted_combined_odds) filter(where b.status='WON'),coalesce(max(b.actual_payout),0),w.balance
 from public.teams t join public.wallets w on w.team_id=t.id left join public.tickets b on b.team_id=t.id and b.status<>'VOIDED'
 where t.league_id=p_league and sportsbook_private.is_member(p_league)
 group by t.id,w.balance order by 8 desc,14 desc,2 desc;
$$;

commit;

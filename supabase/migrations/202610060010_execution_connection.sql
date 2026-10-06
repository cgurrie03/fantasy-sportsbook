begin;
create or replace function public.replenish_weekly_balances(p_league uuid,p_season integer,p_week integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_wallet record; v_key text; v_added integer:=0; v_blocked integer:=0; v_skipped integer:=0;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can replenish balances.'; end if;
 if p_week not between 1 and 18 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Invalid season or week.'; end if;
 for v_wallet in select w.* from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=p_league order by w.team_id for update of w loop
  v_key:='weekly:replenish:'||p_season||':'||p_week||':'||v_wallet.team_id;
  if exists(select 1 from public.wallet_ledger where event_key=v_key) then v_skipped:=v_skipped+1; continue; end if;
  if exists(select 1 from public.tickets where team_id=v_wallet.team_id and nfl_season=p_season and market_week>=p_week and status<>'VOIDED') then v_blocked:=v_blocked+1; continue; end if;
  -- Unresolved tickets must be reviewed before this user's reset; futures require their separate allowance rule.
  if exists(select 1 from public.tickets where team_id=v_wallet.team_id and status='OPEN' and (ticket_type='future' or (nfl_season=p_season and market_week<p_week))) then v_blocked:=v_blocked+1; continue; end if;
  if v_wallet.balance is null then v_blocked:=v_blocked+1; continue; end if;
  insert into public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(v_wallet.team_id,v_key,'weekly_replenishment',greatest(0,100-v_wallet.balance),v_wallet.balance,greatest(100,v_wallet.balance),'Week '||p_week||' replenishment');
  if v_wallet.balance<100 then
   update public.wallets set balance=100,updated_at=now() where team_id=v_wallet.team_id;
   v_added:=v_added+1;
  end if;
 end loop;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(p_league,p_season,p_week,'replenishment',jsonb_build_object('replenished',v_added,'blocked',v_blocked,'already_processed',v_skipped));
 return jsonb_build_object('replenished',v_added,'blocked',v_blocked,'already_processed',v_skipped);
end $$;
commit;

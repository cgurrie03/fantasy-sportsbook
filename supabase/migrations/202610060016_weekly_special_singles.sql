begin;
create or replace function public.sportsbook_special_conflict(a public.sportsbook_markets,b public.sportsbook_markets) returns boolean
language plpgsql immutable set search_path='' as $$
declare c public.sportsbook_markets; l public.sportsbook_markets; t public.sportsbook_markets; s public.sportsbook_markets;
begin
 if ((a.kind='weekly_high' and b.kind='weekly_low') or (a.kind='weekly_low' and b.kind='weekly_high')) and a.team_id=b.team_id then return true; end if;
 if a.kind='weekly_count_150' then c:=a; elsif b.kind='weekly_count_150' then c:=b; end if;
 if a.kind='weekly_any_below_100' then l:=a; elsif b.kind='weekly_any_below_100' then l:=b; end if;
 if c.id is not null and l.side='yes' and c.line=coalesce((c.metadata->>'expected_team_count')::integer,12) then return true; end if;
 if a.kind='team_total' then t:=a;s:=b; elsif b.kind='team_total' then t:=b;s:=a; end if;
 if t.id is not null then
   if s.kind='weekly_any_below_100' and s.side='no' and t.side='under' and t.line<=100 then return true; end if;
   if s.kind='weekly_any_200' and s.side='no' and t.side='over' and t.line>=200 then return true; end if;
   if c.id is not null and t.side='under' and t.line<=150 and c.line=coalesce((c.metadata->>'expected_team_count')::integer,12) then return true; end if;
 end if;
 return false;
end $$;
revoke all on function public.sportsbook_special_conflict(public.sportsbook_markets,public.sportsbook_markets) from public,anon,authenticated;
create or replace function public.place_sportsbook_ticket(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_board public.sportsbook_boards; v_member public.league_memberships; v_wallet public.wallets; v_quote public.sportsbook_markets;
 v_ticket public.tickets; v_price numeric:=1; v_legprice numeric; v_price_int integer; v_payout numeric; v_id uuid:=gen_random_uuid(); v_number integer:=0; v_matchup text;
begin
 select * into v_board from public.sportsbook_boards where id=p_board for share;
 if not found then raise exception 'This market board is unavailable.'; end if;
 select * into v_member from public.league_memberships where league_id=v_board.league_id and user_id=auth.uid();
 if not found then raise exception 'Sign in with your approved league account.'; end if;
 select * into v_wallet from public.wallets where team_id=v_member.team_id for update;
 select * into v_ticket from public.tickets where request_key=p_request;
 if found then
   if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
 if exists(select 1 from public.sportsbook_markets a join public.sportsbook_markets b on a.id<b.id where a.id=any(p_picks) and b.id=any(p_picks) and public.sportsbook_special_conflict(a,b)) then raise exception 'These selections have contradictory outcomes.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) group by market_key having count(*)>1) then raise exception 'Choose only one outcome per market.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key is not null group by matchup_key having bool_or(kind='spread') and bool_or(kind='moneyline')) then raise exception 'Spread and moneyline picks from one matchup cannot be combined.'; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   v_price:=v_price*v_legprice;
 end loop;
 if (v_price-1)*100>2147483647 or round(v_price*p_stake,2)>9999999999.99 then raise exception 'Potential payout exceeds the supported ticket limit.'; end if;
 v_price_int:=round(case when v_price>=2 then (v_price-1)*100 else -100/(v_price-1) end); v_payout:=round(v_price*p_stake,2);
 insert into public.tickets(id,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(v_id,v_board.league_id,v_member.team_id,p_request,v_board.league_season,v_board.nfl_season,(select week from public.sportsbook_period(v_board.league_id)),v_board.market_week,now(),v_price_int,p_stake,v_payout,'OPEN',0);
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   select h.team_name||' vs. '||a.team_name into v_matchup from public.teams h, public.teams a where h.id=v_quote.home_team_id and a.id=v_quote.away_team_id;
   insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
   values(v_id,v_number,v_quote.id,v_quote.label,case v_quote.kind when 'moneyline' then 'Moneyline' when 'spread' then 'Spread' when 'match_total' then 'Match Total' when 'team_total' then 'Team Total' when 'player_points' then 'Player Points' when 'weekly_high' then 'Weekly High Scorer' else 'Weekly Low Scorer' end,v_matchup,round(case when v_legprice>=2 then (v_legprice-1)*100 else -100/(v_legprice-1) end),v_quote.line,v_legprice,'OPEN','Accepted board revision '||p_revision,jsonb_build_object('kind',v_quote.kind,'side',v_quote.side,'team_id',v_quote.team_id,'home_team_id',v_quote.home_team_id,'away_team_id',v_quote.away_team_id,'metadata',v_quote.metadata,'boost_pct',v_quote.boost_pct));
 end loop;
 update public.wallets set balance=balance-p_stake,updated_at=now() where team_id=v_member.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(v_member.team_id,v_id,'ticket:wager:'||v_id,'wager',-p_stake,v_wallet.balance,v_wallet.balance-p_stake,'Ticket placed');
 insert into public.email_deliveries(ticket_id,recipient) values(v_id,v_member.invited_email);
 return jsonb_build_object('ticket_id',v_id,'balance',v_wallet.balance-p_stake,'duplicate',false);
end $$;
commit;

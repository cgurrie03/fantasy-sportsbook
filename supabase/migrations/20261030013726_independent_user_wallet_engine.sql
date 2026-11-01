begin;
-- No public activation operation yet. Empty mode table preserves legacy runtime.
alter table public.outbound_emails add column wallet_model text not null default 'legacy' check(wallet_model in ('legacy','user'));
create table sportsbook_private.user_finance_modes(league_id uuid primary key references public.leagues(id),enabled boolean not null default false);
alter table sportsbook_private.user_finance_modes enable row level security;
revoke all on sportsbook_private.user_finance_modes from public,anon,authenticated,service_role;
create function sportsbook_private.user_finance_enabled(p_league uuid) returns boolean
language sql stable security definer set search_path='' as $$select exists(select 1 from sportsbook_private.user_finance_modes where league_id=p_league and enabled)$$;
revoke all on function sportsbook_private.user_finance_enabled(uuid) from public,anon,authenticated,service_role;
create function sportsbook_private.financial_participant(p_league uuid)
returns table(team_id uuid,user_id uuid,invited_email text,display_name text) language sql stable security definer set search_path='' as $$
 select w.team_id,w.user_id,a.email,w.display_name from public.user_wallets w join auth.users a on a.id=w.user_id
 where w.league_id=p_league and w.user_id=auth.uid() and w.status='approved' and a.email_confirmed_at is not null
$$;
revoke all on function sportsbook_private.financial_participant(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.legacy_place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id) then raise exception 'Request identifier already used for a promotion.';end if; if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.reopening_id is not null and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception 'Reopening prices or game state changed. Refresh your picks.'; end if; if v_board.phase='live' and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception 'Live acceptance is disabled until pricing checks pass.'; end if;
 if v_board.suspension_reason is not null then raise exception 'Markets suspended: %',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception 'Quotes expired; wait for a successful refresh.'; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or (r.week_started and not sportsbook_private.valid_reopening(v_board,p_picks)) or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>'open' or suspension_reason is not null or metadata->>'resolved'='true')) then raise exception 'A selection is suspended or resolved.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind='future_playoffs') then raise exception 'Make/Miss Playoffs requires at least two playoff picks.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('future_playoffs','future_win_total')) then raise exception 'League Winner and #1 Pick are standalone bets.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception 'Playoff and win-total parlays must remain separate.'; end if;
 if v_board.board_type='weekly' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like 'future_%') then raise exception 'Futures require a season board.'; end if;
 if v_board.board_type='future' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like 'future_%') then raise exception 'Only futures belong on a season board.'; end if;
 if v_board.board_type<>'future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','player_h2h','player_milestone','team_milestone','winning_margin')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
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
 if v_board.board_type='future' then update public.tickets set ticket_type='future' where id=v_id; end if;
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
end $function$
;

revoke all on function sportsbook_private.legacy_place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.user_place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_board public.sportsbook_boards; v_member record; v_wallet public.user_wallets; v_quote public.sportsbook_markets;
 v_ticket public.tickets; v_price numeric:=1; v_legprice numeric; v_price_int integer; v_payout numeric; v_id uuid:=gen_random_uuid(); v_number integer:=0; v_matchup text;
begin
 select * into v_board from public.sportsbook_boards where id=p_board for share;
 if not found then raise exception 'This market board is unavailable.'; end if;
 select * into v_member from sportsbook_private.financial_participant(v_board.league_id);
 if not found then raise exception 'Sign in with your approved league account.'; end if;
 select * into v_wallet from public.user_wallets where league_id=v_board.league_id and user_id=auth.uid() and status='approved' for update;
 select * into v_ticket from public.tickets where request_key=p_request;
 if found then if v_ticket.user_wallet_id is distinct from v_wallet.id then raise exception 'Request belongs to another financial account.';end if;
   if exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id) then raise exception 'Request identifier already used for a promotion.';end if; if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.reopening_id is not null and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception 'Reopening prices or game state changed. Refresh your picks.'; end if; if v_board.phase='live' and not sportsbook_private.valid_reopening(v_board,p_picks) then raise exception 'Live acceptance is disabled until pricing checks pass.'; end if;
 if v_board.suspension_reason is not null then raise exception 'Markets suspended: %',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception 'Quotes expired; wait for a successful refresh.'; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or (r.week_started and not sportsbook_private.valid_reopening(v_board,p_picks)) or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>'open' or suspension_reason is not null or metadata->>'resolved'='true')) then raise exception 'A selection is suspended or resolved.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind='future_playoffs') then raise exception 'Make/Miss Playoffs requires at least two playoff picks.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('future_playoffs','future_win_total')) then raise exception 'League Winner and #1 Pick are standalone bets.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception 'Playoff and win-total parlays must remain separate.'; end if;
 if v_board.board_type='weekly' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like 'future_%') then raise exception 'Futures require a season board.'; end if;
 if v_board.board_type='future' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like 'future_%') then raise exception 'Only futures belong on a season board.'; end if;
 if v_board.board_type<>'future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','player_h2h','player_milestone','team_milestone','winning_margin')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
 if exists(select 1 from public.sportsbook_markets a join public.sportsbook_markets b on a.id<b.id where a.id=any(p_picks) and b.id=any(p_picks) and public.sportsbook_special_conflict(a,b)) then raise exception 'These selections have contradictory outcomes.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) group by market_key having count(*)>1) then raise exception 'Choose only one outcome per market.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key is not null group by matchup_key having bool_or(kind='spread') and bool_or(kind='moneyline')) then raise exception 'Spread and moneyline picks from one matchup cannot be combined.'; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   v_price:=v_price*v_legprice;
 end loop;
 if (v_price-1)*100>2147483647 or round(v_price*p_stake,2)>9999999999.99 then raise exception 'Potential payout exceeds the supported ticket limit.'; end if;
 v_price_int:=round(case when v_price>=2 then (v_price-1)*100 else -100/(v_price-1) end); v_payout:=round(v_price*p_stake,2);
 insert into public.tickets(id,user_wallet_id,bettor_display_name,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(v_id,v_wallet.id,v_member.display_name,v_board.league_id,v_member.team_id,p_request,v_board.league_season,v_board.nfl_season,(select week from public.sportsbook_period(v_board.league_id)),v_board.market_week,now(),v_price_int,p_stake,v_payout,'OPEN',0);
 if v_board.board_type='future' then update public.tickets set ticket_type='future' where id=v_id; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   select h.team_name||' vs. '||a.team_name into v_matchup from public.teams h, public.teams a where h.id=v_quote.home_team_id and a.id=v_quote.away_team_id;
   insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
   values(v_id,v_number,v_quote.id,v_quote.label,case v_quote.kind when 'moneyline' then 'Moneyline' when 'spread' then 'Spread' when 'match_total' then 'Match Total' when 'team_total' then 'Team Total' when 'player_points' then 'Player Points' when 'weekly_high' then 'Weekly High Scorer' else 'Weekly Low Scorer' end,v_matchup,round(case when v_legprice>=2 then (v_legprice-1)*100 else -100/(v_legprice-1) end),v_quote.line,v_legprice,'OPEN','Accepted board revision '||p_revision,jsonb_build_object('kind',v_quote.kind,'side',v_quote.side,'team_id',v_quote.team_id,'home_team_id',v_quote.home_team_id,'away_team_id',v_quote.away_team_id,'metadata',v_quote.metadata,'boost_pct',v_quote.boost_pct));
 end loop;
 update public.user_wallets set balance=balance-p_stake,updated_at=now() where league_id=v_board.league_id and user_id=auth.uid() and status='approved';
 insert into public.user_wallet_entries(wallet_id,league_id,team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(v_wallet.id,v_board.league_id,v_member.team_id,v_id,'ticket:wager:'||v_id,'wager',-p_stake,v_wallet.balance,v_wallet.balance-p_stake,'Ticket placed');
 insert into public.email_deliveries(ticket_id,recipient) values(v_id,v_member.invited_email);
 return jsonb_build_object('ticket_id',v_id,'balance',v_wallet.balance-p_stake,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.user_place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid) from public,anon,authenticated,service_role;

create or replace function public.place_sportsbook_ticket(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if sportsbook_private.user_finance_enabled((select league_id from public.sportsbook_boards where id=p_board)) then return sportsbook_private.user_place_sportsbook_ticket(p_board,p_revision,p_picks,p_stake,p_request);end if;
 return sportsbook_private.legacy_place_sportsbook_ticket(p_board,p_revision,p_picks,p_stake,p_request);
end $$;
revoke all on function public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid) from public,anon,service_role;
grant execute on function public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid) to authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.legacy_place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare promo public.promo_offers; base_price numeric; v_board public.sportsbook_boards; v_member public.league_memberships; v_wallet public.wallets; v_quote public.sportsbook_markets;
 v_ticket public.tickets; v_price numeric:=1; v_legprice numeric; v_price_int integer; v_payout numeric; v_id uuid:=gen_random_uuid(); v_number integer:=0; v_matchup text;
begin
 select * into v_board from public.sportsbook_boards where id=p_board for share;
 if not found then raise exception 'This market board is unavailable.'; end if;
 select * into v_member from public.league_memberships where league_id=v_board.league_id and user_id=auth.uid();
 if not found then raise exception 'Sign in with your approved league account.'; end if;
 select * into v_wallet from public.wallets where team_id=v_member.team_id for update;
 select * into v_ticket from public.tickets where request_key=p_request;
 if found then
   if not exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id and offer_id=p_offer and user_id=auth.uid()) then raise exception 'Request identifier already used for another offer.';end if; if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 promo:=sportsbook_private.validate_boost(p_offer,p_board,p_picks,p_stake);
if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.phase='live' then raise exception 'Live acceptance is disabled until pricing checks pass.'; end if;
 if v_board.suspension_reason is not null then raise exception 'Markets suspended: %',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception 'Quotes expired; wait for a successful refresh.'; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.week_started or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>'open' or suspension_reason is not null or metadata->>'resolved'='true')) then raise exception 'A selection is suspended or resolved.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind='future_playoffs') then raise exception 'Make/Miss Playoffs requires at least two playoff picks.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('future_playoffs','future_win_total')) then raise exception 'League Winner and #1 Pick are standalone bets.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception 'Playoff and win-total parlays must remain separate.'; end if;
 if v_board.board_type='weekly' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like 'future_%') then raise exception 'Futures require a season board.'; end if;
 if v_board.board_type='future' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like 'future_%') then raise exception 'Only futures belong on a season board.'; end if;
 if v_board.board_type<>'future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
 if exists(select 1 from public.sportsbook_markets a join public.sportsbook_markets b on a.id<b.id where a.id=any(p_picks) and b.id=any(p_picks) and public.sportsbook_special_conflict(a,b)) then raise exception 'These selections have contradictory outcomes.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) group by market_key having count(*)>1) then raise exception 'Choose only one outcome per market.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key is not null group by matchup_key having bool_or(kind='spread') and bool_or(kind='moneyline')) then raise exception 'Spread and moneyline picks from one matchup cannot be combined.'; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   v_price:=v_price*v_legprice;
 end loop;
 if (v_price-1)*100>2147483647 or round(v_price*p_stake,2)>9999999999.99 then raise exception 'Potential payout exceeds the supported ticket limit.'; end if;
 base_price:=v_price; v_price:=1+(v_price-1)*(1+(promo.terms->>'percent')::numeric/100);
v_price_int:=round(case when v_price>=2 then (v_price-1)*100 else -100/(v_price-1) end); v_payout:=round(v_price*p_stake,2);
 insert into public.tickets(id,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(v_id,v_board.league_id,v_member.team_id,p_request,v_board.league_season,v_board.nfl_season,(select week from public.sportsbook_period(v_board.league_id)),v_board.market_week,now(),v_price_int,p_stake,v_payout,'OPEN',0);
 if v_board.board_type='future' then update public.tickets set ticket_type='future' where id=v_id; end if;
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
 insert into public.ticket_promotions values(v_id,promo.league_id,v_member.team_id,auth.uid(),promo.id,'boost',(promo.terms->>'percent')::numeric,base_price,to_jsonb(promo));
 update public.promo_claims set used_ticket=v_id where offer_id=promo.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(promo.league_id,promo.id,auth.uid(),'redeemed',v_id);return jsonb_build_object('ticket_id',v_id,'balance',v_wallet.balance-p_stake,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.legacy_place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.user_place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare promo public.promo_offers; base_price numeric; v_board public.sportsbook_boards; v_member record; v_wallet public.user_wallets; v_quote public.sportsbook_markets;
 v_ticket public.tickets; v_price numeric:=1; v_legprice numeric; v_price_int integer; v_payout numeric; v_id uuid:=gen_random_uuid(); v_number integer:=0; v_matchup text;
begin
 select * into v_board from public.sportsbook_boards where id=p_board for share;
 if not found then raise exception 'This market board is unavailable.'; end if;
 select * into v_member from sportsbook_private.financial_participant(v_board.league_id);
 if not found then raise exception 'Sign in with your approved league account.'; end if;
 select * into v_wallet from public.user_wallets where league_id=v_board.league_id and user_id=auth.uid() and status='approved' for update;
 select * into v_ticket from public.tickets where request_key=p_request;
 if found then if v_ticket.user_wallet_id is distinct from v_wallet.id then raise exception 'Request belongs to another financial account.';end if;
   if not exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id and offer_id=p_offer and user_id=auth.uid()) then raise exception 'Request identifier already used for another offer.';end if; if v_ticket.team_id<>v_member.team_id then raise exception 'Request identifier already used.'; end if;
   if v_ticket.stake is distinct from p_stake or (select array_agg(market_quote_id order by market_quote_id) from public.ticket_legs where ticket_id=v_ticket.id) is distinct from (select array_agg(x order by x) from unnest(p_picks) x) then raise exception 'This request was already used for a different ticket.'; end if;
   return jsonb_build_object('ticket_id',v_ticket.id,'balance',v_wallet.balance,'duplicate',true);
 end if;
 promo:=sportsbook_private.validate_boost(p_offer,p_board,p_picks,p_stake);
if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>v_wallet.balance or v_wallet.balance is null then raise exception 'Enter a whole-cent wager between $1 and your available balance.'; end if;
 if v_board.status<>'published' or now()<v_board.opens_at or now()>=v_board.closes_at then raise exception 'Betting is closed for this board.'; end if;
 if v_board.phase='live' then raise exception 'Live acceptance is disabled until pricing checks pass.'; end if;
 if v_board.suspension_reason is not null then raise exception 'Markets suspended: %',v_board.suspension_reason; end if;
 if v_board.quote_valid_until is not null and v_board.quote_valid_until<=now() then raise exception 'Quotes expired; wait for a successful refresh.'; end if;
 if exists(select 1 from public.line_refresh_runtime r where r.league_id=v_board.league_id and (r.market_week=v_board.market_week or v_board.board_type='future') and (r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.week_started or r.last_error is not null)) then raise exception 'Current game state cannot support pregame acceptance.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and active and (market_state<>'open' or suspension_reason is not null or metadata->>'resolved'='true')) then raise exception 'A selection is suspended or resolved.'; end if;
 if v_board.revision is distinct from p_revision then raise exception 'Lines have changed. Refresh and review your picks.'; end if;
 if p_picks is null or cardinality(p_picks) not between 1 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 1–10 distinct picks; singles must be Weekly Specials.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind='future_playoffs') then raise exception 'Make/Miss Playoffs requires at least two playoff picks.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('future_playoffs','future_win_total')) then raise exception 'League Winner and #1 Pick are standalone bets.'; end if;
 if v_board.board_type='future' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception 'Playoff and win-total parlays must remain separate.'; end if;
 if v_board.board_type='weekly' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind like 'future_%') then raise exception 'Futures require a season board.'; end if;
 if v_board.board_type='future' and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not like 'future_%') then raise exception 'Only futures belong on a season board.'; end if;
 if v_board.board_type<>'future' and cardinality(p_picks)=1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind not in ('weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score')) then raise exception 'Matchup and Player Points tickets require at least two picks.'; end if;
 if exists(select 1 from public.sportsbook_markets a join public.sportsbook_markets b on a.id<b.id where a.id=any(p_picks) and b.id=any(p_picks) and public.sportsbook_special_conflict(a,b)) then raise exception 'These selections have contradictory outcomes.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) group by market_key having count(*)>1) then raise exception 'Choose only one outcome per market.'; end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key is not null group by matchup_key having bool_or(kind='spread') and bool_or(kind='moneyline')) then raise exception 'Spread and moneyline picks from one matchup cannot be combined.'; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   v_price:=v_price*v_legprice;
 end loop;
 if (v_price-1)*100>2147483647 or round(v_price*p_stake,2)>9999999999.99 then raise exception 'Potential payout exceeds the supported ticket limit.'; end if;
 base_price:=v_price; v_price:=1+(v_price-1)*(1+(promo.terms->>'percent')::numeric/100);
v_price_int:=round(case when v_price>=2 then (v_price-1)*100 else -100/(v_price-1) end); v_payout:=round(v_price*p_stake,2);
 insert into public.tickets(id,user_wallet_id,bettor_display_name,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(v_id,v_wallet.id,v_member.display_name,v_board.league_id,v_member.team_id,p_request,v_board.league_season,v_board.nfl_season,(select week from public.sportsbook_period(v_board.league_id)),v_board.market_week,now(),v_price_int,p_stake,v_payout,'OPEN',0);
 if v_board.board_type='future' then update public.tickets set ticket_type='future' where id=v_id; end if;
 for v_quote in select * from public.sportsbook_markets where id=any(p_picks) order by array_position(p_picks,id) loop
   v_number:=v_number+1;
   v_legprice:=1+(case when v_quote.odds>0 then v_quote.odds/100.0 else 100.0/abs(v_quote.odds) end)*(1+v_quote.boost_pct/100.0);
   select h.team_name||' vs. '||a.team_name into v_matchup from public.teams h, public.teams a where h.id=v_quote.home_team_id and a.id=v_quote.away_team_id;
   insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
   values(v_id,v_number,v_quote.id,v_quote.label,case v_quote.kind when 'moneyline' then 'Moneyline' when 'spread' then 'Spread' when 'match_total' then 'Match Total' when 'team_total' then 'Team Total' when 'player_points' then 'Player Points' when 'weekly_high' then 'Weekly High Scorer' else 'Weekly Low Scorer' end,v_matchup,round(case when v_legprice>=2 then (v_legprice-1)*100 else -100/(v_legprice-1) end),v_quote.line,v_legprice,'OPEN','Accepted board revision '||p_revision,jsonb_build_object('kind',v_quote.kind,'side',v_quote.side,'team_id',v_quote.team_id,'home_team_id',v_quote.home_team_id,'away_team_id',v_quote.away_team_id,'metadata',v_quote.metadata,'boost_pct',v_quote.boost_pct));
 end loop;
 update public.user_wallets set balance=balance-p_stake,updated_at=now() where league_id=v_board.league_id and user_id=auth.uid() and status='approved';
 insert into public.user_wallet_entries(wallet_id,league_id,team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(v_wallet.id,v_board.league_id,v_member.team_id,v_id,'ticket:wager:'||v_id,'wager',-p_stake,v_wallet.balance,v_wallet.balance-p_stake,'Ticket placed');
 insert into public.email_deliveries(ticket_id,recipient) values(v_id,v_member.invited_email);
 insert into public.ticket_promotions values(v_id,promo.league_id,v_member.team_id,auth.uid(),promo.id,'boost',(promo.terms->>'percent')::numeric,base_price,to_jsonb(promo));
 update public.promo_claims set used_ticket=v_id where offer_id=promo.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(promo.league_id,promo.id,auth.uid(),'redeemed',v_id);return jsonb_build_object('ticket_id',v_id,'balance',v_wallet.balance-p_stake,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.user_place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.place_boosted_ticket(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid,p_offer uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if sportsbook_private.user_finance_enabled((select league_id from public.sportsbook_boards where id=p_board)) then return sportsbook_private.user_place_boosted_ticket(p_board,p_revision,p_picks,p_stake,p_request,p_offer);end if;
 return sportsbook_private.legacy_place_boosted_ticket(p_board,p_revision,p_picks,p_stake,p_request,p_offer);
end $$;
revoke all on function public.place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid) from public,anon,service_role;
grant execute on function public.place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.legacy_place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.promo_offers;m public.league_memberships;w public.wallets;c public.promo_claims;t public.tickets;q public.sportsbook_markets;price numeric:=1;lp numeric;i uuid:=gen_random_uuid();n integer:=0;
begin
 -- Read league identity first; take wallet before offer/claim to match acceptance
 -- and void settlement. Admin pause never waits on a wallet.
 select * into o from public.promo_offers where id=p_offer;
 select * into m from public.league_memberships where league_id=o.league_id and user_id=auth.uid();
 if not found then raise exception 'League membership required.';end if;
 select * into strict w from public.wallets where team_id=m.team_id for update;
 select * into t from public.tickets where request_key=p_request;
 if found then
  if t.team_id<>m.team_id or t.stake is distinct from p_stake or not exists(select 1 from public.ticket_promotions where ticket_id=t.id and offer_id=p_offer and kind='fixed' and user_id=auth.uid()) then raise exception 'Request identifier already used.';end if;
  return jsonb_build_object('ticket_id',t.id,'balance',w.balance,'duplicate',true);
 end if;
 select * into o from public.promo_offers where id=p_offer for share;
 if o.kind<>'fixed' or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 insert into public.promo_claims(offer_id,league_id,user_id) values(o.id,o.league_id,auth.uid()) on conflict do nothing;
 select * into c from public.promo_claims where offer_id=o.id and user_id=auth.uid() for update;
 if c.used_ticket is not null then raise exception 'This offer has already been used.';end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>w.balance or w.balance is null then raise exception 'Enter a whole-cent wager within your balance.';end if;
 if o.terms->>'fixed_stake' is not null and p_stake<>(o.terms->>'fixed_stake')::numeric then raise exception 'This offer requires its fixed wager.';end if;
 for q in select * from jsonb_populate_recordset(null::public.sportsbook_markets,o.terms->'legs') loop lp:=case when q.odds>0 then 1+q.odds/100.0 else 1+100.0/abs(q.odds) end;price:=price*lp;end loop;
 if round(price*p_stake,2)>9999999999.99 or (price-1)*100>2147483647 then raise exception 'Potential payout exceeds supported ticket limit.';end if;
 insert into public.tickets(id,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(i,o.league_id,m.team_id,p_request,(select league_season from public.leagues where id=o.league_id),o.nfl_season,o.market_week,o.market_week,now(),round(case when price>=2 then (price-1)*100 else -100/(price-1) end),p_stake,round(price*p_stake,2),'OPEN',0);
 for q in select * from jsonb_populate_recordset(null::public.sportsbook_markets,o.terms->'legs') loop
  n:=n+1;lp:=case when q.odds>0 then 1+q.odds/100.0 else 1+100.0/abs(q.odds) end;
  insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
  values(i,n,q.id,q.label,q.kind,q.subject,q.odds,q.line,lp,'OPEN','Fixed offer version '||o.version,jsonb_build_object('kind',q.kind,'side',q.side,'team_id',q.team_id,'home_team_id',q.home_team_id,'away_team_id',q.away_team_id,'metadata',q.metadata,'boost_pct',0));
 end loop;
 insert into public.ticket_promotions values(i,o.league_id,m.team_id,auth.uid(),o.id,'fixed',0,price,to_jsonb(o));
 update public.wallets set balance=balance-p_stake,updated_at=now() where team_id=m.team_id;
 insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(m.team_id,i,'ticket:wager:'||i,'wager',-p_stake,w.balance,w.balance-p_stake,'Fixed offer accepted');
 update public.promo_claims set used_ticket=i where offer_id=o.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(o.league_id,o.id,auth.uid(),'redeemed',i);
 insert into public.email_deliveries(ticket_id,recipient) values(i,m.invited_email);
 return jsonb_build_object('ticket_id',i,'balance',w.balance-p_stake,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.legacy_place_fixed_ticket(uuid,numeric,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.user_place_fixed_ticket(p_offer uuid, p_stake numeric, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.promo_offers;m record;w public.user_wallets;c public.promo_claims;t public.tickets;q public.sportsbook_markets;price numeric:=1;lp numeric;i uuid:=gen_random_uuid();n integer:=0;
begin
 -- Read league identity first; take wallet before offer/claim to match acceptance
 -- and void settlement. Admin pause never waits on a wallet.
 select * into o from public.promo_offers where id=p_offer;
 select * into m from sportsbook_private.financial_participant(o.league_id);
 if not found then raise exception 'League membership required.';end if;
 select * into strict w from public.user_wallets where league_id=o.league_id and user_id=auth.uid() and status='approved' for update;
 select * into t from public.tickets where request_key=p_request;
 if found then if t.user_wallet_id is distinct from w.id then raise exception 'Request belongs to another financial account.';end if;
  if t.team_id<>m.team_id or t.stake is distinct from p_stake or not exists(select 1 from public.ticket_promotions where ticket_id=t.id and offer_id=p_offer and kind='fixed' and user_id=auth.uid()) then raise exception 'Request identifier already used.';end if;
  return jsonb_build_object('ticket_id',t.id,'balance',w.balance,'duplicate',true);
 end if;
 select * into o from public.promo_offers where id=p_offer for share;
 if o.kind<>'fixed' or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 insert into public.promo_claims(offer_id,league_id,user_id) values(o.id,o.league_id,auth.uid()) on conflict do nothing;
 select * into c from public.promo_claims where offer_id=o.id and user_id=auth.uid() for update;
 if c.used_ticket is not null then raise exception 'This offer has already been used.';end if;
 if p_request is null or p_stake is null or p_stake<>round(p_stake,2) or p_stake<1 or p_stake>w.balance or w.balance is null then raise exception 'Enter a whole-cent wager within your balance.';end if;
 if o.terms->>'fixed_stake' is not null and p_stake<>(o.terms->>'fixed_stake')::numeric then raise exception 'This offer requires its fixed wager.';end if;
 for q in select * from jsonb_populate_recordset(null::public.sportsbook_markets,o.terms->'legs') loop lp:=case when q.odds>0 then 1+q.odds/100.0 else 1+100.0/abs(q.odds) end;price:=price*lp;end loop;
 if round(price*p_stake,2)>9999999999.99 or (price-1)*100>2147483647 then raise exception 'Potential payout exceeds supported ticket limit.';end if;
 insert into public.tickets(id,user_wallet_id,bettor_display_name,league_id,team_id,request_key,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout)
 values(i,w.id,m.display_name,o.league_id,m.team_id,p_request,(select league_season from public.leagues where id=o.league_id),o.nfl_season,o.market_week,o.market_week,now(),round(case when price>=2 then (price-1)*100 else -100/(price-1) end),p_stake,round(price*p_stake,2),'OPEN',0);
 for q in select * from jsonb_populate_recordset(null::public.sportsbook_markets,o.terms->'legs') loop
  n:=n+1;lp:=case when q.odds>0 then 1+q.odds/100.0 else 1+100.0/abs(q.odds) end;
  insert into public.ticket_legs(ticket_id,leg_number,market_quote_id,selection,market_type,matchup,accepted_odds,accepted_line,accepted_decimal_odds,status,result_evidence,settlement_context)
  values(i,n,q.id,q.label,q.kind,q.subject,q.odds,q.line,lp,'OPEN','Fixed offer version '||o.version,jsonb_build_object('kind',q.kind,'side',q.side,'team_id',q.team_id,'home_team_id',q.home_team_id,'away_team_id',q.away_team_id,'metadata',q.metadata,'boost_pct',0));
 end loop;
 insert into public.ticket_promotions values(i,o.league_id,m.team_id,auth.uid(),o.id,'fixed',0,price,to_jsonb(o));
 update public.user_wallets set balance=balance-p_stake,updated_at=now() where league_id=o.league_id and user_id=auth.uid() and status='approved';
 insert into public.user_wallet_entries(wallet_id,league_id,team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason) values(w.id,o.league_id,m.team_id,i,'ticket:wager:'||i,'wager',-p_stake,w.balance,w.balance-p_stake,'Fixed offer accepted');
 update public.promo_claims set used_ticket=i where offer_id=o.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(o.league_id,o.id,auth.uid(),'redeemed',i);
 insert into public.email_deliveries(ticket_id,recipient) values(i,m.invited_email);
 return jsonb_build_object('ticket_id',i,'balance',w.balance-p_stake,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.user_place_fixed_ticket(uuid,numeric,uuid) from public,anon,authenticated,service_role;

create or replace function public.place_fixed_ticket(p_offer uuid,p_stake numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if sportsbook_private.user_finance_enabled((select league_id from public.promo_offers where id=p_offer)) then return sportsbook_private.user_place_fixed_ticket(p_offer,p_stake,p_request);end if;
 return sportsbook_private.legacy_place_fixed_ticket(p_offer,p_stake,p_request);
end $$;
revoke all on function public.place_fixed_ticket(uuid,numeric,uuid) from public,anon,service_role;
grant execute on function public.place_fixed_ticket(uuid,numeric,uuid) to authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.legacy_settle_weekly_ticket(p_ticket uuid, p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ticket public.tickets; v_wallet public.wallets; v_leg public.ticket_legs; v_result jsonb;
 v_status text; v_price numeric:=1; v_payout numeric; v_pending boolean:=false; v_lost boolean:=false; v_won boolean:=false;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can settle tickets.'; end if;
 -- Use the same wallet-before-ticket lock order as bet placement.
 select * into v_wallet from public.wallets where team_id=v_ticket.team_id for update;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status<>'OPEN' then return jsonb_build_object('duplicate',true,'status',v_ticket.status,'payout',v_ticket.actual_payout); end if;
 
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>(select count(*) from public.ticket_legs where ticket_id=p_ticket) then raise exception 'Every ticket leg requires exactly one result.'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_results))<>jsonb_array_length(p_results) then raise exception 'Duplicate leg result.'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) x where not exists(select 1 from public.ticket_legs l where l.id=(x->>'id')::uuid and l.ticket_id=p_ticket)) then raise exception 'Result belongs to another ticket.'; end if;
 for v_leg in select * from public.ticket_legs where ticket_id=p_ticket order by leg_number loop
  select value into v_result from jsonb_array_elements(p_results) where value->>'id'=v_leg.id::text;
  v_status:=v_result->>'status';
  if v_status is null or v_status not in ('OPEN','WON','LOST','PUSH') or coalesce(v_result->>'evidence','')='' then raise exception 'Invalid leg result.'; end if;
  if v_leg.status<>'OPEN' and v_leg.status<>v_status then raise exception 'A confirmed leg result cannot be overwritten.'; end if;
  update public.ticket_legs set status=v_status,actual_value=(v_result->>'actual_value')::numeric,result_evidence=v_result->>'evidence' where id=v_leg.id;
  v_pending:=v_pending or v_status='OPEN'; v_lost:=v_lost or v_status='LOST'; v_won:=v_won or v_status='WON';
  if v_status='WON' then
   if v_leg.accepted_decimal_odds is null or v_leg.accepted_decimal_odds<1 then raise exception 'Accepted leg odds are missing.'; end if;
   v_price:=v_price*v_leg.accepted_decimal_odds;
  end if;
 end loop;
 if v_pending then return jsonb_build_object('status','OPEN','pending',true); end if;
 v_status:=case when v_lost then 'LOST' when v_won then 'WON' else 'PUSH' end;
 if v_won and not v_lost then v_price:=1+(v_price-1)*(1+coalesce((select boost_pct from public.ticket_promotions where ticket_id=p_ticket and kind='boost'),0)/100);end if; v_payout:=case when v_lost then 0 when not v_won then v_ticket.stake else round(v_ticket.stake*v_price,2) end;
 update public.tickets set status=v_status,actual_payout=v_payout,settled_at=now() where id=p_ticket;
 if v_payout>0 then
  insert into public.wallet_ledger(team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(v_ticket.team_id,p_ticket,'ticket:settle:'||p_ticket,'settlement',v_payout,v_wallet.balance,v_wallet.balance+v_payout,'Ticket '||lower(v_status));
  update public.wallets set balance=balance+v_payout,updated_at=now() where team_id=v_ticket.team_id;
 end if;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(v_ticket.league_id,v_ticket.nfl_season,v_ticket.market_week,'settlement',jsonb_build_object('ticket_id',p_ticket,'status',v_status,'payout',v_payout));
 return jsonb_build_object('status',v_status,'payout',v_payout,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.legacy_settle_weekly_ticket(uuid,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.user_settle_weekly_ticket(p_ticket uuid, p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ticket public.tickets; v_wallet public.user_wallets; v_leg public.ticket_legs; v_result jsonb;
 v_status text; v_price numeric:=1; v_payout numeric; v_pending boolean:=false; v_lost boolean:=false; v_won boolean:=false;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can settle tickets.'; end if;
 -- Use the same wallet-before-ticket lock order as bet placement.
 select * into v_wallet from public.user_wallets where id=v_ticket.user_wallet_id for update;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status<>'OPEN' then return jsonb_build_object('duplicate',true,'status',v_ticket.status,'payout',v_ticket.actual_payout); end if;
 
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)<>(select count(*) from public.ticket_legs where ticket_id=p_ticket) then raise exception 'Every ticket leg requires exactly one result.'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_results))<>jsonb_array_length(p_results) then raise exception 'Duplicate leg result.'; end if;
 if exists(select 1 from jsonb_array_elements(p_results) x where not exists(select 1 from public.ticket_legs l where l.id=(x->>'id')::uuid and l.ticket_id=p_ticket)) then raise exception 'Result belongs to another ticket.'; end if;
 for v_leg in select * from public.ticket_legs where ticket_id=p_ticket order by leg_number loop
  select value into v_result from jsonb_array_elements(p_results) where value->>'id'=v_leg.id::text;
  v_status:=v_result->>'status';
  if v_status is null or v_status not in ('OPEN','WON','LOST','PUSH') or coalesce(v_result->>'evidence','')='' then raise exception 'Invalid leg result.'; end if;
  if v_leg.status<>'OPEN' and v_leg.status<>v_status then raise exception 'A confirmed leg result cannot be overwritten.'; end if;
  update public.ticket_legs set status=v_status,actual_value=(v_result->>'actual_value')::numeric,result_evidence=v_result->>'evidence' where id=v_leg.id;
  v_pending:=v_pending or v_status='OPEN'; v_lost:=v_lost or v_status='LOST'; v_won:=v_won or v_status='WON';
  if v_status='WON' then
   if v_leg.accepted_decimal_odds is null or v_leg.accepted_decimal_odds<1 then raise exception 'Accepted leg odds are missing.'; end if;
   v_price:=v_price*v_leg.accepted_decimal_odds;
  end if;
 end loop;
 if v_pending then return jsonb_build_object('status','OPEN','pending',true); end if;
 v_status:=case when v_lost then 'LOST' when v_won then 'WON' else 'PUSH' end;
 if v_won and not v_lost then v_price:=1+(v_price-1)*(1+coalesce((select boost_pct from public.ticket_promotions where ticket_id=p_ticket and kind='boost'),0)/100);end if; v_payout:=case when v_lost then 0 when not v_won then v_ticket.stake else round(v_ticket.stake*v_price,2) end;
 update public.tickets set status=v_status,actual_payout=v_payout,settled_at=now() where id=p_ticket;
 if v_payout>0 then
  insert into public.user_wallet_entries(wallet_id,league_id,team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(v_wallet.id,v_ticket.league_id,v_ticket.team_id,p_ticket,'ticket:settle:'||p_ticket,'settlement',v_payout,v_wallet.balance,v_wallet.balance+v_payout,'Ticket '||lower(v_status));
  update public.user_wallets set balance=balance+v_payout,updated_at=now() where id=v_ticket.user_wallet_id;
 end if;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(v_ticket.league_id,v_ticket.nfl_season,v_ticket.market_week,'settlement',jsonb_build_object('ticket_id',p_ticket,'status',v_status,'payout',v_payout));
 return jsonb_build_object('status',v_status,'payout',v_payout,'duplicate',false);
end $function$
;

revoke all on function sportsbook_private.user_settle_weekly_ticket(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.settle_weekly_ticket(p_ticket uuid,p_results jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select user_wallet_id is not null from public.tickets where id=p_ticket) then return sportsbook_private.user_settle_weekly_ticket(p_ticket,p_results);end if;
 return sportsbook_private.legacy_settle_weekly_ticket(p_ticket,p_results);
end $$;
revoke all on function public.settle_weekly_ticket(uuid,jsonb) from public,anon,service_role;
grant execute on function public.settle_weekly_ticket(uuid,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.legacy_void_sportsbook_ticket(p_ticket uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

revoke all on function sportsbook_private.legacy_void_sportsbook_ticket(uuid,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.user_void_sportsbook_ticket(p_ticket uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ticket public.tickets; v_wallet public.user_wallets;
begin
 select * into v_ticket from public.tickets where id=p_ticket;
 if not found then raise exception 'Ticket not found.'; end if;
 if not sportsbook_private.is_admin(v_ticket.league_id) then raise exception 'Only the league admin can void tickets.'; end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Provide a cancellation reason.'; end if;
 select * into v_wallet from public.user_wallets where id=v_ticket.user_wallet_id for update;
 if not found or v_wallet.balance is null then raise exception 'Wallet unavailable; no ticket was changed.'; end if;
 select * into v_ticket from public.tickets where id=p_ticket for update;
 if v_ticket.status='VOIDED' then return jsonb_build_object('duplicate',true,'balance',v_wallet.balance); end if;
 if v_ticket.status<>'OPEN' then raise exception 'Only open tickets can be voided.'; end if;
 update public.tickets set status='VOIDED',actual_payout=stake,settled_at=now() where id=p_ticket;
 update public.ticket_legs set status='VOIDED',result_evidence='Voided by league admin: '||trim(p_reason) where ticket_id=p_ticket;
 update public.user_wallets set balance=balance+v_ticket.stake,updated_at=now() where id=v_ticket.user_wallet_id;
 insert into public.user_wallet_entries(wallet_id,league_id,team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,reason)
 values(v_wallet.id,v_ticket.league_id,v_ticket.team_id,p_ticket,'ticket:void:'||p_ticket,'void_refund',v_ticket.stake,v_wallet.balance,v_wallet.balance+v_ticket.stake,'Ticket voided by admin: '||trim(p_reason));
 update public.email_deliveries set status='failed',last_error='Ticket voided; confirmation cancelled' where ticket_id=p_ticket and status<>'sent';
 return jsonb_build_object('duplicate',false,'balance',v_wallet.balance+v_ticket.stake,'refund',v_ticket.stake);
end $function$
;

revoke all on function sportsbook_private.user_void_sportsbook_ticket(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.void_sportsbook_ticket(p_ticket uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select user_wallet_id is not null from public.tickets where id=p_ticket) then return sportsbook_private.user_void_sportsbook_ticket(p_ticket,p_reason);end if;
 return sportsbook_private.legacy_void_sportsbook_ticket(p_ticket,p_reason);
end $$;
revoke all on function public.void_sportsbook_ticket(uuid,text) from public,anon,service_role;
grant execute on function public.void_sportsbook_ticket(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION sportsbook_private.legacy_replenish_weekly_balances(p_league uuid, p_season integer, p_week integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w record; k text; added integer:=0; blocked integer:=0; skipped integer:=0; committed numeric; target numeric;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can replenish balances.'; end if;
 if p_week not between 1 and 18 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Invalid season or week.'; end if;
 for w in select x.* from public.wallets x join public.teams t on t.id=x.team_id where t.league_id=p_league order by x.team_id for update of x loop
  k:='weekly:replenish:'||p_season||':'||p_week||':'||w.team_id;
  if exists(select 1 from public.wallet_ledger where event_key=k) then skipped:=skipped+1; continue; end if;
  if w.balance is null or exists(select 1 from public.tickets where team_id=w.team_id and ticket_type<>'future' and nfl_season=p_season and ((market_week>=p_week and status<>'VOIDED') or (market_week<p_week and status='OPEN'))) then blocked:=blocked+1; continue; end if;
  select coalesce(sum(stake),0) into committed from public.tickets where team_id=w.team_id and ticket_type='future' and status='OPEN';
  target:=greatest(25,100-committed);
  insert into public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
  values(w.team_id,k,'weekly_replenishment',greatest(0,target-w.balance),w.balance,greatest(target,w.balance),'Week '||p_week||' replenishment; open futures stakes $'||committed||'; cash floor $'||target);
  if w.balance<target then update public.wallets set balance=target,updated_at=now() where team_id=w.team_id; added:=added+1; end if;
 end loop;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary) values(p_league,p_season,p_week,'replenishment',jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped));
 return jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped);
end $function$
;

revoke all on function sportsbook_private.legacy_replenish_weekly_balances(uuid,integer,integer) from public,anon,authenticated,service_role;


create function sportsbook_private.user_replenish_weekly_balances(p_league uuid,p_season integer,p_week integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w record;k text;added integer:=0;blocked integer:=0;skipped integer:=0;committed numeric;target numeric;legacy_primary boolean;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can replenish balances.';end if;
 if p_week is null or p_week not between 1 and 18 or not exists(select 1 from public.leagues where id=p_league and nfl_season=p_season) then raise exception 'Invalid season or week.';end if;
 for w in select x.* from public.user_wallets x join auth.users a on a.id=x.user_id
  where x.league_id=p_league and x.status='approved' and a.email_confirmed_at is not null order by x.id for update of x loop
  k:='weekly:replenish:'||p_season||':'||p_week||':'||w.id;
  if exists(select 1 from public.user_wallet_entries where wallet_id=w.id and event_key=k) then skipped:=skipped+1;continue;end if;
  select exists(select 1 from public.league_memberships where league_id=p_league and user_id=w.user_id and team_id=w.team_id) into legacy_primary;
  if w.balance is null or exists(select 1 from public.tickets t where (t.user_wallet_id=w.id or (legacy_primary and t.user_wallet_id is null and t.team_id=w.team_id))
    and t.ticket_type<>'future' and t.nfl_season=p_season and ((t.market_week>=p_week and t.status<>'VOIDED') or (t.market_week<p_week and t.status='OPEN')))
  then blocked:=blocked+1;continue;end if;
  select coalesce(sum(t.stake),0) into committed from public.tickets t where t.status='OPEN' and t.ticket_type='future'
   and (t.user_wallet_id=w.id or (legacy_primary and t.user_wallet_id is null and t.team_id=w.team_id));
  target:=greatest(25,100-committed);
  insert into public.user_wallet_entries(wallet_id,league_id,team_id,event_key,kind,amount,balance_before,balance_after,reason)
   values(w.id,p_league,w.team_id,k,'weekly_replenishment',greatest(0,target-w.balance),w.balance,greatest(target,w.balance),
    'Week '||p_week||' replenishment; own open futures stakes $'||committed||'; cash floor $'||target);
  if w.balance<target then update public.user_wallets set balance=target,updated_at=clock_timestamp() where id=w.id;added:=added+1;end if;
 end loop;
 insert into public.weekly_execution_runs(league_id,nfl_season,market_week,operation,summary)
  values(p_league,p_season,p_week,'replenishment',jsonb_build_object('wallet_model','user','replenished',added,'blocked',blocked,'already_processed',skipped));
 return jsonb_build_object('replenished',added,'blocked',blocked,'already_processed',skipped);
end $$;
revoke all on function sportsbook_private.user_replenish_weekly_balances(uuid,integer,integer) from public,anon,authenticated,service_role;
create or replace function public.replenish_weekly_balances(p_league uuid,p_season integer,p_week integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if sportsbook_private.user_finance_enabled(p_league) then return sportsbook_private.user_replenish_weekly_balances(p_league,p_season,p_week);end if;
 return sportsbook_private.legacy_replenish_weekly_balances(p_league,p_season,p_week);
end $$;
revoke all on function public.replenish_weekly_balances(uuid,integer,integer) from public,anon,service_role;
grant execute on function public.replenish_weekly_balances(uuid,integer,integer) to authenticated;

create function public.set_user_wallet_balance(p_wallet uuid,p_expected numeric,p_balance numeric,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.user_wallets;e public.user_wallet_entries;
begin
 select * into w from public.user_wallets where id=p_wallet for update;
 if not found or not sportsbook_private.is_admin(w.league_id) or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'League operator required.';end if;
 if p_request is null or p_reason is null or length(trim(p_reason)) not between 8 and 500 or p_balance is null or p_balance::text in ('NaN','Infinity','-Infinity')
  or p_balance<0 or p_balance>9999999999.99 or p_balance<>round(p_balance,2) then raise exception 'Valid whole-cent balance, review reason and request required.';end if;
 select * into e from public.user_wallet_entries where wallet_id=w.id and request_key=p_request;
 if found then
  if e.kind<>'adjustment' or e.balance_after<>p_balance or e.metadata->'expected' is distinct from coalesce(to_jsonb(p_expected),'null'::jsonb)
   or e.reason<>trim(p_reason) then raise exception 'Request already used for another financial change.';end if;
  return jsonb_build_object('wallet_id',w.id,'balance',w.balance,'duplicate',true);
 end if;
 if w.balance is null or w.status<>'approved' then raise exception 'Owner-initialized approved wallet required.';end if;
 if w.balance is distinct from p_expected then raise exception 'Balance changed; review again.';end if;
 insert into public.user_wallet_entries(wallet_id,league_id,team_id,event_key,request_key,kind,amount,balance_before,balance_after,reason,metadata)
  values(w.id,w.league_id,w.team_id,'adjustment:'||p_request,p_request,'adjustment',p_balance-w.balance,w.balance,p_balance,trim(p_reason),jsonb_build_object('expected',p_expected,'actor_id',auth.uid()));
 update public.user_wallets set balance=p_balance,updated_at=clock_timestamp() where id=w.id;
 return jsonb_build_object('wallet_id',w.id,'balance',p_balance,'duplicate',false);
end $$;
revoke all on function public.set_user_wallet_balance(uuid,numeric,numeric,text,uuid) from public,anon,service_role;
grant execute on function public.set_user_wallet_balance(uuid,numeric,numeric,text,uuid) to authenticated;

create function public.set_user_wallet_status(p_wallet uuid,p_expected integer,p_status text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare w public.user_wallets;
begin
 if not sportsbook_private.is_platform_owner() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
  then raise exception 'Platform owner required.';end if;
 if p_status is null or p_status not in ('approved','revoked') or p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Reviewed status and reason required.';end if;
 select * into w from public.user_wallets where id=p_wallet for update;
 if not found or p_expected is distinct from w.revision then raise exception 'Financial approval changed; refresh.';end if;
 if p_status='approved' and not exists(select 1 from auth.users where id=w.user_id and email_confirmed_at is not null) then raise exception 'Verified user required.';end if;
 update public.user_wallets set status=p_status,revision=revision+1,updated_at=clock_timestamp() where id=w.id;
 insert into sportsbook_private.user_wallet_approvals(wallet_id,actor,reason) values(w.id,auth.uid(),'Status '||w.status||' to '||p_status||': '||trim(p_reason));
 return w.revision+1;
end $$;
revoke all on function public.set_user_wallet_status(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.set_user_wallet_status(uuid,integer,text,text) to authenticated;


-- Accepted ticket ownership determines the confirmation recipient. A new user
-- ticket may never fall back to the legacy team's primary email address.
create or replace function sportsbook_private.guard_outbox_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  perform 1 from public.leagues where id=new.league_id for share;
  new.wallet_model:=case when exists(select 1 from sportsbook_private.user_finance_modes where league_id=new.league_id and enabled) then 'user' else 'legacy' end;
 elsif new.wallet_model is distinct from old.wallet_model then raise exception 'Queued financial model is immutable.';end if;
 if tg_op='UPDATE' and new.payload is null and old.payload is not null
  and row(new.league_id,new.team_id,new.ticket_id,new.recipient,new.kind) is not distinct from
      row(old.league_id,old.team_id,old.ticket_id,old.recipient,old.kind) then return new;end if;
 if exists(select 1 from public.tickets where id=new.ticket_id and user_wallet_id is not null) then
  if new.kind<>'confirmation' or not exists(select 1 from public.tickets t join public.user_wallets w on w.id=t.user_wallet_id
   join auth.users a on a.id=w.user_id where t.id=new.ticket_id and t.league_id=new.league_id and t.team_id=new.team_id
    and w.status='approved' and a.email_confirmed_at is not null and a.email=new.recipient)
  then raise exception 'Confirmation must target the accepted financial account owner.';end if;
 elsif new.wallet_model='user' and new.ticket_id is null and new.kind<>'attention' then
  if not exists(select 1 from public.user_wallets w join auth.users a on a.id=w.user_id
    where w.league_id=new.league_id and w.team_id=new.team_id and w.status='approved'
     and a.email_confirmed_at is not null and a.email=new.recipient)
   then raise exception 'Email must target an approved financial account owner.';end if;
 elsif new.team_id is null or not exists(select 1 from public.league_memberships m where m.league_id=new.league_id
  and m.team_id=new.team_id and m.invited_email=new.recipient and (new.kind<>'attention' or m.role='admin'))
 then raise exception 'Email recipient must match the approved league membership.';end if;
 if new.payload is not null and (new.payload->'to' is distinct from jsonb_build_array(new.recipient) or new.payload ? 'cc' or new.payload ? 'bcc')
 then raise exception 'Email payload recipients must match the outbox recipient.';end if;
 return new;
end $$;


drop trigger outbox_recipient_guard on public.outbound_emails;
create trigger outbox_recipient_guard before insert or update of league_id,team_id,ticket_id,recipient,payload,wallet_model
 on public.outbound_emails for each row execute function sportsbook_private.guard_outbox_recipient();

create function public.financial_email_recipient(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Mail worker only.';end if;
 if not exists(select 1 from public.tickets where id=p_ticket and user_wallet_id is not null) then return null;end if;
 select jsonb_build_object('wallet_id',w.id,'user_id',w.user_id,'league_id',t.league_id,'team_id',t.team_id,
  'recipient',a.email,'display_name',w.display_name,'balance',w.balance,
  'accepted_balance',(select balance_after from public.user_wallet_entries where wallet_id=w.id and ticket_id=t.id and kind='wager')) into result
 from public.tickets t join public.user_wallets w on w.id=t.user_wallet_id join auth.users a on a.id=w.user_id
 where t.id=p_ticket and w.status='approved' and a.email_confirmed_at is not null;
 if result is null then raise exception 'Accepted financial recipient is no longer approved or verified.';end if;
 if result->'accepted_balance'='null'::jsonb then raise exception 'Accepted wager receipt is unavailable.';end if;
 return result;
end $$;
revoke all on function public.financial_email_recipient(uuid) from public,anon,authenticated;
grant execute on function public.financial_email_recipient(uuid) to service_role;


create function public.financial_email_context(p_league uuid,p_team uuid,p_recipient text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Mail worker only.';end if;
 if not exists(select 1 from sportsbook_private.user_finance_modes where league_id=p_league and enabled) then return null;end if;
 select jsonb_build_object('wallet_id',w.id,'user_id',w.user_id,'league_id',w.league_id,'team_id',w.team_id,
  'recipient',a.email,'display_name',w.display_name,'balance',w.balance) into result
 from public.user_wallets w join auth.users a on a.id=w.user_id where w.league_id=p_league and w.team_id=p_team
  and w.status='approved' and a.email_confirmed_at is not null and a.email=p_recipient;
 if result is null then raise exception 'Financial recipient is pending approval or verification.';end if;
 if (select count(*) from public.user_wallets where league_id=p_league)>128 then raise exception 'Financial email participant budget exceeded.';end if;
 result:=result||coalesce((select jsonb_build_object('rank',r.rank,'participants',r.participants) from (
  select w.id,row_number() over(order by x.profit desc,x.bets desc,w.id) rank,count(*) over() participants
  from public.user_wallets w cross join lateral(select count(*) bets,coalesce(sum(t.net_profit) filter(where t.status<>'OPEN'),0) profit
   from public.tickets t where t.user_wallet_id=w.id and t.status<>'VOIDED') x where w.league_id=p_league
 ) r where r.id=(result->>'wallet_id')::uuid),'{}'::jsonb);
 return result;
end $$;
revoke all on function public.financial_email_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.financial_email_context(uuid,uuid,text) to service_role;

commit;

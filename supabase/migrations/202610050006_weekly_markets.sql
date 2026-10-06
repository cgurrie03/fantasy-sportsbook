begin;
create table public.sportsbook_boards (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id),
 market_week integer not null check(market_week between 1 and 18), nfl_season integer not null, league_season integer not null,
 status text not null default 'draft' check(status in ('draft','published','closed')), revision integer not null default 1,
 opens_at timestamptz not null, closes_at timestamptz not null check(closes_at>opens_at),
 unique(league_id,nfl_season,market_week)
);
create table public.sportsbook_markets (
 id uuid primary key, board_id uuid not null references public.sportsbook_boards(id), market_key text not null, matchup_key text,
 kind text not null check(kind in ('spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low')),
 label text not null check(length(label) between 1 and 160), subject text not null, side text not null,
 line numeric(8,2), odds integer not null check(abs(odds::bigint) between 100 and 100000),
 boost_pct integer not null default 0 check(boost_pct in (0,25)),
 team_id uuid references public.teams(id), home_team_id uuid references public.teams(id), away_team_id uuid references public.teams(id),
 home_projection numeric(8,2), away_projection numeric(8,2),
 featured text not null default '' check(featured in ('','Game of the Week','Tank Bowl')),
 metadata jsonb not null default '{}', active boolean not null default true,
 check(home_team_id is null or home_team_id<>away_team_id), unique(board_id,market_key,side)
);
create index sportsbook_boards_league_idx on public.sportsbook_boards(league_id);
create index sportsbook_markets_board_idx on public.sportsbook_markets(board_id);
create index sportsbook_markets_team_idx on public.sportsbook_markets(team_id);
create index sportsbook_markets_home_idx on public.sportsbook_markets(home_team_id);
create index sportsbook_markets_away_idx on public.sportsbook_markets(away_team_id);
alter table public.sportsbook_boards enable row level security;
alter table public.sportsbook_markets enable row level security;
revoke all on public.sportsbook_boards,public.sportsbook_markets from anon,authenticated;
grant select on public.sportsbook_boards,public.sportsbook_markets to authenticated;
create policy board_read on public.sportsbook_boards for select to authenticated using(sportsbook_private.is_member(league_id) and (status<>'draft' or sportsbook_private.is_admin(league_id)));
create policy market_read on public.sportsbook_markets for select to authenticated using(exists(select 1 from public.sportsbook_boards b where b.id=board_id));
alter table public.tickets add column request_key uuid unique;
alter table public.ticket_legs add column market_quote_id uuid references public.sportsbook_markets(id);
alter table public.ticket_legs add column accepted_decimal_odds numeric(18,10);
alter table public.ticket_legs add column settlement_context jsonb;
create index ticket_legs_quote_idx on public.ticket_legs(market_quote_id);
alter table public.wallet_ledger drop constraint wallet_ledger_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check check(kind in ('historical_opening','settlement','weekly_replenishment','wager'));
create table public.email_deliveries (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null unique references public.tickets(id),
 recipient text not null, kind text not null default 'ticket_confirmation',
 status text not null default 'pending' check(status in ('pending','sent','failed')),
 attempts integer not null default 0, provider_id text, last_error text, created_at timestamptz not null default now(), sent_at timestamptz
);
alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from public,anon,authenticated;
grant select,insert,update on public.email_deliveries to service_role;
create index email_deliveries_pending_idx on public.email_deliveries(created_at) where status<>'sent';

create function public.save_market_board(p_board uuid,p_league uuid,p_week integer,p_opens timestamptz,p_closes timestamptz,p_quotes jsonb,p_status text default 'draft') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_league public.leagues; v_quote jsonb; v_board public.sportsbook_boards;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can manage markets.'; end if;
 if p_status is null or p_quotes is null or p_status not in ('draft','published','closed') or jsonb_typeof(p_quotes)<>'array' or jsonb_array_length(p_quotes)>1500 then raise exception 'Invalid market board.'; end if;
 if p_status='published' and (p_closes<=now() or jsonb_array_length(p_quotes)=0) then raise exception 'Add markets and a future cutoff before publishing.'; end if;
 select * into v_league from public.leagues where id=p_league;
 select * into v_board from public.sportsbook_boards where id=p_board for update;
 if found and (v_board.league_id<>p_league or v_board.market_week<>p_week) then raise exception 'Board identity does not match this league and week.'; end if;
 insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status)
 values(p_board,p_league,p_week,v_league.nfl_season,v_league.league_season,p_opens,p_closes,p_status)
 on conflict(id) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at,status=excluded.status,revision=public.sportsbook_boards.revision+1;
 update public.sportsbook_markets set active=false where board_id=p_board;
 for v_quote in select value from jsonb_array_elements(p_quotes) loop
   if exists(select 1 from public.sportsbook_markets where id=(v_quote->>'id')::uuid and board_id<>p_board) then raise exception 'A quote belongs to a different board.'; end if;
   if exists(select 1 from (values(nullif(v_quote->>'team_id','')::uuid),(nullif(v_quote->>'home_team_id','')::uuid),(nullif(v_quote->>'away_team_id','')::uuid)) x(id) where x.id is not null and not exists(select 1 from public.teams t where t.id=x.id and t.league_id=p_league)) then raise exception 'Market teams must belong to this league.'; end if;
   if (v_quote->>'boost_pct')::int=25 and not ((v_quote->>'featured'='Game of the Week' and v_quote->>'kind'='moneyline') or (v_quote->>'featured'='Tank Bowl' and (v_quote->>'kind'='moneyline' or (v_quote->>'kind'='match_total' and v_quote->>'side'='over')))) then raise exception 'This selection is not eligible for the featured boost.'; end if;
   insert into public.sportsbook_markets(id,board_id,market_key,matchup_key,kind,label,subject,side,line,odds,boost_pct,team_id,home_team_id,away_team_id,home_projection,away_projection,featured,metadata)
   values((v_quote->>'id')::uuid,p_board,v_quote->>'market_key',nullif(v_quote->>'matchup_key',''),v_quote->>'kind',v_quote->>'label',v_quote->>'subject',v_quote->>'side',(v_quote->>'line')::numeric,(v_quote->>'odds')::int,coalesce((v_quote->>'boost_pct')::int,0),(v_quote->>'team_id')::uuid,(v_quote->>'home_team_id')::uuid,(v_quote->>'away_team_id')::uuid,(v_quote->>'home_projection')::numeric,(v_quote->>'away_projection')::numeric,coalesce(v_quote->>'featured',''),coalesce(v_quote->'metadata','{}'))
   on conflict(id) do update set market_key=excluded.market_key,matchup_key=excluded.matchup_key,kind=excluded.kind,label=excluded.label,subject=excluded.subject,side=excluded.side,line=excluded.line,odds=excluded.odds,boost_pct=excluded.boost_pct,team_id=excluded.team_id,home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,home_projection=excluded.home_projection,away_projection=excluded.away_projection,featured=excluded.featured,metadata=excluded.metadata,active=true;
 end loop;
 return p_board;
end $$;

create function public.place_sportsbook_ticket(p_board uuid,p_revision integer,p_picks uuid[],p_stake numeric,p_request uuid) returns jsonb
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
 if p_picks is null or cardinality(p_picks) not between 2 and 10 or (select count(distinct x) from unnest(p_picks) x)<>cardinality(p_picks) then raise exception 'Select 2–10 distinct picks.'; end if;
 if (select count(*) from public.sportsbook_markets where id=any(p_picks) and board_id=p_board and active)<>cardinality(p_picks) then raise exception 'A selection is no longer available.'; end if;
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
revoke all on function public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text),public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid) from public,anon;
grant execute on function public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text),public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid) to authenticated;
commit;

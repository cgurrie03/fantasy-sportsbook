begin;
create table public.promo_images (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),
 png text not null check(length(png) between 32 and 6990508),created_at timestamptz not null default now(),unique(id,league_id)
);
create index promo_images_league_idx on public.promo_images(league_id);
create table public.promo_offers (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),
 nfl_season integer not null,market_week integer not null check(market_week between 1 and 18),slot integer not null check(slot between 1 and 3),
 kind text not null check(kind in ('boost','fixed')),title text not null check(length(title) between 1 and 120),description text not null check(length(description) between 1 and 500),
 image_id uuid not null,expires_at timestamptz not null,status text not null default 'draft' check(status in ('draft','scheduled','disabled')),
 activated_at timestamptz,version integer not null default 1,terms jsonb not null,created_at timestamptz not null default now(),
 foreign key(image_id,league_id) references public.promo_images(id,league_id),unique(id,league_id)
);
create unique index promo_slot_idx on public.promo_offers(league_id,nfl_season,market_week,slot) where status='scheduled';
create index promo_league_week_idx on public.promo_offers(league_id,nfl_season,market_week);
create table public.promo_claims (
 offer_id uuid not null,league_id uuid not null,user_id uuid not null,used_ticket uuid references public.tickets(id),claimed_at timestamptz not null default now(),
 primary key(offer_id,user_id),foreign key(offer_id,league_id) references public.promo_offers(id,league_id)
);
create index promo_claim_user_idx on public.promo_claims(league_id,user_id);
create table public.ticket_promotions (
 ticket_id uuid primary key,league_id uuid not null,team_id uuid not null,user_id uuid not null,offer_id uuid not null,
 kind text not null check(kind in ('boost','fixed')),boost_pct numeric not null default 0,base_decimal numeric not null check(base_decimal>1),terms jsonb not null,
 foreign key(ticket_id,league_id,team_id) references public.tickets(id,league_id,team_id),foreign key(offer_id,league_id) references public.promo_offers(id,league_id)
);
create index ticket_promotions_offer_idx on public.ticket_promotions(offer_id,user_id);
create table public.promo_events (
 id uuid primary key default gen_random_uuid(),league_id uuid not null,offer_id uuid not null,user_id uuid,event text not null,
 ticket_id uuid references public.tickets(id),details jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(offer_id,league_id) references public.promo_offers(id,league_id)
);
create index promo_events_offer_date_idx on public.promo_events(league_id,offer_id,created_at desc);
alter table public.promo_images enable row level security;
alter table public.promo_offers enable row level security;
alter table public.promo_claims enable row level security;
alter table public.ticket_promotions enable row level security;
alter table public.promo_events enable row level security;
revoke all on public.promo_images,public.promo_offers,public.promo_claims,public.ticket_promotions,public.promo_events from public,anon,authenticated;
grant select on public.promo_offers,public.promo_claims,public.ticket_promotions,public.promo_events to authenticated;
create policy promo_admin_read on public.promo_offers for select to authenticated using(sportsbook_private.is_admin(league_id));
create policy promo_claim_read on public.promo_claims for select to authenticated using(sportsbook_private.is_member(league_id) and (user_id=(select auth.uid()) or sportsbook_private.is_admin(league_id)));
create policy ticket_promo_read on public.ticket_promotions for select to authenticated using(sportsbook_private.is_member(league_id));
create policy promo_events_read on public.promo_events for select to authenticated using(sportsbook_private.is_admin(league_id));

create function sportsbook_private.promo_available(o public.promo_offers) returns boolean language sql volatile set search_path='' as $$
 select o.status='scheduled' and o.activated_at is not null and o.activated_at<=clock_timestamp() and o.expires_at>clock_timestamp()
 and exists(select 1 from public.sportsbook_period(o.league_id) p where p.week=o.market_week and p.nfl_season=o.nfl_season)
$$;
create function public.list_promos(p_league uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League membership required.';end if;
 return coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('claimed',c.offer_id is not null,'used',c.used_ticket is not null) order by slot)
 from public.promo_offers o left join public.promo_claims c on c.offer_id=o.id and c.user_id=auth.uid()
 where o.league_id=p_league and sportsbook_private.promo_available(o)),'[]');
end $$;
-- Images are private data, fetched only after authentication. Upload API validates
-- and decodes PNG bytes before calling this service-only function.
create function public.store_promo_image(p_league uuid,p_user uuid,p_png text) returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.league_memberships where league_id=p_league and user_id=p_user and role='admin') then raise exception 'League admin required.';end if;
 insert into public.promo_images(league_id,png) values(p_league,p_png) returning id into i;return i;
end $$;
create function public.read_promo_image(p_image uuid) returns text language plpgsql security definer set search_path='' as $$
declare i public.promo_images;
begin
 select * into i from public.promo_images where id=p_image;
 if not found or not sportsbook_private.is_member(i.league_id) then raise exception 'Image unavailable.';end if;
 if not sportsbook_private.is_admin(i.league_id) and not exists(select 1 from public.promo_offers o where o.image_id=i.id and sportsbook_private.promo_available(o)) then raise exception 'Image unavailable.';end if;
 return i.png;
end $$;
create function public.save_promo(p_league uuid,p_id uuid,p_version integer,p_offer jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.promo_offers;l public.leagues;t jsonb:=p_offer->'terms';q public.sportsbook_markets; leg jsonb; frozen jsonb:='[]'; st text:=p_offer->>'status'; at timestamptz;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required.';end if;
 select * into strict l from public.leagues where id=p_league;
 if p_offer->>'kind' not in ('boost','fixed') or st not in ('draft','scheduled') or st is null or p_offer->>'kind' is null then raise exception 'Invalid offer type or state.';end if;
 if (p_offer->>'expires_at')::timestamptz<=now() then raise exception 'Choose a future expiry.';end if;
 if p_id is not null then
  select * into o from public.promo_offers where id=p_id and league_id=p_league for update;
  if not found or o.version is distinct from p_version then raise exception 'Offer changed. Reload before saving.';end if;
  if o.status<>'draft' then raise exception 'Advertised terms are locked. Create a new draft version.';end if;
 end if;
 if p_offer->>'kind'='boost' then
  if t->>'criterion' not in ('points_min','points_exact','spreads_min','parlay_min','category','featured') or t->>'criterion' is null or
   (t->>'count')::int not between 1 and 10 or (t->>'count') is null or (t->>'percent')::numeric not between 1 and 1000 or t->>'percent' is null or
   (t->>'max_stake')::numeric<1 or t->>'max_stake' is null then raise exception 'Choose valid eligibility, percentage and maximum wager.';end if;
  if t->>'criterion'='category' and (t->>'category' is null or t->>'category' not in ('player_points','spread','moneyline','match_total','team_total','weekly')) then raise exception 'Choose an approved category.';end if;
  if length(coalesce(t->>'code',''))>40 or (t->>'max_stake')::numeric<>round((t->>'max_stake')::numeric,2) or (t->>'max_stake')::numeric>9999999999.99 then raise exception 'Use a code up to 40 characters and a whole-cent maximum wager.';end if;
  if t->>'criterion'='featured' and not exists(select 1 from public.sportsbook_markets m join public.sportsbook_boards b on b.id=m.board_id where b.league_id=p_league and b.nfl_season=l.nfl_season and b.market_week=(p_offer->>'week')::int and m.matchup_key=t->>'matchup') then raise exception 'Choose a matchup from this league and week.';end if;
  t:=jsonb_build_object('criterion',t->>'criterion','count',(t->>'count')::int,'percent',(t->>'percent')::numeric,'max_stake',(t->>'max_stake')::numeric,'category',t->>'category','matchup',t->>'matchup','code',upper(trim(coalesce(t->>'code',''))));
 else
  if jsonb_typeof(t->'legs') is distinct from 'array' or jsonb_array_length(t->'legs') not between 2 and 10 then raise exception 'Choose 2–10 fixed selections.';end if;
  for leg in select value from jsonb_array_elements(t->'legs') loop
   select m.* into q from public.sportsbook_markets m join public.sportsbook_boards b on b.id=m.board_id where m.id=(leg->>'id')::uuid and b.league_id=p_league and b.market_week=(p_offer->>'week')::int and b.nfl_season=l.nfl_season and b.board_type='weekly';
   if not found then raise exception 'Fixed selections must belong to this league and week.';end if;
   if q.boost_pct>0 or q.kind like 'future_%' then raise exception 'Fixed offers cannot stack featured boosts or futures.';end if;
   q.line:=coalesce((leg->>'line')::numeric,q.line);q.odds:=(leg->>'odds')::int;q.label:=leg->>'label';q.active:=true;q.market_state:='open';q.suspension_reason:=null;
   if abs(q.odds::bigint) not between 100 and 100000 or q.odds is null or length(q.label) not between 1 and 160 or q.label is null then raise exception 'Enter valid saved labels and odds.';end if;
   if exists(select 1 from jsonb_populate_recordset(null::public.sportsbook_markets,frozen) f where f.id=q.id or f.market_key=q.market_key or public.sportsbook_special_conflict(f,q) or (f.matchup_key=q.matchup_key and ((f.kind='spread' and q.kind='moneyline') or (f.kind='moneyline' and q.kind='spread')))) then raise exception 'Fixed selections are incompatible.';end if;
   frozen:=frozen||jsonb_build_array(to_jsonb(q));
  end loop;
  if t->>'fixed_stake' is not null and ((t->>'fixed_stake')::numeric<1 or (t->>'fixed_stake')::numeric<>round((t->>'fixed_stake')::numeric,2)) then raise exception 'Fixed wager must be whole cents and at least $1.';end if;
  t:=jsonb_build_object('legs',frozen,'fixed_stake',(t->>'fixed_stake')::numeric);
 end if;
 if st='scheduled' then select greatest(now(),b.opens_at) into at from public.sportsbook_boards b where b.league_id=p_league and b.nfl_season=l.nfl_season and b.market_week=(p_offer->>'week')::int and b.board_type='weekly' and b.status='published';end if;
 if p_id is null then
  insert into public.promo_offers(league_id,nfl_season,market_week,slot,kind,title,description,image_id,expires_at,status,terms,activated_at)
  values(p_league,l.nfl_season,(p_offer->>'week')::int,(p_offer->>'slot')::int,p_offer->>'kind',trim(p_offer->>'title'),trim(p_offer->>'description'),(p_offer->>'image_id')::uuid,(p_offer->>'expires_at')::timestamptz,st,t,at) returning id into p_id;
 else
  update public.promo_offers set market_week=(p_offer->>'week')::int,slot=(p_offer->>'slot')::int,kind=p_offer->>'kind',title=trim(p_offer->>'title'),description=trim(p_offer->>'description'),image_id=(p_offer->>'image_id')::uuid,expires_at=(p_offer->>'expires_at')::timestamptz,status=st,terms=t,activated_at=at,version=version+1 where id=p_id;
 end if;
 insert into public.promo_events(league_id,offer_id,user_id,event,details) values(p_league,p_id,auth.uid(),st,jsonb_build_object('title',p_offer->>'title'));
 return p_id;
end $$;
create function public.pause_promo(p_offer uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.promo_offers;
begin
 select * into o from public.promo_offers where id=p_offer for update;
 if not found or not sportsbook_private.is_admin(o.league_id) then raise exception 'League admin required.';end if;
 update public.promo_offers set status='disabled' where id=p_offer;
 insert into public.promo_events(league_id,offer_id,user_id,event) values(o.league_id,o.id,auth.uid(),'disabled');
end $$;
create function public.promo_usage(p_league uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('offer_id',o.id,
 'claims',(select count(*) from public.promo_claims c where c.offer_id=o.id),
 'redemptions',(select count(*) from public.ticket_promotions p where p.offer_id=o.id),
 'extra_paid',coalesce((select sum(round((t.actual_payout-t.stake)*p.boost_pct/(100+p.boost_pct),2)) from public.ticket_promotions p join public.tickets t on t.id=p.ticket_id where p.offer_id=o.id and p.kind='boost' and t.status='WON'),0),
 'extra_liability',coalesce((select sum(t.accepted_potential_payout-round(t.stake*p.base_decimal,2)) from public.ticket_promotions p join public.tickets t on t.id=p.ticket_id where p.offer_id=o.id and p.kind='boost' and t.status='OPEN'),0))) from public.promo_offers o where o.league_id=p_league),'[]');
end $$;
create function sportsbook_private.activate_promos() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='published' and new.board_type='weekly' then update public.promo_offers set activated_at=greatest(now(),new.opens_at) where league_id=new.league_id and nfl_season=new.nfl_season and market_week=new.market_week and status='scheduled' and activated_at is null;end if;return new;
end $$;
create trigger activate_promos after insert or update of status on public.sportsbook_boards for each row execute function sportsbook_private.activate_promos();
create function public.claim_promo(p_offer uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.promo_offers;
begin
 select * into o from public.promo_offers where id=p_offer for share;
 if not found or not sportsbook_private.is_member(o.league_id) or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 insert into public.promo_claims(offer_id,league_id,user_id) values(o.id,o.league_id,auth.uid()) on conflict do nothing;
 if found then insert into public.promo_events(league_id,offer_id,user_id,event) values(o.league_id,o.id,auth.uid(),'claimed');end if;
end $$;
create function sportsbook_private.validate_boost(p_offer uuid,p_board uuid,p_picks uuid[],p_stake numeric) returns public.promo_offers language plpgsql set search_path='' as $$
declare o public.promo_offers;c public.promo_claims;b public.sportsbook_boards;n integer;distinct_n integer;
begin
 select * into o from public.promo_offers where id=p_offer for share;
 select * into b from public.sportsbook_boards where id=p_board;
 if not found or o.id is null or o.kind<>'boost' or o.league_id<>b.league_id or o.nfl_season<>b.nfl_season or o.market_week<>b.market_week or not sportsbook_private.promo_available(o) then raise exception 'Offer unavailable or expired.';end if;
 select * into c from public.promo_claims where offer_id=o.id and user_id=auth.uid() for update;
 if not found or c.used_ticket is not null then raise exception 'Claim this boost first; each boost can be used once.';end if;
 if p_stake>(o.terms->>'max_stake')::numeric then raise exception 'Maximum wager with this boost is %.',o.terms->>'max_stake';end if;
 if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and (boost_pct>0 or kind like 'future_%')) then raise exception 'Boosts cannot stack with featured boosts or futures.';end if;
 n:=cardinality(p_picks);
 if n<(o.terms->>'count')::int or (o.terms->>'criterion'='points_exact' and n<>(o.terms->>'count')::int) then raise exception 'Selection count does not qualify.';end if;
 if o.terms->>'criterion' in ('points_min','points_exact') then
  select count(distinct metadata->>'player_id') into distinct_n from public.sportsbook_markets where id=any(p_picks) and kind='player_points';
  if distinct_n<>n then raise exception 'Every selection must be Player Points from a distinct player.';end if;
 elsif o.terms->>'criterion'='spreads_min' then
  select count(distinct matchup_key) into distinct_n from public.sportsbook_markets where id=any(p_picks) and kind='spread';
  if distinct_n<>n then raise exception 'Every selection must be a spread from a distinct matchup.';end if;
 elsif o.terms->>'criterion'='category' then
  if exists(select 1 from public.sportsbook_markets where id=any(p_picks) and case when o.terms->>'category'='weekly' then kind not like 'weekly_%' else kind<>o.terms->>'category' end) then raise exception 'Selections do not match the approved category.';end if;
 elsif o.terms->>'criterion'='featured' then
  if not exists(select 1 from public.sportsbook_markets where id=any(p_picks) and matchup_key=o.terms->>'matchup') then raise exception 'Include the designated matchup.';end if;
 end if;
 return o;
end $$;
-- Copy the latest ordinary acceptance body with all its compatibility/freshness
-- checks; only add explicit boost validation, profit pricing and immutable audit.
do $$ declare d text;a text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into d;
 d:=replace(d,'place_sportsbook_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid)','place_boosted_ticket(p_board uuid, p_revision integer, p_picks uuid[], p_stake numeric, p_request uuid, p_offer uuid)');
 d:=replace(d,'declare v_board','declare promo public.promo_offers; base_price numeric; v_board');
 a:='if p_request is null or p_stake is null';
 if position(a in d)=0 then raise exception 'Boost validation anchor missing.';end if;
 d:=replace(d,a,'promo:=sportsbook_private.validate_boost(p_offer,p_board,p_picks,p_stake);'||chr(10)||a);
 a:='v_price_int:=round(case';
 if position(a in d)=0 then raise exception 'Boost pricing anchor missing.';end if;
 d:=replace(d,a,'base_price:=v_price; v_price:=1+(v_price-1)*(1+(promo.terms->>''percent'')::numeric/100);'||chr(10)||a);
 a:='return jsonb_build_object(''ticket_id'',v_id,''balance'',v_wallet.balance-p_stake,''duplicate'',false);';
 if position(a in d)=0 then raise exception 'Boost audit anchor missing.';end if;
 d:=replace(d,a,'insert into public.ticket_promotions values(v_id,promo.league_id,v_member.team_id,auth.uid(),promo.id,''boost'',(promo.terms->>''percent'')::numeric,base_price,to_jsonb(promo));
 update public.promo_claims set used_ticket=v_id where offer_id=promo.id and user_id=auth.uid();
 insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(promo.league_id,promo.id,auth.uid(),''redeemed'',v_id);'||a);
 -- Reject an ordinary or different-offer request ID on a boost retry.
 d:=replace(d,'if v_ticket.team_id<>v_member.team_id then','if not exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id and offer_id=p_offer and user_id=auth.uid()) then raise exception ''Request identifier already used for another offer.'';end if; if v_ticket.team_id<>v_member.team_id then');
 if position('place_boosted_ticket' in d)=0 then raise exception 'Boost function header anchor missing.';end if;
 execute d;
 -- Ordinary retries must not treat an accepted promotion as an ordinary ticket.
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into d;
 a:='if v_ticket.team_id<>v_member.team_id then';
 if position(a in d)=0 then raise exception 'Ordinary retry anchor missing.';end if;
 d:=replace(d,a,'if exists(select 1 from public.ticket_promotions where ticket_id=v_ticket.id) then raise exception ''Request identifier already used for a promotion.'';end if; '||a);
 execute d;
end $$;
create function public.place_fixed_ticket(p_offer uuid,p_stake numeric,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
do $$ declare d text;a text;
begin
 select pg_get_functiondef('public.settle_weekly_ticket(uuid,jsonb)'::regprocedure) into d;
 a:='v_payout:=case when v_lost';
 if position(a in d)=0 then raise exception 'Promo settlement anchor missing.';end if;
 d:=replace(d,a,'if v_won and not v_lost then v_price:=1+(v_price-1)*(1+coalesce((select boost_pct from public.ticket_promotions where ticket_id=p_ticket and kind=''boost''),0)/100);end if; '||a);
 execute d;
end $$;
create function sportsbook_private.promo_void_restore() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.ticket_promotions;
begin
 if new.status='VOIDED' and old.status<>'VOIDED' then
  select * into p from public.ticket_promotions where ticket_id=new.id;
  -- Fixed offers stay used; no separate restoration decision was approved.
  if found and p.kind='boost' then
   update public.promo_claims set used_ticket=null where offer_id=p.offer_id and user_id=p.user_id and used_ticket=new.id;
   if found then insert into public.promo_events(league_id,offer_id,user_id,event,ticket_id) values(p.league_id,p.offer_id,p.user_id,'restored',new.id);end if;
  end if;
 end if;return new;
end $$;
create trigger promo_void_restore after update of status on public.tickets for each row execute function sportsbook_private.promo_void_restore();
create function sportsbook_private.promo_snapshot_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Promotion snapshots and events are immutable.';end $$;
create trigger promo_snapshot_immutable before update or delete on public.ticket_promotions for each row execute function sportsbook_private.promo_snapshot_immutable();
create trigger promo_event_immutable before update or delete on public.promo_events for each row execute function sportsbook_private.promo_snapshot_immutable();
revoke all on function sportsbook_private.promo_available(public.promo_offers),sportsbook_private.activate_promos(),sportsbook_private.validate_boost(uuid,uuid,uuid[],numeric),sportsbook_private.promo_void_restore(),sportsbook_private.promo_snapshot_immutable() from public,anon,authenticated;
revoke all on function public.list_promos(uuid),public.read_promo_image(uuid),public.save_promo(uuid,uuid,integer,jsonb),public.pause_promo(uuid),public.promo_usage(uuid),public.claim_promo(uuid),public.place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid),public.place_fixed_ticket(uuid,numeric,uuid),public.store_promo_image(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.list_promos(uuid),public.read_promo_image(uuid),public.save_promo(uuid,uuid,integer,jsonb),public.pause_promo(uuid),public.promo_usage(uuid),public.claim_promo(uuid),public.place_boosted_ticket(uuid,integer,uuid[],numeric,uuid,uuid),public.place_fixed_ticket(uuid,numeric,uuid) to authenticated;
grant execute on function public.store_promo_image(uuid,uuid,text) to service_role;
commit;

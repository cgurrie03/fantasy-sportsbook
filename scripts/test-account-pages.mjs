import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {buildBalanceHistory} from '../src/lib/balanceHistory.ts';
const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const owner=randomUUID(),other=randomUUID(),A=randomUUID(),B=randomUUID(),TA=randomUUID(),TB=randomUUID();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 for(const f of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='202610280055'))await db.exec(await fs.readFile('supabase/migrations/'+f,'utf8'));
 for(const [id,email]of[[owner,'page-owner@example.test'],[other,'page-other@example.test']])await q('insert into auth.users values($1,$2,now())',[id,email]);
 await q("insert into sportsbook_private.import_batches(id,source_url) values('synthetic-pages','https://example.invalid/synthetic')");
 for(const [league,team]of[[A,TA],[B,TB]]){
  await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season) values($1::uuid,'Page fixture',($1::uuid)::text,2026,1)`,[league]);
  await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
   values($1,$2,1,'Fixture team','fixture','Fixture owner','fixture','Fixture owner')`,[team,league]);
  await q(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)
   values($1,$2,$3,'page-owner@example.test','Page owner','fixture','admin')`,[league,team,owner]);
  await q(`insert into tickets(source_batch,league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,stake,accepted_combined_odds,
   accepted_potential_payout,status,actual_payout,settled_at,legacy_ticket_id,ticket_type,source_record)
   select 'synthetic-pages',$1,$2,1,2026,(i%18)+1,(i%18)+1,now()-interval '1 day'-(i%7)*interval '1 minute',10,
   case when i%2=0 then 100 else -110 end,20,case when i%3=0 then 'WON' else 'OPEN' end,
   case when i%3=0 then 20 else 0 end,case when i%3=0 then now()-interval '1 hour' else null end,
   'fixture-'||i,case when i%4=0 then 'future' else 'single' end,'{"excluded_source":"raw_import"}'
   from generate_series(1,$3::integer) i`,[league,team,league===A?1205:3]);
 }
 await q(`insert into tickets(id,source_batch,league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,stake,accepted_combined_odds,accepted_potential_payout,status,actual_payout,settled_at,legacy_ticket_id,ticket_type)
  values(gen_random_uuid(),'synthetic-pages',$1,$2,1,2025,1,1,now()-interval '1 year',7,100,14,'WON',14,now()-interval '1 year','past-season-B','single')`,[B,TB]);
 await q(`insert into ticket_legs(ticket_id,leg_number,selection,market_type,accepted_odds,status,result_evidence,settlement_context)
  select id,1,'Needle '||legacy_ticket_id,'Player Points',100,status,'Fixture result','{"kind":"player_points","metadata":{"player_id":"fixture"}}'
  from tickets`);
 await q('insert into wallets(team_id,balance) values($1,1000),($2,null)',[TA,TB]);
 await q(`insert into wallet_ledger(team_id,ticket_id,source_batch,event_key,kind,amount,balance_before,balance_after,reason,created_at)
  select $1,id,'synthetic-pages','page-fixture-'||id,case when n%2=0 then 'wager' else 'settlement' end,
   case when n%2=0 then -10 else 20 end,1000,case when n%2=0 then 990 else 1020 end,'Fixture entry',now()-interval '1 hour'
  from (select id,row_number() over(order by id) n from tickets where league_id=$2 limit 16) t`,[TA,A]);
 await q(`insert into wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason,created_at)
  values($1,'page-fixture-weekly','weekly_replenishment',100,900,1000,'Fixture replenishment',now()-interval '1 hour')`,[TA]);
 await q(`insert into balance_events(team_id,actor_id,request_id,previous_balance,new_balance,reason,kind,created_at)
  values($1,$2,gen_random_uuid(),900,800,'Fixture adjustment','admin_adjustment',now()-interval '30 minutes')`,[TA,owner]);
 const act=async user=>db.exec(`reset role;set row_security=on;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 const visible=(await q("select id,market_week from tickets where league_id=$1 and status='OPEN' and ticket_type<>'future' limit 1",[A]))[0];
 const image=randomUUID(),offer=randomUUID();
 await q('insert into promo_images(id,league_id,png) values($1,$2,$3)',[image,A,'a'.repeat(40)]);
 await q(`insert into promo_offers(id,league_id,nfl_season,market_week,slot,kind,title,description,image_id,expires_at,terms)
  values($1,$2,2026,1,1,'boost','Fixture boost','Synthetic accepted promotion',$3,now()+interval '1 day','{"criterion":"points_min","count":5,"percent":50,"max_stake":20}')`,[offer,A,image]);
 await q(`insert into ticket_promotions(ticket_id,league_id,team_id,user_id,offer_id,kind,boost_pct,base_decimal,terms)
  values($1,$2,$3,$4,$5,'boost',50,3.64,'{"accepted":"fixture"}')`,[visible.id,A,TA,owner,offer]);
 for(const league of [A,B])for(const week of [visible.market_week,19-visible.market_week])await q(`insert into ticket_score_observations(league_id,nfl_season,market_week,fetched_at,cadence_minutes,payload)
  values($1,2026,$2,now(),15,jsonb_build_object('teams','{}'::jsonb,'players',jsonb_build_object('fixture',0,'UNRELATED_PLAYER',99),'week_final',false)) on conflict do nothing`,[league,week]);
 await db.exec('analyze public.tickets');
 const financial=async()=>JSON.stringify(await q(`select (select jsonb_agg(to_jsonb(t) order by id) from tickets t) tickets,
  (select jsonb_agg(to_jsonb(l) order by id) from ticket_legs l) legs,(select jsonb_agg(to_jsonb(w) order by team_id) from wallets w) wallets,
  (select jsonb_agg(to_jsonb(l) order by id) from wallet_ledger l) ledger,(select jsonb_agg(to_jsonb(e) order by id) from balance_events e) events,
  (select jsonb_agg(to_jsonb(p) order by ticket_id) from ticket_promotions p) promotions`));
 const before=await financial();
 await act(owner);
 assert.deepEqual((await q('select account_history_seasons($1) value',[B]))[0].value,[2026,2025]);
 const page=async(filters={},cursor=null,limit=37,league=A)=>(await q('select account_ticket_page($1,$2,$3,$4) value',[league,JSON.stringify(filters),cursor?JSON.stringify(cursor):null,limit]))[0].value;
 const all=(await q('select id,placed_at,settled_at,actual_payout,accepted_combined_odds from tickets where league_id=$1',[A]));
 const completeProjection={tickets:[],legs:[],ticketPromotions:[]};
 for(const sort of ['placed','settled','winnings','odds'])for(const direction of ['asc','desc']){
  let cursor=null;const ids=[];do{const p=await page({sort,direction},cursor);
   assert.equal(p.total,1205);assert(p.tickets.length<=37);assert.equal(p.legs.length,p.tickets.length);
   assert(p.tickets.every(t=>t.league_id===A&&!('source_record'in t)));assert(p.legs.every(l=>p.tickets.some(t=>t.id===l.ticket_id)));
   assert.deepEqual(p.ticketPromotions,p.tickets.some(t=>t.id===visible.id)?[{ticket_id:visible.id,kind:'boost',boost_pct:50,base_decimal:3.64}]:[]);
   if(sort==='placed'&&direction==='desc'){completeProjection.tickets.push(...p.tickets);completeProjection.legs.push(...p.legs);completeProjection.ticketPromotions.push(...p.ticketPromotions);}
   ids.push(...p.tickets.map(t=>t.id));cursor=p.next;
  }while(cursor);
  const val=t=>sort==='placed'?Date.parse(t.placed_at):sort==='settled'?(t.settled_at?Date.parse(t.settled_at):null):sort==='winnings'?Number(t.actual_payout):t.accepted_combined_odds>0?1+t.accepted_combined_odds/100:1+100/Math.abs(t.accepted_combined_odds);
  const expected=[...all].sort((a,b)=>{const x=val(a),y=val(b);return x===null&&y!==null?1:y===null&&x!==null?-1:
   (x===null||y===null?0:(direction==='asc'?x-y:y-x))||Date.parse(b.placed_at)-Date.parse(a.placed_at)||a.id.localeCompare(b.id);}).map(t=>t.id);
  assert.deepEqual(ids,expected,sort+':'+direction);assert.equal(new Set(ids).size,1205);
 }
 assert.equal((await page({query:'Needle fixture-1205'})).total,1);
 const pageBytes=Buffer.byteLength(JSON.stringify(await page({},null,20))),fullBytes=Buffer.byteLength(JSON.stringify(completeProjection));
 assert(pageBytes<fullBytes/10);
 console.log('Synthetic serialized JSON bytes (not production wire or physical storage):',JSON.stringify({twentyTicketPage:pageBytes,complete1205TicketProjection:fullBytes}));
 assert.equal((await page({query:'%'})).total,0,'search is literal, not an accidental wildcard');
 assert((await page({week:'futures'})).tickets.every(t=>t.ticket_type==='future'));
 assert((await page({week:'5',status:'Settled'})).tickets.every(t=>t.placement_week===5&&t.status!=='OPEN'));
 assert((await page({personal:true})).tickets.every(t=>t.team_id===TA));
 const exact=await page({ticket:visible.id,personal:true,season:2026});assert.equal(exact.total,1);assert.equal(exact.tickets[0].id,visible.id);
 assert.equal((await page({ticket:visible.id,season:2025})).total,0);
 assert((await page({market_week:5})).tickets.every(t=>t.market_week===5));
 await assert.rejects(page({season:'2026'}),/filter/);
 const totals=(await q('select account_betting_totals($1,null,null) value',[A]))[0].value;
 assert.deepEqual(totals,[{team_id:TA,placed:1205,settled:401,stake:4010,profit:4010,roi:1,open:8040,open_future:2010,open_count:804,open_weekly_count:603,all_stake:12050}]);
 const filteredTotals=(await q('select account_betting_totals($1,2026,5) value',[A]))[0].value[0];
 assert.equal(filteredTotals.placed,67);assert.equal(filteredTotals.open,670);assert.equal(filteredTotals.open_future,340);assert.equal(filteredTotals.stake,0);assert.equal(filteredTotals.roi,null);
 assert.equal((await q('select account_betting_totals($1,2025,null) value',[A]))[0].value[0].placed,0);
 await assert.rejects(q('select account_betting_totals($1,2026,19)',[A]),/period/);
 const detailFree=await page({ticket:visible.id,details:false});assert.deepEqual(detailFree.legs,[]);assert.deepEqual(detailFree.ticketPromotions,[]);
 let walletCursor=null;const walletRows=[];
 do{const result=(await q('select account_wallet_report($1,null,$2,3) value',[A,walletCursor?JSON.stringify(walletCursor):null]))[0].value;
  assert.equal(result.total,18);assert.equal(result.by_team[0].credits,260);assert.equal(result.by_team[0].debits,180);
  walletRows.push(...result.rows);walletCursor=result.next;
 }while(walletCursor);
 assert.equal(new Set(walletRows.map(r=>r.source+':'+r.id)).size,18);assert(walletRows.every(r=>r.team_id===TA));
 let selectionCursor=null;const selectionRows=[];
 do{const result=(await q('select account_selection_report($1,2026,null,null,$2,43) value',[A,selectionCursor?JSON.stringify(selectionCursor):null]))[0].value;
  assert.equal(result.total,1205);assert.equal(result.appearances,1205);assert.equal(result.maximum,1);
  selectionRows.push(...result.rows);selectionCursor=result.next;
 }while(selectionCursor);
 assert.equal(new Set(selectionRows.map(r=>r.label)).size,1205);assert.equal(selectionRows.reduce((n,r)=>n+r.stakes,0),12050);
 const openReport=(await q('select account_open_ticket_report($1,2026,null,null,null,20) value',[A]))[0].value;
 assert.equal(openReport.total,804);assert.equal(openReport.tickets.length,20);assert.deepEqual(openReport.legs,[]);assert.equal(openReport.totals[0].open,8040);
 const weekReport=(await q('select account_open_ticket_report($1,2026,5,$2,null,20) value',[A,TA]))[0].value;
 assert.equal(weekReport.total,67);assert.equal(weekReport.totals[0].open,670);assert(weekReport.tickets.every(t=>t.market_week===5));
 const walletFirst=(await q('select account_wallet_report($1,null,null,2) value',[A]))[0].value;
 await assert.rejects(q('select account_wallet_report($1,null,$2,2)',[B,JSON.stringify(walletFirst.next)]),/cursor/);
 await assert.rejects(q('select account_open_ticket_report($1,2026,null,null,$2,20)',[B,JSON.stringify(openReport.next)]),/cursor/);
 const plan=(await q('explain (format json) select id from tickets where league_id=$1 and nfl_season=2025 order by placed_at desc,id limit 20',[B]))[0]['QUERY PLAN'];
 const planIndexes=[];const walkPlan=node=>{if(!node||typeof node!=='object')return;if(node['Index Name'])planIndexes.push(node['Index Name']);for(const value of Object.values(node))if(value&&typeof value==='object')Array.isArray(value)?value.forEach(walkPlan):walkPlan(value);};walkPlan(plan);
 assert(planIndexes.length>0,'selective selected-league/season read uses an index at the synthetic cardinality');
 console.log('Synthetic selected-league/season plan indexes:',[...new Set(planIndexes)].join(', '));
 const selectionFirst=(await q('select account_selection_report($1,2026,null,null,null,2) value',[A]))[0].value;
 await db.exec('reset role;begin;');
 await q("update ticket_legs set status='WON' where ticket_id=$1",[visible.id]);
 await assert.rejects(q('select account_selection_report($1,2026,null,null,$2,2)',[A,JSON.stringify(selectionFirst.next)]),/results changed/);
 await db.exec('rollback;');await act(owner);
 const historyData={tickets:await q('select * from tickets where league_id=$1',[A]),ledger:await q('select * from wallet_ledger where team_id=$1',[TA]),
  events:await q('select * from balance_events where team_id=$1',[TA]),wallets:await q('select * from wallets where team_id=$1',[TA])};
 const expectedHistory=buildBalanceHistory(historyData,TA);let historyCursor=null;const history=[];
 do{const h=(await q('select account_balance_page($1,$2,$3,$4) value',[A,TA,historyCursor?JSON.stringify(historyCursor):null,31]))[0].value;
  assert.equal(h.total,expectedHistory.length);assert(h.entries.length<=31);history.push(...h.entries);historyCursor=h.next;
 }while(historyCursor);
 assert.deepEqual(history.map(e=>({...e,date:new Date(e.date).toISOString()})),expectedHistory.map(({id,ticketId,title,reason,amount,date,imported,balanceAfter})=>
  ({id,ticketId,title,reason,amount,date:new Date(date).toISOString(),imported,balanceAfter})), 'canonical page balances match all imported/current anchors and legacy wager fallback');
 const pending=(await q('select account_balance_page($1,$2,null,1) value',[B,TB]))[0].value;
 assert.equal(pending.entries[0].balanceAfter,null,'pending wallet does not become a fabricated zero');
 const balanceFirst=(await q('select account_balance_page($1,$2,null,1) value',[A,TA]))[0].value;
 await assert.rejects(q('select account_balance_page($1,$2,$3,1)',[B,TB,JSON.stringify(balanceFirst.next)]),/cursor/);
 const progress=(ids=[],current=null,league=A)=>q('select account_score_progress($1,$2,$3) value',[league,ids,current?JSON.stringify(current):null]);
 const observed=(await progress([visible.id]))[0].value;
 assert.equal(observed.length,1);assert.equal(observed[0].market_week,visible.market_week);
 assert.deepEqual(observed[0].payload.players,{fixture:0},'retain a true zero and omit unrelated player bodies');
 assert.deepEqual((await progress([],{season:2026,week:visible.market_week}))[0].value[0].payload.players,{});
 assert.deepEqual((await progress([]))[0].value,[]);
 await assert.rejects(progress(Array(21).fill(visible.id)),/20 visible/);
 await assert.rejects(progress([],{season:2025,week:visible.market_week}),/period/);
 const first=await page();
 await assert.rejects(page({status:'Won'},first.next),/cursor/);
 await assert.rejects(page({},first.next,37,B),/cursor/);
 await assert.rejects(page({sort:'unknown'}),/filters/);
 await assert.rejects(page({query:'x'.repeat(129)}),/filters/);
 await assert.rejects(page({},null,100),/filters/);
 await act(other);await assert.rejects(page(),/access/);
 await db.exec('reset role;');const peerTeam=randomUUID();
 await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
  values($1,$2,2,'Peer team','peer','Peer','peer','Peer')`,[peerTeam,A]);
 await q(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id)
  values($1,$2,$3,'page-other@example.test','Peer','peer')`,[A,peerTeam,other]);
 await act(other);assert.equal((await page()).total,1205);
 await assert.rejects(q('select account_wallet_report($1)',[A]),/admin/);
 await assert.rejects(q('select account_selection_report($1,2026)',[A]),/admin/);
 await assert.rejects(q('select account_open_ticket_report($1,2026)',[A]),/admin/);
 await assert.rejects(page({},first.next),/cursor/,'a second authorized member cannot reuse another user cursor');
 assert.equal((await page({personal:true,team:TA})).total,0,'personal scope ignores another team supplied by the caller');
 await assert.rejects(q('select account_balance_page($1,$2,null,1)',[A,TA]),/access/,'a peer cannot read another wallet history');
 for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(page(),/permission/);
  await assert.rejects(q('select account_betting_totals($1)',[A]),/permission/);
  await assert.rejects(q('select account_wallet_report($1)',[A]),/permission/);
 }
 await db.exec('reset role;');
 assert.equal((await q('select count(*) n from tickets'))[0].n,1209);
 assert.equal(await financial(),before,'read endpoints preserve every accepted term, wallet, ledger and adjustment byte');
 console.log('Passed 1,205-ticket traversal across eight sorts, complete-scope aggregates, historical seasons, report/receipt cursor and tenant isolation, visible-player projection, canonical balance parity, revision fences and exact financial preservation.');
}finally{await db.close();}

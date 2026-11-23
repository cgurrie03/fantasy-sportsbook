import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {setup} from './storage-setup.mjs';import {settleLeg} from '../../api/_lib/settlement.ts';
const db=await setup(),q=async(s,a=[])=>(await db.query(s,a)).rows;const checks=[];function ok(n,v){assert(v,n);checks.push(n)}
try{
 const data=JSON.parse(await fs.readFile('visual/src/data.json','utf8')),players=JSON.parse(await fs.readFile('visual/src/players.json','utf8')),rules=JSON.parse(await fs.readFile('visual/scripts/fixtures/storage-league-rules.json','utf8'));
 const A=randomUUID(),B=randomUUID(),member=randomUUID(),outsider=randomUUID();
 for(const [league,name]of[[A,'Real league context test'],[B,'Isolation test']])await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor) values($1::uuid,$2,$1::text,2026,1,8,now())`,[league,name]);
 for(const t of data.teams)await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name) values($1,$2,$3::integer,$4,$3::text,$4,$3::text,$4)`,[t.id,A,t.roster_id,t.name]);
 for(const id of [member,outsider])await q('insert into auth.users values($1,$2,now())',[id,id+'@example.test']);
 await q(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role) values($1,$2,$3,$4,'Local member','local','member')`,[A,data.teams[0].id,member,member+'@example.test']);
 const ticket=randomUUID(),originals=new Map();
 await db.exec('set session_replication_role=replica');
 await q(`insert into tickets(id,league_id,team_id,league_season,nfl_season,placement_week,market_week,placed_at,accepted_combined_odds,stake,accepted_potential_payout,status,actual_payout) values($1,$2,$3,1,2026,8,8,now(),100,1,2,'OPEN',0)`,[ticket,A,data.teams[0].id]);
 for(let i=0;i<197;i++){
  const m=data.markets[i%data.markets.length],home=data.teams.find(t=>t.id===m.home),away=data.teams.find(t=>t.id===m.away),id=randomUUID();
  const roster=t=>players.filter(p=>p.roster===t.roster_id).map(p=>({id:p.id,name:p.name,position:p.position,seasonAverage:p.seasonAverage,starter:p.starter,opponent:p.opponent}));
  const ctx={kind:m.kind,side:m.side,team_id:m.team,home_team_id:m.home,away_team_id:m.away,boost_pct:0,metadata:{...rules,home_lineup:roster(home).filter(p=>p.starter),away_lineup:roster(away).filter(p=>p.starter),home_eligible_players:roster(home),away_eligible_players:roster(away),price_policy:{version:'example',vig:0.0476},model_config:{version:'sample-shape'},player_id:'test-player',margin_lower:5,margin_upper:null,expected_team_count:data.teams.length,projection_targets:{[home.id]:150,[away.id]:140}}};
  originals.set(id,JSON.parse(JSON.stringify(ctx)));await q(`insert into ticket_legs(id,ticket_id,leg_number,selection,market_type,accepted_odds,accepted_line,status,accepted_decimal_odds,settlement_context,result_evidence) values($1,$2,$3,$4,$5,-110,$6,'OPEN',1.909090909,$7,'Local storage benchmark')`,[id,ticket,i+1,m.label||m.kind,m.kind,m.line,JSON.stringify(ctx)]);
 }
 await db.exec('set session_replication_role=origin');
 const before=(await q('select sum(pg_column_size(l))::bigint bytes from ticket_legs l'))[0].bytes;
 const financeBefore=(await q(`select jsonb_build_object('tickets',(select jsonb_agg(to_jsonb(t)) from tickets t),'wallets',(select jsonb_agg(to_jsonb(w)) from wallets w),'entries',(select jsonb_agg(to_jsonb(w)) from wallet_ledger w)) r`))[0].r;
 await db.exec(await fs.readFile('visual/server/storage-efficiencies.sql','utf8'));
 const rows=await q('select * from ticket_legs_with_evidence');ok('All original receipt evidence reconstructs exactly',rows.length===originals.size&&rows.every(r=>JSON.stringify(r.settlement_context)===JSON.stringify(originals.get(r.id))||assert.deepEqual(r.settlement_context,originals.get(r.id))===undefined));
 const compact=await q('select * from ticket_legs');ok('Existing legs were normalized',compact.every(r=>r.context_bundle_id!==null&&!('scoring_settings'in r.settlement_context.metadata)));
 ok('Required player/target fields stay inline',compact.every(r=>r.settlement_context.metadata.player_id==='test-player'&&r.settlement_context.metadata.margin_lower===5&&r.settlement_context.metadata.expected_team_count===12));
 const after=(await q(`select (select sum(pg_column_size(l)) from ticket_legs l)+(select coalesce(sum(pg_column_size(v)),0) from receipt_context_values v)+(select coalesce(sum(pg_column_size(b)),0) from receipt_context_bundles b) bytes`))[0].bytes;
 ok('Combined row values shrink including dictionaries',Number(after)<Number(before));
 const financialAfter=(await q(`select jsonb_build_object('tickets',(select jsonb_agg(to_jsonb(t)) from tickets t),'wallets',(select jsonb_agg(to_jsonb(w)) from wallets w),'entries',(select jsonb_agg(to_jsonb(w)) from wallet_ledger w)) r`))[0].r;ok('Ticket and wallet/ledger values untouched',JSON.stringify(financeBefore)===JSON.stringify(financialAfter));
 const one=compact[0];await assert.rejects(q('update ticket_legs set accepted_odds=150 where id=$1',[one.id]),/immutable/);ok('Accepted odds immutable',true);
 await assert.rejects(q(`update ticket_legs set settlement_context=jsonb_set(settlement_context,'{metadata,margin_lower}','9') where id=$1`,[one.id]),/immutable/);ok('Accepted settlement targets immutable',true);
 await assert.rejects(q(`update receipt_context_values set payload='{}'`),/immutable/);ok('Shared evidence immutable',true);
 await assert.rejects(q('delete from receipt_context_bundles where id=$1',[one.context_bundle_id]),/foreign key/);ok('Referenced bundles cannot be deleted',true);
 await assert.rejects(q('delete from receipt_context_values'),/referenced/);ok('Referenced context values cannot be deleted',true);
 const results={final:true,teams:Object.fromEntries(data.teams.map((t,i)=>[t.id,{name:t.name,points:100+i*5}])),players:{'test-player':{played:true,points:20}}};
 ok('Compact settlement agrees with expanded settlement',rows.every(r=>JSON.stringify(settleLeg(r,results))===JSON.stringify(settleLeg(compact.find(c=>c.id===r.id),results))));
 await db.exec(`set row_security=on;set request.jwt.claim.sub='${outsider}';set request.jwt.claim.role='authenticated';set role authenticated`);ok('Other league/outsider cannot read receipt evidence',(await q('select count(*)::int n from receipt_context_values'))[0].n===0);ok('Outsider cannot read receipts',(await q('select count(*)::int n from ticket_legs_with_evidence'))[0].n===0);
 await assert.rejects(q(`insert into receipt_context_values(league_id,fingerprint,payload)values($1,sha256('x'::bytea),'{}')`,[A]),/permission denied/);ok('Members cannot insert shared contexts',true);
 await db.exec(`reset role;set request.jwt.claim.sub='${member}';set role authenticated`);ok('Member gets full evidence on demand',(await q('select count(*)::int n from ticket_legs_with_evidence'))[0].n===197);await db.exec('reset role');
 const stats=await q(`select (select count(*) from receipt_context_values)::int as value_count,(select count(*) from receipt_context_bundles)::int as bundle_count,round(avg(pg_column_size(l))) as leg_bytes from ticket_legs l`);
 console.log(JSON.stringify({checks:checks.length,beforeValueBytes:before,afterValueBytes:after,savedPct:100*(Number(before)-Number(after))/Number(before),stats}));
 await fs.writeFile('visual/test-results/storage/receipt-results.json',JSON.stringify({checks,beforeValueBytes:Number(before),afterValueBytes:Number(after),savedPct:100*(Number(before)-Number(after))/Number(before)},null,2));
}catch(e){console.error(e.message,e.query?.slice(0,300));process.exitCode=1}finally{await db.close()}

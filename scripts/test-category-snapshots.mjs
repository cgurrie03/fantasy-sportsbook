import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {marketCategories,marketCategory} from '../src/lib/market-categories.ts';
const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const owner=randomUUID(),member=randomUUID(),A=randomUUID(),B=randomUUID(),weekly=randomUUID(),future=randomUUID(),foreign=randomUUID();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await fs.readFile('supabase/development/baseline-schema.sql','utf8'));
 for(const file of (await fs.readdir('supabase/migrations')).sort().filter(f=>f>='20261028210237'))await db.exec(await fs.readFile('supabase/migrations/'+file,'utf8'));
 for(const [id,email]of[[owner,'category-owner@example.test'],[member,'category-member@example.test']])await q('insert into auth.users values($1,$2,now())',[id,email]);
 for(const league of [A,B])await q(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)
  values($1::uuid,'Category fixture',($1::uuid)::text,2026,1,5,now())`,[league]);
 for(const [user,role,i]of[[owner,'admin',1],[member,'member',2]]){const team=randomUUID();
  await q(`insert into teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name)
   values($1,$2,$3,'Category team','fixture','Fixture','fixture','Fixture')`,[team,A,i]);
  await q(`insert into league_memberships(league_id,team_id,user_id,invited_email,display_name,sleeper_user_id,role)
   values($1,$2,$3,$4,'Fixture user','fixture',$5)`,[A,team,user,user===owner?'category-owner@example.test':'category-member@example.test',role]);
 }
 for(const [id,league,type]of[[weekly,A,'weekly'],[future,A,'future'],[foreign,B,'weekly']])await q(`insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status,board_type)
  values($1,$2,$3,2026,1,now()-interval '1 hour',now()+interval '1 hour','published',$4)`,[id,league,type==='future'?1:5,type]);
 const team=(await q('select id from teams where league_id=$1 limit 1',[A]))[0].id;
 const kinds=['spread','moneyline','match_total','team_total','team_milestone','winning_margin','player_points','player_milestone','player_h2h','weekly_high','weekly_count_150','future_champion','future_win_total'];
 for(const kind of kinds)await q(`insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,metadata,team_id,home_team_id,away_team_id)
  values(gen_random_uuid(),$1,$2,$2,$2,'Fixture category',$4,8.5,100,$3::jsonb,$5,$5,null)`,[kind.startsWith('future_')?future:weekly,kind,
  JSON.stringify({projection:12.25,player_id:'fixture',opponent_player_id:'opponent',slot:'QB',margin_lower:0,margin_upper:10,raw_provider:{private_marker:'MUST_NOT_RETURN',blob:'x'.repeat(12000)},scoring_settings:{raw:true},home_lineup:[{raw:true}]}),kind.endsWith('milestone')?'at_least':kind==='player_h2h'?'home':'over',team]);
 await q(`insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active)
  values(gen_random_uuid(),$1,'inactive','spread','Inactive','Fixture','over',100.5,100,false)`,[weekly]);
 const act=user=>db.exec(`reset role;set row_security=on;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await act(member);
 const snapshot=async(category,board=category==='Season Futures'?future:weekly,league=A)=>(await q('select sportsbook_category_snapshot($1,$2,$3) value',[league,board,category]))[0].value;
 for(const category of marketCategories){
  const actual=await snapshot(category);assert.equal(actual.week,5);assert(actual.markets.length>0);assert(actual.markets.every(m=>marketCategory(m.kind)===category&&m.active));
  assert(!JSON.stringify(actual).includes('MUST_NOT_RETURN'));assert(actual.markets.every(m=>m.metadata.projection===12.25&&!('scoring_settings'in m.metadata)));
  const old=(await q('select sportsbook_current_snapshot($1,$2) value',[A,category==='Season Futures'?'future':'weekly']))[0].value;
  const expected=old.markets.filter(m=>marketCategory(m.kind)===category);
  assert.deepEqual(actual.markets.map(m=>m.id).sort(),expected.map(m=>m.id).sort());
  for(const row of actual.markets){const prior=expected.find(m=>m.id===row.id);for(const field of ['line','odds','side','metadata','market_state','suspension_reason','home_projection','away_projection'])assert.deepEqual(row[field],prior[field]);}
 }
 await db.exec('reset role;');
 await q(`insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,metadata)
  select gen_random_uuid(),$1,'player-fixture-'||i,'player_points','Over 20.5','Fixture Player','over',20.5,-110,
   jsonb_build_object('player_id','p'||i,'raw_provider',repeat('x',2048)) from generate_series(1,1000) i`,[weekly]);
 await db.exec('analyze sportsbook_markets;');
 await act(member);
 const narrow=await snapshot('Matchups'),full=(await q("select sportsbook_current_snapshot($1,'weekly') value",[A]))[0].value;
 const narrowBytes=Buffer.byteLength(JSON.stringify(narrow)),fullBytes=Buffer.byteLength(JSON.stringify(full));
 assert(narrowBytes<fullBytes/20);
 const plan=(await q(`explain select m.id from sportsbook_markets m where board_id=$1 and active and
  kind=any(array['spread','moneyline','match_total','team_total','team_milestone','winning_margin'])`,[weekly])).map(r=>r['QUERY PLAN']).join('\n');
 assert(plan.includes('sportsbook_markets_category_idx'),plan);
 console.log(JSON.stringify({synthetic_category_bytes:narrowBytes,synthetic_full_weekly_bytes:fullBytes,category_index_used:true}));
 assert.equal(await snapshot('Matchups',foreign,A),null);assert.equal(await snapshot('Matchups',foreign,B),null);
 assert.equal(await snapshot('Season Futures',weekly),null);await assert.rejects(snapshot('Everything'),/Unknown/);
 await db.exec('reset role;');await q("update sportsbook_boards set status='draft' where id=$1",[weekly]);
 await act(member);assert.equal(await snapshot('Matchups'),null);
 await act(owner);assert.equal((await snapshot('Matchups')).board.status,'draft');
 const definition=(await q("select pg_get_functiondef('public.sportsbook_category_snapshot(uuid,uuid,text)'::regprocedure) definition"))[0].definition;
 assert(!definition.includes('sportsbook_quote_snapshot('),'category reads do not materialize the full board');
 assert(!definition.includes('SECURITY DEFINER'),'category function preserves RLS');
 for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(snapshot('Matchups'),/permission/);}
 console.log('Passed category-only current board reads, active/draft/member/foreign isolation, public metadata and line/price parity with the legacy member view; no full quote snapshot materialization.');
}finally{await db.close();}

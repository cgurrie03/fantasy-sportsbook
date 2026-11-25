import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function testPlayerParlayConflicts(db,{board,user,team,revision}) {
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('reset role;begin');
 try {
  const sql=await fs.readFile('visual/server/player-parlay-conflicts.sql','utf8');
  await db.exec(sql);await db.exec(sql);
  const opponent=randomUUID();
  await q("insert into public.teams(id,league_id,roster_id,team_name,owner_name,sleeper_owner_id,sportsbook_owner_id,sportsbook_owner_name) select $1,league_id,2,'Opponent','Opponent','opponent','opponent','Opponent' from public.teams where id=$2",[opponent,team]);
  const make=async(player,kind='player_milestone',threshold=10,match='same-match')=>{
   const id=randomUUID();
   await q(`insert into public.sportsbook_markets(id,board_id,market_key,matchup_key,kind,label,subject,side,line,odds,team_id,home_team_id,away_team_id,metadata,active)
    values($1,$2,$3,$4,$5,$6,$6,$7,$8,-110,$9,$9,$11,$10,true)`,[id,board,kind+':'+player+':'+threshold,match,kind,player,kind==='player_milestone'?'at_least':'over',threshold,team,{player_id:player,cutoff_at:new Date(Date.now()+3600000).toISOString()},opponent]);
   return id;
  };
  const antonio=await make('Antonio Williams'),jacory=await make('Jacory Croskey-Merritt');
  const duplicate=await make('Antonio Williams','player_milestone',15),points=await make('Antonio Williams','player_points',10.5),other=await make('Different Player','player_points',10.5);
  const conflict=async(a,b)=>(await q('select public.sportsbook_special_conflict(a,b) result from public.sportsbook_markets a,public.sportsbook_markets b where a.id=$1 and b.id=$2',[a,b]))[0].result;
  assert.equal(await conflict(antonio,jacory),false);assert.equal(await conflict(jacory,antonio),false);
  assert.equal(await conflict(antonio,other),false);
  assert.equal(await conflict(antonio,duplicate),true);assert.equal(await conflict(antonio,points),true);
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[user]);
  for(const picks of [[antonio,jacory],[antonio,other]]) {
   await db.exec('savepoint valid_player_parlay');
   const result=(await q('select public.place_sportsbook_ticket($1,$2,$3::uuid[],1,$4) result',[board,revision,picks,randomUUID()]))[0].result;
   assert(result.ticket_id,'Valid player parlay did not pass both conflict and insertion checks');
   await db.exec('rollback to valid_player_parlay;release valid_player_parlay');
  }
  await db.exec('savepoint duplicate_player_parlay');
  await assert.rejects(()=>q('select public.place_sportsbook_ticket($1,$2,$3::uuid[],1,$4)',[board,revision,[antonio,duplicate],randomUUID()]),/contradictory|one outcome/);
  await db.exec('rollback to duplicate_player_parlay;release duplicate_player_parlay');
  console.log('Player parlays: Antonio Williams 10+ with Jacory Croskey-Merritt 10+ and distinct-player mixed props accepted; duplicate/same-player outcomes rejected; migration repeat-safe.');
 } finally {await db.exec('rollback;reset role');}
}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testWalletOffers(db,{owner,primary,coowner,outsider,A,team,board,p,c}) {
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const act=id=>db.exec(`reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated;`);
 await db.exec('reset role');
 const image=randomUUID(),picks=[randomUUID(),randomUUID()];
 await q('insert into promo_images(id,league_id,png) values($1,$2,$3)',[image,A,'a'.repeat(40)]);
 for(const [i,id] of picks.entries())await q(`insert into sportsbook_markets(id,board_id,market_key,kind,label,subject,side,line,odds,active,metadata)
  values($1,$2,$3,'player_points',$3,$3,'over',10.5,100,true,$4)`,[id,board,'wallet:player:'+i,JSON.stringify({player_id:'wallet-player-'+i})]);
 const rev=(await q('select revision from sportsbook_boards where id=$1',[board]))[0].revision;
 await act(owner);
 const template={week:5,slot:1,title:'Synthetic co-owner offer',description:'Local only',image_id:image,status:'scheduled',expires_at:new Date(Date.now()+86400000).toISOString()};
 const boost=(await q('select save_promo($1,null,null,$2) id',[A,JSON.stringify({...template,kind:'boost',terms:{criterion:'points_exact',count:2,percent:50,max_stake:20}})]))[0].id;
 const boostBet=request=>q('select place_boosted_ticket($1,$2,$3::uuid[],10,$4,$5) r',[board,rev,picks,request,boost]);
 await act(primary);await q('select claim_promo($1)',[boost]);
 const request=randomUUID(),first=(await boostBet(request))[0].r;
 await act(coowner);await q('select claim_promo($1)',[boost]);
 await assert.rejects(boostBet(request),/another financial account/);
 const second=(await boostBet(randomUUID()))[0].r;
 assert.notEqual(first.ticket_id,second.ticket_id);
 await assert.rejects(boostBet(randomUUID()),/once/);
 await db.exec('reset role');
 assert.equal((await q('select count(*)::int n from promo_claims where offer_id=$1 and used_ticket is not null',[boost]))[0].n,2);
 assert((await q('select accepted_potential_payout from tickets where id=any($1::uuid[])',[[first.ticket_id,second.ticket_id]])).every(t=>Number(t.accepted_potential_payout)===55));
 await act(owner);await q('select void_sportsbook_ticket($1,$2)',[second.ticket_id,'Synthetic co-owner offer refund']);
 await q('select void_sportsbook_ticket($1,$2)',[second.ticket_id,'Synthetic co-owner offer refund']);
 await db.exec('reset role');
 assert.equal((await q('select used_ticket from promo_claims where offer_id=$1 and user_id=$2',[boost,coowner]))[0].used_ticket,null);
 assert.equal((await q('select used_ticket from promo_claims where offer_id=$1 and user_id=$2',[boost,primary]))[0].used_ticket,first.ticket_id);
 await act(coowner);const replacement=(await boostBet(randomUUID()))[0].r;
 await act(owner);
 const fixed=(await q('select save_promo($1,null,null,$2) id',[A,JSON.stringify({...template,slot:2,kind:'fixed',terms:{legs:picks.map(id=>({id,label:'Frozen local pick',odds:200,line:12.5})),fixed_stake:null}})]))[0].id;
 const fixedBet=request=>q('select place_fixed_ticket($1,10,$2) r',[fixed,request]);
 await act(primary);const fixedRequest=randomUUID(),primaryFixed=(await fixedBet(fixedRequest))[0].r;
 assert.equal((await fixedBet(fixedRequest))[0].r.duplicate,true);
 await act(coowner);await assert.rejects(fixedBet(fixedRequest),/another financial account/);
 const coFixed=(await fixedBet(randomUUID()))[0].r;
 await assert.rejects(fixedBet(randomUUID()),/already been used/);
 await db.exec('reset role');
 for(const [ticket,wallet,user] of [[first.ticket_id,p.wallet_id,primary],[replacement.ticket_id,c.wallet_id,coowner],[primaryFixed.ticket_id,p.wallet_id,primary],[coFixed.ticket_id,c.wallet_id,coowner]]) {
  const t=(await q('select user_wallet_id from tickets where id=$1',[ticket]))[0];assert.equal(t.user_wallet_id,wallet);
  assert.equal((await q('select recipient from outbound_emails where ticket_id=$1',[ticket]))[0].recipient,user+'@example.test');
 }
 assert((await q('select accepted_potential_payout from tickets where id=any($1::uuid[])',[[primaryFixed.ticket_id,coFixed.ticket_id]])).every(t=>Number(t.accepted_potential_payout)===90));
 await db.exec("set request.jwt.claim.role='service_role';set role service_role");
 for(const [user,wallet] of [[primary,p.wallet_id],[coowner,c.wallet_id]]) {
  const context=(await q('select financial_email_context($1,$2,$3) r',[A,team,user+'@example.test']))[0].r;
  assert.equal(context.wallet_id,wallet);assert.equal(context.recipient,user+'@example.test');
 }
 const audience=(await q('select financial_email_audience($1) r',[A]))[0].r;
 assert.equal(audience.length,2);assert.deepEqual(new Set(audience.map(r=>r.id)),new Set([p.wallet_id,c.wallet_id]));
 await db.exec('reset role');
 await q(`insert into outbound_emails(league_id,event_key,kind,recipient,team_id,market_week)
  values($1,$2,'recap',$3,$4,5)`,[A,'synthetic:coowner:recap',coowner+'@example.test',team]);
 await assert.rejects(q(`insert into outbound_emails(league_id,event_key,kind,recipient,team_id,market_week)
  values($1,$2,'recap',$3,$4,5)`,[A,'synthetic:outsider:recap',outsider+'@example.test',team]),/financial account/);
 await db.exec("set request.jwt.claim.role='service_role';set role service_role");
 await assert.rejects(q('select financial_email_context($1,$2,$3)',[A,team,outsider+'@example.test']),/pending approval/);
 await db.exec('reset role');
 console.log('Co-owner boost/fixed claims are independent; retries, restoration, cash and confirmation recipients stay on their accepted wallet.');
}

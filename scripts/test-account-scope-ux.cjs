// Synthetic, fully intercepted browser coverage. No external service writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {setup,A,B,teams}=require('./test-ux.cjs');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const f=await setup(browser,1280,844);let release,started;
 const gate=new Promise(r=>release=r),seen=new Promise(r=>started=r),calls=[];
 await f.context.route('**/rest/v1/balance_events*',async route=>{
  const url=new URL(route.request().url()),team=url.searchParams.get('team_id');calls.push(team);
  const league=team.includes(teams[0].id)?A:B;
  if(league===A){started();await gate;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify([{id:'event-'+league,team_id:teams.find(t=>t.league_id===league).id,
   reason:league===A?'Delayed League A adjustment':'Current League B adjustment',kind:'admin_adjustment',previous_balance:90,new_balance:100,created_at:'2026-10-28T16:00:00Z'}])}).catch(()=>{});
 });
 await f.context.route('**/rpc/account_balance_page',route=>{
  const body=route.request().postDataJSON();assert.equal(body.p_league,B);assert.equal(body.p_team,teams.find(t=>t.league_id===B).id);
  return route.fulfill({contentType:'application/json',body:JSON.stringify({entries:[{id:'B-entry',ticketId:null,title:'Balance Adjustment',reason:'Current League B adjustment',amount:10,date:'2026-10-28T16:00:00Z',imported:false,balanceAfter:100}],total:1,next:null,as_of:new Date().toISOString()})});
 });
 await f.page.reload({waitUntil:'domcontentloaded'});await seen;
 await f.page.getByLabel('League',{exact:true}).selectOption(B);
 await f.page.getByText('Current League B adjustment',{exact:true}).waitFor();
 release();await f.page.waitForLoadState('networkidle');
 assert.equal(await f.page.getByLabel('League',{exact:true}).inputValue(),B);
 assert.equal(await f.page.getByText('Delayed League A adjustment',{exact:true}).count(),0);
 assert(calls.length>=1&&calls.every(x=>x?.startsWith('in.(')));
 assert.deepEqual(f.errors,[]);await f.context.close();
 const paged=await setup(browser,390,844),historyRequests=[];
 paged.state.ledger=Array.from({length:41},(_,i)=>({id:'ledger-'+String(i).padStart(2,'0'),team_id:teams[0].id,reason:'Fixture change '+i,
  kind:'weekly_replenishment',balance_before:100,balance_after:110,created_at:new Date(Date.now()-i*60000).toISOString()}));
 paged.page.on('request',r=>{const u=new URL(r.url());if(['tickets','ticket_legs','wallet_ledger','balance_events','ticket_promotions'].includes(u.pathname.split('/').at(-1)))historyRequests.push(u.pathname);});
 await paged.page.goto('http://127.0.0.1:5185/#/account');
 await paged.page.getByText('Page 1 · 41 balance changes',{exact:true}).waitFor();
 assert.equal(await paged.page.locator('.history-entry').count(),30);
 await paged.page.getByRole('button',{name:'Next 30 changes'}).click();
 await paged.page.getByText('Page 2 · 41 balance changes',{exact:true}).waitFor();
 assert.equal(await paged.page.locator('.history-entry').count(),11);
 await paged.page.getByRole('button',{name:'Previous 30 changes'}).click();
 await paged.page.getByText('Page 1 · 41 balance changes',{exact:true}).waitFor();
 assert.equal(await paged.page.locator('.history-entry').count(),30);
 assert.deepEqual(historyRequests,[],'balance screen does not fetch all ticket/ledger/leg/promotion history');
 assert(paged.state.balancePageCalls.every(c=>c.p_league===A&&c.p_team===teams[0].id&&c.p_limit===30));
 assert.deepEqual(paged.errors,[]);await paged.context.close();
 console.log('Passed selected-league history queries and delayed prior-league response isolation after a rapid league switch.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

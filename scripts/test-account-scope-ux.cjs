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
 await f.page.reload({waitUntil:'domcontentloaded'});await seen;
 await f.page.getByLabel('League',{exact:true}).selectOption(B);
 await f.page.getByText('Current League B adjustment',{exact:true}).waitFor();
 release();await f.page.waitForLoadState('networkidle');
 assert.equal(await f.page.getByLabel('League',{exact:true}).inputValue(),B);
 assert.equal(await f.page.getByText('Delayed League A adjustment',{exact:true}).count(),0);
 assert(calls.length>=2&&calls.every(x=>x?.startsWith('in.(')));
 assert.deepEqual(f.errors,[]);await f.context.close();
 console.log('Passed selected-league history queries and delayed prior-league response isolation after a rapid league switch.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

// Headless localhost fixtures only. All Auth/data/bet/mail requests intercepted.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {setup,A,B,teams}=require('./test-ux.cjs');
const user='cccccccc-3333-4333-8333-333333333333',wallet='eeeeeeee-4444-4444-8444-444444444444';
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const width of [390,1440]){
  const f=await setup(browser,width,900),p=f.page,calls=[];
  await p.route('**/rpc/account_access',route=>route.fulfill({json:[
   {league_id:A,view:true,admin:false,configure:false,platform_owner:false,bet:true,team_id:teams[0].id,wallet_model:'user',
    participant:{id:wallet,wallet_id:wallet,league_id:A,team_id:teams[0].id,user_id:user,display_name:'Approved Co-owner',role:'member',invited_email:'',balance:93,source:'financial'}},
   {league_id:B,view:true,admin:false,configure:false,platform_owner:false,bet:false,team_id:null,wallet_model:'user',participant:null}
  ]}));
  await p.route('**/league_memberships?*',route=>route.fulfill({json:[]}));
  await p.route('**/rpc/account_personal_totals',route=>route.fulfill({json:[{wallet_id:wallet,team_id:teams[0].id,placed:1,settled:0,stake:0,profit:0,roi:null,open:7,open_future:0,open_count:1,open_weekly_count:1,all_stake:7}]}));
  await p.route('**/rpc/account_user_balance_page',route=>{
   const body=route.request().postDataJSON();calls.push(body);assert.equal(body.p_wallet,wallet);assert.equal(body.p_league,A);
   return route.fulfill({json:{wallet_id:wallet,entries:[{id:'own-entry',ticketId:null,title:'Balance Adjustment',reason:'Own wallet change',amount:-7,date:'2026-10-29T16:00:00Z',imported:false,balanceAfter:93}],total:1,next:null,as_of:new Date().toISOString()}});
  });

  await p.route('**/rpc/user_leaderboard',route=>route.fulfill({json:[
   {wallet_id:'ffffffff-6666-4666-8666-666666666666',team_id:teams[0].id,display_name:'Primary Participant',bets_placed:2,bets_won:1,bets_lost:0,bets_push:0,total_wagered:90,total_payout:20,net_profit:10,roi:100,win_percentage:100,biggest_parlay_legs:1,biggest_parlay_odds:100,biggest_payout:20,current_balance:null,balance_visible:false,open_stakes:80,settled_stakes:10},
   {wallet_id:wallet,team_id:teams[0].id,display_name:'Approved Co-owner',bets_placed:1,bets_won:0,bets_lost:0,bets_push:0,total_wagered:7,total_payout:0,net_profit:0,roi:0,win_percentage:0,biggest_parlay_legs:0,biggest_parlay_odds:null,biggest_payout:0,current_balance:93,balance_visible:true,open_stakes:7,settled_stakes:0}
  ]}));
  await p.goto('http://127.0.0.1:5185/#/account');await p.reload();
  await p.getByRole('heading',{name:'Approved Co-owner',exact:true}).waitFor();
  await p.getByText('Own wallet change',{exact:true}).waitFor();
  assert.match(await p.locator('.balance-highlight').innerText(),/93\.00/);
  assert.match(await p.locator('.profile-copy').innerText(),/93\.00/);
  assert(!/100\.00/.test(await p.locator('.profile-copy').innerText()),'legacy primary balance is not shown');
  assert.equal(await p.getByRole('link',{name:'My Bets',exact:true}).count(),1);
  assert.equal(await p.getByText('Membership Pending',{exact:true}).count(),0);

  await p.getByRole('link',{name:'Leaderboard',exact:true}).click();
  await p.getByRole('button',{name:/Primary Participant/}).waitFor();
  assert.equal(await p.locator('.standing-expand').count(),2,'co-owners have distinct rows despite sharing a fantasy team');
  await p.getByRole('button',{name:/Primary Participant/}).click();
  const primaryStats=p.getByRole('region',{name:'Primary Participant statistics',exact:true});
  assert.match(await primaryStats.innerText(),/Open stakes\s*\$80\.00/);
  const primaryRow=p.getByRole('row').filter({has:p.getByRole('button',{name:/Primary Participant/})});
  assert.match(await primaryRow.innerText(),/Private/);
  await p.getByLabel('League',{exact:true}).selectOption(B);
  await p.getByText('League viewing access',{exact:true}).waitFor();
  assert.equal(await p.getByRole('link',{name:'My Bets',exact:true}).count(),0);
  assert(!/Balance|Not Set/.test(await p.locator('.profile-copy').innerText()),'staff-only league has no financial participant');
  assert(calls.length>0);assert.equal(f.state.betCalls,0);assert.deepEqual(f.errors,[]);await f.context.close();
 }
 console.log('Passed mobile/desktop approved co-owner without legacy membership, own cash/history wallet scope, no shared primary balance and no fabricated staff wallet. All requests intercepted.');
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

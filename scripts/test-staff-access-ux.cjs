// Intercepted local browser only: one account is a participant in A, staff in B.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {setup,A,B,teams}=require('./test-ux.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,1440]){
   const f=await setup(browser,width,900),p=f.page;let operator=true,owner=false;
   await p.route('**/rest/v1/rpc/account_access',route=>route.fulfill({json:[
    {league_id:A,view:true,admin:false,configure:owner,platform_owner:owner,bet:true,team_id:teams[0].id},
    {league_id:B,view:true,admin:operator||owner,configure:owner,platform_owner:owner,bet:false,team_id:null}
   ]}));
   await p.route('**/rest/v1/league_memberships?*',route=>route.fulfill({json:[{id:'participant-A',league_id:A,team_id:teams[0].id,user_id:'cccccccc-3333-4333-8333-333333333333',invited_email:'fixture@example.test',display_name:'Participant A',role:'member'}]}));
   await p.reload();await p.locator('.market-quote').first().waitFor();
   await p.getByLabel('League',{exact:true}).selectOption(B);
   await p.getByText('League operations access',{exact:true}).waitFor();
   assert.equal(await p.getByRole('heading',{name:'Membership Pending',exact:true}).count(),0);
   assert(!/Balance|Not Set/.test(await p.locator('.profile-copy').innerText()));
   assert.equal(await p.getByRole('link',{name:'My Bets',exact:true}).count(),0);
   assert.equal(await p.getByRole('link',{name:'Account',exact:true}).count(),0);
   assert.equal(await p.locator('.slip-banner,.place-bet').count(),0);
   await p.getByRole('link',{name:'Open League Admin',exact:true}).click();
   await p.getByRole('heading',{name:'League Admin',exact:true}).waitFor();
   await p.getByRole('link',{name:/League Settings/}).click();
   await p.getByText('Only the platform owner can change league configuration.',{exact:true}).waitFor();
   assert(await p.getByRole('button',{name:'Save league identity',exact:true}).isDisabled());
   await p.goto('http://127.0.0.1:5185/#/home');await p.getByText('League operations access',{exact:true}).waitFor();
   await p.getByLabel('League',{exact:true}).selectOption(A);
   await p.getByRole('heading',{name:'Participant A',exact:true}).waitFor();
   assert.match(await p.locator('.profile-copy').innerText(),/100\.00/,'actual participant retains its own league balance');
   operator=false;await p.reload();await p.getByLabel('League',{exact:true}).selectOption(B);
   await p.getByText('League viewing access',{exact:true}).waitFor();
   assert.equal(await p.getByRole('link',{name:'Open League Admin',exact:true}).count(),0);
   owner=true;await p.reload();await p.getByText('Platform owner oversight',{exact:true}).waitFor();
   await p.getByRole('link',{name:'Open League Admin',exact:true}).click();await p.getByRole('link',{name:/League Settings/}).click();
   await p.getByRole('button',{name:'Save league identity',exact:true}).waitFor();
   assert(await p.locator('.settings-fields input').first().isEnabled());
   assert.equal(f.state.betCalls,0);assert.deepEqual(f.errors,[]);await f.context.close();
  }
  console.log('Passed phone/desktop participant A + teamless staff B, no phantom balance/My Bets/slip/account, owner-only settings controls, viewer/operator separation and preserved participant access. All calls intercepted.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

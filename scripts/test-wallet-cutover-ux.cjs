// Owner browser is never used: intercepted localhost fixtures only.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {setup,A,B,teams}=require('./test-ux.cjs');
const wallet='eeeeeeee-4444-4444-8444-444444444444';
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const width of [390,1440]){
  const f=await setup(browser,width,900),p=f.page;let active=false,owner=false,attempt=0;const calls=[];
  const cap=league=>({league_id:league,view:true,admin:league===A,configure:owner,platform_owner:owner,bet:false,team_id:null,wallet_model:active?'user':'legacy',participant:null});
  const preflight=()=>({league_id:A,ready:true,blockers:[],routing_enabled:active,approved_accounts:1,funding_pending:1,legacy_open_tickets:0});
  await p.route('**/rpc/account_access',r=>r.fulfill({json:[cap(A),cap(B)]}));
  await p.route('**/rpc/league_capabilities',r=>r.fulfill({json:cap(r.request().postDataJSON().p_league)}));
  await p.route('**/user_wallets?*',r=>r.fulfill({json:[{id:wallet,league_id:A,team_id:teams[0].id,user_id:'cccccccc-3333-4333-8333-333333333333',display_name:'Pending owner account',balance:null,status:'approved',revision:1}]}));
  await p.route('**/wallets?*',r=>new URL(r.request().url()).searchParams.get('team_id')?.startsWith('in.')?r.fulfill({json:[{team_id:teams[0].id,balance:null}]}):r.fallback());
  await p.route('**/rpc/user_finance_cutover_preflight',r=>{assert.equal(r.request().postDataJSON().p_league,A);return r.fulfill({json:preflight()});});
  await p.route('**/rpc/prepare_user_finance_cutover',r=>{const body=r.request().postDataJSON();calls.push({kind:'prepare',...body});assert.equal(body.p_league,A);
   return r.fulfill({json:{...preflight(),review_id:'review-'+(++attempt),expires_at:new Date(Date.now()+300000).toISOString()}});});
  await p.route('**/rpc/activate_user_finance_cutover',r=>{const body=r.request().postDataJSON();calls.push({kind:'activate',...body});assert.equal(body.p_league,A);
   if(attempt===1)return r.fulfill({status:400,json:{message:'Financial state changed; prepare a fresh cutover review.'}});
   assert.equal(body.p_review,'review-2');active=true;return r.fulfill({json:{league_id:A,activated:true,duplicate:false,opening_funds_moved:false}});});
  await p.goto('http://127.0.0.1:5185/#/admin/users');await p.reload();
  assert.equal(await p.getByRole('button',{name:'Review independent wallets',exact:true}).count(),0);
  owner=true;await p.reload();await p.getByRole('button',{name:'Review independent wallets',exact:true}).click();
  await p.getByRole('heading',{name:'Wallet preparation',exact:true}).waitFor();
  await p.getByLabel('Cutover review reason',{exact:true}).fill('Reviewed synthetic development accounts');
  assert(await p.getByLabel('Opening decision',{exact:true}).isDisabled());
  await p.getByRole('button',{name:'Prepare cutover review',exact:true}).click();
  const activate=p.getByRole('button',{name:'Activate independent wallets in development',exact:true});
  await activate.waitFor();assert(await activate.isDisabled());
  await p.getByLabel('Confirm pending funding and disabled operations',{exact:true}).check();await activate.click();
  await p.getByText('Financial state changed; prepare a fresh cutover review.',{exact:true}).waitFor();assert.equal(active,false);
  await p.getByRole('button',{name:'Prepare cutover review',exact:true}).click();
  await p.waitForFunction(()=>{const c=document.querySelector('input[aria-label="Confirm pending funding and disabled operations"]');return c&&!c.disabled&&!c.checked;});
  await p.getByLabel('Confirm pending funding and disabled operations',{exact:true}).check();await activate.click();
  await p.getByLabel('Opening decision',{exact:true}).waitFor();
  await p.waitForFunction(()=>document.querySelector('select[aria-label="Opening decision"]')?.disabled===false);
  assert.equal(calls.filter(c=>c.kind==='activate').length,2);assert.equal(f.state.betCalls,0);assert.deepEqual(f.errors,[]);
  await f.context.close();
 }
 console.log('Owner-only phone/desktop cutover prepares a scoped expiring review, requires acknowledgement, rejects stale state and keeps opening funds pending. All requests intercepted.');
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

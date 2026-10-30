// Intercepted localhost only; tests no real balance, Auth, or provider mutation.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {setup,A,B,teams}=require('./test-ux.cjs');
const user='cccccccc-3333-4333-8333-333333333333',primaryUser='dddddddd-5555-4555-8555-555555555555';
const own='eeeeeeee-4444-4444-8444-444444444444',primary='ffffffff-6666-4666-8666-666666666666';
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const width of [390,1440]){
  const f=await setup(browser,width,900),p=f.page;let owner=false,legacyCash=100;
  const rows=[{id:own,league_id:A,user_id:user,team_id:teams[0].id,display_name:'Approved Co-owner',balance:93,status:'approved',revision:1},
   {id:primary,league_id:A,user_id:primaryUser,team_id:teams[0].id,display_name:'Primary Participant',balance:null,status:'approved',revision:1}];
  const cap=league=>({league_id:league,view:true,admin:league===A,configure:owner,platform_owner:owner,bet:league===A,team_id:league===A?teams[0].id:null,wallet_model:'user',
   participant:league===A?{id:own,wallet_id:own,league_id:A,team_id:teams[0].id,user_id:user,display_name:'Approved Co-owner',role:'member',invited_email:'',balance:93,source:'financial'}:null});
  const mutations=[];
  await p.route('**/rpc/account_access',r=>r.fulfill({json:[cap(A),cap(B)]}));
  await p.route('**/rpc/league_capabilities',r=>r.fulfill({json:cap(r.request().postDataJSON().p_league)}));
  await p.route('**/league_memberships?*',r=>r.fulfill({json:[{id:'primary-member',league_id:A,team_id:teams[0].id,user_id:primaryUser,invited_email:'primary@example.test',display_name:'Primary Participant',role:'member'}]}));
  await p.route('**/user_wallets?*',r=>r.fulfill({json:rows}));
  await p.route('**/wallets?*',r=>{
   const filter=new URL(r.request().url()).searchParams.get('team_id');
   return filter?.startsWith('in.')?r.fulfill({json:[{team_id:teams[0].id,balance:legacyCash}]}):r.fallback();
  });
  await p.route('**/rpc/initialize_user_wallet',r=>{
   const b=r.request().postDataJSON();mutations.push({name:'initialize',...b});assert.equal(b.p_user,primaryUser);assert.equal(b.p_league,A);assert.equal(b.p_mode,'transfer_legacy');assert.equal(b.p_expected_legacy,100);
   rows[1].balance=100;legacyCash=0;return r.fulfill({json:{wallet_id:primary,balance:100,duplicate:false}});
  });
  await p.route('**/rpc/set_user_wallet_balance',r=>{
   const b=r.request().postDataJSON();mutations.push({name:'adjust',...b});assert.equal(b.p_wallet,primary);assert.equal(b.p_expected,100);assert.equal(b.p_balance,110);
   rows[1].balance=110;return r.fulfill({json:{wallet_id:primary,balance:110,duplicate:false}});
  });
  await p.goto('http://127.0.0.1:5185/#/admin/users');await p.reload();
  await p.getByLabel('Participant account',{exact:true}).waitFor();await p.getByLabel('Participant account',{exact:true}).selectOption(primary);
  assert(await p.getByLabel('Opening decision',{exact:true}).isDisabled());
  await p.getByText('Only the platform owner can approve opening funds.',{exact:true}).waitFor();assert.equal(mutations.length,0);
  owner=true;await p.reload();await p.getByLabel('Participant account',{exact:true}).waitFor();
  await p.getByLabel('Participant account',{exact:true}).selectOption(primary);
  await p.getByLabel('Opening decision',{exact:true}).selectOption('transfer_legacy');
  assert.equal(await p.getByRole('option',{name:'Initialize at $0',exact:true}).getAttribute('disabled'),'');
  await p.getByLabel('Financial review reason',{exact:true}).fill('Explicit synthetic owner cash transfer');
  await p.getByRole('button',{name:'Confirm opening decision',exact:true}).click();
  await p.getByText('Opening decision recorded once.',{exact:true}).waitFor();
  await p.getByLabel('New participant balance',{exact:true}).fill('110');
  await p.getByLabel('Financial review reason',{exact:true}).fill('Explicit synthetic correction after review');
  await p.getByRole('button',{name:'Save participant balance',exact:true}).click();
  await p.getByText('Balance adjustment recorded.',{exact:true}).waitFor();
  assert.equal(mutations.length,2);assert.equal(legacyCash,0);assert.equal(rows[0].balance,93);
  assert.equal(f.state.betCalls,0);assert.deepEqual(f.errors,[]);await f.context.close();
 }
 console.log('Passed operator opening denial, owner reviewed legacy transfer, explicit per-wallet CAS adjustment and unchanged co-owner funds on mobile/desktop. All requests intercepted.');
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});

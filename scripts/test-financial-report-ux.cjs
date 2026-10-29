// Fully intercepted synthetic reports; no provider calls, real exports or bets.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {setup,A,B,teams}=require('./test-ux.cjs');
setTimeout(()=>{console.error('Financial report fixture exceeded 90 seconds.');process.exit(1);},90000).unref();
(async()=>{const browser=await chromium.launch({headless:true});try{
 const f=await setup(browser,1280,1000),p=f.page,requests=[];
 f.state.tickets=Array.from({length:55},(_,i)=>({id:'financial-'+String(i).padStart(3,'0'),league_id:A,team_id:teams[0].id,nfl_season:2026,
  placement_week:i%18+1,market_week:i%18+1,ticket_type:i%3===0?'future':'single',placed_at:new Date(Date.now()-i*60000).toISOString(),
  settled_at:i%2===0?new Date().toISOString():null,status:i%2===0?'WON':'OPEN',stake:10,actual_payout:i%2===0?20:0,accepted_combined_odds:100,accepted_potential_payout:20}));
 f.state.tickets.push({...f.state.tickets[0],id:'financial-old-season',nfl_season:2025,stake:9,actual_payout:18});
 f.state.tickets.push({...f.state.tickets[1],id:'other-league-private',league_id:B,team_id:teams[2].id,stake:9999});
 f.state.legs=f.state.tickets.map((t,i)=>({id:'financial-leg-'+i,ticket_id:t.id,leg_number:1,selection:t.league_id===B?'DO NOT LEAK':'Unique pick '+String(i).padStart(3,'0'),market_type:'Team Total',status:t.status}));
 f.state.ledger=Array.from({length:80},(_,i)=>({id:'wallet-'+i,team_id:teams[0].id,reason:'Wallet record '+i,kind:'weekly_replenishment',balance_before:100,balance_after:110,created_at:new Date(Date.now()-i*60000).toISOString()}));
 f.state.ledger.push({id:'other-ledger',team_id:teams[2].id,reason:'DO NOT LEAK',kind:'weekly_replenishment',balance_before:0,balance_after:9999,created_at:new Date().toISOString()});
 f.state.events=[{id:'manual-change',team_id:teams[0].id,reason:'Recorded adjustment',kind:'admin_adjustment',previous_balance:100,new_balance:110,created_at:new Date().toISOString()}];
 p.on('request',r=>requests.push(new URL(r.url())));
 await p.goto('http://127.0.0.1:5185/#/admin/reports?report=8');
 const kpi=label=>p.locator('.report-kpis article').filter({has:p.getByText(label,{exact:true})}).locator('strong');
 await p.getByText('Betting Performance',{exact:true}).last().waitFor();
 await kpi('Settled tickets').getByText('28',{exact:true}).waitFor();assert.equal(await kpi('Net settled profit').innerText(),'$280.00');
 await p.getByLabel(/^Season/).selectOption('2025');await kpi('Settled tickets').getByText('1',{exact:true}).waitFor();assert.equal(await kpi('Net settled profit').innerText(),'$9.00');
 await p.getByLabel(/^Season/).selectOption('2026');await kpi('Settled tickets').getByText('28',{exact:true}).waitFor();
 await p.getByLabel(/^Report/).selectOption('10');await p.getByText('Page 1 · 55 selection labels.',{exact:false}).waitFor();
 assert.equal(await kpi('Ticket appearances').innerText(),'55');
 await p.getByRole('button',{name:'Next page',exact:true}).click();await p.getByText('Page 2 · 55 selection labels.',{exact:false}).waitFor();
 assert.equal(await kpi('Ticket appearances').innerText(),'55','summary covers all records on page two');
 await p.getByRole('button',{name:'Export',exact:true}).click();const selectionDownload=p.waitForEvent('download');await p.getByRole('button',{name:'CSV Data',exact:true}).click();
 const textOf=async download=>{const parts=[];for await(const part of await (await download).createReadStream())parts.push(part);return Buffer.concat(parts).toString('utf8');};
 const selections=await textOf(selectionDownload);assert.equal(selections.split('\r\n').length,56);assert(selections.includes('Unique pick 054'));assert(!selections.includes('DO NOT LEAK'));
 await p.getByLabel(/^Report/).selectOption('11');await p.getByText('Page 1 · 27 open tickets.',{exact:false}).waitFor();
 assert.equal(await kpi('Total committed stakes').innerText(),'$270.00');assert.equal(await kpi('Futures stakes').innerText(),'$90.00');
 await p.getByRole('button',{name:'Next page',exact:true}).click();await p.getByText('Page 2 · 27 open tickets.',{exact:false}).waitFor();assert.equal(await kpi('Total committed stakes').innerText(),'$270.00');
 await p.getByLabel(/^Week/).selectOption('2');await p.getByText('Page 1 · 3 open tickets.',{exact:false}).waitFor();assert.equal(await kpi('Total committed stakes').innerText(),'$30.00');
 await p.getByLabel(/^Report/).selectOption('9');await p.getByText('Page 1 · 81 balance entries.',{exact:false}).waitFor();assert(await p.getByLabel(/^Season/).isDisabled());
 await p.getByRole('button',{name:'Next page',exact:true}).click();await p.getByText('Page 2 · 81 balance entries.',{exact:false}).waitFor();assert.equal(await kpi('Balance entries').innerText(),'81');
 await p.getByRole('button',{name:'Export',exact:true}).click();const walletDownload=p.waitForEvent('download');await p.getByRole('button',{name:'CSV Data',exact:true}).click();
 const wallet=await textOf(walletDownload);assert.equal(wallet.split('\r\n').length,82);assert(wallet.includes('Wallet record 79'));assert(wallet.includes('Recorded adjustment'));assert(!wallet.includes('DO NOT LEAK'));
 const forbidden=['tickets','ticket_legs','wallet_ledger','balance_events','ticket_promotions','league_result_weeks','sportsbook_report_forecasts','sportsbook_report_forecast_details','automation_jobs','outbound_emails','report-results'];
 assert.deepEqual(requests.filter(u=>forbidden.includes(u.pathname.split('/').at(-1))).map(u=>u.pathname),[],'financial reports do not read raw histories, score archives, forecast bodies or unrelated log screens');
 assert(f.state.financialReportCalls.every(c=>c.p_league===A));assert.deepEqual(f.errors,[]);await f.context.close();
 console.log('Passed complete-scope financial totals, historical seasons, stable report pages, period filters and all-row bounded CSVs without raw-history/provider reads or other-league records.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

// All auth, data, API acceptance and mail calls are intercepted. Never runs a live bet/email.
const { chromium } = require('playwright');
const {marketCategory}=require('../src/lib/market-categories.ts');
const {buildBalanceHistory}=require('../src/lib/balanceHistory.ts');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const origin=process.env.UX_ORIGIN || 'http://127.0.0.1:5185';
assert(new URL(origin).hostname==='127.0.0.1'||new URL(origin).hostname==='localhost','Fixtures require localhost');
const output=path.resolve(process.env.UX_OUTPUT || 'work/ux-evidence');fs.mkdirSync(output,{recursive:true});
const A='aaaaaaaa-1111-4111-8111-111111111111', B='bbbbbbbb-2222-4222-8222-222222222222', userId='cccccccc-3333-4333-8333-333333333333';
const names=['The Extremely Long Fantasy Football Team Name With Repeated Championship Aspirations','TheUnbrokenTeamNameThatMustWrapWithoutHidingAnyBalanceOrOdds'];
const leagues=[A,B].map((id,i)=>({id,name:i?'Disconnected League B':'Disconnected League A With A Long Display Name',league_season:i?9:3,nfl_season:2026,sleeper_league_id:i?'222':'1312126153980391424',avatar_url:null,sportsbook_url:'https://fixture.example.test/',email_sender:'fixture@example.test',operations_enabled:true}));
const teams=[A,B].flatMap((league_id,j)=>names.map((team_name,i)=>({id:`${j?'bbbbbbbb':'aaaaaaaa'}-0000-4000-8000-00000000000${i+1}`,league_id,roster_id:i+1,team_name,sportsbook_owner_name:`Owner ${i+1}`,sportsbook_owner_id:`overlap-${i+1}`,co_owner_names:[],avatar_url:null,wins:3-i,losses:1+i,ties:0})));
const memberships=[A,B].map((league_id,j)=>({id:`member-${j}`,league_id,team_id:teams[j*2].id,user_id:userId,invited_email:'fixture@example.test',display_name:'Long Fixture Owner',role:j?'member':'admin'}));
const session={access_token:`${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.fixture`,refresh_token:'fixture-only',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:userId,email:'fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
const boards=[A,B].map((league_id,i)=>({id:`board-${i}`,league_id,board_type:'weekly',market_week:5,nfl_season:2026,league_season:i?9:3,status:'published',phase:'pregame',revision:1,opens_at:new Date(Date.now()-3600000).toISOString(),closes_at:new Date(Date.now()+86400000).toISOString()}));
const futureBoards=boards.map(b=>({...b,id:`${b.id}-future`,board_type:'future'}));
function futureQuotes(b){return teams.filter(t=>t.league_id===b.league_id).flatMap(t=>['future_win_total','future_playoffs','future_champion','future_first_pick'].flatMap(kind=>(kind==='future_win_total'?['over','under']:kind==='future_playoffs'?['make','miss']:['yes']).map(side=>({id:`${b.id}-${t.id}-${kind}-${side}`,board_id:b.id,market_key:`${kind}:${t.id}`,kind,side,line:kind==='future_win_total'?8.5:null,odds:110,boost_pct:0,label:t.team_name,subject:t.team_name,team_id:t.id,active:true,market_state:'open',metadata:{expected_wins:8.5,simulated_probability:0.5}}))))}
function quotes(b){const t=teams.filter(t=>t.league_id===b.league_id);return [['spread',t[0].id,-4.5,-110],['spread',t[1].id,4.5,-110],['moneyline',t[0].id,null,-150],['moneyline',t[1].id,null,130],['match_total','over',250.5,-110],['match_total','under',250.5,-110]].map(([kind,side,line,odds],i)=>({id:`${b.id}-q${i}`,board_id:b.id,market_key:kind,matchup_key:'same-roster-numbers',kind,side,line,odds,label:kind==='match_total'?`${side} ${line}`:`${t.find(t=>t.id===side).team_name} ${line??'Win'}`,subject:'Fixture league',team_id:kind==='match_total'?null:side,home_team_id:t[0].id,away_team_id:t[1].id,home_projection:127.5,away_projection:123,featured:'Game of the Week',boost_pct:kind==='moneyline'?25:0,metadata:{},active:true,market_state:'open'}))}
function specialQuotes(b,state){const exact = ['weekly_high','weekly_low','weekly_count_150','weekly_count_projection','weekly_average','weekly_highest_score','weekly_any_below_100','weekly_any_200'].map(kind=>({id:`${b.id}-${kind}`,board_id:b.id,market_key:kind,kind,side:kind.startsWith('weekly_count')?'exact':'yes',line:kind.startsWith('weekly_count')?4:150,odds:300+(state.movement||0)*20,boost_pct:0,label:kind==='weekly_count_150'?'4 Teams Scoring 150+':kind==='weekly_count_projection'?'4 Teams Beating Projection':'Fixture selection',subject:'Fixture league',team_id:null,active:true,market_state:'open',metadata:{}}));return [...exact,...exact.filter(q=>q.kind.startsWith('weekly_count')).map(q=>({...q,id:q.id+'-at-least',side:'4+',odds:-125,label:q.kind==='weekly_count_150'?'At Least 4 Teams Scoring 150+':'At Least 4 Teams Beating Projection'}))]}
const evidence=[];
function fixtureTotals(state,league,season,week){return teams.filter(t=>t.league_id===league).map(team=>{
 const rows=state.tickets.filter(t=>t.team_id===team.id&&(!season||t.nfl_season===season)&&(!week||t.market_week===week));
 const settled=rows.filter(t=>['WON','LOST','PUSH'].includes(t.status)),stake=settled.reduce((n,t)=>n+Number(t.stake),0),profit=settled.reduce((n,t)=>n+Number(t.actual_payout)-Number(t.stake),0);
 return {team_id:team.id,placed:rows.length,settled:settled.length,stake,profit,roi:stake?profit/stake:null,
  open:rows.filter(t=>t.status==='OPEN').reduce((n,t)=>n+Number(t.stake),0),open_future:rows.filter(t=>t.status==='OPEN'&&t.ticket_type==='future').reduce((n,t)=>n+Number(t.stake),0),
  open_count:rows.filter(t=>t.status==='OPEN').length,open_weekly_count:rows.filter(t=>t.status==='OPEN'&&t.ticket_type!=='future').length,all_stake:rows.filter(t=>t.status!=='VOIDED').reduce((n,t)=>n+Number(t.stake),0)};
});}
async function oneLineCopy(page){
 for(const item of await page.locator('.market-description, .market-eligibility').all()){
  const fit=await item.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return {text:el.textContent,lines:range.getClientRects().length,fits:el.scrollWidth<=el.clientWidth+1};});
  assert(fit.lines===1&&fit.fits,`Market copy must fit one line: ${fit.text}`);
 }
}
async function setup(browser, width, height, signedIn=true, firstVisit=false){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<768,hasTouch:width<768,acceptDownloads:true});
 const state={tickets:[],legs:[],fail:false,slow:false,empty:false,suspended:false,changed:false,betCalls:0,authCalls:0};
 if(!firstVisit)await context.addInitScript(({userId})=>localStorage.setItem('sportsbook-quick-start-v1:'+userId,'seen'),{userId});
 if(signedIn)await context.addInitScript(({session})=>localStorage.setItem('sportsbook-development-whlcnlacueweaqpsupqs',JSON.stringify(session)),{session});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()), endpoint=url.pathname.split('/').at(-1);
  if(url.protocol==='blob:'||url.protocol==='data:')return route.continue();
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.hostname.endsWith('supabase.co')){
   if(endpoint==='application_environment_identity')return json({environment:'development',project_ref:'whlcnlacueweaqpsupqs',app_origin:'https://dev.sportsbook.coopergurrie.com'});
   if(state.slow)await new Promise(r=>setTimeout(r,500));
   if(url.pathname.includes('/auth/')){state.authCalls++;return json(endpoint==='user'?session.user:{});}
   if(state.fail)return json({message:'Fixture connection unavailable. Try again.'},503);
   let body={};try{body=req.postDataJSON()||{}}catch{}
   if(endpoint==='claim_memberships')return json(2);
   if(endpoint==='team_claim_directory')return json({claims:[],invitations:[]});
   if(endpoint==='wallet_policy_review')return json({season:2026,week:5,latest_revision:0,current:{contract:'wallet-ticket-policy-v1',defaults_version:1,revision:0,effective_season:null,effective_week:null,values:{minimum_stake:1,maximum_picks:10,weekly_target:100,futures_cash_floor:25}},versions:[]});
   if(endpoint==='account_access')return json(memberships.map(m=>({league_id:m.league_id,view:true,admin:!!state.platformOwner||m.role==='admin',configure:!!state.platformOwner,platform_owner:!!state.platformOwner,bet:true,team_id:m.team_id,...(state.walletPolicies?.[m.league_id]?{policy:state.walletPolicies[m.league_id]}:{})})));
   if(endpoint==='account_history_seasons')return json([...new Set([2026,...state.tickets.filter(t=>t.league_id===body.p_league).map(t=>t.nfl_season)])].filter(Number.isInteger).sort((a,b)=>b-a));
   if(endpoint==='account_wallet_report'){
    (state.financialReportCalls??=[]).push({endpoint,...body});
    const selected=teams.filter(t=>t.league_id===body.p_league&&(!body.p_team||t.id===body.p_team)).map(t=>t.id);
    const all=[...(state.ledger??[]).map(l=>({...l,source:'ledger'})),...(state.events??[]).map(e=>({...e,source:'adjustment',balance_before:e.previous_balance,balance_after:e.new_balance}))]
     .filter(r=>selected.includes(r.team_id)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
    const start=body.p_cursor?all.findIndex(r=>r.id===body.p_cursor.id&&r.source===body.p_cursor.source)+1:0,rows=all.slice(start,start+(body.p_limit??40));
    return json({rows,total:all.length,by_team:selected.map(team_id=>{const changes=all.filter(r=>r.team_id===team_id&&r.balance_before!==null&&!['historical_opening','opening_balance'].includes(r.kind));return {team_id,
     credits:changes.reduce((n,r)=>n+Math.max(Number(r.balance_after)-Number(r.balance_before),0),0),debits:changes.reduce((n,r)=>n+Math.max(Number(r.balance_before)-Number(r.balance_after),0),0)};}),
     next:start+rows.length<all.length?{id:rows.at(-1).id,source:rows.at(-1).source}:null,as_of:new Date().toISOString()});
   }
   if(endpoint==='account_selection_report'){
    (state.financialReportCalls??=[]).push({endpoint,...body});const counts=new Map();
    for(const t of state.tickets.filter(t=>t.league_id===body.p_league&&t.nfl_season===body.p_season&&(!body.p_week||t.market_week===body.p_week)&&(!body.p_team||t.team_id===body.p_team)&&t.status!=='VOIDED'))for(const l of state.legs.filter(l=>l.ticket_id===t.id)){
     const label=/moneyline|^ml$/i.test(l.market_type)?l.selection.replace(/\s*·?\s*ML$/i,'')+' · ML':l.selection;
     const r=counts.get(label)??{label,count:0,stakes:0,won:0,lost:0,pushed:0,open:0};r.count++;r.stakes+=Number(t.stake);
     if(l.status==='WON')r.won++;else if(l.status==='LOST')r.lost++;else if(['PUSH','VOIDED'].includes(l.status))r.pushed++;else r.open++;counts.set(label,r);
    }
    const all=[...counts.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)),revision=JSON.stringify(all);
    if(body.p_cursor?.revision&&body.p_cursor.revision!==revision)return json({message:'Selection results changed; refresh report before continuing'},409);
    const start=body.p_cursor?all.findIndex(r=>r.label===body.p_cursor.label)+1:0,rows=all.slice(start,start+(body.p_limit??40));
    return json({rows,total:all.length,top:all.slice(0,12),appearances:all.reduce((n,r)=>n+r.count,0),maximum:all[0]?.count??0,revision,
     next:start+rows.length<all.length?{label:rows.at(-1).label,revision}:null,as_of:new Date().toISOString()});
   }
   if(endpoint==='account_betting_totals'){
    (state.bettingTotalCalls??=[]).push(body);
    return json(fixtureTotals(state,body.p_league,body.p_season,body.p_week));
   }
   if(endpoint==='account_balance_page'){
    (state.balancePageCalls??=[]).push(body);
    const entries=buildBalanceHistory({tickets:state.tickets,ledger:state.ledger??[],events:state.events??[],
     wallets:memberships.map(m=>({team_id:m.team_id,balance:100-state.tickets.filter(t=>t.team_id===m.team_id).reduce((n,t)=>n+Number(t.stake),0)}))},body.p_team);
    const start=body.p_cursor?entries.findIndex(e=>e.id===body.p_cursor.id)+1:0,page=entries.slice(start,start+(body.p_limit??30));
    return json({entries:page,total:entries.length,next:start+page.length<entries.length?{id:page.at(-1).id}:null,as_of:new Date().toISOString()});
   }
   if(endpoint==='account_score_progress'){
    (state.scoreProgressCalls??=[]).push(body);
    const periods=[...(body.p_current?[{nfl_season:body.p_current.season,market_week:body.p_current.week}]:[]),
     ...state.tickets.filter(t=>(body.p_tickets??[]).includes(t.id))];
    return json((state.scoreRows??[]).filter(r=>r.league_id===body.p_league&&periods.some(p=>p.nfl_season===r.nfl_season&&p.market_week===r.market_week)));
   }
   if(endpoint==='account_ticket_page'||endpoint==='account_open_ticket_report'){
    if(endpoint==='account_open_ticket_report'){
     (state.financialReportCalls??=[]).push({endpoint,...body});
     body.p_filters={status:'Open',season:body.p_season,market_week:body.p_week||undefined,team:body.p_team||'all',details:false};
    }
    (state.historyPageCalls??=[]).push(body);
    const f=body.p_filters??{},league=body.p_league,personal=memberships.find(m=>m.league_id===league)?.team_id;
    const rows=state.tickets.filter(t=>t.league_id===league&&(!f.personal||t.team_id===personal)
     &&(!f.ticket||t.id===f.ticket)&&(!f.season||t.nfl_season===f.season)&&(!f.market_week||t.market_week===f.market_week)
     &&(!f.team||f.team==='all'||f.personal||t.team_id===f.team)
     &&(!f.status||f.status==='All'||(f.status==='Settled'?t.status!=='OPEN':t.status===f.status.toUpperCase()))
     &&(!f.week||f.week==='all'||(f.week==='futures'?t.ticket_type==='future':t.placement_week===Number(f.week)))
     &&[t.id,t.legacy_ticket_id,...teams.filter(x=>x.id===t.team_id).flatMap(x=>[x.team_name,x.sportsbook_owner_name]),
       ...state.legs.filter(l=>l.ticket_id===t.id).flatMap(l=>[l.selection,l.matchup,l.market_type])].join(' ').toLowerCase().includes((f.query??'').trim().toLowerCase()));
    const value=t=>f.sort==='settled'?(t.settled_at?Date.parse(t.settled_at):null):f.sort==='winnings'?Number(t.actual_payout):f.sort==='odds'?
     t.accepted_combined_odds>0?1+t.accepted_combined_odds/100:1+100/Math.abs(t.accepted_combined_odds):Date.parse(t.placed_at);
    rows.sort((a,b)=>{const x=value(a),y=value(b);return x===null&&y!==null?1:y===null&&x!==null?-1:
     (x===null||y===null?0:(f.direction==='asc'?x-y:y-x))||Date.parse(b.placed_at)-Date.parse(a.placed_at)||a.id.localeCompare(b.id);});
    const start=body.p_cursor?rows.findIndex(t=>t.id===body.p_cursor.id)+1:0,page=rows.slice(start,start+(body.p_limit??20));
    return json({tickets:page,legs:f.details===false?[]:state.legs.filter(l=>page.some(t=>t.id===l.ticket_id)),ticketPromotions:f.details===false?[]:(state.ticketPromotions??[]).filter(p=>page.some(t=>t.id===p.ticket_id)),
     ...(endpoint==='account_open_ticket_report'?{totals:fixtureTotals(state,body.p_league,body.p_season,body.p_week)}:{}),
     total:rows.length,next:start+page.length<rows.length?{id:page.at(-1).id}:null,as_of:new Date().toISOString()});
   }
   if(endpoint==='sportsbook_period')return json([{week:5,league_season:body.p_league===B?9:3,nfl_season:2026}]);
   if(endpoint==='sportsbook_board_manifest'){
    const weekly=boards.find(b=>b.league_id===body.p_league),future=futureBoards.find(b=>b.league_id===body.p_league);
    const status=b=>({...b,content_version:state.movement??0,...(state.specials&&!state.pregame?{phase:'live'}:{}),...(state.suspended?{suspension_reason:'Fixture source outage; markets wait for fresh data.'}:{}),...(state.liveDevelopment&&b.board_type==='weekly'?{suspension_reason:'Live pricing unavailable: observed starter points and a validated remaining-points model are required.'}:{})});
    return json({...(state.walletPolicies?.[body.p_league]?{policy:state.walletPolicies[body.p_league]}:{}),week:state.week??5,weekly:state.empty?null:status(weekly),future:state.empty||!state.futures?null:status(future)});
   }
   if(endpoint==='sportsbook_quote_snapshot'||endpoint==='sportsbook_current_snapshot'||endpoint==='sportsbook_category_snapshot'){
    if(endpoint==='sportsbook_category_snapshot')(state.categoryCalls??=[]).push(body);
    const b=endpoint==='sportsbook_current_snapshot'?(body.p_type==='future'?futureBoards:boards).find(b=>b.league_id===body.p_league):[...boards,...futureBoards].find(b=>b.id===body.p_board);
    if(state.empty||(body.p_type==='future'&&!state.futures))return json({week:state.week??5,board:null,markets:[]});
    return json({week:state.week??5,board:{...b,content_version:state.movement??0,...(state.specials&&!state.pregame?{phase:'live'}:{}),...(state.suspended?{suspension_reason:'Fixture source outage; markets wait for fresh data.'}:{}),...(state.liveDevelopment&&b.board_type==="weekly"?{suspension_reason:'Live pricing unavailable: observed starter points and a validated remaining-points model are required.'}:{})},markets:(b.board_type==='future'?futureQuotes(b):[...quotes(b),...(state.specials?specialQuotes(b,state):[])]).filter(m=>endpoint!=='sportsbook_category_snapshot'||marketCategory(m.kind)===body.p_category)});
   }
   if(endpoint==='list_promos')return json([]);
   if(endpoint==='league_leaderboard')return json(state.standings??[]);
   if(endpoint==='ticket_score_observations')return json(state.scoreRows??[]);
   if(endpoint==='leagues')return json(leagues);
   if(endpoint==='teams')return json(teams);
   if(endpoint==='league_memberships')return json(memberships);
   if(endpoint==='wallets')return json(memberships.map(m=>({team_id:m.team_id,balance:100-state.tickets.filter(t=>t.team_id===m.team_id).reduce((n,t)=>n+t.stake,0)})));
   if(endpoint==='tickets')return json(state.tickets);
   if(endpoint==='ticket_legs')return json(state.legs);
   if(endpoint==='sportsbook_boards')return json(state.empty?[]:(url.searchParams.get('board_type')==='eq.future'?(state.futures?futureBoards:[]):boards).filter(b=>url.searchParams.get('league_id')===`eq.${b.league_id}`));
   if(endpoint==='league_result_weeks')return json([{nfl_season:2026,market_week:4,final:true,fetched_at:new Date().toISOString(),results:Object.fromEntries(teams.filter(t=>t.league_id===A).map((t,i)=>[t.id,{name:t.team_name,points:120+i*10,projection:125,projection_basis:'Fixture archived forecast',matchup_id:1,players_points:{}}]))}]);
   if(endpoint==='weekly_schedule')return json({automation_enabled:false,publication_paused:false,job_times:{}});
   if(['my_notification_preferences','league_notification_defaults'].includes(endpoint)){
    const body=req.postDataJSON(),values={opening:true,reminder:true,recap:true,monday_watch:true,reopening:true};
    return json({league_id:body.p_league,user_id:userId,revision:0,defaults:values,available:values,effective:values,overrides:{},weekly_limit:3});
   }
   if(req.method()!=='GET'){assert(['sportsbook_period','sportsbook_quote_snapshot','league_leaderboard','claim_memberships'].includes(endpoint),`Unexpected mutation ${endpoint}`);}
   return json([]);
  }
  if(url.origin===origin&&url.pathname.startsWith('/api/')){
   if(endpoint==='active-starters')return json({observed_at:new Date().toISOString(),rosters:[]});
   if(endpoint==='place-bet'){
    state.betCalls++;const body=req.postDataJSON(),b=boards.find(b=>b.id===body.board_id);
    if(!state.changed){state.changed=true;b.revision++;return json({error:'Lines have changed. Review and explicitly approve the new prices.'},409);}
    assert.equal(body.revision,b.revision);const m=memberships.find(m=>m.league_id===b.league_id);
    const id='fixture-ticket';state.tickets.push({id,league_id:b.league_id,team_id:m.team_id,nfl_season:2026,legacy_ticket_id:null,placement_week:5,market_week:5,placed_at:new Date().toISOString(),settled_at:null,stake:body.stake,accepted_combined_odds:264,accepted_potential_payout:36.4,actual_payout:0,status:'OPEN'});
    state.legs=body.picks.map((id,i)=>({id:`leg-${i}`,ticket_id:'fixture-ticket',leg_number:i+1,selection:quotes(b).find(q=>q.id===id).label,market_type:'Spread',matchup:'Fixture matchup',status:'OPEN'}));
    return json({ticket_id:id,balance:90,email_status:'pending'});
   }
   return json({error:'Fixture route unavailable'},503);
  }
  if(url.origin===origin){const root=path.resolve('dist');let target=path.resolve(root,'.'+url.pathname);if(!target.startsWith(root+path.sep)&&target!==root)return route.abort();if(!fs.existsSync(target)||fs.statSync(target).isDirectory())target=path.join(root,'index.html');const ext=path.extname(target);return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[ext]||'application/octet-stream',body:fs.readFileSync(target)});}
  return route.abort(); // No external images, emails, analytics or live API writes.
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForLoadState('networkidle');return {context,page,state,errors};
}
async function geometry(page,label){const g=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth}));assert(g.scroll<=g.width,`${label} overflow: ${JSON.stringify(g)}`);evidence.push({label,...g});}
async function menu(page,item){await page.getByLabel('Open Account Options').click();await page.locator('.profile-options').getByRole(item==='Sign Out'?'button':'link',{name:item,exact:true}).click();}
if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.UX_BROWSER_PATH?{executablePath:process.env.UX_BROWSER_PATH}:{})});
 try{
  const sign=await setup(browser,390,844,false);assert(!await sign.page.getByText('Goldy',{exact:false}).count());
  await sign.page.getByLabel('Email Address').fill('fixture@example.test');await sign.page.getByRole('button',{name:'Email Me A Sign-In Link'}).click();await sign.page.getByRole('heading',{name:'Check Your Email'}).waitFor();assert(sign.state.authCalls>0);await sign.context.close();
  for(const width of (process.env.UX_SKIP_MATRIX?[]:[360,390,430,768,1024,1440])){
   const {context,page,state,errors}=await setup(browser,width,844);
   await page.getByRole('heading',{name:/SEASON/}).waitFor();assert.equal(await page.locator('.line-updates-coming-soon').count(),0);assert.equal(await page.locator('.line-refresh-status').count(),0);
   for(const theme of ['dark','light']){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);await geometry(page,`${width}-${theme}-home`);
    const balance=page.locator('.profile-copy small');assert(await balance.isVisible());assert.match(await balance.innerText(),/100\.00/);
    const alignment=await page.locator('.board-window').evaluate(el=>({align:getComputedStyle(el).textAlign,right:el.getBoundingClientRect().right,parentRight:el.parentElement.getBoundingClientRect().right}));
    assert.equal(alignment.align,'right');assert(Math.abs(alignment.right-alignment.parentRight)<2,'Board status must stay at the right edge');
    await page.screenshot({path:path.join(output,`home-${width}-${theme}.png`),fullPage:true});
   }
   await page.locator('.market-quote').nth(0).click();await page.locator('.market-quote').nth(1).click();
   await page.getByRole('button',{name:/Bet Slip/}).click();await page.getByRole('dialog').waitFor();
   await page.getByLabel('Wager',{exact:true}).fill('10');
   assert(await page.locator('.place-bet').isEnabled());await page.screenshot({path:path.join(output,`slip-${width}.png`),fullPage:true});
   await page.keyboard.press('Escape');assert(!await page.getByRole('dialog').isVisible());
   await page.getByLabel('League',{exact:true}).selectOption(B);assert(!await page.locator('.slip-banner').count());await menu(page,'Home');
   await page.getByRole('heading',{name:/SEASON 9/}).waitFor();assert.equal(await page.locator('.slip-banner').count(),0);
   await page.getByLabel('Open Account Options').click();assert.equal(await page.locator('.profile-options').getByRole('button',{name:'Admin',exact:true}).count(),0);await page.keyboard.press('Escape');
   assert.equal(state.betCalls,0);assert.deepEqual(errors,[]);await context.close();
  }
  for(const width of [360,390,1440]){
   const f=await setup(browser,width,844);f.state.futures=true;f.state.liveDevelopment=true;await f.page.reload();await f.page.getByRole('heading',{name:/SEASON/}).waitFor();
   assert.equal(await f.page.getByText(/Live pricing unavailable:/).count(),0);assert.equal(await f.page.locator('.line-updates-coming-soon').count(),0);
   await f.page.getByRole('button',{name:'Season Futures',exact:true}).click();await f.page.locator('.future-row').first().waitFor();
   assert.equal(await f.page.locator('.board-window').getByText(/parlay|single/i).count(),0);
   assert.equal(await f.page.locator('.market-eligibility').count(),4);
   await oneLineCopy(f.page);
   for(const title of await f.page.locator('.market-title').all()){
    const g=await title.evaluate(el=>({titleRight:el.querySelector('h2').getBoundingClientRect().right,labelLeft:el.querySelector('.market-eligibility').getBoundingClientRect().left}));assert(g.labelLeft>g.titleRight);
   }
   for(const row of await f.page.locator('.future-row').all()){
    assert.equal(await row.locator('.market-eligibility').count(),0);
    const details=await row.evaluate(el=>{const name=el.querySelector('.future-team strong'),actions=el.querySelector('.future-actions');return {nameRight:name.getBoundingClientRect().right,actionsLeft:actions.getBoundingClientRect().left,textFits:name.scrollWidth<=name.clientWidth}});
    assert(details.textFits && details.nameRight<details.actionsLeft,'Long team names must not overlap futures odds');
   }
   for(const theme of ['dark','light']){await f.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await f.page.waitForTimeout(250);await geometry(f.page,`futures-${width}-${theme}`);await f.page.screenshot({path:path.join(output,`futures-${width}-${theme}.png`),fullPage:true});}
   f.state.specials=true;f.state.pregame=true;f.state.liveDevelopment=false;await f.page.clock.install();await f.page.reload();await f.page.getByRole('button',{name:'Weekly Specials',exact:true}).click();await f.page.locator('.count-selection .market-quote').first().waitFor();
   assert.equal(await f.page.locator('.market-eligibility').count(),8);for(const label of await f.page.locator('.market-eligibility').all())assert.equal(await label.innerText(),'Eligible for Singles and Parlays');
   await oneLineCopy(f.page);
   for(const title of await f.page.locator('.market-title').all()){const g=await title.evaluate(el=>({right:el.getBoundingClientRect().right,labelRight:el.querySelector('.market-eligibility').getBoundingClientRect().right,titleRight:el.querySelector('h2').getBoundingClientRect().right,labelLeft:el.querySelector('.market-eligibility').getBoundingClientRect().left}));assert(g.labelLeft>g.titleRight&&Math.abs(g.right-g.labelRight)<2);}
   assert.equal(await f.page.locator('.market-description').count(),0);
   for(const card of await f.page.locator('.count-special').all()){
    const choices=card.locator('.count-selection .market-quote');assert.equal(await choices.count(),2);
    assert.match(await choices.nth(0).innerText(),/Exactly 4.*\+300/s);assert.match(await choices.nth(1).innerText(),/At Least 4\+.*-125/s);
    await choices.nth(0).click();await choices.nth(1).click();
    assert.equal(await choices.nth(0).getAttribute('aria-pressed'),'true');assert.equal(await choices.nth(1).getAttribute('aria-pressed'),'false');
    await choices.nth(0).click();await choices.nth(1).click();assert.equal(await choices.nth(1).getAttribute('aria-pressed'),'true');
    await choices.nth(1).click();
   }
   for(const theme of ['dark','light']){await f.page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await f.page.waitForTimeout(250);await geometry(f.page,`specials-${width}-${theme}`);await f.page.screenshot({path:path.join(output,`specials-${width}-${theme}.png`),fullPage:true});}
   f.state.pregame=false;await f.page.reload();await f.page.getByRole('button',{name:'Weekly Specials',exact:true}).click();await f.page.locator('.count-selection .quote-price').first().waitFor();const price=f.page.locator('.count-selection .quote-price').first();assert.match(await price.innerText(),/\+300/);f.state.movement=1;await f.page.clock.fastForward(30000);await price.locator('.line-movement-up').waitFor();assert.match(await price.innerText(),/\+320.*↑/s);
   const arrow=await price.locator('.line-movement').evaluate(el=>({position:getComputedStyle(el).position,right:el.getBoundingClientRect().right,parentRight:el.parentElement.getBoundingClientRect().right}));assert.notEqual(arrow.position,'absolute');assert(Math.abs(arrow.right-arrow.parentRight)<2);
   await f.page.locator('.count-special').first().screenshot({path:path.join(output,`odds-arrow-${width}.png`)});
   await f.page.waitForLoadState('networkidle');await f.page.clock.fastForward(5100);assert.equal(await price.locator('.line-movement').count(),0);f.state.movement=-1;await f.page.clock.fastForward(30000);await price.locator('.line-movement-down').waitFor();assert.match(await price.innerText(),/\+280.*↓/s);
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  const {context,page,state,errors}=await setup(browser,390,844);
  await page.locator('.market-quote').nth(0).click();await page.locator('.market-quote').nth(1).click();await page.getByRole('button',{name:/Bet Slip/}).click();await page.getByLabel('Wager',{exact:true}).fill('10');
  await page.locator('.place-bet').click();await page.getByRole('button',{name:/Approve/}).waitFor();assert.equal(state.betCalls,1);
  assert(await page.locator('.place-bet').isDisabled());await page.getByRole('button',{name:/Approve/}).click();
  // Reduced viewport models keyboard space, not an actual OS keyboard/device test.
  await page.setViewportSize({width:390,height:420});await page.getByLabel('Wager',{exact:true}).focus();await page.locator('.place-bet').scrollIntoViewIfNeeded();
  const rect=await page.locator('.place-bet').boundingBox();assert(rect.y>=0&&rect.y+rect.height<=420);await page.screenshot({path:path.join(output,'slip-reduced-height.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('.place-bet').click();await page.locator('.feedback').filter({hasText:/Bet placed/}).waitFor();assert.equal(state.betCalls,2);
  await page.getByRole('link',{name:'My Bets',exact:true}).click();await page.locator('.history-ticket').first().waitFor();await geometry(page,'ticket-history');await page.screenshot({path:path.join(output,'tickets-mobile.png'),fullPage:true});
  await menu(page,'Admin');await page.getByRole('link',{name:/Reports & Dashboard/}).click();await page.locator('.report-toolbar select').nth(0).waitFor();
  await page.locator('.report-toolbar select').nth(2).selectOption('4');await geometry(page,'reports-mobile');await page.screenshot({path:path.join(output,'reports-mobile.png'),fullPage:true});
  for(const [name,ext]of [['CSV Data','csv'],['PNG Image','png'],['PDF Document','pdf']]){
   console.log(`Checking report export: ${ext}`);
   await page.getByRole('button',{name:'Export',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name}).click();const d=await download;await d.saveAs(path.join(output,`report-fixture.${ext}`));assert(fs.statSync(path.join(output,`report-fixture.${ext}`)).size>100);
  }
  await context.close();
  for(const mode of ['empty','suspended','slow','fail']){
   const f=await setup(browser,360,740);f.state[mode]=true;await f.page.reload();await f.page.waitForLoadState('networkidle');await geometry(f.page,`${mode}-mobile`);await f.page.screenshot({path:path.join(output,`${mode}-mobile.png`),fullPage:true});
   if(mode==='suspended'){assert(await f.page.getByText('Fixture source outage; markets wait for fresh data.').isVisible());assert(await f.page.locator('.market-quote').first().isDisabled());}
   if(mode==='fail'){await f.page.getByRole('heading',{name:'Could Not Load Your Account'}).waitFor();f.state.fail=false;await f.page.getByRole('button',{name:'Try Again'}).click();await f.page.locator('.market-quote').first().waitFor();}
   if(mode==='slow'){await f.page.reload();await f.page.getByRole('status').filter({hasText:/Loading/}).first().waitFor();await f.page.screenshot({path:path.join(output,'loading-mobile.png')});}
   await f.context.close();
  }
  fs.writeFileSync(path.join(output,'viewport-evidence.json'),JSON.stringify(evidence,null,2));assert.deepEqual(errors,[]);
  console.log(`Passed measured viewports, both themes, long names/balance, native dialog, reduced height, revised-price approval, fixture ticket/history, league switch/admin roles, report exports and empty/suspended/loading/error retry. Evidence: ${output}`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exit(1)});
module.exports={setup,menu,A,B,boards,quotes,teams};

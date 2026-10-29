// Fully intercepted localhost fixtures; no owner browser/session or live bets.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup,boards,quotes}=require('./test-ux.cjs');
const {marketCategory}=require('../src/lib/market-categories.ts');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{for(let i=0;i<100;i++){if(test())return;await sleep(50);}throw Error('Fixture requests did not finish');};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,1440]){
   const f=await setup(browser,width,900),p=f.page,reads=[],wire=[];
   let movement=0,fail='',starterReads=0,manifestReads=0;
   const board=()=>({...boards[0],content_version:movement,revision:1+movement});
   await p.route('**/rest/v1/rpc/sportsbook_board_manifest',route=>{manifestReads++;return route.fulfill({json:{week:5,weekly:board(),future:{...board(),id:'future-fixture',board_type:'future'}}});});
   await p.route('**/rest/v1/rpc/sportsbook_category_snapshot',route=>{
    const body=route.request().postDataJSON();reads.push(body.p_category);
    if(body.p_category===fail)return route.fulfill({status:503,json:{message:'Fixture category outage'}});
    const b=board(),base=quotes(b)[0];
    const all=[...quotes(b),{...base,id:'player-one',market_key:'player-one',kind:'player_points',side:'over',line:20.5,label:'Actual Player Over 20.5',subject:'Actual Player',metadata:{player_id:'one',position:'QB'}},
     {...base,id:'weekly-one',kind:'weekly_high',side:'yes',label:'Weekly high',metadata:{}}];
    const result={week:5,board:body.p_category==='Season Futures'?{...b,id:'future-fixture',board_type:'future'}:b,
     markets:all.filter(m=>marketCategory(m.kind)===body.p_category).map(m=>({...m,odds:m.odds+(movement?20:0)}))};
    wire.push({category:body.p_category,bytes:Buffer.byteLength(JSON.stringify(result))});
    return route.fulfill({json:result});
   });
   await p.route('**/api/active-starters?*',route=>{starterReads++;return route.fulfill({json:{observed_at:new Date().toISOString(),rosters:[]}});});
   await p.reload();await p.locator('.market-quote').first().waitFor();await p.waitForLoadState('networkidle');
   assert.deepEqual(reads,['Matchups'],'initial view loads neither player nor future bodies');
   await p.getByRole('button',{name:'Player Points',exact:true}).click();
   await p.getByRole('heading',{name:/Actual Player/}).first().waitFor();await p.waitForLoadState('networkidle');
   assert.deepEqual(reads,['Matchups','Player Points'],'player view reuses its matchup grouping dependency');
   await p.getByRole('button',{name:'Matchups',exact:true}).click();await p.locator('.market-quote').first().waitFor();await p.waitForLoadState('networkidle');
   assert.equal(reads.length,2,'unchanged category body is reused');
   await p.locator('.market-quote').first().click();
   await p.getByRole('button',{name:'Weekly Specials',exact:true}).click();await p.waitForLoadState('networkidle');
   await p.getByRole('heading',{name:'Highest Weekly Scorer',exact:true}).waitFor();assert(reads.includes('Weekly Specials'),JSON.stringify(reads));const before=reads.length;
   movement++;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await until(()=>reads.length>=before+2);await p.waitForLoadState('networkidle');
   assert.deepEqual(reads.slice(before).sort(),['Matchups','Weekly Specials'],'slip prices refresh even while browsing another category');
   await p.getByRole('button',{name:/Bet Slip/}).click();await p.getByRole('dialog').waitFor();
   assert(await p.getByRole('button',{name:/Approve/}).isVisible());await p.keyboard.press('Escape');
   fail='Head to Head';await p.getByRole('button',{name:'Head to Head',exact:true}).click();
   await p.getByText('These markets could not load. Use Retry prices above.',{exact:true}).waitFor();
   fail='';await p.getByRole('button',{name:'Retry prices',exact:true}).click();await p.getByText('These markets could not load. Use Retry prices above.',{exact:true}).waitFor({state:'hidden'});
   await p.getByRole('button',{name:'Matchups',exact:true}).click();await p.locator('.market-quote').first().waitFor();
   assert(!reads.includes('Season Futures'),'unvisited futures body remains absent');
   // Use the visibility API, not a real OS window, to verify pause/resume.
   await p.clock.install();await p.evaluate(()=>{window.fixtureHidden=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureHidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   const hiddenBefore=reads.length,starterBefore=starterReads,manifestBefore=manifestReads;
   await p.clock.fastForward(61000);await sleep(100);
   assert.equal(reads.length,hiddenBefore);assert.equal(manifestReads,manifestBefore);assert.equal(starterReads,starterBefore);
   movement++;await p.evaluate(()=>{window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await p.waitForLoadState('networkidle');
   await until(()=>reads.length>hiddenBefore);assert(reads.length>hiddenBefore,'resume checks the current board immediately');
   assert.equal(f.state.betCalls,0);assert.deepEqual(f.errors,[]);
   fs.mkdirSync('work/category-loading',{recursive:true});fs.writeFileSync(`work/category-loading/${width}-bytes.json`,JSON.stringify({width,reads,wire},null,2));
   await f.context.close();
   const history=await setup(browser,width,900);let historyManifests=0;
   await history.page.route('**/rest/v1/rpc/sportsbook_board_manifest',route=>{historyManifests++;return route.fallback();});
   await history.page.getByRole('link',{name:'My Bets',exact:true}).click();await history.page.getByRole('heading',{name:'My Bets',exact:true}).waitFor();
   await history.page.waitForLoadState('networkidle');const categoryCount=history.state.categoryCalls.length,manifestCount=historyManifests;
   await history.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await until(()=>historyManifests>manifestCount);
   assert.equal(history.state.categoryCalls.length,categoryCount,'history without picks requests metadata, no category bodies');
   await history.context.close();
  }
  console.log('Passed mobile/desktop lazy categories, grouping dependencies, unchanged-body reuse, slip-family price refresh/approval, category failure isolation and hidden pause/immediate resume. JSON bytes recorded from intercepted responses, not production wire billing.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exit(1);});

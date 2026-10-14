// All authentication, data and API calls use intercepted local fixtures.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, A, boards } = require('./test-ux.cjs');
const output = path.resolve(process.env.UX_OUTPUT || 'work/refresh-recovery');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const width of [390,1440]) {
      const f = await setup(browser,width,900);
      let fail = false, active = 0, peak = 0, requests = 0;
      await f.page.route('**/rest/v1/rpc/sportsbook_quote_snapshot', async route => {
        const body = route.request().postDataJSON();
        if (body.p_board !== boards.find(b => b.league_id === A).id) return route.fallback();
        requests++; active++; peak = Math.max(peak,active);
        try {
          if (fail) {
            await new Promise(resolve=>setTimeout(resolve,300));
            return await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'canceling statement due to statement timeout'})});
          }
          return await route.fallback();
        } finally { active--; }
      });
      await f.page.locator('.market-quote').first().waitFor();
      const count = await f.page.locator('.market-quote').count();
      await f.page.clock.install();
      await f.page.reload();
      await f.page.waitForLoadState('networkidle');
      await f.page.locator('.market-quote').first().waitFor();
      fail = true;
      await f.page.clock.fastForward(31000);
      await f.page.getByRole('button',{name:'Retry prices',exact:true}).waitFor();
      assert.equal(await f.page.locator('.market-quote').count(),count,'Refresh failure retains usable quotes');
      assert(await f.page.getByText(/Showing the last available data/).isVisible());
      assert.equal(await f.page.getByText('canceling statement due to statement timeout',{exact:true}).count(),0);
      await f.page.getByRole('button',{name:'Retry prices',exact:true}).dblclick();
      assert.equal(peak,1,'Retry cannot overlap the pending weekly request');
      await f.page.getByRole('button',{name:'My Bets',exact:true}).click();
      assert(await f.page.getByRole('heading',{name:'My Bets',exact:true}).isVisible());
      await f.page.getByRole('button',{name:'Home',exact:true}).click();
      await f.page.waitForFunction(() => !document.querySelector('.feedback.error button')?.disabled);
      fail = false;
      await f.page.getByRole('button',{name:'Retry prices',exact:true}).click();
      await f.page.getByRole('button',{name:'Retry prices',exact:true}).waitFor({state:'hidden'});
      assert.equal(await f.page.locator('.market-quote').count(),count);
      await f.page.screenshot({path:path.join(output,`recovered-${width}.png`),fullPage:true});
      await f.page.route('**/rest/v1/ticket_legs*', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'fixture history timeout'})}));
      await f.page.reload();
      await f.page.locator('.market-quote').first().waitFor();
      await f.page.getByRole('button',{name:'My Bets',exact:true}).click();
      await f.page.getByRole('button',{name:'Retry history',exact:true}).waitFor();
      assert.equal(await f.page.getByRole('heading',{name:'Could Not Load Your Account',exact:true}).count(),0);
      await f.page.unroute('**/rest/v1/ticket_legs*');
      // A first-load failure is different from an empty scheduled slate.
      fail = true;
      await f.page.reload();
      await f.page.getByRole('button',{name:'Retry prices',exact:true}).waitFor();
      assert(await f.page.getByText('Markets temporarily unavailable',{exact:true}).isVisible());
      await f.page.getByRole('button',{name:'My Bets',exact:true}).click();
      assert.equal(await f.page.getByText('canceling statement due to statement timeout',{exact:true}).count(),0);
      fail=false;
      f.state.empty=true;
      await f.page.route('**/rest/v1/rpc/sportsbook_period',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{week:6,league_season:3,nfl_season:2026}])}));
      await f.page.reload();
      await f.page.getByRole('heading',{name:/WEEK\s+6/}).waitFor();
      await f.page.getByRole('button',{name:'My Bets',exact:true}).click();
      assert(await f.page.getByRole('heading',{name:'My Bets',exact:true}).isVisible());
      await f.context.close();
      console.log(`Passed ${width}px: stale retention, contextual first-load error, independent ticket navigation, single-flight retry and recovery (${requests} snapshot requests).`);
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

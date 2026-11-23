from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path('work/boff-visual-iteration8');out.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];api=[];base='http://127.0.0.1:5180';L='1312126153980391424'
def check(n,v):
 assert v,n
 checks.append(n)
source=json.loads(Path('visual/src/season-context.json').read_text(encoding='utf-8'));fixture=json.loads(Path('visual/src/data.json').read_text(encoding='utf-8'))
with sync_playwright() as p:
 b=p.chromium.launch();ctx=b.new_context(viewport={'width':1440,'height':1000},permissions=['clipboard-read','clipboard-write']);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:api.append(r.url) if '/api/' in r.url or 'supabase.co' in r.url else None)
 def visit(r):page.goto(base+'/'+L+'/'+r);page.wait_for_load_state('networkidle')
 def shot(n):page.screenshot(path=str(out/(n+'.png')))
 visit('my-bets');future=page.locator('#ticket-BF-08105');won=page.locator('#ticket-BF-08097');lost=page.locator('#ticket-BF-08091');mixed=page.locator('#ticket-BF-08104')
 check('Single futures have no expand button',future.locator('button.ticket-card-toggle').count()==0)
 check('Single futures show meter directly',future.locator('.wins-marker').inner_text()=='4')
 check('Single futures have one selection label',future.get_by_text('The 20 Year Rebuild · Over 7.5 wins',exact=True).count()==1)
 check('Single tickets have no leg result circles',page.locator('.single-ticket .leg-circle').count()==0)
 check('Lost single displays final result',lost.locator('.leg-result').count()==1 and '296.06' in lost.inner_text())
 check('Lost ticket omits return', 'Return' not in lost.locator('.ticket-card-bottom').inner_text())
 check('Collapsed parlay shows each leg',won.locator('.ticket-preview-leg').count()==3)
 check('Collapsed parlay has no final information','Final:' not in won.inner_text())
 check('Collapsed parlay has no progress or result icons',won.locator('.leg-circle,.leg-progress,.leg-result').count()==0)
 check('Parlay type appears once',won.get_by_text('3-Leg Parlay',exact=True).count()==1)
 shot('ticket-overview')
 won.locator('button.ticket-card-toggle').scroll_into_view_if_needed();before=page.evaluate('scrollY');url=page.url;won.locator('button.ticket-card-toggle').click();page.wait_for_timeout(100)
 check('Expansion preserves exact scroll',abs(page.evaluate('scrollY')-before)<2)
 check('Expansion keeps route and no modal',page.url==url and page.locator('dialog[open]').count()==0)
 check('Expanded parlay displays three finals',won.locator('.leg-result').count()==3)
 check('Expanded parlay shows matchups',won.locator('.slip-game h3').count()==3)
 check('Expanded parlay still has one title',won.get_by_text('3-Leg Parlay',exact=True).count()==1)
 check('Leg circles slightly smaller',won.locator('.leg-circle').first.evaluate('e=>e.clientWidth')<=25)
 won.screenshot(path=str(out/'parlay-expanded.png'))
 won.locator('button.ticket-card-toggle').click();check('Collapse removes all results','Final:' not in won.inner_text())
 visit('all-bets');check('All bets retain participant and type',page.locator('#ticket-BF-08097 .ticket-type').inner_text()=='3-Leg Parlay\nzachmerk' or '3-Leg Parlay' in page.locator('#ticket-BF-08097 .ticket-type').inner_text())
 rects=[page.locator('.ticket-tools .segmented').bounding_box(),page.get_by_label('Ticket Week').bounding_box(),page.get_by_label('Ticket Participant').bounding_box(),page.get_by_label('Ticket Sort').bounding_box(),page.get_by_label('Find A Ticket').bounding_box()]
 check('Desktop toolbar remains one row',max(r['y']+r['height'] for r in rects)-min(r['y']+r['height'] for r in rects)<3)
 page.get_by_label('Ticket Sort').select_option('stake-high');stakes=[float(s) for s in page.locator('.ticket-card-bottom>span:first-child b').all_text_contents()];check('Stake sorting retained',stakes==sorted(stakes,reverse=True))
 page.get_by_label('Find A Ticket').fill('Malik');check('Search includes total matchup',page.locator('#ticket-BF-08091').count()==1)
 visit('my-bets?ticket=BF-08091');check('Single deep link directly shows result without expansion',page.locator('#ticket-BF-08091 .leg-result').count()==1 and page.locator('#ticket-BF-08091 .inline-ticket-details').count()==0)
 page.locator('#ticket-BF-08091').get_by_role('button',name='Share Ticket',exact=True).click();check('Shared lost single has no result icon',page.locator('dialog .grouped-picks .leg-circle').count()==0);check('Shared lost single omits return','Return' not in page.locator('dialog .receipt-totals').inner_text());page.get_by_role('button',name='Copy Ticket Summary',exact=True).click();copied=page.evaluate('navigator.clipboard.readText()');check('Copied lost ticket omits zero return','Return:' not in copied and 'return:' not in copied);page.get_by_role('button',name='Close dialog',exact=True).click()
 visit('matchups');check('Slate has explicit Sleeper matchup links',page.get_by_role('link',name='Open freelance yush vs Malik’s Magic Magnum In Sleeper').count()==1)
 page.get_by_role('button',name='All Markets',exact=True).first.click();matchroute=page.url.split('/'+L+'/')[1]
 check('Detail removes redundant All Markets',page.get_by_role('button',name='All Markets',exact=True).count()==0)
 link=page.locator('.matchup .sleeper-link');check('Sleeper matchup text and external target',link.inner_text().strip()=='Sleeper Matchup' and link.get_attribute('target')=='_blank' and '/matchup/'+L+'/8/' in link.get_attribute('href'))
 check('Team header includes points and form',page.locator('.team-season-summary').count()==2 and page.locator('.team-season-summary .form-result').count()==10)
 gap=page.locator('.matchup-market-tabs').evaluate('e=>e.getBoundingClientRect().top-e.previousElementSibling.getBoundingClientRect().bottom');check('More separation before extra markets',gap>=25)
 check('Record has no encoding artifacts','â' not in page.locator('.matchup-vs').inner_text())
 shot('matchup-markets');page.get_by_role('tab',name='Season Comparison',exact=True).click()
 check('Season comparison metrics visible',all(page.get_by_role('rowheader',name=n,exact=True).count()==1 for n in ['Points For','Points Against','Points Per Game','Scoring Rank','Against The Spread']))
 check('Season last-five results source-backed',page.locator('.season-comparison .form-result').count()==10)
 check('No invented ATS record','consistent pregame benchmark' in page.locator('.season-data-note').inner_text())
 check('Archived injury gap explicit',page.get_by_text('Archived Injury Report Unavailable',exact=True).count()==2)
 check('Roster bye information present',page.locator('.availability-comparison li').count()>0)
 check('Earlier meeting empty state',page.get_by_text('No Earlier Meeting This Season',exact=True).count()==1)
 page.get_by_role('tab',name='Season Comparison',exact=True).focus();page.keyboard.press('ArrowLeft');check('Season tabs keyboard accessible',page.get_by_role('tab',name='Markets',exact=True).get_attribute('aria-selected')=='true');page.keyboard.press('End');check('End selects Season Comparison',page.get_by_role('tab',name='Season Comparison',exact=True).get_attribute('aria-selected')=='true')
 shot('season-comparison');page.locator('.header-league summary').click();check('League switcher has one named Sleeper link',page.locator('.league-dropdown').get_by_role('link',name='Sleeper League',exact=True).count()==1)
 for theme in ['light','dark']:
  visit(matchroute);page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.wait_for_timeout(250);page.get_by_role('tab',name='Season Comparison',exact=True).click();shot('season-'+theme)
  visit('my-bets?ticket=BF-08104');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.wait_for_timeout(250);shot('tickets-'+theme)
  check(theme+' ticket title uses text token',page.locator('#ticket-BF-08104 .ticket-type strong').evaluate("e=>getComputedStyle(e).color===getComputedStyle(e.closest('article')).color"));check(theme+' share link uses text token',page.locator('#ticket-BF-08104 .ticket-share').evaluate("e=>getComputedStyle(e).color===getComputedStyle(e.closest('article')).color"));check(theme+' expanded mixed parlay has local scores',page.locator('#ticket-BF-08104 .leg-progress').count()==1)
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900})
  for route in ['my-bets','all-bets',matchroute]:
   visit(route);check(str(width)+'px no overflow '+route,page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   if route==matchroute:
    page.get_by_role('tab',name='Season Comparison',exact=True).click();check(str(width)+'px no overflow season comparison',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    if width==390:shot('mobile-season')
  if width==390:visit('my-bets?ticket=BF-08104');shot('mobile-tickets')
 # Deterministic timing checks for feedback messages; timers reset on repeated identical rejection.
 page.set_viewport_size({'width':1440,'height':900});visit('matchups');page.clock.install();match=page.locator('.matchup').first;match.locator('.odds-button').nth(0).click();match.locator('.odds-button').nth(1).click();toast=page.locator('.toast');check('Incompatible picks show feedback','overlap' in toast.inner_text());page.clock.fast_forward(4990);check('Message stays fully visible for five seconds','toast-fading' not in toast.get_attribute('class'));toastX=toast.bounding_box()['x'];page.clock.fast_forward(20);check('Message enters fade after five seconds','toast-fading' in toast.get_attribute('class'));check('Fade uses opacity transition','opacity' in toast.evaluate('e=>getComputedStyle(e).transitionProperty'));page.wait_for_timeout(150);check('Fade preserves horizontal position',abs(toast.bounding_box()['x']-toastX)<2);page.clock.fast_forward(400);check('Message removed after fade',toast.count()==0)
 match.locator('.odds-button').nth(1).click();page.clock.fast_forward(4000);match.locator('.odds-button').nth(1).click();page.clock.fast_forward(2000);check('Repeated identical rejection restarts message lifetime',toast.count()==1 and 'toast-fading' not in toast.get_attribute('class'));page.clock.fast_forward(3400);check('Repeated message eventually clears',toast.count()==0)
 check('No page errors',not errors);check('No backend writes or requests',not api);b.close()
for t in fixture['teams']:
 rows=[r for r in source['rows'] if r['roster']==t['roster_id']];check('Source total reconciles '+str(t['roster_id']),abs(sum(r['points'] for r in rows)-t['pointsFor'])<.011)
check('Bounded context under 12KB',Path('visual/src/season-context.json').stat().st_size<12000)
(out/'review-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'backendRequests':api},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

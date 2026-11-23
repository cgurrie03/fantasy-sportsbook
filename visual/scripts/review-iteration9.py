from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path('work/boff-visual-iteration9');out.mkdir(parents=True,exist_ok=True);checks=[];errors=[];api=[];base='http://127.0.0.1:5180';L='1312126153980391424';route='matchup/sleeper-8-5-10'
def check(n,v):
 assert v,n
 checks.append(n)
with sync_playwright() as p:
 b=p.chromium.launch();ctx=b.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce');page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:api.append(r.url) if '/api/' in r.url or 'supabase.co' in r.url else None)
 def visit(r):page.goto(base+'/'+L+'/'+r);page.wait_for_load_state('networkidle')
 def shot(n):page.screenshot(path=str(out/(n+'.png')))
 def select(name):page.get_by_role('button',name='Show '+name,exact=True).click()
 visit(route);initial=page.locator('.carousel-page.active');check('Initial screen shows only two names pictures and records',initial.locator('.avatar').count()==2 and initial.locator('h2').count()==2 and initial.locator('p').count()==2 and initial.locator('dl,.recent-form').count()==0)
 check('Three selectable page dots',page.locator('.carousel-dot').count()==3)
 check('First page dot active',page.get_by_role('button',name='Show Teams & Records',exact=True).get_attribute('aria-current')=='true')
 check('Inactive pages inert and hidden',page.locator('.carousel-page[inert][aria-hidden="true"]').count()==2)
 check('Separate comparison tab replaced',page.get_by_role('tab',name='Season Comparison',exact=True).count()==0)
 check('Markets remain visible while reading stats',page.locator('.matchup').count()==1)
 height=page.locator('.matchup-carousel').bounding_box()['height'];shot('header-initial')
 select('Season Stats');active=page.locator('.carousel-page.active');check('Second screen includes current seed',active.get_by_text('Current Seed',exact=True).count()==2)
 check('Second screen includes scoring stats',active.get_by_text('Points For',exact=True).count()==2 and active.get_by_text('Points Against',exact=True).count()==2)
 check('Seed matches existing standings rank',active.locator('dd').first.inner_text()=='5 Of 12')
 check('Second screen has stable height',abs(page.locator('.matchup-carousel').bounding_box()['height']-height)<1);shot('header-season')
 select('Recent Form & Availability');active=page.locator('.carousel-page.active');check('Third screen includes ten recent results',active.locator('.form-result').count()==10)
 check('No oldest-first copy','Oldest First' not in page.locator('main').inner_text())
 check('Third screen retains byes earlier meetings and source gap','Week 8 Byes' in active.inner_text() and 'Earlier Meetings' in active.inner_text() and 'Archived Injury Report Unavailable' in active.inner_text())
 check('Third screen has stable height',abs(page.locator('.matchup-carousel').bounding_box()['height']-height)<1);shot('header-form')
 result=active.locator('.form-result').first;result.hover();tooltip=page.get_by_role('tooltip');check('Hover opens result popover',tooltip.is_visible());text=tooltip.inner_text();check('Popover names opponent week and exact final',all(s in text for s in ['Week 4','Diabloo','113.64','167.66','Lost','Final']))
 check('Popover linked to result button',result.get_attribute('aria-describedby')==tooltip.get_attribute('id'));shot('form-popover');tooltip.hover();page.wait_for_timeout(180);check('Popover stays open while hovering its content',tooltip.is_visible());page.keyboard.press('Escape');check('Escape closes popover',tooltip.count()==0)
 result.focus();check('Keyboard focus opens same information',tooltip.is_visible());page.keyboard.press('Tab');check('Each result reachable by keyboard',page.locator('.carousel-page.active .form-result').nth(1).evaluate('e=>e===document.activeElement'))
 select('Teams & Records');link=page.locator('.sleeper-link');check('Sleeper matchup is text link without icon',link.inner_text()=='Sleeper Matchup' and link.locator('svg').count()==0 and link.get_attribute('target')=='_blank')
 check('No redundant All Markets on detail',page.get_by_role('button',name='All Markets',exact=True).count()==0)
 visit('matchups');check('All slate week labels align with matchup column',all(abs(r['week']-r['label'])<1 for r in page.locator('.matchup').evaluate_all("es=>es.map(e=>({week:e.querySelector('.matchup-time').getBoundingClientRect().left,label:e.querySelector('.board-columns>span').getBoundingClientRect().left}))")))
 check('All slate Sleeper links have no icons',page.locator('.sleeper-link svg').count()==0)
 page.get_by_role('button',name='Notifications',exact=True).click()
 for i,tone in [(0,'gold'),(1,'gold'),(2,'red'),(3,'neutral')]:
  page.locator('.notification-item').nth(i).click();detail=page.locator('.notification-detail');summary=detail.locator('.notification-result');check('Notification '+str(i)+' result follows selection',summary.evaluate('e=>e.previousElementSibling.tagName==="UL"'));check('Notification '+str(i)+' result has emphasis',summary.evaluate('e=>Number(getComputedStyle(e).fontWeight)>=600'))
  if tone!='neutral':check('Notification '+str(i)+' result tone',summary.get_attribute('class').endswith('result-'+tone))
  if i==2:shot('notification-result')
 page.get_by_role('button',name='Close Notifications',exact=True).click() if page.get_by_role('button',name='Close Notifications',exact=True).count() else page.get_by_role('button',name='Notifications',exact=True).click()
 for theme in ['light','dark']:
  visit(route);page.evaluate(f"document.documentElement.dataset.theme='{theme}'");select('Season Stats');shot('season-'+theme);select('Recent Form & Availability');page.locator('.carousel-page.active .form-result').first.hover();shot('form-'+theme)
  check(theme+' active dot differs from inactive',page.locator('.carousel-dot.active').evaluate("e=>getComputedStyle(e,'::after').backgroundColor!==getComputedStyle(e.parentElement.querySelector('.carousel-dot:not(.active)'),'::after').backgroundColor"))
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900});visit(route)
  for view in ['Teams & Records','Season Stats','Recent Form & Availability']:
   select(view);check(str(width)+'px '+view+' no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   if width==390:shot('mobile-'+view.split()[0].lower())
  page.locator('.carousel-page.active .form-result').first.hover();box=page.get_by_role('tooltip').bounding_box();check(str(width)+'px tooltip within viewport',box['x']>=0 and box['x']+box['width']<=width)
 # Preserve prior ticket disclosure changes after replacing matchup context.
 page.set_viewport_size({'width':1440,'height':1000});visit('all-bets');won=page.locator('#ticket-BF-08097');check('Collapsed parlay still omits results','Final:' not in won.inner_text());won.locator('.ticket-card-toggle').scroll_into_view_if_needed();y=page.evaluate('scrollY');won.locator('button.ticket-card-toggle').click();check('Ticket expansion still preserves scroll',abs(page.evaluate('scrollY')-y)<2);check('Expanded parlay retains three finals',won.locator('.leg-result').count()==3);check('Singles still do not expand',page.locator('.single-ticket button.ticket-card-toggle').count()==0);check('Lost ticket still omits zero return','Return' not in page.locator('#ticket-BF-08091 .ticket-card-bottom').inner_text())
 # Verify exact automatic timing on a normal-motion page using controlled JS timers.
 timed=b.new_page(viewport={'width':1440,'height':1000});timed.on('pageerror',lambda e:errors.append(str(e)));timed.clock.install(time="2026-11-09T12:00:00");timed.goto(base+'/'+L+'/'+route);timed.wait_for_load_state('networkidle');timed.mouse.move(0,0)
 def idx():return timed.locator('.carousel-dot[aria-current="true"]').get_attribute('aria-label')
 check('Default carousel starts at identity',idx()=='Show Teams & Records');timed.clock.pause_at('2026-11-09T12:00:05');timed.get_by_role('button',name='Show Teams & Records',exact=True).click();timed.get_by_role('heading',name='Matchup',exact=True).click();timed.mouse.move(0,0);timed.clock.fast_forward(4999);check('No premature carousel rotation',idx()=='Show Teams & Records');timed.clock.fast_forward(1);check('Carousel rotates at five seconds',idx()=='Show Season Stats');timed.clock.fast_forward(5000);check('Carousel advances to third group',idx()=='Show Recent Form & Availability');timed.clock.fast_forward(5000);check('Carousel cycles to identity',idx()=='Show Teams & Records')
 timed.locator('.matchup-carousel').hover();start=idx();timed.clock.fast_forward(7000);check('Reading hover pauses rotation',idx()==start);timed.mouse.move(0,0);timed.clock.fast_forward(5000);check('Rotation resumes after hover',idx()!=start)
 timed.get_by_role('button',name='Pause Matchup Rotation',exact=True).click();timed.get_by_role('heading',name='Matchup',exact=True).click();timed.mouse.move(0,0);start=idx();timed.clock.fast_forward(10000);check('Pause control stops rotation',idx()==start)
 timed.get_by_role('button',name='Show Recent Form & Availability',exact=True).click();timed.get_by_role('button',name='Start Matchup Rotation',exact=True).click();start=idx();timed.clock.fast_forward(7000);check('Focused controls pause rotation',idx()==start);timed.get_by_role('heading',name='Matchup',exact=True).click();timed.mouse.move(0,0);timed.clock.fast_forward(5000);check('Manual selection resumes with a full interval',idx()!=start)
 timed.goto(base+'/'+L+'/matchups');timed.wait_for_load_state('networkidle');match=timed.locator('.matchup').first;match.locator('.odds-button').nth(0).click();match.locator('.odds-button').nth(1).click();toast=timed.locator('.toast');timed.clock.fast_forward(3999);check('Message fully visible through first four seconds','toast-fading' not in toast.get_attribute('class'));timed.clock.fast_forward(1);check('Message starts fading at four seconds','toast-fading' in toast.get_attribute('class'));check('Fade duration is exactly one second','1s' in toast.evaluate('e=>getComputedStyle(e).transitionDuration'));timed.clock.fast_forward(999);check('Message retained until fade completes',toast.count()==1);timed.clock.fast_forward(1);check('Message gone at exactly five seconds',toast.count()==0)
 match.locator('.odds-button').nth(1).click();timed.clock.fast_forward(4500);match.locator('.odds-button').nth(1).click();timed.clock.fast_forward(100);check('Repeated rejection restores full opacity phase','toast-fading' not in toast.get_attribute('class'));timed.clock.fast_forward(4900);check('Repeated rejection also clears at five seconds',toast.count()==0)
 # Reduced-motion preference starts paused and preserves manual navigation.
 visit(route);page.clock.install();page.clock.fast_forward(15000);check('Reduced motion starts with rotation paused',page.get_by_role('button',name='Show Teams & Records',exact=True).get_attribute('aria-current')=='true' and page.get_by_role('button',name='Start Matchup Rotation',exact=True).count()==1)
 check('No page errors',not errors);check('No backend requests',not api);b.close()
(out/'review-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'backendRequests':api},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

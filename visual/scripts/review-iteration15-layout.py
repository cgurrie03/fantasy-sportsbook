from pathlib import Path
from playwright.sync_api import sync_playwright
import json
from datetime import datetime, timezone, timedelta
out=Path('work/boff-visual-iteration15');out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
def check(n,v):
 assert v,n
 checks.append(n)
base='http://127.0.0.1:5180';league='/1312126153980391424/'
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce');page.on('pageerror',lambda e:errors.append(str(e)))
 def visit(route):page.goto(base+league+route);page.wait_for_load_state('networkidle')
 def shot(name):page.screenshot(path=str(out/(name+'.png')))
 for theme in ['light','dark']:
  visit('commissioner');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.get_by_role('tab',name='Rivalries',exact=True).click()
  spacing=page.locator('.rivals-table').evaluate('''e=>{const th=e.querySelector('tbody th'),avatar=th.querySelector('.avatar').getBoundingClientRect(),last=e.querySelector('tbody td:last-child'),head=e.querySelector('thead th:last-child');return {avatarInset:avatar.x-th.getBoundingClientRect().x,countInset:parseFloat(getComputedStyle(last).paddingRight),headingInset:parseFloat(getComputedStyle(head).paddingRight),headerBackground:getComputedStyle(e.querySelector('thead th')).backgroundColor}}''')
  check(theme+' avatar inset at least fourteen px',spacing['avatarInset']>=14);check(theme+' counts and heading have sixteen px end inset',spacing['countInset']>=16 and spacing['headingInset']>=16);check(theme+' table header has no contrasting filled band',spacing['headerBackground']=='rgba(0, 0, 0, 0)');shot('rivalries-'+theme)
  page.get_by_role('tab',name='Featured Matchups',exact=True).click();page.get_by_role('button',name='Eligibility Cutoffs',exact=True).click()
  for width,height in [(1920,1080),(1440,900),(1366,768),(1280,720),(1024,768)]:
   page.set_viewport_size({'width':width,'height':height});metrics=page.get_by_role('dialog').evaluate('e=>({height:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth})');check(theme+' cutoff all content fits '+str(width)+'x'+str(height),metrics['scroll']<=metrics['height']+1 and metrics['scrollWidth']<=metrics['width']+1)
   if width in [1366,1440]:shot('cutoffs-'+theme+'-'+str(width))
  page.keyboard.press('Escape');page.set_viewport_size({'width':1440,'height':900});visit('matchups');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");shot('slate-'+theme)
  check(theme+' compact offer titles use shared display face',all('Newsreader' in f for f in page.locator('.compact-offers h2').evaluate_all('es=>es.map(e=>getComputedStyle(e).fontFamily)')))
  page.get_by_role('button',name='Notifications',exact=True).click();page.get_by_role('button',name='Parlay Leg Won',exact=False).click();summary=page.locator('.notification-summary');check(theme+' notification states what remains',summary.locator('strong').inner_text()=='1 Leg Awaiting Confirmation');check(theme+' notification gives settled-leg counts','1 Won · 1 Pushed' in summary.inner_text());check(theme+' summary has no filled gold box',summary.evaluate('e=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)');check(theme+' summary follows selections',summary.bounding_box()['y']>page.locator('.notification-detail ul').bounding_box()['y']);shot('notification-'+theme);page.get_by_role('button',name='Close Notifications',exact=True).click()
  href=page.locator('.matchup-open-overlay').first.get_attribute('href');page.goto(base+href);page.wait_for_load_state('networkidle');page.evaluate(f"document.documentElement.dataset.theme='{theme}'")
  for i,label in enumerate(['Teams & Records','Season Stats','Recent Form & Availability']):
   page.get_by_role('button',name='Show '+label,exact=True).click();check(theme+' '+label+' shows vs and both seeds',page.locator('.carousel-page.active .carousel-versus').is_visible() and page.locator('.carousel-page.active .team-seed').count()==2);shot('matchup-'+theme+'-'+str(i+1))
  page.locator('.carousel-page.active .form-result').first.hover();line=page.locator('.historical-total-line').bounding_box();actual=page.locator('.historical-actual').bounding_box();check(theme+' final total immediately follows line',0<=actual['x']-line['x']-line['width']<=10);shot('last-five-'+theme)
  for route in ['offers','futures','my-bets','all-bets','league','profile','commissioner']:
   visit(route);check(theme+' '+route+' body uses shared UI face','Public Sans' in page.locator('body').evaluate('e=>getComputedStyle(e).fontFamily'));head=page.locator('.page-heading h1');
   if head.count():check(theme+' '+route+' page title uses shared display face','Newsreader' in head.first.evaluate('e=>getComputedStyle(e).fontFamily'))
   if route=='offers':check(theme+' full offer titles use shared display face',all('Newsreader' in f for f in page.locator('.offer-top h2').evaluate_all('es=>es.map(e=>getComputedStyle(e).fontFamily)')))
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900});page.goto(base+href);page.wait_for_load_state('networkidle')
  for label in ['Teams & Records','Season Stats','Recent Form & Availability']:
   page.get_by_role('button',name='Show '+label,exact=True).click();check(str(width)+'px '+label+' no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
 check('No browser errors in targeted checks',not errors)

 b.close()
(out/'targeted-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

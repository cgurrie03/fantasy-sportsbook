from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path('work/boff-visual-iteration16');out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
def check(n,v):
 assert v,n
 checks.append(n)
base='http://127.0.0.1:5180';league='/1312126153980391424/'
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce');page.on('pageerror',lambda e:errors.append(str(e)))
 def visit(route):page.goto(base+league+route);page.wait_for_load_state('networkidle')
 for theme in ['light','dark']:
  visit('commissioner');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");badge=page.locator('.environment-badge');balance=page.locator('.header-balance');check(theme+' dev badge is left of credit balance',badge.is_visible() and badge.bounding_box()['x']+badge.bounding_box()['width']<balance.bounding_box()['x']);page.get_by_role('tab',name='Featured Matchups',exact=True).click();page.get_by_role('button',name='Configure Matchup Rules',exact=True).click()
  for w,h in [(1920,1080),(1440,900),(1366,768),(1280,720),(1024,768)]:
   page.set_viewport_size({'width':w,'height':h});dialog=page.get_by_role('dialog');check(theme+' rules fit without scrolling '+str(w)+'x'+str(h),dialog.evaluate('e=>e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1'));xs=page.locator('.feature-rule-editor').evaluate_all('es=>es.map(e=>e.getBoundingClientRect().x)');check(theme+' all eight rules share one list at '+str(w),len(xs)==8 and max(xs)-min(xs)<1)
   if w==1366:page.screenshot(path=str(out/('rules-'+theme+'.png')))
  page.get_by_role('button',name='Save Rules',exact=True).click();check(theme+' Save Rules closes and saves renamed dialog',page.get_by_role('dialog').count()==0);page.set_viewport_size({'width':1440,'height':900});visit('matchups');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.wait_for_timeout(200);page.screenshot(path=str(out/('slate-'+theme+'.png')));hrefs=page.locator('.matchup-open-overlay').evaluate_all('es=>es.map(e=>e.getAttribute("href"))')
  for href in hrefs:
   page.goto(base+href);page.wait_for_load_state('networkidle');sizes=[]
   for i,label in enumerate(['Teams & Records','Season Stats','Recent Form & Availability']):
    page.get_by_role('button',name='Show '+label,exact=True).click();sizes.append(page.locator('.matchup-carousel').bounding_box()['height']);check(theme+' slide content fits '+href+' '+str(i),page.locator('.carousel-page.active').evaluate('e=>e.scrollHeight<=e.clientHeight+1'))
   check(theme+' slides stay equal '+href,max(sizes)-min(sizes)<1);check(theme+' injury separators are dots '+href,all(' · ' in text and ' - ' not in text for text in page.locator('.carousel-page.active .injury-row small').all_text_contents()))
  # Exercise all five category hues against actual accepted preview markets.
  for kind,tone in [('game','gold'),('tank','bronze'),('playoff','sage'),('rivalry','clay'),('upset','lavender')]:
   visit('matchups');page.evaluate('''async k=>{const m=await import('/src/model.ts'),r=await import('/src/featuredRules.ts');const s=r.defaultFeatureSettings();s.overrides[m.matchups[0].id]=k;s.playoffModes[m.matchups[0].id]='both';r.saveFeatureSettings(s)}''',kind);page.reload();page.wait_for_load_state('networkidle');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.wait_for_timeout(200);button=page.locator('.matchup').first.locator('.boosted-odds').first
   check(theme+' '+kind+' carries matching '+tone+' category',button.count()==1 and 'boosted-tone-'+tone in button.get_attribute('class'))
   def contrast():return button.evaluate('''e=>{const s=getComputedStyle(e),c=getComputedStyle(e.querySelector('.price-pair strong')).color;const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};const lum=color=>{const a=rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};const x=lum(c),y=lum(s.backgroundColor);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}''')
   check(theme+' '+kind+' accented quote text meets 4.5 contrast',contrast()>=4.5);button.click();page.wait_for_timeout(200);check(theme+' '+kind+' selected quote text meets 4.5 contrast',contrast()>=4.5)
   if kind in ['rivalry','tank']:page.screenshot(path=str(out/(kind+'-boost-'+theme+'.png')))
  page.evaluate("localStorage.removeItem('boff-features-v2:1312126153980391424')")
 # Many real roster identities with illustrative injury statuses: no actual injury claims.
 page.goto(base+hrefs[0]);page.wait_for_load_state('networkidle');page.get_by_role('button',name='Show Recent Form & Availability',exact=True).click()
 stress=page.evaluate('''async()=>{const reactModule=await import('/node_modules/.vite/deps/react.js'),React=reactModule.default||reactModule,domModule=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=domModule.createRoot||domModule.default.createRoot,{InjuryReport}=await import('/src/MatchupSeason.tsx'),players=(await import('/src/players.json')).default;const host=document.createElement('div');host.className='carousel-form';host.style.width='240px';document.body.appendChild(host);const root=createRoot(host);root.render(React.createElement(InjuryReport,{injuries:players.filter(p=>p.roster===1).slice(0,8).map(p=>({...p,bodyPart:'Ankle',status:'Out'}))}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const list=host.querySelector('.injury-list');const result={count:list.querySelectorAll('.injury-row').length,height:list.clientHeight,scroll:list.scrollHeight,overflow:getComputedStyle(list).overflowY};list.scrollTop=list.scrollHeight;result.lastReachable=list.lastElementChild.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+1;root.unmount();host.remove();return result}''')
 check('Many injuries remain bounded and scrollable',stress['count']==8 and stress['height']<=106 and stress['scroll']>stress['height'] and stress['overflow']=='auto');check('Last injury remains reachable',stress['lastReachable'])
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900});page.goto(base+hrefs[0]);page.wait_for_load_state('networkidle');sizes=[]
  for label in ['Teams & Records','Season Stats','Recent Form & Availability']:
   page.get_by_role('button',name='Show '+label,exact=True).click();sizes.append(page.locator('.matchup-carousel').bounding_box()['height']);check(str(width)+'px '+label+' no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));check(str(width)+'px '+label+' contents fit frame',page.locator('.carousel-page.active').evaluate('e=>e.scrollHeight<=e.clientHeight+1'))
  check(str(width)+'px slide heights are equal',max(sizes)-min(sizes)<1)
 check('No targeted browser errors',not errors);b.close()
(out/'targeted-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path('work/boff-visual-iteration14');r=json.loads((out/'review-results.json').read_text(encoding='utf-8'));checks=[]
def check(n,v):
 assert v,n
 checks.append(n)
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce')
 for theme in ['light','dark']:
  page.goto('http://127.0.0.1:5180/1312126153980391424/commissioner');page.wait_for_load_state('networkidle');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.get_by_role('tab',name='Rivalries',exact=True).click()
  ratios=page.locator('.rivals-table select').first.evaluate('''e=>{const s=getComputedStyle(e);const lum=c=>{const a=c.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);return {text:contrast(s.color,s.backgroundColor),boundary:contrast(s.borderTopColor,s.backgroundColor)}}''')
  check(theme+' rivalry text contrast at least 4.5',ratios['text']>=4.5);check(theme+' field border contrast at least 3',ratios['boundary']>=3);page.locator('.rivalry-populate-menu summary').click();page.get_by_role('button',name='Similar Standings',exact=False).click();page.screenshot(path=str(out/('team-rivalries-'+theme+'.png')))
  page.get_by_role('tab',name='Featured Matchups',exact=True).click();gear=page.get_by_role('button',name='Eligibility Cutoffs',exact=True).locator('svg');check(theme+' gear is readable eighteen-pixel vector',gear.bounding_box()['width']==18);page.screenshot(path=str(out/('featured-'+theme+'.png')))
  page.goto('http://127.0.0.1:5180/1312126153980391424/matchups');page.wait_for_load_state('networkidle');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.screenshot(path=str(out/('boosted-slate-'+theme+'.png')));href=page.locator('.matchup-open-overlay').first.get_attribute('href');page.goto('http://127.0.0.1:5180'+href);page.wait_for_load_state('networkidle');page.evaluate(f"document.documentElement.dataset.theme='{theme}'")
  for i,label in enumerate(['Teams & Records','Season Stats','Recent Form & Availability']):
   page.get_by_role('button',name='Show '+label,exact=True).click();page.screenshot(path=str(out/(theme+'-matchup-'+str(i+1)+'.png')))
  page.locator('.carousel-page.active .form-result').first.hover();page.screenshot(path=str(out/('last-five-'+theme+'.png')));page.mouse.move(100,100)
  page.goto('http://127.0.0.1:5180/1312126153980391424/offers');page.wait_for_load_state('networkidle');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.screenshot(path=str(out/('offers-'+theme+'.png')))
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900});page.goto('http://127.0.0.1:5180'+href);page.wait_for_load_state('networkidle')
  for label in ['Teams & Records','Season Stats','Recent Form & Availability']:
   page.get_by_role('button',name='Show '+label,exact=True).click();check(str(width)+'px '+label+' no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  if width==390:page.screenshot(path=str(out/'mobile-matchup.png'))
 b.close()
r['checks'].extend(checks);r['passed']=len(r['checks']);(out/'review-results.json').write_text(json.dumps(r,indent=2),encoding='utf-8');print(json.dumps({'passed':r['passed'],'additional':len(checks)}))

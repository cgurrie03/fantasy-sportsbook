from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path('work/boff-visual-iteration20');out.mkdir(parents=True,exist_ok=True);checks=[];errors=[];base='http://127.0.0.1:5180/1312126153980391424/'
def check(n,v):assert v,n;checks.append(n)
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce');page.on('pageerror',lambda e:errors.append(str(e)))
 for width in [1440,1280,1100,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':1000 if width==1440 else 900})
  for game in ['sleeper-8-5-10','sleeper-8-1-4']:
   page.goto(base+'matchup/'+game);page.wait_for_load_state('networkidle')
   if not page.get_by_role('tab',name='Alternate Lines',exact=True).count():continue
   page.get_by_role('tab',name='Alternate Lines',exact=True).click();root=page.locator('.alternate-market-grid')
   check(str(width)+game+' both markets render',page.get_by_role('table',name='Alternate Spreads',exact=True).count()==1 and page.get_by_role('table',name='Alternate Match Totals',exact=True).count()==1)
   check(str(width)+game+' consistent market headings',root.locator('.panel-heading h2').evaluate_all('es=>es.every(e=>getComputedStyle(e).fontFamily.includes("Public Sans")&&getComputedStyle(e).fontSize==="18px")'))
   check(str(width)+game+' larger column headers',root.locator('.alternate-preset-head').evaluate_all('es=>es.every(e=>parseFloat(getComputedStyle(e).fontSize)>=13)'))
   check(str(width)+game+' no sliders',root.locator('input[type=range]').count()==0)
   check(str(width)+game+' twenty preset selections',root.locator('.odds-button').count()==20)
   check(str(width)+game+' alternates never boosted',root.locator('.boosted-odds').count()==0)
   check(str(width)+game+' headers and rows align',root.evaluate('''root=>[...root.querySelectorAll('.alternate-presets')].every(table=>{const headers=[...table.querySelectorAll('[role=columnheader]')].map(e=>e.getBoundingClientRect());return [...table.querySelectorAll('[role=rowgroup] [role=row]')].every(row=>[...row.children].every((cell,i)=>{const r=cell.getBoundingClientRect();return Math.abs(r.left-headers[i].left)<1&&Math.abs(r.width-headers[i].width)<1}))})'''))
   check(str(width)+game+' headers readable without overflow',root.locator('[role=columnheader]').evaluate_all('es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)'))
   check(str(width)+game+' over and under explicit',page.get_by_role('table',name='Alternate Match Totals',exact=True).locator('.odds-button>span:first-child').evaluate_all('es=>es.every((e,i)=>e.textContent.startsWith(i%2===0?"Over ":"Under "))'))
   check(str(width)+game+' targets end in half point',root.locator('.odds-button>span:first-child').evaluate_all('es=>es.every(e=>/\\.5$/.test(e.textContent))'))
   check(str(width)+game+' no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   root.evaluate('e=>window.scrollTo(0,scrollY+e.getBoundingClientRect().top-150)');page.wait_for_timeout(80)
   if width in [1440,390] and game=='sleeper-8-5-10':
    for theme in ['light','dark']:
     page.evaluate(f'document.documentElement.dataset.theme="{theme}"');page.screenshot(path=str(out/f'alternate-{width}-{theme}.png'))
  if width==1440:
   page.get_by_role('table',name='Alternate Spreads',exact=True).locator('.odds-button').first.click();check('Preset click adds accepted selection to slip',page.locator('.odds-button.selected').count()==1)
   page.get_by_role('table',name='Alternate Spreads',exact=True).locator('.odds-button').first.click();check('Preset can be removed',page.locator('.odds-button.selected').count()==0)
 check('No browser errors',not errors);b.close()
(out/'preset-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

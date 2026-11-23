from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime,timezone,timedelta
import json
out=Path('work/boff-visual-iteration15');checks=[]
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce');page.goto('http://127.0.0.1:5180/1312126153980391424/commissioner');page.wait_for_load_state('networkidle');page.get_by_role('tab',name='Featured Matchups',exact=True).click()
 def role(selector):return page.locator(selector).first.evaluate('e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight]}')
 baseline=role('.feature-toolbar h2');page.get_by_role('button',name='Notifications',exact=True).click();assert role('.notification-heading h2')==baseline;checks.append('Commissioner and notification section headings match family size weight and line height');page.get_by_role('button',name='Close Notifications',exact=True).click();page.goto('http://127.0.0.1:5180/1312126153980391424/profile?section=balance-history');page.wait_for_load_state('networkidle')
 if True:
  assert role('.balance-history .panel-heading h3')==baseline;checks.append('Balance history heading uses the shared section type role')
 loaded=page.evaluate('Array.from(document.fonts).map(f=>({family:f.family,status:f.status}))');assert any(x['family']=='Public Sans' and x['status']=='loaded' for x in loaded) and any(x['family']=='Newsreader' and x['status']=='loaded' for x in loaded);checks.append('Both self-hosted typefaces load successfully')
 t=b.new_page(viewport={'width':1440,'height':900},reduced_motion='no-preference');fixed=datetime(2026,11,9,tzinfo=timezone.utc);t.clock.install(time=fixed);t.clock.pause_at(fixed+timedelta(minutes=1));t.goto('http://127.0.0.1:5180/1312126153980391424/matchup/sleeper-8-5-10');t.wait_for_load_state('networkidle');t.mouse.move(0,0);t.clock.fast_forward(4000);t.evaluate("document.documentElement.dataset.theme='dark'");t.clock.fast_forward(250);t.screenshot(path=str(out/'carousel-timer-half.png'));b.close()
(out/'font-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2),encoding='utf-8');print(checks)

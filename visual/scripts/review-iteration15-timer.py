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
 b=p.chromium.launch()
 href='/1312126153980391424/matchup/sleeper-8-5-10'
 # Timer checks use a controlled browser clock: no real eight-second sleeps.
 timer=b.new_page(viewport={'width':1440,'height':900},reduced_motion='no-preference');fixed=datetime(2026,11,9,tzinfo=timezone.utc);timer.clock.install(time=fixed);timer.clock.pause_at(fixed+timedelta(minutes=1));timer.goto(base+href);timer.wait_for_load_state('networkidle');timer.mouse.move(0,0)
 current=lambda:timer.locator('.carousel-page.active').get_attribute('aria-label')
 offset=lambda:float(timer.locator('.timer-progress').evaluate('e=>getComputedStyle(e).strokeDashoffset').replace('px',''))
 start=current();timer.clock.fast_forward(3900);check('Timer ring fills progressively',0.3<offset()<0.7);timer.clock.fast_forward(3900);check('Slide remains before eight seconds',current()==start);timer.clock.fast_forward(300);check('Slide advances after eight seconds',current()!=start)
 timer.clock.fast_forward(1800);timer.locator('.matchup-carousel').hover();held=current();progress=offset();timer.clock.fast_forward(9000);check('Hover pauses slide rotation and ring',current()==held and abs(offset()-progress)<0.01);timer.mouse.move(0,0);timer.clock.fast_forward(6300);check('Rotation resumes remaining time after hover',current()!=held)
 timer.get_by_role('button',name='Pause Matchup Rotation',exact=True).click();timer.locator('h1').click();timer.mouse.move(0,0);held=current();timer.clock.fast_forward(10000);check('Explicit pause prevents rotation',current()==held);timer.get_by_role('button',name='Show Teams & Records',exact=True).click();check('Manual slide selection resets timer',offset()==1)
 reduced=b.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce');reduced.clock.install(time=fixed);reduced.clock.pause_at(fixed+timedelta(minutes=1));reduced.goto(base+href);reduced.wait_for_load_state('networkidle');reduced.clock.fast_forward(17000);check('Reduced motion starts with rotation paused',reduced.get_by_role('button',name='Start Matchup Rotation',exact=True).is_visible() and '1 Of 3' in reduced.locator('.carousel-page.active').get_attribute('aria-label'))
 b.close()
(out/'timer-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

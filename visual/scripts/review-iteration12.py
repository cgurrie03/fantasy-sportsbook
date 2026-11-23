from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path('work/boff-visual-iteration12');out.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];api=[];L='1312126153980391424';base='http://127.0.0.1:5180'
def check(n,v):
 assert v,n
 checks.append(n)
with sync_playwright() as p:
 b=p.chromium.launch();ctx=b.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce');page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:api.append(r.url) if '/api/' in r.url or 'supabase.co' in r.url else None)
 def visit(route):page.goto(base+'/'+L+'/'+route);page.wait_for_load_state('networkidle')
 def tab(name):page.get_by_role('tab',name=name,exact=True).click()
 def shot(name):page.screenshot(path=str(out/(name+'.png')))
 visit('matchups');engine=page.evaluate(Path(__file__).with_name('featured-engine-tests.js').read_text(encoding='utf-8'));checks.extend(engine)
 initial=page.evaluate("async()=>{const m=await import('/src/model.ts');const r=await import('/src/featuredRules.ts');return {count:m.matchups.length,assignments:[...r.selectFeatureAssignments(m.matchups,m.teams,r.getFeatureSettings())],tickets:JSON.stringify(m.exampleTickets)}}")
 check('Actual league automatic quota respected',sum(1 for _,a in initial['assignments'] if a['source']=='Automatic' and a['kind']!='rivalry')<=initial['count']//2)
 check('No invented division rivalry in sample league',not any(a['kind']=='rivalry' for _,a in initial['assignments']))
 actual=page.evaluate("async()=>{const m=await import('/src/model.ts');return m.matchups.every(game=>{const f=m.featuredAssignment(game);return game.markets.every(row=>{const pick=m.marketPick(row);const qualifies=f&&(f.market==='over'?row.kind==='match_total'&&row.side==='over':row.kind==='moneyline'&&f.targets.includes(row.team_id));return qualifies?pick.originalOdds===row.odds&&pick.odds===m.boosted(row.odds,f.boost):pick.originalOdds==null&&pick.odds===row.odds;});});}")
 check('Each market receives only its correct feature boost',actual);shot('weekly-boosts')
 tankIds=[id for id,a in initial['assignments'] if a['kind']=='tank'];check('Actual sample has eligible combined-record Tank Bowls',len(tankIds)>0)
 for id in tankIds:
  card=page.locator('[data-matchup-id="'+id+'"]');check(id+' Over alone has crossed-out price',card.locator('.original-price').count()==1 and card.locator('.odds-button[data-market="Total"]').first.locator('.original-price').count()==1)
 visit('commissioner');tab('Featured Matchups');check('Assignments and eligibility sections available',page.get_by_role('heading',name='Eligibility Cutoffs',exact=True).is_visible() and page.get_by_role('heading',name='Week 8 Assignments',exact=True).is_visible())
 names=page.locator('.feature-rule-editor .feature-badge strong').all_text_contents();check('Priority matches owner order',names==['Championship Rematch','Playoff Race','Rivalry','Revenge Game','Upset Watch','Streak Breaker','Tank Bowl','Game Of The Week'])
 check('Removed categories unavailable',not any('Closest' in x or 'High-Scoring' in x or 'Clash' in x for x in page.locator('.feature-assignment-row select option').all_text_contents()))
 check('No editable percentage input',page.locator('input[aria-label*="Boost"],input[aria-label*="Profit"]').count()==0)
 check('Tank begins week eight for fourteen-week season',page.get_by_label('Tank Bowl: Start Week',exact=True).input_value()=='8')
 check('Tank combined threshold is 33.3',page.get_by_label('Tank Bowl: Combined Win % At Most',exact=True).input_value()=='33.3')
 check('Streak threshold is five',page.get_by_label('Streak Breaker: Winning Streak At Least',exact=True).input_value()=='5')
 page.get_by_label('Tank Bowl: Combined Win % At Most',exact=True).fill('20');page.get_by_role('button',name='Save Cutoffs',exact=True).click();visit('matchups');check('Saved cutoff changes actual displayed assignments',page.locator('[data-featured="Tank Bowl"]').count()==0)
 visit('commissioner');tab('Featured Matchups');page.get_by_label('Tank Bowl: Combined Win % At Most',exact=True).fill('33.3');page.get_by_role('button',name='Save Cutoffs',exact=True).click();visit('commissioner');tab('Featured Matchups');check('Cutoff persists after reload',page.get_by_label('Tank Bowl: Combined Win % At Most',exact=True).input_value()=='33.3');shot('assignments')
 metadata=page.evaluate("async()=>{const m=await import('/src/model.ts');const r=await import('/src/featuredRules.ts');const first=m.matchups[0];return {id:first.id,away:first.away.id,home:first.home.id,a:r.participants.find(p=>p.roster===first.away.roster_id).id,b:r.participants.find(p=>p.roster===first.home.roster_id).id,people:r.participants}}")
 # Manual assignment can exceed the ordinary quota and only one fixed bonus applies per game.
 for select in page.locator('.feature-assignment-row > label > select').all():select.select_option('rivalry')
 page.get_by_role('button',name='Save Assignments',exact=True).click();visit('matchups');check('Manual assignment can cover every matchup',page.locator('[data-featured="Rivalry"]').count()==initial['count'])
 check('Manual rivalry shows locked 35 percent',all('35% Profit' in s for s in page.locator('.matchup .feature-badge').all_text_contents()))
 unchanged=page.evaluate("async()=>JSON.stringify((await import('/src/model.ts')).exampleTickets)");check('Existing accepted tickets remain unchanged',unchanged==initial['tickets'])
 visit('commissioner');tab('Featured Matchups');page.get_by_label('Assignment For '+metadata['id'],exact=True).select_option('none');page.get_by_role('button',name='Save Assignments',exact=True).click();visit('matchups');check('Commissioner removes an individual bonus',page.locator('[data-matchup-id="'+metadata['id']+'"] .feature-badge').count()==0)
 visit('commissioner');tab('Featured Matchups');page.get_by_label('Assignment For '+metadata['id'],exact=True).select_option('playoff');page.get_by_label('Playoff Context For '+metadata['id'],exact=True).select_option('away-racing');page.get_by_role('button',name='Save Assignments',exact=True).click();visit('matchups');card=page.locator('[data-matchup-id="'+metadata['id']+'"]');check('Manual single-racer scenario labelled Playoff Spoiler',card.get_attribute('data-featured')=='Playoff Spoiler');check('Racing team marked without receiving spoiler boost',card.locator('.team-market-row').first.locator('.playoff-team-indicator').count()==1 and card.locator('.team-market-row').first.locator('.odds-button[data-market="Moneyline"] .original-price').count()==0);check('Only opponent receives spoiler boost',card.locator('.team-market-row').nth(1).locator('.odds-button[data-market="Moneyline"] .original-price').count()==1);shot('playoff-spoiler')
 visit('commissioner');tab('Featured Matchups');check('Manual playoff context persists',page.get_by_label('Playoff Context For '+metadata['id'],exact=True).input_value()=='away-racing')
 # Rivalry editing uses actual Sleeper participants and reciprocal three-slot limits.
 page.evaluate("localStorage.removeItem('boff-features-v2:'+ '1312126153980391424')");visit('commissioner');tab('Rivalries');check('Rivalries tab exposes all source participants',page.get_by_label('Rivalry Participant',exact=True).locator('option').count()==13);check('No divisions state is accurate',page.get_by_text('No Sleeper Divisions In This League',exact=True).is_visible());check('No fake division restore',page.get_by_role('button',name='Restore Division Suggestions',exact=True).is_disabled())
 page.get_by_label('Rivalry Participant',exact=True).select_option(metadata['a']);page.get_by_label('Rival 1',exact=True).select_option(metadata['b']);page.get_by_role('button',name='Save Rivalries',exact=True).click();page.get_by_label('Rivalry Participant',exact=True).select_option(metadata['b']);check('Saved rivalry is reciprocal',page.get_by_label('Rival 1',exact=True).input_value()==metadata['a']);check('Only three rival slots available',page.locator('.rivalry-slots select').count()==3);shot('rivalries')
 visit('matchups');check('Rival pairing automatically features actual matchup',page.locator('[data-matchup-id="'+metadata['id']+'"]').get_attribute('data-featured')=='Rivalry');check('Rivalries remain outside ordinary quota',page.locator('.matchup .feature-badge').count()>initial['count']//2)
 # Palette uses clear labels/percentages and passes text contrast in both themes.
 for theme in ['light','dark']:
  visit('commissioner');tab('Featured Matchups');page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.wait_for_timeout(250)
  contrast=page.locator('.feature-rule-editor .feature-badge').evaluate_all('''es=>{const lum=c=>{const a=c.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};return es.map(e=>{const s=getComputedStyle(e),a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});}''');check(theme+' feature badge contrast meets 4.5',len(contrast)==8 and min(contrast)>=4.5);shot('commissioner-'+theme)
  tab('Rivalries');shot('rivalries-'+theme)
 # Native links, betting controls, guide completion and ticket disclosures survive the management changes.
 visit('matchups');url=page.url;first=page.locator('.matchup').first;first.locator('.odds-button').first.click();check('Odds remain independently actionable',page.url==url and first.locator('.odds-button').first.get_attribute('aria-pressed')=='true');first.locator('.matchup-open-overlay').click(position={'x':8,'y':8});check('Matchup card still opens extra markets','/matchup/' in page.url);page.get_by_role('button',name='Open Guide',exact=True).click();check('Guide has no Previous on first page',page.get_by_role('button',name='Previous',exact=True).count()==0);page.get_by_role('dialog').get_by_role('button',name='Preferences',exact=True).click();page.get_by_role('button',name="Let's Go!",exact=True).click();check('Guide completion still closes dialog',page.get_by_role('dialog').count()==0)
 visit('all-bets');won=page.locator('#ticket-BF-08097');check('Collapsed parlay omits finals','Final:' not in won.inner_text());won.locator('button.ticket-card-toggle').scroll_into_view_if_needed();pos=page.evaluate('scrollY');won.locator('button.ticket-card-toggle').click();check('Ticket expansion preserves scroll',abs(page.evaluate('scrollY')-pos)<2);check('Expanded ticket has three finals',won.locator('.leg-result').count()==3)
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900})
  visit('commissioner');tab('Featured Matchups');check(str(width)+'px featured controls no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));tab('Rivalries');check(str(width)+'px rivalry controls no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));visit('matchups');check(str(width)+'px weekly slate no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  if width==390:shot('mobile-boosts');visit('commissioner');tab('Rivalries');shot('mobile-rivalries')
 check('No page errors',not errors);check('No backend requests',not api);b.close()
(out/'review-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'backendRequests':api},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

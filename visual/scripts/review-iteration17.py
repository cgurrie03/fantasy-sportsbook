from pathlib import Path
from playwright.sync_api import sync_playwright
import json

out=Path('work/boff-visual-iteration17');out.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];api=[];L='1312126153980391424';base='http://127.0.0.1:5180'
def check(name, value):
 assert value,name
 checks.append(name)
with sync_playwright() as p:
 b=p.chromium.launch();ctx=b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce');page=ctx.new_page()
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:api.append(r.url) if '/api/' in r.url or 'supabase.co' in r.url else None)
 def visit(route):page.goto(base+'/'+L+'/'+route);page.wait_for_load_state('networkidle')
 def tab(name):page.get_by_role('tab',name=name,exact=True).click()
 def shot(name):page.screenshot(path=str(out/(name+'.png')))
 def planner():visit('commissioner');tab('Featured Matchups')
 def week(n):page.get_by_role('button',name='Week '+str(n)+(' · Current Week' if n==8 else ''),exact=True).click()
 def save():page.get_by_role('button',name='Save Presets',exact=True).click()
 visit('matchups');checks.extend(page.evaluate(Path(__file__).with_name('featured-engine-tests.js').read_text(encoding='utf-8')))
 extra=page.evaluate('''async()=>{
 const r=await import('/src/featuredRules.ts'),p=await import('/src/featuredPlanning.ts'),m=await import('/src/model.ts'),o=await import('/src/featuredOptions.ts'),schedule=(await import('/src/featured-schedule.json')).default;
 const a=[];const ok=(n,v)=>{if(!v)throw Error(n);a.push(n)};
 ok('All fourteen actual regular-season weeks are present',schedule.weeks.length===14&&schedule.weeks.every(w=>w.pairs.length===6));
 ok('Every week uses twelve distinct known roster IDs',schedule.weeks.every(w=>new Set(w.pairs.flat()).size===12&&w.pairs.flat().every(id=>m.teams.some(t=>t.roster_id===id))));
 ok('Future fixtures have identities only, no quotes or forecasts',p.scheduledMatches(10).every(x=>Object.keys(x).sort().join(',')==='away,home,id'));
 ok('Every category has a unique icon',new Set(Object.values(o.featureCatalog).map(x=>x.icon)).size===8);
 ok('Rivalries default blank until commissioner action',r.defaultFeatureSettings().rivals.length===0);
 const old=(await import('/src/featured-source.json')).default.participants,co=old.filter(x=>x.roster===8),op=old.find(x=>x.roster!==8);
 const merged=r.migrateTeamRivals(co.map(x=>[x.id,op.id]));
 ok('Co-manager pairings migrate into one team pair',co.length===2&&merged.length===1&&r.validRivals(merged));
 ok('Migration discards same-team and unknown pairings',r.migrateTeamRivals([[co[0].id,co[1].id],['unknown',op.id]]).length===0);
 ok('Rivalry identity list contains one entry per team',r.rivalTeams.length===m.teams.length&&new Set(r.rivalTeams.map(t=>t.roster)).size===m.teams.length);
 ok('Rivalry names and IDs are team identities',r.rivalTeams.every(t=>m.teams.some(team=>team.id===t.id&&team.name===t.name)));

 for(const [name,pairs] of [['history',r.historyRivals()],['standings',r.standingsRivals()]]){
 ok(name+' suggestions are nonempty, reciprocal, bounded and valid',pairs.length>0&&r.validRivals(pairs));
 ok(name+' suggestions are deterministic',JSON.stringify(pairs)===JSON.stringify(name==='history'?r.historyRivals():r.standingsRivals()));
 }
 ok('History does not invent opponents without games',r.historyRivals(r.rivalTeams,[]).length===0);
 ok('Standings do not invent rivals without played games',r.standingsRivals(r.rivalTeams,[]).length===0);
 ok('History suggestions use actual completed meetings',r.historyRivals().every(([a,b])=>{const x=r.rivalTeams.find(q=>q.id===a),y=r.rivalTeams.find(q=>q.id===b);return r.featureEvidence.history.some(h=>h.week<=m.league.week&&h.roster===x.roster&&h.opponent===y.roster)}));
 const key='boff-features-v2:'+m.league.leagueId,original=localStorage.getItem(key);
 try{
 let s=r.defaultFeatureSettings();for(let w=1;w<=14;w++){const games=p.scheduledMatches(w);s=r.putWeekPlan(s,w,{overrides:Object.fromEntries(games.map(g=>[g.id,'rivalry'])),playoffModes:{}})}r.saveFeatureSettings(s);const loaded=r.getFeatureSettings();
 ok('All season presets survive save/reload',Object.keys(loaded.plans).length===14&&Object.values(loaded.plans).every(plan=>Object.keys(plan.overrides).length===6));
 ok('Only active week presets affect active overrides',Object.keys(loaded.overrides).every(id=>m.matchups.some(x=>x.id===id)));
 ok('Entire season six-game presets stay below twelve KB',new TextEncoder().encode(localStorage.getItem(key)).length<12000);
 ok('Invalid season weeks and empty plans are discarded',Object.keys(r.cleanWeekPlans({'0':{overrides:{x:'game'}},'15':{overrides:{x:'game'}},'2':{overrides:{}}})).length===0);
 let future=r.defaultFeatureSettings(),game=p.scheduledMatches(10)[0];future=r.putWeekPlan(future,10,{overrides:{[game.id]:'playoff'},playoffModes:{[game.id]:'auto'}});
 ok('Future undecided playoff context invents no racing team or recipient',p.plannedFeature(game,10,future).targets.length===0&&p.plannedFeature(game,10,future).raceTeams.length===0);
 future=r.putWeekPlan(future,10,{overrides:{[game.id]:null},playoffModes:{}});ok('Explicit future removal suppresses automatic assignment',p.plannedFeature(game,10,future)===null);

 const legacy=r.defaultFeatureSettings();delete legacy.rivalScope;legacy.rivals=co.map(x=>[x.id,op.id]);localStorage.setItem(key,JSON.stringify(legacy));ok('Stored legacy pairs are converted by reader',r.getFeatureSettings().rivals.length===1&&r.validRivals(r.getFeatureSettings().rivals));
 r.saveFeatureSettings(r.getFeatureSettings());ok('Subsequent saves mark team scope',JSON.parse(localStorage.getItem(key)).rivalScope==='teams');
 }finally{original===null?localStorage.removeItem(key):localStorage.setItem(key,original)}return a;
 }''');checks.extend(extra)
 baseline=page.evaluate("async()=>{const m=await import('/src/model.ts'),r=await import('/src/featuredRules.ts');return{assignments:JSON.stringify([...r.selectFeatureAssignments(m.matchups,m.teams,r.getFeatureSettings())]),tickets:JSON.stringify(m.exampleTickets)}}")
 planner();check('Fourteen week choices visible',page.locator('.feature-week-picker button').count()==14);check('Cutoffs moved out of main view',page.locator('.feature-rule-editor').count()==0)
 row=page.locator('.feature-assignment-row').first;check('Compact fixture shows both team avatars',row.locator('.avatar').count()==2);check('Compact assignment rows below eighty px',max(x.bounding_box()['height'] for x in page.locator('.feature-assignment-row').all())<80);check('Headers aligned with fixture content',abs(page.locator('.feature-grid-heading span').first.bounding_box()['x']-row.locator('.feature-fixture').bounding_box()['x'])<2);shot('compact-assignments')
 page.get_by_role('button',name='Configure Matchup Rules',exact=True).click();check('Cutoffs open in separate dialog',page.get_by_role('dialog').is_visible());check('All eight fixed boost labels explicit',all('% Profit Boost' in x for x in page.locator('.feature-rule-editor .feature-badge').all_text_contents()));check('All eight rendered icon paths unique',len(set(page.locator('.feature-rule-editor .feature-badge svg').evaluate_all('es=>es.map(e=>e.innerHTML)')))==8)
 check('Priority follows owner order',page.locator('.feature-rule-editor .feature-badge strong').all_text_contents()==['Championship Rematch','Playoff Race','Rivalry','Revenge Game','Upset Watch','Streak Breaker','Tank Bowl','Game Of The Week']);check('Boost percentages are not editable',page.locator('input[aria-label*="Boost"],input[aria-label*="Profit"]').count()==0)
 field=page.get_by_label('Tank Bowl: Combined Win % At Most',exact=True);field.fill('20');page.get_by_role('button',name='Cancel',exact=True).click();check('Dialog restores opener focus',page.get_by_role('button',name='Configure Matchup Rules',exact=True).evaluate('(e)=>e===document.activeElement'))
 page.get_by_role('button',name='Configure Matchup Rules',exact=True).click();check('Cancelled draft is discarded',field.input_value()=='33.3');field.fill('20');page.get_by_role('button',name='Save Rules',exact=True).click();visit('matchups');check('Saved cutoff changes actual slate',page.locator('[data-featured="Tank Bowl"]').count()==0)
 planner();page.get_by_role('button',name='Configure Matchup Rules',exact=True).click();field.fill('33.3');page.get_by_role('button',name='Save Rules',exact=True).click()
 ids={}
 for n,kind in [(9,'rivalry'),(10,'playoff'),(14,'championship')]:
  week(n);select=page.locator('.feature-row-controls select').first;ids[n]=select.get_attribute('aria-label').replace('Assignment For ','');select.select_option(kind)
  if n==10:
   context=page.get_by_label('Playoff Context For '+ids[n],exact=True);check('Future playoff defaults to undecided',context.input_value()=='auto');context.select_option('away-racing');check('Future spoiler identifies only opponent',page.locator('.feature-assignment-row').first.locator('.feature-badge').inner_text().startswith('Playoff Spoiler'))
 save();planner()
 for n,kind in [(9,'rivalry'),(10,'playoff'),(14,'championship')]:
  week(n);check(str(n)+' week assignment survives reload',page.get_by_label('Assignment For '+ids[n],exact=True).input_value()==kind)
 week(10);check('Future playoff context survives reload',page.get_by_label('Playoff Context For '+ids[10],exact=True).input_value()=='away-racing');shot('future-week')
 after=page.evaluate("async()=>{const m=await import('/src/model.ts'),r=await import('/src/featuredRules.ts');return{assignments:JSON.stringify([...r.selectFeatureAssignments(m.matchups,m.teams,r.getFeatureSettings())]),tickets:JSON.stringify(m.exampleTickets)}}");check('Future plans leave active book and accepted tickets unchanged',after==baseline)
 week(7);check('Past week is read only',all(x.is_disabled() for x in page.locator('.feature-row-controls select').all()) and page.get_by_role('button',name='Save Presets',exact=True).is_disabled())
 tab('Rivalries');check('Entire team directory displayed together',page.locator('[data-rival-team-id]').count()==12);check('Three editable slots per team',page.locator('.rivals-table select').count()==36);check('Rivalry badge removed from editor header',page.locator('.compact-rivalries > .feature-toolbar .feature-badge').count()==0);page.get_by_role('button',name='How Rivalry Boosts Work',exact=True).click();check('Help explains automatic boost and cap exception','35%' in page.get_by_role('dialog').inner_text() and '50%' in page.get_by_role('dialog').inner_text());page.get_by_role('button',name='Got It',exact=True).click();panel=page.locator('.compact-rivalries').bounding_box();check('All twelve rows fit on desktop screen',panel['y']+panel['height']<=900);shot('all-rivalries')
 page.locator('.rivalry-populate-menu summary').click();check('Three one-time suggestion choices',page.locator('.rivalry-populate-options button').count()==3);check('Division suggestion accurately disabled for league without divisions',page.get_by_role('button',name='Sleeper Divisions',exact=False).is_disabled());shot('auto-populate');page.get_by_role('button',name='Competitive History',exact=False).click();check('Auto-populate creates editable draft',any(s.input_value() for s in page.locator('.rivals-table select').all()) and all(s.is_enabled() for s in page.locator('.rivals-table select').all()));check('Populate menu closes',not page.locator('.rivalry-populate-menu').get_attribute('open'))
 page.get_by_role('button',name='Clear All',exact=True).click();check('Clear All supports starting from scratch',all(s.input_value()=='' for s in page.locator('.rivals-table select').all()));first=page.locator('.rivals-table select').first;person=page.locator('[data-rival-team-id]').first.get_attribute('data-rival-team-id');other=first.locator('option').nth(1).get_attribute('value');first.select_option(other);check('Manual selection updates reciprocal row',page.locator('[data-rival-team-id="'+other+'"] select').first.input_value()==person);page.get_by_role('button',name='Save Rivalries',exact=True).click();visit('commissioner');tab('Rivalries');check('Manual pair persists after reload',page.locator('.rivals-table select').first.input_value()==other)
 page.locator('.rivalry-populate-menu summary').click();page.get_by_role('button',name='Similar Standings',exact=False).click();check('Standings suggestions loaded as editable fields',any(s.input_value() for s in page.locator('.rivals-table select').all()) and all(s.is_enabled() for s in page.locator('.rivals-table select').all()));page.get_by_role('button',name='Save Rivalries',exact=True).click();shot('populated-rivalries')
 for theme in ['light','dark']:
  planner();page.evaluate(f"document.documentElement.dataset.theme='{theme}'");shot('assignments-'+theme);page.get_by_role('button',name='Configure Matchup Rules',exact=True).click();page.wait_for_timeout(100)
  contrast=page.locator('.feature-rule-editor .feature-badge').evaluate_all('''es=>{const lum=c=>{const a=c.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};return es.map(e=>{const s=getComputedStyle(e),a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});}''');check(theme+' category text contrast at least 4.5',len(contrast)==8 and min(contrast)>=4.5);shot('cutoffs-'+theme);page.keyboard.press('Escape');check(theme+' Escape closes cutoff dialog',page.get_by_role('dialog').count()==0);tab('Rivalries');shot('rivalries-'+theme);check(theme+' rivalry fields use distinct border',page.locator('.rivals-table select').first.evaluate('e=>getComputedStyle(e).borderTopColor!==getComputedStyle(e).backgroundColor'))
 visit('matchups');url=page.url;first=page.locator('.matchup').first;first.locator('.odds-button').first.click();check('Odds remain independently actionable',page.url==url and first.locator('.odds-button').first.get_attribute('aria-pressed')=='true');first.locator('.matchup-open-overlay').click(position={'x':8,'y':8});check('Slate card opens matchup markets','/matchup/' in page.url)
 
 header_positions=[]
 for idx,label in enumerate(['Teams & Records','Season Stats','Recent Form & Availability']):
  page.get_by_role('button',name='Show '+label,exact=True).click();header_positions.append(page.locator('.carousel-page.active .carousel-team-header h2').evaluate_all('es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y}))'))
  if idx==0:check('Identity slide uses stable desktop frame',page.locator('.matchup-carousel').bounding_box()['height']==274)
  if idx==2:
   check('Injury statuses share the position and injury line',page.locator('.carousel-page.active .injury-row small .injury-status').count()==4);page.locator('.carousel-page.active .form-result').first.hover();line=page.locator('.historical-total-line').bounding_box();actual=page.locator('.historical-actual').bounding_box();check('Historical actual appears to right of total line',actual['x']>line['x']+line['width'] and abs(actual['y']-line['y'])<8);page.mouse.move(100,100)
 check('Season and form team headers share exact anchor positions',header_positions[1]==header_positions[2]);check('Identity headers retain same horizontal positions',all(abs(a['x']-b['x'])<1 for a,b in zip(header_positions[0],header_positions[1])))
 page.get_by_role('button',name='Open Guide',exact=True).click();check('Guide hides Previous on first page',page.get_by_role('button',name='Previous',exact=True).count()==0);page.get_by_role('dialog').get_by_role('button',name='Preferences',exact=True).click();page.get_by_role('button',name="Let's Go!",exact=True).click();check('Guide completion closes dialog',page.get_by_role('dialog').count()==0)

 for theme in ['light','dark']:
  for route,selector in [('offers','.offer-odds strong'),('matchups','.compact-offers .offer-odds strong')]:
   visit(route);page.evaluate(f"document.documentElement.dataset.theme='{theme}'");page.wait_for_timeout(80)
   values=page.locator(selector).evaluate_all('''es=>es.map(e=>{const c=getComputedStyle(e).color;let p=e;while(p&&getComputedStyle(p).backgroundColor==='rgba(0, 0, 0, 0)')p=p.parentElement;const bg=getComputedStyle(p).backgroundColor;const lum=c=>{const a=c.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};return {color:c,ratio:(Math.max(lum(c),lum(bg))+.05)/(Math.min(lum(c),lum(bg))+.05)}})''');check(theme+' '+route+' boosted offer prices meet 4.5 contrast',len(values)==2 and min(x['ratio'] for x in values)>=4.5)
   check(theme+' '+route+' boosted prices use gold tones',all(x['color'] in ['rgb(138, 90, 19)','rgb(229, 199, 141)'] for x in values))
 visit('matchups');check('Only boosted slate buttons receive accent',page.locator('.boosted-odds').count()>0 and page.locator('.boosted-odds').count()==page.locator('.odds-button .original-price').count())
 visit('all-bets');won=page.locator('#ticket-BF-08097');check('Collapsed parlay omits finals','Final:' not in won.inner_text());won.locator('button.ticket-card-toggle').scroll_into_view_if_needed();pos=page.evaluate('scrollY');won.locator('button.ticket-card-toggle').click();check('Inline ticket expansion preserves scroll',abs(page.evaluate('scrollY')-pos)<2);check('Expanded parlay shows three results',won.locator('.leg-result').count()==3)
 for width in [1440,1280,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900});planner();check(str(width)+'px planner no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));page.get_by_role('button',name='Configure Matchup Rules',exact=True).click();check(str(width)+'px cutoff dialog no horizontal overflow',page.get_by_role('dialog').evaluate('e=>e.scrollWidth<=e.clientWidth+1'));page.keyboard.press('Escape');tab('Rivalries');check(str(width)+'px rivalry table contains scrolling',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));visit('matchups');check(str(width)+'px slate no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
 check('No browser errors',not errors);check('No backend requests',not api);b.close()
(out/'review-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'backendRequests':api},indent=2),encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}))

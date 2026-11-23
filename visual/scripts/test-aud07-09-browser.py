import json,base64,time
from pathlib import Path
from playwright.sync_api import sync_playwright
fixture=json.loads(Path('visual/src/data.json').read_text(encoding='utf-8'))
players=json.loads(Path('visual/src/players.json').read_text(encoding='utf-8'))
for team in fixture['teams']:
 team['observed']=next(row['points'] for row in fixture['finalScores'] if row['roster']==team['roster_id'])
quotes=[dict(q,metadata=dict(ui_id=q['id']),away_team_id=q['away'],home_team_id=q['home'],matchup_key=q.get('matchup'),boost_pct=q.get('boost',0)) for q in fixture['markets']]
for quote in quotes:
 team=next((t['name'] for t in fixture['teams'] if t['id']==quote.get('team_id')),'Team')
 quote['label']=(quote['side'].title()+' '+str(quote['line'])) if quote['kind'] in ['match_total','team_total'] else team+(' '+str(quote['line']) if quote.get('line') is not None else '')
uid='11111111-1111-4111-8111-111111111111';host='http://127.0.0.1:5193';key='sb-whlcnlacueweaqpsupqs-auth-token'
part=lambda v:base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
claims=dict(sub=uid,exp=int(time.time())+3600,role='authenticated')
session=dict(access_token=part(dict(alg='HS256',typ='JWT'))+'.'+part(claims)+'.test',refresh_token='fixture',expires_in=3600,expires_at=claims['exp'],token_type='bearer',user=dict(id=uid,email='member@example.invalid'))
book=dict(book=dict(valid_until='2099-01-01',payload=dict(teams=fixture['teams'],players=players,positions=fixture.get('rosterPositions',[]),leagueName=fixture['league'],regularSeasonWeeks=14)),board=dict(market_week=10,nfl_season=2026),quotes=quotes,tickets=[],ledger=[],balance=75,user=dict(id=uid,name='Member',email='member@example.invalid',teamId=fixture['teams'][0]['id']),teams=[],leagueId='fixture')
offers=[dict(slot=str(i),title=title,deadline='2099-01-01',percent=25,base=3.5,claimed=False,used=False,picks=[dict(id=quotes[0]['id'],label='Fixture pick',odds=-110,subject='Teams',kind='moneyline',matchup='Fixture')]) for i,title in enumerate(['Sunday Spotlight','A Very Long Offer Title That Must Stay Inside Its Own Card And Keep The Action Accessible','Four Corners','Ten-Point Spotlight'])]
out=Path('work/aud07-09-check');out.mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=(p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') if engine=='chromium' else p.webkit.launch())
  for width in [1440,820,390,320]:
   for theme in ['light','dark']:
    state={'count':4};errors=[];requests=[]
    ctx=browser.new_context(viewport=dict(width=width,height=950));ctx.add_init_script('localStorage.setItem('+json.dumps(key)+','+json.dumps(json.dumps(session))+');localStorage.setItem("boff-visual-theme",'+json.dumps(theme)+');')
    def api(route):
     if '/api/live-book' in route.request.url:
      requests.append(route.request.headers.get('authorization'));return route.fulfill(json=dict(status='connected',payload=None))
     if '/api/book' in route.request.url:return route.fulfill(json=dict(book,offerUpdate=dict(offers=offers[:state['count']],version='fixture')))
     return route.fulfill(json={})
    ctx.route(host+'/api/**',api)
    ctx.route('https://whlcnlacueweaqpsupqs.supabase.co/**',lambda route:route.fulfill(json=dict(offers=offers[:state['count']],version='fixture') if 'dev_weekly_offer_changes' in route.request.url else []))
    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(host+'/'+fixture['leagueId']+'/matchups',wait_until='networkidle');page.evaluate('(t)=>document.documentElement.dataset.theme=t',theme)
    page.locator('.weekly-offer-summary').first.wait_for()
    def geometry():
     return page.locator('.weekly-offer-summaries').evaluate('''strip=>{
      const cards=[...strip.children], boxes=cards.map(c=>c.getBoundingClientRect());
      for(const card of cards){const c=card.getBoundingClientRect();for(const el of card.children){const r=el.getBoundingClientRect();if(r.left<c.left||r.right>c.right+1||r.top<c.top||r.bottom>c.bottom+1)throw Error('Child outside offer');}
       const button=card.querySelector('button'),title=card.querySelector('strong');if(title.getBoundingClientRect().bottom>button.getBoundingClientRect().top)throw Error('Title/action overlap');}
      if(Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height))>1)throw Error('Unequal heights');
      if(boxes.some(b=>b.width<220))throw Error('Collapsed card');
      return {height:boxes[0].height,width:boxes[0].width};
     }''')
    original=geometry()
    for tab in ['Player Head-To-Head','Player Points & Milestones',"This Week’s Specials",'Matchups']:
     target=page.get_by_role('tab',name=tab,exact=True)
     if not target.count() and 'Specials' in tab:target=page.get_by_role('tab',name="This Week's Specials",exact=True)
     if target.count():target.click();assert geometry()==original,'Offer size changes across tabs'
    page.locator('.weekly-offer-summary').last.locator('button').scroll_into_view_if_needed();page.locator('.weekly-offer-summary').last.locator('button').click();page.get_by_role('dialog').wait_for();page.keyboard.press('Escape')
    # A real market selection must render both slips without duplicate input IDs.
    page.get_by_role('tab',name='Matchups',exact=True).click()
    page.locator('.odds-button:not([disabled])').first.click()
    if not page.locator('#stake-desktop').count():
     page.screenshot(path=str(out/'selection-debug.png'))
     raise Exception(str(errors)+' '+ascii(page.locator('body').inner_text()[-1800:]))
    if page.locator('.mobile-slip-handle').is_visible():
     page.locator('.mobile-slip-handle').click();input=page.locator('#stake-mobile');input.wait_for(state='visible');page.locator('label[for="stake-mobile"]').click();assert input.evaluate('(e)=>document.activeElement===e')
     assert page.locator('#stake-desktop').count()==1
    else:
     input=page.locator('#stake-desktop');input.wait_for(state='visible');page.locator('label[for="stake-desktop"]').click();assert input.evaluate('(e)=>document.activeElement===e')
    assert page.locator('[id="stake"]').count()==0
    input.fill('-5');assert page.get_by_role('button',name='Place Bet',exact=True).filter(visible=True).is_disabled()
    input.fill('10')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    page.screenshot(path=str(out/(engine+'-'+str(width)+'-'+theme+'.png')))
    # Single offer retains the same card dimensions.
    state['count']=1;page.reload(wait_until='networkidle');assert page.locator('.weekly-offer-summary').count()==1;assert geometry()==original
    page.goto(host+'/'+fixture['leagueId']+'/matchups?view=live',wait_until='networkidle');assert requests and requests[-1]=='Bearer '+session['access_token']
    results.append(dict(engine=engine,width=width,theme=theme,geometry=original));ctx.close()
  browser.close()
(out/'browser-results.json').write_text(json.dumps(results,indent=2))
print('PASS offer containment/equal sizing/scroll actions/single and multiple offers/tab stability; unique stake labels, focus and negative validation; authenticated source-view requests: '+str(len(results))+' browser/width/theme combinations')

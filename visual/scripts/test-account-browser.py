import json,base64,time
from pathlib import Path
from playwright.sync_api import sync_playwright
fixture=json.loads(Path('visual/src/data.json').read_text(encoding='utf-8'))
for team in fixture['teams']:
 team['observed']=next(row['points'] for row in fixture['finalScores'] if row['roster']==team['roster_id'])
players=json.loads(Path('visual/src/players.json').read_text(encoding='utf-8'))
quotes=[dict(q,metadata=dict(ui_id=q['id']),away_team_id=q['away'],home_team_id=q['home'],matchup_key=q.get('matchup'),boost_pct=q.get('boost',0)) for q in fixture['markets']]
key='sb-whlcnlacueweaqpsupqs-auth-token'
host='http://127.0.0.1:5191'
def session(uid,name):
 claims=dict(sub=uid,exp=int(time.time())+3600,role='authenticated')
 part=lambda obj:base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
 return dict(access_token=part(dict(alg='HS256',typ='JWT'))+'.'+part(claims)+'.test',refresh_token='fixture',expires_in=3600,expires_at=claims['exp'],token_type='bearer',user=dict(id=uid,email=name+'@example.invalid'))
def book(uid,name):
 return dict(book=dict(payload=dict(teams=fixture['teams'],players=players,positions=fixture.get('rosterPositions',[]),leagueName=fixture['league'],leagueAvatar=fixture.get('avatar'),regularSeasonWeeks=14)),board=dict(market_week=10,nfl_season=2026),quotes=quotes,tickets=[],ledger=[],balance=75,user=dict(id=uid,name=name,email=name+'@example.invalid',teamId=fixture['teams'][0]['id']),teams=[],leagueId='fixture')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
 for width in [1440,390]:
  ctx=browser.new_context(viewport=dict(width=width,height=950));identity={'uid':'11111111-1111-4111-8111-111111111111','name':'Alice'}
  ctx.add_init_script('if(!localStorage.getItem('+json.dumps(key)+'))localStorage.setItem('+json.dumps(key)+','+json.dumps(json.dumps(session(identity['uid'],identity['name'])))+');localStorage.setItem("boff-visual-profile",JSON.stringify({name:"Legacy Private Name",email:"legacy@example.invalid"}));')
  ctx.route(host+'/api/book*',lambda route:route.fulfill(json=book(**identity)))
  ctx.route(host+'/api/**',lambda route:route.fallback() if '/api/book' in route.request.url else route.fulfill(json={}))
  ctx.route('https://whlcnlacueweaqpsupqs.supabase.co/**',lambda route:route.fulfill(json={'offers':[],'version':'fixture'} if 'dev_weekly_offer_changes' in route.request.url else []))
  page=ctx.new_page();page.on('pageerror',lambda e:print('Browser error:',str(e)));page.goto(host+'/'+fixture['leagueId']+'/profile',wait_until='networkidle')
  if not page.get_by_label('Display Name',exact=True).count(): raise Exception(ascii(page.locator('body').inner_text()[:500]))
  assert page.get_by_label('Display Name',exact=True).input_value()=='Alice'
  assert page.get_by_label('Email Address',exact=True).input_value()=='Alice@example.invalid'
  assert page.get_by_label('Email Address',exact=True).get_attribute('readonly') is not None
  page.get_by_label('Display Name',exact=True).fill('Alice Custom');page.get_by_role('button',name='Save Details',exact=True).click();page.reload(wait_until='networkidle')
  assert page.get_by_label('Display Name',exact=True).input_value()=='Alice Custom'
  identity.update(uid='22222222-2222-4222-8222-222222222222',name='Bob')
  page.evaluate('(args)=>localStorage.setItem(args.key,args.value)',dict(key=key,value=json.dumps(session(**identity))))
  page.reload(wait_until='networkidle')
  assert page.get_by_label('Display Name',exact=True).input_value()=='Bob'
  assert page.get_by_label('Email Address',exact=True).input_value()=='Bob@example.invalid'
  assert 'Legacy Private Name' not in page.locator('body').inner_text()
  # Cross-tab/session removal must unmount account data without a reload.
  page.evaluate("async()=>{const {auth}=await import('/src/live.ts');await auth.auth.signOut({scope:'local'});}")
  page.get_by_role('heading',name='Sign In',exact=True).wait_for()
  assert page.get_by_label('Display Name',exact=True).count()==0
  assert page.evaluate('window.__boffLive===undefined')
  ctx.close()
 browser.close()
print('PASS desktop/mobile: verified identity, read-only email, account-scoped saved name, same-browser account switch, and sign-out removes account UI/data')

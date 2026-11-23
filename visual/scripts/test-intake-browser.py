import json,base64,time
from pathlib import Path
from playwright.sync_api import sync_playwright
fixture=json.loads(Path('visual/src/data.json').read_text(encoding='utf-8'))
players=json.loads(Path('visual/src/players.json').read_text(encoding='utf-8'))
for team in fixture['teams']:
 team['observed']=next(row['points'] for row in fixture['finalScores'] if row['roster']==team['roster_id'])
quotes=[dict(q,metadata=dict(ui_id=q['id']),away_team_id=q['away'],home_team_id=q['home'],matchup_key=q.get('matchup'),boost_pct=q.get('boost',0)) for q in fixture['markets']]
uid='11111111-1111-4111-8111-111111111111';host='http://127.0.0.1:5192';key='sb-whlcnlacueweaqpsupqs-auth-token'
part=lambda v:base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
claims=dict(sub=uid,exp=int(time.time())+3600,role='authenticated')
session=dict(access_token=part(dict(alg='HS256',typ='JWT'))+'.'+part(claims)+'.test',refresh_token='fixture',expires_in=3600,expires_at=claims['exp'],token_type='bearer',user=dict(id=uid,email='owner@example.invalid'))
book=dict(book=dict(payload=dict(teams=fixture['teams'],players=players,positions=fixture.get('rosterPositions',[]),leagueName=fixture['league'],regularSeasonWeeks=14)),board=dict(market_week=10,nfl_season=2026),quotes=quotes,tickets=[],ledger=[],balance=75,user=dict(id=uid,name='Owner',email='owner@example.invalid',teamId=fixture['teams'][0]['id'],role='admin',platformOwner=True,commissioner=True),teams=[],leagueId='fixture')
source=dict(contract='sleeper-nfl-intake-v1',provider='sleeper',league_id='9000000000000000018',season=2026,name='Intake Preview',total_rosters=8,teams=[dict(roster_id=1,team_name='Shared Team',owner_id='101',owner_name='Primary Person',co_owner_ids=['102'],co_owner_names=['Second Person']),dict(roster_id=2,team_name='Solo Team',owner_id='103',owner_name='Solo Person',co_owner_ids=[],co_owner_names=[])])
draft=dict(id='22222222-2222-4222-8222-222222222222',revision=1,state='draft',source=source,source_league_id=source['league_id'],created_at='2026-11-18',expires_at='2099-01-01',imported_league_id=None,capabilities=dict(contract='sleeper-nfl-intake-v1',admission='review_required',families=[dict(name='matchups',state='input_compatible',reasons=[])],issues=[]))
out=Path('work/aud02-check');out.mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
 for width in [1440,390]:
  drafts=[];errors=[];calls=[]
  ctx=b.new_context(viewport=dict(width=width,height=950));ctx.add_init_script('localStorage.setItem('+json.dumps(key)+','+json.dumps(json.dumps(session))+');')
  def api(route):
   if '/api/book' in route.request.url:return route.fulfill(json=book)
   if '/api/league-intake' in route.request.url:
    body=route.request.post_data_json;calls.append(body)
    if body.get('action')=='discover':return route.fulfill(json=dict(season=2026,hasSleeperAccount=True,linked=[dict(sleeperId='123456789',name='Linked League')],leagues=[dict(id='123456789',name='Linked League',season=2026,teams=12,linked=True),dict(id=source['league_id'],name=source['name'],season=2026,teams=8,linked=False)]))
    drafts.append(draft);return route.fulfill(json=dict(id=draft['id'],state='draft'))
   return route.fulfill(json={})
  ctx.route(host+'/api/**',api)
  def supa(route):
   url=route.request.url
   if 'league_intake_drafts' in url:return route.fulfill(json=drafts)
   return route.fulfill(json=dict(offers=[],version='fixture') if 'dev_weekly_offer_changes' in url else [])
  ctx.route('https://whlcnlacueweaqpsupqs.supabase.co/**',supa)
  page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(host+'/leagues/new',wait_until='networkidle')
  page.get_by_role('heading',name='Add League',exact=True).wait_for()
  page.get_by_text('Already Connected',exact=True).wait_for()
  page.get_by_label('Sleeper league ID',exact=True).fill('123456789');assert page.get_by_role('button',name='Preview league import',exact=True).is_disabled()
  page.get_by_role('button',name='Select League',exact=True).click();assert page.get_by_label('Sleeper league ID',exact=True).input_value()==source['league_id']
  page.get_by_role('button',name='Preview league import',exact=True).click()
  for label in ['Manager','Primary Manager','Co-Manager']:page.get_by_text(label,exact=True).wait_for()
  assert page.locator('.intake-team').count()==2
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Horizontal page overflow'
  assert not errors,errors
  page.screenshot(path=str(out/('intake-'+str(width)+'.png')),full_page=True)
  assert len(calls)==2,calls
  ctx.close()
 b.close()
print('PASS production bundle desktop/mobile: Add League renders; trusted league choices; linked duplicate disabled; distinct Solo/Primary/Co manager preview; no browser errors or horizontal overflow')


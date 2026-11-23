import json,uuid,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
scope={};exec(Path('visual/scripts/test-aud07-09-browser.py').read_text().split("out=Path")[0],scope)
host='http://127.0.0.1:5194';book=scope['book'];book['user'].update(platformOwner=True,commissioner=True,role='admin',walletId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
raw=[]
for i in range(1052):
 raw.append(dict(id=str(uuid.UUID(int=i+1)),team_id=book['user']['teamId'],user_wallet_id=book['user']['walletId'] if i%2==0 else 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',bettor_display_name='Member' if i%2==0 else 'Other',
  nfl_season=2026,market_week=10 if i%3 else 9,placed_at='2026-11-18T10:00:00Z',stake=5,status='WON' if i%2 else 'OPEN',accepted_combined_odds=110,accepted_potential_payout=10.5,actual_payout=10.5 if i%2 else 0,
  ticket_legs=[dict(id='leg-'+str(i),leg_number=1,selection='Hidden Beyond Thousand' if i==1001 else 'Selection '+str(i),market_type='Moneyline',accepted_odds=110,status='WON' if i%2 else 'OPEN',settlement_context=dict(kind='moneyline'))]))
book['tickets']=raw[:10]
out=Path('work/aud10-11-14-16-check');out.mkdir(exist_ok=True)
with sync_playwright() as p:
 for width in [1440,390]:
  saved={};calls=[];errors=[];busy=[]
  ctx=p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').new_context(viewport=dict(width=width,height=950))
  ctx.add_init_script('localStorage.setItem('+json.dumps(scope['key'])+','+json.dumps(json.dumps(scope['session']))+');')
  def api(route):
   params=urllib.parse.parse_qs(urllib.parse.urlsplit(route.request.url).query);q={k:v[0] for k,v in params.items()};calls.append(q)
   if 'archive' in q:return route.fulfill(json=dict(spreadHistory=[],feedRecap=[]))
   if q.get('history')=='tickets':
    pool=[r for r in raw if q.get('mine')!='1' or r['user_wallet_id']==book['user']['walletId']]
    rows=[r for r in pool if (q.get('status','All')=='All' or r['status']==q['status'].upper()) and (not q.get('week') or r['market_week']==int(q['week'])) and (not q.get('participant') or r['user_wallet_id']==q['participant']) and (not q.get('search') or q['search'].lower() in (r['id']+' '+r['ticket_legs'][0]['selection']).lower())]
    offset=int(json.loads(q['cursor'])['value']) if q.get('cursor') else 0;size=int(q.get('size',25));page=rows[offset:offset+size]
    return route.fulfill(json=dict(tickets=page,next=dict(value=str(offset+size),id=page[-1]['id']) if offset+size<len(rows) else None,summary=dict(count=len(pool),openStake=sum(r['stake'] for r in pool if r['status']=='OPEN')),weeks=[10,9],participants=[dict(id=book['user']['walletId'],name='Member'),dict(id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name='Other')]))
   if q.get('history')=='ledger':
    offset=25 if q.get('cursor') else 0
    return route.fulfill(json=dict(entries=[dict(id=str(uuid.UUID(int=2000+i)),reason='Own Claim '+str(i),kind='claim',amount=10,balance_after=75,created_at='2026-11-18T10:00:00Z') for i in range(offset,offset+25)],next=dict(time='2026-11-18T10:00:00Z',id=str(uuid.UUID(int=2024))) if not offset else None))
   if q.get('ticket'):return route.fulfill(json=dict(ticket=next(r for r in raw if r['id']==q['ticket'])))
   return route.fulfill(json=book)
  ctx.route(host+'/api/book*',api)
  def rpc(route):
   name=route.request.url.split('/')[-1];body=route.request.post_data_json or {}
   if name=='dev_fantasy_reward_rules':
    if 'p_rules' in body:saved.update(body['p_rules'])
    return route.fulfill(json=dict(rules=saved,revision=1))
   if name=='dev_commissioner_members':return route.fulfill(json=dict(teams=[]))
   return route.fulfill(json=dict(offers=[],version='fixture') if name=='dev_weekly_offer_changes' else [])
  ctx.route('https://whlcnlacueweaqpsupqs.supabase.co/rest/v1/rpc/**',rpc)
  page=ctx.new_page();page.on('pageerror',lambda error:errors.append(str(error)));base=host+'/'+scope['fixture']['leagueId']
  page.goto(base+'/matchups',wait_until='networkidle');assert not any(q.get('history') for q in calls)
  page.goto(base+'/all-bets',wait_until='networkidle');page.locator('.ticket-card').nth(24).wait_for();assert page.locator('.ticket-card').count()==25
  page.get_by_role('button',name='Load More Tickets',exact=True).click();page.locator('.ticket-card').nth(49).wait_for();assert page.locator('.ticket-card').count()==50
  page.get_by_label('Find A Ticket',exact=True).fill('Hidden Beyond Thousand');page.get_by_text('Hidden Beyond Thousand',exact=True).wait_for();assert page.locator('.ticket-card').count()==1
  assert any(q.get('search')=='Hidden Beyond Thousand' for q in calls)
  page.goto(base+'/my-bets',wait_until='networkidle');page.locator('.ticket-card').nth(24).wait_for();assert any(q.get('mine')=='1' for q in calls)
  page.goto(base+'/commissioner',wait_until='networkidle');page.get_by_role('tab',name='Fantasy Rewards',exact=True).click()
  allow=page.get_by_label('Top Scorer of the Week allow all qualifying recipients',exact=True);allow.wait_for();assert not allow.is_checked()
  cap=page.get_by_label('Top Scorer of the Week maximum weekly users',exact=True);cap.fill('3');allow.check();assert cap.is_disabled();allow.uncheck();assert cap.input_value()=='3';allow.check()
  page.get_by_role('button',name='Review Changes',exact=True).click();page.get_by_role('button',name='Save Changes',exact=True).click();page.get_by_text('Fantasy reward settings saved.',exact=True).wait_for();assert saved['maxRecipients']['topScorer']==0
  page.screenshot(path=str(out/('rewards-'+str(width)+'.png')),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.goto(base+'/profile',wait_until='networkidle');page.get_by_role('tab',name='Balance History',exact=True).click();page.get_by_text('Own Claim 0',exact=True).wait_for();assert page.locator('.balance-entry').count()==4
  page.get_by_role('button',name='Show More Transactions',exact=True).click();assert page.locator('.balance-entry').count()==25
  page.get_by_role('button',name='Load Older Transactions',exact=True).click();page.get_by_text('Own Claim 49',exact=True).wait_for();assert page.locator('.balance-entry').count()==50
  assert not errors,errors
  browser=ctx.browser;ctx.close();browser.close()
print('PASS desktop/mobile: startup defers history; 25-row ticket pages, load more, search beyond 1,000, personal scope; reward Allow All default/disable/restore/save; balance pagination; no browser errors or horizontal overflow')

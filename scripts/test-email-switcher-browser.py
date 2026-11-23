import json,time,base64
from pathlib import Path
from playwright.sync_api import sync_playwright
fixture=json.loads(Path('work/email-reader-fixture.json').read_text())
rows=fixture['rows']; calls=[]
enc=lambda d:base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
exp=int(time.time())+3600
session={'access_token':enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'exp':exp,'sub':'fixture','role':'authenticated'})+'.YQ','refresh_token':'mock-refresh','expires_at':exp,'token_type':'bearer','user':{'id':'fixture'}}
def api(route):
 args=route.request.post_data_json
 calls.append(args)
 selected=next((row for row in rows if row['id']==args.get('p_league')),rows[0])
 row=dict(selected,details=args['p_details'])
 if not row['details']: row['edition']={}
 route.fulfill(json={'leagues':[dict(id=r['id'],name=r['name'],path=r['path']) for r in rows],'report':row},headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'})
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
 for width in [1440,390]:
  page=browser.new_page(viewport={'width':width,'height':950})
  page.add_init_script("localStorage.setItem('sb-whlcnlacueweaqpsupqs-auth-token',"+json.dumps(json.dumps(session))+")")
  page.route('**/rest/v1/rpc/dev_email_reader',api)
  page.route('https://sleepercdn.com/**',lambda r:r.abort())
  page.goto('http://127.0.0.1:5186/communications?kind=opening&league='+rows[0]['id']+'&week=10',wait_until='networkidle')
  frame=page.frame_locator('iframe[title="League Email Report"]')
  frame.get_by_label('League Of Focus').select_option(rows[1]['id'])
  frame.get_by_text('Harbor Hawks',exact=True).first.wait_for()
  assert frame.get_by_text('Seaside Sharks',exact=True).count()==0
  assert '82.00' in frame.locator('body').inner_text()
  assert page.locator('body').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert frame.locator('body').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  page.screenshot(path=f'work/email-reader-{width}.png',full_page=True)
  assert page.get_by_label('Include Details').count()==0
  page.goto('http://127.0.0.1:5186/communications?kind=opening&league='+rows[1]['id']+'&week=10&details=0',wait_until='networkidle')
  frame=page.frame_locator('iframe[title="League Email Report"]')
  frame.get_by_label('League Of Focus').wait_for()
  assert '82.00' in frame.locator('body').inner_text()
  page.close()
 print('Web reader: both widths switch complete league content, old brief links stay full, no detail toggle or horizontal overflow')
 # Exercise the actual AMP runtime instead of only simulating its selector.
 page=browser.new_page(viewport={'width':600,'height':950})
 page.route('https://sleepercdn.com/**',lambda r:r.abort())
 page.goto(Path('work/email-switcher.amp.html').resolve().as_uri())
 page.wait_for_function("document.body.style.visibility !== 'hidden' && window.AMP !== undefined")
 page.locator('section').first.get_by_role('button',name='Switch League').click()
 page.locator('section').first.locator('amp-selector [option="1"]').click()
 page.locator('section').nth(1).wait_for(state='visible')
 assert not page.locator('section').first.is_visible()
 assert page.locator('section').nth(1).get_by_text('Harbor Hawks',exact=True).first.is_visible()
 page.screenshot(path='work/email-switcher-amp.png',full_page=True)
 print('Actual AMP runtime: header dropdown switches visible league and hides previous report')
 browser.close()

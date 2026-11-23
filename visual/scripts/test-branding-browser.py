import json,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
scope={};exec(Path('visual/scripts/test-aud07-09-browser.py').read_text().split('out=Path')[0],scope)
out=Path('work/branding-check');out.mkdir(exist_ok=True)
share=(out/'private-share.txt').read_text().strip() if '--hosted' in sys.argv else ''
host='https://'+urlsplit(share).netloc if share else 'http://127.0.0.1:5197'
results=[]
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=p.webkit.launch() if engine=='webkit' else p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
  for width in ([390] if '--hosted' in sys.argv else [1440,390,320]):
   for theme in ['light','dark']:
    ctx=browser.new_context(viewport={'width':width,'height':950},reduced_motion='reduce')
    ctx.add_init_script('localStorage.setItem("boff-visual-theme",'+json.dumps(theme)+');')
    page=ctx.new_page();errors=[];sent=[];page.on('pageerror',lambda error:errors.append(str(error)))
    if share:page.goto(share,wait_until='networkidle')
    page.goto(host+'/sign-in',wait_until='networkidle')
    page.get_by_role('heading',name='Sign In',exact=True).wait_for()
    def geometry():
     assert page.locator('body').evaluate('(e)=>e.scrollWidth<=innerWidth+1')
     assert page.evaluate('document.documentElement.dataset.theme')==theme
     assert 'Public Sans' in page.locator('body').evaluate('(e)=>getComputedStyle(e).fontFamily')
     assert 'Newsreader' in page.get_by_role('heading').first.evaluate('(e)=>getComputedStyle(e).fontFamily')
    geometry()
    assert page.get_by_role('link',name='Boff Home',exact=True).count()==1
    page.get_by_role('button',name='Email A Sign-In Link',exact=True).click()
    page.get_by_role('alert').get_by_text('Enter a valid email address to receive a sign-in link.',exact=True).wait_for()
    assert page.get_by_label('Email',exact=True).evaluate('(e)=>e===document.activeElement')
    def auth(route):
     sent.append(route.request.post_data_json)
     route.fulfill(status=500,json={'msg':'Internal fixture service error'})
    ctx.route('**/auth/v1/token*',auth)
    ctx.route('**/auth/v1/otp*',lambda route:(sent.append(route.request.post_data_json),route.fulfill(status=200,json={})))
    page.get_by_label('Email',exact=True).fill('test@example.invalid')
    page.get_by_role('button',name='Email A Sign-In Link',exact=True).click()
    page.get_by_role('status').get_by_text('Check your email for a sign-in link.',exact=True).wait_for()
    assert sent[-1]['create_user']==False
    page.get_by_label('Password',exact=True).fill('test-only-password')
    page.get_by_role('button',name='Sign In',exact=True).click()
    page.get_by_role('alert').get_by_text('Sign-in is temporarily unavailable. Please try again shortly.',exact=True).wait_for(timeout=20000)
    assert page.get_by_role('button',name='Sign In',exact=True).is_enabled()
    geometry();page.screenshot(path=str(out/(engine+'-'+str(width)+'-'+theme+'-signin.png')),full_page=True)
    assert not errors,errors
    ctx.close()
    # Signed-in errors and content states use a fixture account; no real mutations.
    ctx=browser.new_context(viewport={'width':width,'height':950},reduced_motion='reduce')
    ctx.add_init_script('localStorage.setItem('+json.dumps(scope['key'])+','+json.dumps(json.dumps(scope['session']))+');localStorage.setItem("boff-visual-theme",'+json.dumps(theme)+');')
    mode={'value':'startup'}
    def book(route):
     if mode['value']=='startup':return route.fulfill(status=503,json={'error':'internal database stack must not be shown'})
     if mode['value']=='access':return route.fulfill(status=403,json={'error':'Your account is not mapped to this league'})
     return route.fulfill(json=scope['book'])
    ctx.route(host+'/api/book*',book)
    def rpc(route):
     if 'dev_accept_member_invitation' in route.request.url:
      return route.fulfill(json={'league':'Test League','team':'Test Team','leaguePath':'/1312126153980391424/matchups','accepted':False,'managerStatus':'Co-Manager'})
     return route.fulfill(json={'offers':[],'version':'fixture'} if 'dev_weekly_offer_changes' in route.request.url else [])
    ctx.route('**/rest/v1/rpc/**',rpc)
    page=ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    if share:page.goto(share,wait_until='networkidle')
    page.goto(host+'/',wait_until='networkidle')
    page.get_by_role('heading',name='League Unavailable',exact=True).wait_for()
    assert 'internal database' not in page.locator('body').inner_text()
    geometry();page.screenshot(path=str(out/(engine+'-'+str(width)+'-'+theme+'-error.png')),full_page=True)
    mode['value']='access';page.reload(wait_until='networkidle')
    page.get_by_role('heading',name='League Access Required',exact=True).wait_for()
    geometry()
    page.goto(host+'/join?invitation='+'a'*64,wait_until='networkidle')
    page.get_by_role('heading',name='Join Your Boff League',exact=True).wait_for()
    assert page.get_by_text('Co-Manager',exact=True).count()==1
    geometry();page.screenshot(path=str(out/(engine+'-'+str(width)+'-'+theme+'-invite.png')),full_page=True)
    mode['value']='book'
    page.goto(host+'/1312126153980391424/commissioner',wait_until='networkidle')
    page.get_by_role('heading',name='Commissioner Access Required',exact=True).wait_for()
    assert page.get_by_role('link',name='Open Weekly Slate',exact=True).count()>=1
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    page.goto(host+'/missing-page',wait_until='networkidle')
    page.get_by_role('heading',name='Page Not Found',exact=True).first.wait_for()
    assert 'visual review' not in page.locator('.boff-state').inner_text()
    assert not errors,errors
    # Hold the initial request to inspect the branded loading state.
    held=[]
    ctx.route(host+'/api/book*',lambda route:held.append(route))
    page.goto(host+'/',wait_until='domcontentloaded')
    page.get_by_role('heading',name='Connecting To Your League',exact=True).wait_for()
    assert page.locator('.boff-screen-brand').count()==1
    assert page.locator('.boff-state-progress span').evaluate('(e)=>getComputedStyle(e).animationName')=='none'
    for request in held:request.abort()
    ctx.close()
    results.append({'browser':engine,'width':width,'theme':theme})
  browser.close()
 (out/('hosted-results.json' if share else 'results.json')).write_text(json.dumps(results,indent=2))
 print('PASS:',len(results),'browser/width/theme cases: branded sign-in, validation, link/password failures, startup/access errors, invitations, denied access, missing pages and loading')

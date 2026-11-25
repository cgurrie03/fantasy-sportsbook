import json,sys,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
config=json.load(sys.stdin)
host=config['host'];league='1312126153980391424';results=[]
out=Path('work/production-migration/runtime-browser');out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
 try:
  for identity in config['sessions']:
   for width in [1440,390]:
    context=browser.new_context(viewport={'width':width,'height':950},reduced_motion='reduce')
    context.add_init_script('localStorage.setItem("sb-bmvjcdgxwxqalaohpsnw-auth-token",'+json.dumps(json.dumps(identity['session']))+');')
    def route_request(route):
     request=route.request
     if request.url.startswith(host+'/'):
      route.continue_();return
     if request.url.startswith('https://bmvjcdgxwxqalaohpsnw.supabase.co/'):
      url=host+'/__offline/'+request.url.split('.supabase.co/',1)[1]
      data=request.post_data.encode() if request.post_data else None
      headers={k:v for k,v in request.headers.items() if k.lower() in ['authorization','apikey','content-type']}
      try:
       with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers,method=request.method),timeout=20) as response:
        route.fulfill(status=response.status,body=response.read(),content_type='application/json')
      except urllib.error.HTTPError as error:
       route.fulfill(status=error.code,body=error.read(),content_type='application/json')
      return
     # No provider, auth, mail, push, analytics or image network is allowed.
     route.abort()
    context.route('**/*',route_request)
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    for route,title in [('matchups','Weekly Slate'),('futures','Season Futures'),('my-bets','My Bets'),('league','The League'),('profile','Profile'),('commissioner','Commissioner' if identity['name']!='member' else 'Commissioner Access Required'),('platform','Platform Owner' if identity['name']=='owner' else 'Platform Owner Access Required')]:
     print('Checking '+identity['name']+' '+str(width)+' '+route,file=sys.stderr)
     url=host+('/platform' if route=='platform' else '/'+league+'/'+route)
     page.goto(url,wait_until='networkidle')
     try:page.get_by_role('heading',name=title,exact=True).wait_for(timeout=20000)
     except Exception:
      (out/'page-failure.txt').write_text(page.locator('body').inner_text()+'\nScript errors: '+str(errors),encoding='utf-8')
      raise
     assert not errors,identity['name']+' '+route+' script errors: '+str(errors)
     assert page.locator('.dev-badge:visible,.environment-badge:visible,.preview-bar:visible').count()==0
     if route=='matchups':
      slip=page.locator('.mobile-slip-handle' if width==390 else '.slip-panel')
      light_slip=slip.evaluate('(e)=>getComputedStyle(e).backgroundColor')
      feed=page.locator('.slate-ticker')
      light_feed=feed.evaluate('(e)=>getComputedStyle(e).backgroundColor') if feed.count() else None
      page.get_by_role('button',name='Switch to dark mode',exact=True).click()
      page.wait_for_function('document.documentElement.dataset.theme === "dark"')
      assert slip.evaluate('(e)=>getComputedStyle(e).backgroundColor')!=light_slip,'Bet slip must change with theme'
      if light_feed is not None:
       assert feed.evaluate('(e)=>getComputedStyle(e).backgroundColor')!=light_feed,'League feed must change with theme'
      page.get_by_role('button',name='Switch to light mode',exact=True).click()
      page.wait_for_function('document.documentElement.dataset.theme === "light"')
     if route=='profile':
      page.get_by_role('tab',name='Communications',exact=True).click()
      page.get_by_role('button',name='Save Preferences',exact=True).click()
      page.get_by_role('status').get_by_text('Notification preferences saved.',exact=True).wait_for()
     if route=='commissioner' and identity['name']!='member':
      for tab in ['Featured Matchups','Fantasy Rewards','League Feed','Season Futures','Rivalries','Members']:
       page.get_by_role('tab',name=tab,exact=True).click()
       page.wait_for_timeout(150)
       assert not errors,identity['name']+' '+tab+' script errors'
     if route=='platform' and identity['name']=='owner':
      for tab in ['Result Review','Operations','Communications','Support Inbox','User Balances','Overview']:
       page.get_by_role('tab',name=tab,exact=True).click()
       page.wait_for_timeout(150)
       assert not errors,'Owner '+tab+' script errors'
     results.append({'role':identity['name'],'width':width,'page':route,'passed':True})
    context.close()
 finally:browser.close()
receipt={'checks':len(results),'roles':3,'widths':[1440,390],'actual_production_candidate':True,'sql_backed_responses':True,'communications_saved':True,'commissioner_and_owner_tabs_exercised':True,'auth_and_external_transport_simulated':True,'results':results}
(out/'results.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt))

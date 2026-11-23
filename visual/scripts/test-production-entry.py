import functools,json,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

metadata=json.loads(Path('work/production-migration/candidate-manifest.json').read_text())
candidate=Path(metadata['candidate_directory'])
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  if not (candidate/self.path.split('?')[0].lstrip('/')).is_file():self.path='/index.html'
  super().do_GET()
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(candidate)))
threading.Thread(target=server.serve_forever,daemon=True).start()
host='http://127.0.0.1:'+str(server.server_address[1]);results=[]
try:
 with sync_playwright() as playwright:
  for engine in ['chromium','webkit']:
   browser=playwright.webkit.launch() if engine=='webkit' else playwright.chromium.launch(executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
   for width in [1440,390]:
    for theme in ['light','dark']:
     context=browser.new_context(viewport={'width':width,'height':950},reduced_motion='reduce')
     context.add_init_script('localStorage.setItem("boff-visual-theme",'+json.dumps(theme)+')')
     outbound=[];errors=[]
     def auth(route):
      outbound.append(route.request)
      assert 'bmvjcdgxwxqalaohpsnw.supabase.co' in route.request.url
      assert route.request.headers.get('apikey')=='sb_publishable_yFDnhaRJWEjx4VAn53h4YQ_a7o1fE_L'
      assert route.request.post_data_json['create_user']==False
      route.fulfill(status=200,json={})
     context.route('https://*.supabase.co/**',auth)
     page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
     page.goto(host+'/sign-in',wait_until='networkidle')
     page.get_by_role('heading',name='Sign In',exact=True).wait_for()
     assert page.locator('.dev-badge:visible,.environment-badge:visible,.preview-bar:visible').count()==0
     assert page.locator('body').evaluate('(e)=>e.scrollWidth<=innerWidth+1')
     page.get_by_label('Email',exact=True).fill('migration-fixture@example.invalid')
     page.get_by_role('button',name='Email A Sign-In Link',exact=True).click()
     page.get_by_role('status').get_by_text('Check your email for a sign-in link.',exact=True).wait_for()
     assert len(outbound)==1
     assert not errors,errors
     results.append({'engine':engine,'width':width,'theme':theme,'production_target':True,'auth_intercepted':True,'pass':True})
     context.close()
   browser.close()
 Path('work/production-migration/entry-browser-results.json').write_text(json.dumps(results,indent=2))
 print('PASS: '+str(len(results))+' isolated Production entry checks; correct Auth target/key, no Dev badge, no overflow, intercepted sign-in email only; no live email/accounts changed.')
finally:server.shutdown();server.server_close()

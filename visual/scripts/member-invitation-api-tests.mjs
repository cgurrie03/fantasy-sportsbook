import assert from 'node:assert/strict';
import handler from '../dist/api/membership.mjs';
const beforeFetch=fetch,beforeEnv={...process.env};
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts',SUPABASE_URL:'https://whlcnlacueweaqpsupqs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service'});
const requestId='11111111-1111-4111-8111-111111111111';
async function run({verified=true,exists=true,captured=false,forbidden=false,origin,token='member-token',action='invite',userVerified=true}={}){
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{
  const path=new URL(url).pathname,body=opts.body?JSON.parse(opts.body):null;calls.push({path,body,headers:opts.headers});
  let result;
  if(path==='/auth/v1/user')result={id:'commissioner',email_confirmed_at:userVerified?'2026-11-18':null};
  else if(path.endsWith('dev_pending_member_invitations'))result=[{id:'invite',teamId:'team',sleeperId:'person',coManager:false,expected:null,email:'new@example.invalid'}];
  else if(path.endsWith('dev_prepare_member_invitation')){
   if(forbidden)return Response.json({message:'Commissioner access required'},{status:403});
   assert.equal(opts.headers.Authorization,'Bearer member-token');
   result={id:'invite',leagueName:'Exact league NAME',teamName:'Team',email:'new@example.invalid',verified,accountId:exists?'account':null,captured,status:'pending',expires:'2026-11-25T10:00:00Z'};
  }else if(path.endsWith('generate_link')){
   assert.equal(opts.headers.Authorization,'Bearer test-service');assert.equal(body.type,exists?'magiclink':'invite');
   const redirect=new URL(url).searchParams.get('redirect_to');assert.equal(new URL(redirect).origin,'https://dev.sportsbook.coopergurrie.com');
   result={id:'account',action_link:'https://whlcnlacueweaqpsupqs.supabase.co/auth/v1/verify?token=private&redirect_to='+encodeURIComponent(redirect)};
  }else if(path.endsWith('dev_capture_member_invitation')){
   assert.equal(opts.headers.Authorization,'Bearer test-service');assert.match(body.p_subject,/Exact league NAME/);assert.match(body.p_html,/Accept Invitation/);
   return new Response(null,{status:204});
  }else throw Error('Unexpected request '+path);
  return Response.json(result);
 };
 let status,data;const response={setHeader(){},status(s){status=s;return this},json(d){data=d;return this}};
 await handler({method:'POST',headers:{authorization:token?'Bearer '+token:'',host:'dev.sportsbook.coopergurrie.com',...(origin?{origin}:{})},body:{action,requestId,invitationId:'invite',teamId:'team',sleeperId:'person',coManager:false,expected:null,email:'new@example.invalid',reason:'Invitation test reason'}},response);
 return {status,data,calls};
}
try{
 assert.equal((await run({token:''})).status,401);
 assert.equal((await run({origin:'https://attacker.invalid'})).status,403);
 assert.equal((await run({userVerified:false})).status,401);
 assert.equal((await run({forbidden:true})).status,403);
 for(const args of [{},{verified:false,exists:false},{verified:false,exists:true},{action:'resend'}]){
  const result=await run(args);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.calls.filter(c=>c.path.endsWith('dev_capture_member_invitation')).length,1);
  assert.equal('url' in result.data,false,'Secret links must never be returned to commissioner');
 }
 const replay=await run({captured:true});assert.equal(replay.status,200);assert.equal(replay.calls.some(c=>c.path.endsWith('generate_link')||c.path.endsWith('dev_capture_member_invitation')),false);
 console.log('PASS invitation API: issuer/verification/origin guards; existing, new, unverified, resend and idempotent capture paths; no secret link exposure');
}finally{globalThis.fetch=beforeFetch;process.env=beforeEnv;}

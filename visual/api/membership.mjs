import {createHash,createHmac} from 'node:crypto';
import {renderLeagueInvitation} from '../lib/invitation-email.mjs';
import {serverTarget} from '../lib/release-target.mjs';
const LEAGUE='13121261-5398-4391-8240-000000000003';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const target=serverTarget(process.env);if(!target)return res.status(503).json({error:'League invitations unavailable'});
 const ORIGIN=target.origin;
 const token=(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!token||token===key)return res.status(401).json({error:'Commissioner sign-in required'});
 if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`)return res.status(403).json({error:'Invalid request origin'});
 const call=async(path,body,admin=false)=>{
  const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:`Bearer ${admin?key:token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(response.status===204)return null;
  const text=await response.text();const data=text?JSON.parse(text):null;if(!response.ok){const error=Error(data?.message||data?.msg||'Invitation request failed');error.status=response.status;throw error;}return data;
 };
 try{
  const user=await call('/auth/v1/user');
  if(!user.id||!user.email_confirmed_at)return res.status(401).json({error:'Verified commissioner sign-in required'});
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??{});
  if(Buffer.byteLength(raw)>4096)return res.status(413).json({error:'Invitation request too large'});
  let input;try{input=JSON.parse(raw);}catch{return res.status(400).json({error:'Invalid JSON'});}
  if(!input||typeof input!=='object'||Array.isArray(input))return res.status(400).json({error:'Invalid invitation request'});
  if(!uuid.test(input.requestId??''))return res.status(400).json({error:'Invalid invitation request identifier'});
  let details=input;
  if(input.action==='resend'){
   const pending=await call('/rest/v1/rpc/dev_pending_member_invitations',{p_league:LEAGUE});
   const row=pending.find(row=>row.id===input.invitationId);
   if(!row)return res.status(404).json({error:'Pending invitation unavailable'});
   details={teamId:row.teamId,sleeperId:row.sleeperId,coManager:row.coManager,expected:row.expected,email:row.email,reason:'Commissioner requested invitation resend'};
  }else if(input.action!=='invite')return res.status(400).json({error:'Invalid invitation action'});
  const secret=createHmac('sha256',key).update(`boff-member-invitation:${user.id}:${LEAGUE}:${input.requestId}`).digest('hex');
  const digest=createHash('sha256').update(secret).digest('hex');
  const invitation=await call('/rest/v1/rpc/dev_prepare_member_invitation',{
   p_league:LEAGUE,p_team:details.teamId,p_sleeper:details.sleeperId,p_co:details.coManager,p_expected:details.expected??null,
   p_email:details.email,p_reason:details.reason,p_request:input.requestId,p_digest:digest,
  });
  if(invitation.status!=='pending')return res.status(409).json({error:'This invitation is no longer pending'});
  if(!invitation.captured){
   let account=invitation.accountId;
   const join=new URL('/join',ORIGIN);join.searchParams.set('invitation',secret);
   let actionLink=join.href;
   if(!invitation.verified){
    const link=await call('/auth/v1/admin/generate_link?redirect_to='+encodeURIComponent(join.href),{
     type:account?'magiclink':'invite',email:invitation.email,
    },true);
    account=link.id??link.user?.id;
    actionLink=link.action_link??link.properties?.action_link;
    if(!account||!actionLink)throw Error('Verification link unavailable');
    const verification=new URL(actionLink);
    if(verification.origin!==url||verification.pathname!=='/auth/v1/verify'||verification.searchParams.get('redirect_to')!==join.href)throw Error('Invalid verification destination');
   }
   const message=renderLeagueInvitation({leagueName:invitation.leagueName,teamName:invitation.teamName,
    role:invitation.managerStatus??(invitation.coManager?'Co-Manager':'Manager'),url:actionLink,existingAccount:invitation.verified,
    expires:new Date(invitation.expires).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}),
    board:{origin:ORIGIN,path:'/1312126153980391424',leagueName:invitation.leagueName,leagueAvatar:invitation.leagueAvatar,
     team:{id:details.teamId,name:invitation.teamName,avatar:invitation.teamAvatar}},
   });
   await call('/rest/v1/rpc/dev_capture_member_invitation',{p_id:invitation.id,p_digest:digest,p_account:account,
    p_subject:message.subject,p_html:message.html,p_text:message.text},true);
  }
  return res.status(200).json({id:invitation.id,status:'captured',message:'Invitation captured in Development. League access is linked when the recipient accepts.'});
 }catch(error){
  const message=error instanceof Error?error.message:'Invitation unavailable';
  if(/Commissioner access required/i.test(message))return res.status(403).json({error:'Commissioner access required'});
  return res.status(error.status===401?401:error.status===403?403:/changed|limit|already|review|pending|invalid|reason|invitation/i.test(message)?409:503).json({error:message});
 }
}

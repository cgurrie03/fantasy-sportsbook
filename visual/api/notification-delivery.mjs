import {createHash,timingSafeEqual} from 'node:crypto';
import {serverTarget} from '../lib/release-target.mjs';
import {prepareConfirmations} from '../lib/confirmation-capture.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const target=serverTarget(process.env),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(target?.name!=='production'||!process.env.RESEND_API_KEY)return res.status(503).json({error:'Delivery unavailable'});
 const token=(req.headers.authorization??'').replace(/^Bearer /,'');
 if(!/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'Worker authorization required'});
 const db=async(path,body)=>{
  const r=await fetch(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('delivery_database_unavailable');
  if(r.status===204)return null;
  const text=await r.text();return text?JSON.parse(text):null;
 };
 try{
  const runtime=await db('rpc/production_refresh_runtime',{});
  const hash=createHash('sha256').update(token).digest('hex');
  if(typeof runtime.tokenHash!=='string'||runtime.tokenHash.length!==64||!timingSafeEqual(Buffer.from(hash),Buffer.from(runtime.tokenHash)))return res.status(401).json({error:'Worker authorization required'});
  if(req.body?.action==='health')return res.status(200).json({status:'ready',providerConfigured:true});
  if(!runtime.notificationsEnabled)return res.status(200).json({status:'disabled'});
  const action=req.body?.action??'deliver';
  if(!['deliver','confirmation'].includes(action)||action==='confirmation'&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.body?.ticketId??''))return res.status(400).json({error:'Invalid delivery request'});
  const contexts=await db('rpc/production_confirmation_contexts',{p_ticket:action==='confirmation'?req.body.ticketId:null});
  if(contexts.length){
   const renderers=await import('../lib/invitation-email.mjs');
   await prepareConfirmations(db,contexts,renderers,target.origin);
  }
  const messages=await db('rpc/production_claim_communications',{p_limit:4});let sent=0,failed=0;
  for(const m of messages){
   let providerId=null,error=null;
   try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'boff-communication-'+m.id},body:JSON.stringify({from:'Boff <'+m.sender+'>',to:[m.recipient],subject:m.subject,html:m.html,text:m.plain_text}),signal:AbortSignal.timeout(12000)});
    const data=await r.json();if(!r.ok||!data.id)throw Error('provider_http_'+r.status);providerId=data.id;sent++;
   }catch(e){error=e instanceof Error&&/^provider_http_\d+$/.test(e.message)?e.message:'provider_retry_required';failed++;}
   await db('rpc/production_finish_communication',{p_id:m.id,p_provider:providerId,p_error:error});
  }
  return res.status(200).json({status:'processed',sent,failed});
 }catch{return res.status(503).json({error:'Communication delivery will retry'});}
}

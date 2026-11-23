import nodemailer from "nodemailer";

export type AmpPayload={from:string;to:string[];subject:string;text:string;html:string;amp?:string};
export async function sendAmpMail(payload:AmpPayload,eventKey:string){
 if(!payload.amp||new TextEncoder().encode(payload.amp).length>200000)throw Error("Invalid AMP message");
 if(!process.env.RESEND_API_KEY)throw Error("Email delivery is not configured");
 const transport=nodemailer.createTransport({host:"smtp.resend.com",port:465,secure:true,
  auth:{user:"resend",pass:process.env.RESEND_API_KEY},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:15000,
  disableFileAccess:true,disableUrlAccess:true});
 try{
  const result=await transport.sendMail({...payload,headers:{"Resend-Idempotency-Key":eventKey},
   disableFileAccess:true,disableUrlAccess:true});
  if(result.rejected.length||!result.accepted.length)throw Error("Email recipient was not accepted");
  // Resend's SMTP response contains its provider UUID; keep it for owner sending logs.
  return {id:result.response.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]??result.messageId};
 }finally{transport.close();}
}

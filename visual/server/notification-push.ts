import webpush from "npm:web-push@3.6.7";
import {pushTarget} from "./push-target.ts";

type DatabaseRequest = (path:string,method?:string,body?:unknown)=>Promise<any>;
type PushKeys = {publicKey:string;privateKey:string};
export type PushDevice = {id:string;endpoint:string;keys:{auth:string;p256dh:string}};

export async function ensurePushKeys(db:DatabaseRequest):Promise<PushKeys>{
 const existing=await db("rpc/dev_push_keys","POST",{});
 if(existing)return existing;
 const keys=webpush.generateVAPIDKeys();
 return db("rpc/dev_push_keys","POST",{p_public:keys.publicKey,p_private:keys.privateKey});
}

export async function deliverPush(db:DatabaseRequest,leagueId:string,eventKey:string,device:PushDevice,keys:PushKeys,title:string,origin='https://sportsbook.coopergurrie.com'){
 const endpoint=new URL(device.endpoint);
 if(endpoint.protocol!=="https:"||endpoint.port||endpoint.username||endpoint.password||
  !/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)$/.test(endpoint.hostname))return;
 let expired=false;
 try{
  await webpush.sendNotification({endpoint:device.endpoint,keys:device.keys},
   JSON.stringify({title,body:"Open Boff to see your update.",url:pushTarget(eventKey.split(":")[0],eventKey),tag:eventKey}),{
    vapidDetails:{subject:origin,...keys}, TTL:900, timeout:4000,
   });
 }catch(error){
  const status=(error as {statusCode?:number}).statusCode;
  if(status!==404&&status!==410)throw error;
  expired=true;
 }
 await db("rpc/dev_record_push","POST",{p_league:leagueId,p_device:device.id,p_event:eventKey,p_expired:expired});
}

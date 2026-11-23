import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
export async function rehearseProductionBrowser(gateway,identities,api,handlers,roles){
 const manifest=JSON.parse(await fs.readFile('work/production-migration/candidate-manifest.json','utf8'));
 const candidate=path.resolve(manifest.candidate_directory);assert(candidate.startsWith(path.resolve('work/production-migration')+path.sep));
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=chunks.length?Buffer.concat(chunks).toString():undefined;
   if(req.url.startsWith('/__offline/')){
    const response=await gateway.fetch(gateway.origin+'/'+req.url.slice('/__offline/'.length),{method:req.method,headers:req.headers,body});
    res.writeHead(response.status,{'Content-Type':'application/json'});return res.end(await response.text());
   }
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   if(handlers[pathname]){
    const result=await api(handlers[pathname],req.url,req.headers.authorization?.replace(/^Bearer /,'')??'offline-outsider',req.method,body);
    res.writeHead(result.status,{'Content-Type':'application/json'});return res.end(JSON.stringify(result.data));
   }
   assert(req.method==='GET');
   let file=path.resolve(candidate,'.'+decodeURIComponent(pathname));assert(file.startsWith(candidate+path.sep));
   try{assert((await fs.stat(file)).isFile());}catch{file=path.join(candidate,'index.html');}
   res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]??'application/octet-stream'});
   res.end(await fs.readFile(file));
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"Offline fixture request failed"}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const sessions=roles.map(({name,id})=>{
   const user={...identities.get('offline-'+id),email:name+'@example.invalid'};
   const claims={sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'};
   const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.offline';
   identities.set(token,user);
   return {name,session:{access_token:token,refresh_token:'offline-refresh',expires_in:3600,expires_at:claims.exp,token_type:'bearer',user}};
  });
  const input={host:'http://127.0.0.1:'+server.address().port,sessions};
  const result=await new Promise((resolve,reject)=>{
   const child=spawn('python',['visual/scripts/test-production-runtime.py'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   const stdout=[],stderr=[];child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));child.on('error',reject);
   child.on('close',async code=>{
    if(code===0)return resolve(JSON.parse(Buffer.concat(stdout).toString()));
    await fs.mkdir('work/production-migration/runtime-browser',{recursive:true});
    await fs.writeFile('work/production-migration/runtime-browser/failure.log',Buffer.concat(stderr));
    reject(Error('Isolated browser acceptance failed; private runtime-browser/failure.log contains the diagnostic'));
   });
   child.stdin.end(JSON.stringify(input));
  });
  return result;
 }finally{await new Promise(resolve=>server.close(resolve));}
}

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
export function loadOfflineWorker(environment,fetch){
 let handler;const cache=new Map(),errors=[];
 const globals={fetch,Response,Request,Headers,AbortSignal,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,
  Date,Intl,structuredClone,crypto:webcrypto,btoa,atob,console:{log(){},error(...args){errors.push(args[0]);}},
  Deno:{env:{get:key=>environment[key]},serve:fn=>{handler=fn;}}};
 function load(filename){
  filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename);
  const module={exports:{}};cache.set(filename,module.exports);
  const source=fs.readFileSync(filename,'utf8');
  const require=specifier=>{
   if(specifier==='npm:web-push@3.6.7')return {default:{generateVAPIDKeys(){throw Error('Push disabled in Production preparation');},sendNotification(){throw Error('Push transport disabled');}},__esModule:true};
   if(!specifier.startsWith('.'))throw Error('Unexpected worker dependency: '+specifier);
   return load(path.resolve(path.dirname(filename),specifier));
  };
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {...globals,require,exports:module.exports,module},{filename});
  return module.exports;
 }
 load('visual/server/live-refresh.ts');return {handler,errors,load};
}

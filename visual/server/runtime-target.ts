// Worker configuration is explicit and independent of any request parameters.
export function workerTarget(input:{target?:string;url?:string;schema?:string}){
 const name=input.target??'development';
 if(name!=='development'&&name!=='production')return null;
 const projectRef=name==='production'?'bmvjcdgxwxqalaohpsnw':'whlcnlacueweaqpsupqs';
 const origin=name==='production'?'https://sportsbook.coopergurrie.com':'https://dev.sportsbook.coopergurrie.com';
 if(input.url!==`https://${projectRef}.supabase.co`)return null;
 if(name==='production'&&input.schema!=='boff-person-wallets-2026-11')return null;
 return {name,projectRef,origin};
}

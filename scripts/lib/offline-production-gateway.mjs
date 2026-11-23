import assert from 'node:assert/strict';
// A deliberately bounded PostgREST/Auth simulator over the restored database.
// All SQL/RLS/functions are real; only HTTP transport and JWT verification are simulated.
export function offlineGateway(db,identities){
 const service='offline-production-service',origin='https://bmvjcdgxwxqalaohpsnw.supabase.co';
 const ident=name=>{assert(/^[a-z_][a-z0-9_]*$/.test(name));return '"'+name+'"';};
 let queue=Promise.resolve();const calls=[];
 const fetch=async(input,options={})=>{
  const url=new URL(String(input));assert.equal(url.origin,origin,'Offline test attempted an external destination');
  const headers=new Headers(options.headers),token=(headers.get('Authorization')??'').replace(/^Bearer /,'');
  const user=identities.get(token),admin=token===service;
  calls.push({path:url.pathname,method:options.method??'GET',admin});
  if(url.pathname==='/auth/v1/user')return user?Response.json(user):Response.json({message:'Invalid session'},{status:401});
  if(url.pathname.startsWith('/auth/'))throw Error('Real account creation/link transport is not permitted in the offline fixture');
  if(!admin&&!user)return Response.json({message:'Invalid session'},{status:401});
  const run=async()=>{
   await db.exec('reset role;savepoint offline_http');
   try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user?.id??'',admin?'service_role':'authenticated']);
    await db.exec('set local role '+(admin?'service_role':'authenticated'));
    let output;
    const rpc=/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
    if(rpc){
     const data=options.body?JSON.parse(options.body):{};
     const procs=(await db.query(`select p.proargnames names,p.proargtypes::oid[] types from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=$1`,[rpc[1]])).rows;
     const proc=procs.find(p=>Object.keys(data).every(k=>p.names?.includes(k)));assert(proc,'Unknown offline RPC signature: '+rpc[1]);
     const values=[],args=[];
     for(const [key,value] of Object.entries(data)){
      const type=(await db.query('select format_type($1::oid,null) t',[proc.types[proc.names.indexOf(key)]] )).rows[0].t;
      values.push(value!==null&&(type==='jsonb'||type==='json')?JSON.stringify(value):value);
      args.push(ident(key)+'=> $'+values.length+'::'+type);
     }
     output=(await db.query(`select public.${ident(rpc[1])}(${args.join(',')}) result`,values)).rows[0].result;
    }else{
     const match=/^\/rest\/v1\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);assert(match,'Unsupported offline path');
     const table=match[1],values=[],where=[];
     for(const [key,expression] of url.searchParams){
      if(['select','limit','order'].includes(key))continue;
      const field=ident(key),parsed=/^(eq|neq|lt|lte|gt|gte|is|not\.is|in)\.(.*)$/.exec(expression);assert(parsed,'Unsupported offline filter');
      const [,operator,value]=parsed;
      if(operator==='is'||operator==='not.is'){assert.equal(value,'null');where.push(field+(operator==='is'?' IS NULL':' IS NOT NULL'));}
      else if(operator==='in'){values.push(value.slice(1,-1).split(','));where.push(field+'::text=ANY($'+values.length+'::text[])');}
      else{values.push(value);where.push(field+({eq:'=',neq:'<>',lt:'<',lte:'<=',gt:'>',gte:'>='}[operator])+'$'+values.length);}
     }
     const condition=where.length?' WHERE '+where.join(' AND '):'';
     let rows;
     if(options.method==='PATCH'){
      const patch=JSON.parse(options.body),set=Object.entries(patch).map(([key,value])=>{values.push(value!==null&&typeof value==='object'?JSON.stringify(value):value);return ident(key)+'=$'+values.length;});
      rows=(await db.query(`UPDATE public.${ident(table)} SET ${set.join(',')}${condition} RETURNING *`,values)).rows;
     }else{
      assert(!options.method||options.method==='GET','Unsupported offline table mutation');
      const order=(url.searchParams.get('order')??'').split(',').filter(Boolean).map(term=>{const [field,direction='asc']=term.split('.');assert(['asc','desc'].includes(direction));return ident(field)+' '+direction;});
      const limit=Number(url.searchParams.get('limit')??1000);assert(Number.isInteger(limit)&&limit>0&&limit<=1000);
      rows=(await db.query(`SELECT * FROM public.${ident(table)}${condition}${order.length?' ORDER BY '+order.join(','):''} LIMIT ${limit}`,values)).rows;
     }
     const select=url.searchParams.get('select')??'*';
     for(const row of rows){
      if(select.includes('ticket_legs('))row.ticket_legs=(await db.query('select * from public.ticket_legs where ticket_id=$1 order by leg_number',[row.id])).rows;
      if(select.includes('wallets('))row.wallets=(await db.query('select balance from public.wallets where team_id=$1',[row.id])).rows[0]??null;
     }
     output=select==='payload->feed'?rows.map(row=>({feed:row.payload?.feed})):rows;
    }
    await db.exec('reset role;release offline_http');return Response.json(output??null);
   }catch(error){
    await db.exec('rollback to offline_http;release offline_http;reset role');
    return Response.json({message:error.message,code:error.code},{status:error.code==='42501'?403:400});
   }
  };
  const task=queue.then(run);queue=task.catch(()=>{});return task;
 };
 return {fetch,calls,service,origin};
}

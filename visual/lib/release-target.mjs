// Public target identities only. Credentials must stay in server environment variables.
export const releaseSchema = 'boff-person-wallets-2026-11';
export const targets = Object.freeze({
  development: Object.freeze({name:'development',projectRef:'whlcnlacueweaqpsupqs',vercelProject:'prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts',vercelEnvironment:'preview',origin:'https://dev.sportsbook.coopergurrie.com',publishableKey:'sb_publishable_dvXjmm6gbHUCXO1NBBbsSw_5ZcOL5ce'}),
  production: Object.freeze({name:'production',projectRef:'bmvjcdgxwxqalaohpsnw',vercelProject:'prj_xQNaH7f1SPr8bgn2GV92a9MODQu8',vercelEnvironment:'production',origin:'https://sportsbook.coopergurrie.com',publishableKey:'sb_publishable_yFDnhaRJWEjx4VAn53h4YQ_a7o1fE_L'}),
});
export function buildTarget(name='development') {
  if (!Object.hasOwn(targets,name)) throw Error('An explicit known release target is required');
  return targets[name];
}
export function serverTarget(env) {
  const name=env.BOFF_RELEASE_TARGET ?? 'development';
  if(!Object.hasOwn(targets,name))return null;
  const target=targets[name];
  if(env.VERCEL_ENV!==target.vercelEnvironment || env.VERCEL_PROJECT_ID!==target.vercelProject ||
     env.SUPABASE_URL!==`https://${target.projectRef}.supabase.co` || !env.SUPABASE_SERVICE_ROLE_KEY)return null;
  // Production is opt-in, after the schema/ownership/settlement rehearsal is accepted.
  if(name==='production' && env.BOFF_RELEASE_SCHEMA!==releaseSchema)return null;
  return target;
}
export function targetHeaders(config,target) {
  const copy=structuredClone(config);
  for(const group of copy.headers ?? [])for(const header of group.headers ?? []) {
    if(header.key==='Content-Security-Policy') {
      for(const known of Object.values(targets))header.value=header.value.replaceAll(`${known.projectRef}.supabase.co`,`${target.projectRef}.supabase.co`);
    }
  }
  return copy;
}

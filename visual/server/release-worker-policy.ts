export function productionRunPolicy(marker:any, config:any, action:string, tokenHash:string) {
 if(marker?.environment!=='production'||marker?.project_ref!=='bmvjcdgxwxqalaohpsnw'||
  marker?.release_schema!=='boff-person-wallets-2026-11'||!config||
  marker.release_state!==config.state||config.tokenHash!==tokenHash||
  !Number.isInteger(config.season)||config.season<2026||!Number.isInteger(config.openingWeek)||
  config.openingWeek<1||config.openingWeek>22||!Number.isFinite(Date.parse(config.baselineAt)))throw Error('wrong_release_state');
 const warmup=action==='warmup';
 if(warmup?config.state!=='prepared':config.state!=='active')throw Error('release_not_active');
 if(!['warmup','scheduled'].includes(action))throw Error('invalid_refresh_action');
 return {warmup,season:config.season,openingWeek:config.openingWeek,baselineAt:config.baselineAt,
  // Production delivery needs its own acceptance/activation, never a side effect of warmup.
  notificationsEnabled:!warmup&&config.notificationsEnabled===true};
}

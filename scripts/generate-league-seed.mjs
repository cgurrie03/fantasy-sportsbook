import fs from 'node:fs'
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''))
const q = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`
const league = source.league
const leagueId = '13121261-5398-4391-8240-000000000003'
const users = new Map(source.users.map(user => [user.user_id, user]))
const avatar = user => user.metadata?.avatar || (user.avatar ? `https://sleepercdn.com/avatars/${user.avatar}` : null)
const array = values => `array[${values.map(q).join(',')}]::text[]`
let sql = `begin;\ninsert into public.leagues(id,name,sleeper_league_id,nfl_season,league_season,avatar_url) values (${q(leagueId)},${q(league.name)},${q(league.league_id)},${Number(league.season)},3,${q(`https://sleepercdn.com/avatars/${league.avatar}`)});\n`
for (const roster of source.rosters) {
  const owner = users.get(roster.owner_id)
  const coOwners = (roster.co_owners || []).map(id => users.get(id))
  // Human-approved shared-team mapping: nellyknowsball only.
  const mapped = roster.roster_id === 8 ? users.get('1269136771011055616') : owner
  const name = owner.metadata?.team_name?.trim() || owner.display_name
  sql += `insert into public.teams(league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name,co_owner_ids,co_owner_names,avatar_url,wins,losses,ties) values (${q(leagueId)},${roster.roster_id},${q(name)},${q(owner.user_id)},${q(owner.display_name)},${q(mapped.user_id)},${q(mapped.display_name)},${array(coOwners.map(u=>u.user_id))},${array(coOwners.map(u=>u.display_name))},${q(avatar(owner))},${roster.settings.wins},${roster.settings.losses},${roster.settings.ties || 0});\n`
}
sql += `insert into public.wallets(team_id) select id from public.teams where league_id=${q(leagueId)};\n`
sql += `insert into public.league_memberships(league_id,team_id,invited_email,display_name,sleeper_user_id,role) select league_id,id,'cooper.gurrie@gmail.com','Cooper',sportsbook_owner_id,'admin' from public.teams where league_id=${q(leagueId)} and roster_id=1;\ncommit;\n`
fs.writeFileSync('supabase/migrations/202610050002_league_seed.sql', sql)
console.log(`Prepared ${source.rosters.length} teams; approved Cooper mapping only. No balances or historical tickets imported.`)

import fs from 'node:fs'
import assert from 'node:assert/strict'
const dir = new URL('../../outputs/', import.meta.url)
const read = name => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8').replace(/^\uFEFF/, ''))
const table = name => { const [headers, ...rows] = read(`week3-source-${name}.json`).values; return rows.map(row => Object.fromEntries(headers.map((h,i) => [h,row[i] ?? null]))) }
const source = read('sleeper-league-stage1.json')
const results = read('week3-sleeper-results.json')
const users = table('users'), tickets = table('tickets'), markets = table('markets')
const byName = new Map(users.map((u,i) => [u.Team, i+1]))
const resultFor = name => { const r = results.find(r=>r.roster_id===byName.get(name)); assert(r,`Unknown team ${name}`); return r }
const score = r => Math.round((r.custom_points ?? r.points)*100)
const opponent = r => { const o = results.find(x=>x.matchup_id===r.matchup_id && x.roster_id!==r.roster_id); assert(o); return o }
const grade = comparison => comparison===0 ? 'PUSH' : comparison>0 ? 'WON' : 'LOST'
// Sheet serial dates represent local wall time in the spreadsheet's Eastern timezone.
const placedAt = serial => {
  const wall = Math.round((serial-25569)*86400000)
  const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))
  const offset = date => { const p=parts(date); return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(date/1000)*1000 }
  let utc=wall-offset(wall); utc=wall-offset(utc)
  return new Date(utc).toISOString()
}
function leg(text) {
  const [selection,type,oddsText] = text.split(' — ')
  const odds = Number(oddsText); assert(Number.isFinite(odds))
  let outcome, actual, line=null, team=null, matchup=null
  if(type==='Moneyline') {
    team=selection; const r=resultFor(team); actual=score(r)-score(opponent(r)); outcome=grade(actual)
  } else if(type==='Spread') {
    const match=selection.match(/^(.*) ([+-]\d+(?:\.\d+)?)$/); assert(match); team=match[1]; line=Number(match[2]); const r=resultFor(team); actual=score(r)-score(opponent(r)); outcome=grade(actual+Math.round(line*100))
  } else if(['Team Over','Team Under','Match Over','Match Under'].includes(type)) {
    const match=selection.match(/^(.*) ([OU]) (\d+(?:\.\d+)?)$/); assert(match); line=Number(match[3]); team=match[1]
    if(type.startsWith('Match')) { const names=team.split(' vs '); assert.equal(names.length,2); const a=resultFor(names[0]),b=resultFor(names[1]); assert.equal(a.matchup_id,b.matchup_id); actual=score(a)+score(b); matchup=team; team=null }
    else actual=score(resultFor(team))
    outcome=grade((actual-Math.round(line*100))*(type.endsWith('Over')?1:-1))
  } else if(['Most Points','Least Points'].includes(type)) {
    team=selection; actual=score(resultFor(team)); const extremum=(type==='Most Points'?Math.max:Math.min)(...results.map(score)); outcome=actual===extremum?'WON':'LOST'
    assert.equal(results.filter(r=>score(r)===extremum).length,1,'Weekly scorer tie needs an approved rule')
  } else throw new Error(`Unsupported market ${type}`)
  if(team && !['Most Points','Least Points'].includes(type)) matchup=markets.find(m=>m.Selection===team && m['Market Type']==='Moneyline')?.Game
  return {selection,type,accepted_odds:odds,accepted_line:line,team,matchup,result:outcome,actual_value:actual/100,source_text:text}
}
const settled = tickets.map(t=>{
  assert.equal(t.Status,'OPEN'); assert.equal(t.Week,3)
  const legs=t.Selections.split(' | ').map(leg); assert.equal(legs.length,t['Leg Count'])
  const result=legs.some(l=>l.result==='LOST')?'LOST':legs.every(l=>l.result==='PUSH')?'PUSH':'WON'
  const wager=Math.round(t.Wager*100)
  assert(!legs.some(l=>l.result==='PUSH'),'This import expects no partial pushes; add repricing before using on other datasets')
  const payout=result==='WON'?Math.round(t['Potential Payout']*100):result==='PUSH'?wager:0
  return {legacy_ticket_id:t['Ticket ID'],legacy_user_id:t['User ID'],week:3,nfl_season:Number(source.league.season),league_season:3,placed_at:placedAt(t.Timestamp),source_timestamp_serial:t.Timestamp,source_timezone:'America/New_York',source_status:t.Status,result,accepted_combined_odds:t['Combined Odds'],stake_cents:wager,accepted_potential_payout_cents:Math.round(t['Potential Payout']*100),payout_cents:payout,profit_cents:payout-wager,legs}
})
assert.equal(new Set(settled.map(t=>t.legacy_ticket_id)).size,settled.length)
const mappings=users.map((u,i)=>{
  const roster=source.rosters.find(r=>r.roster_id===i+1); assert(roster)
  const sleeperId=roster.roster_id===8?'1269136771011055616':roster.owner_id
  const owner=source.users.find(x=>x.user_id===sleeperId); assert(owner)
  const own=settled.filter(t=>t.legacy_user_id===u['User ID']); const stake=own.reduce((s,t)=>s+t.stake_cents,0),payout=own.reduce((s,t)=>s+t.payout_cents,0)
  assert.equal(stake,Math.round(u['Total Wagered']*100)); assert.equal(Math.round(u.Balance*100),Math.round(u['Starting Balance']*100)-stake)
  const after=Math.round(u.Balance*100)+payout
  return {roster_id:roster.roster_id,legacy_user_id:u['User ID'],name:u.Name,team_name:u.Team,current_sleeper_team_name:owner.metadata?.team_name?.trim() || source.users.find(x=>x.user_id===roster.owner_id)?.display_name,sleeper_user_id:sleeperId,sleeper_username:owner.display_name,email:u.Email.toLowerCase(),role:i===0?'admin':'member',sheet_balance_cents:Math.round(u.Balance*100),stake_cents:stake,payout_cents:payout,net_profit_cents:payout-stake,balance_after_settlement_cents:after,proposed_replenishment_cents:Math.max(0,10000-after),proposed_week5_balance_cents:Math.max(10000,after),bets:own.length,won:own.filter(t=>t.result==='WON').length,lost:own.filter(t=>t.result==='LOST').length}
})
assert.equal(settled.length,19); assert.equal(mappings.length,12)
const sums={tickets:settled.length,won:settled.filter(t=>t.result==='WON').length,lost:settled.filter(t=>t.result==='LOST').length,stake_cents:settled.reduce((s,t)=>s+t.stake_cents,0),payout_cents:settled.reduce((s,t)=>s+t.payout_cents,0),sheet_balance_cents:mappings.reduce((s,u)=>s+u.sheet_balance_cents,0),balance_after_settlement_cents:mappings.reduce((s,u)=>s+u.balance_after_settlement_cents,0),proposed_week5_balance_cents:mappings.reduce((s,u)=>s+u.proposed_week5_balance_cents,0)}
assert.equal(sums.sheet_balance_cents+sums.stake_cents,120000)
assert.equal(sums.balance_after_settlement_cents,120000+sums.payout_cents-sums.stake_cents)
const prepared={status:'Prepared; Not Imported; Awaiting Mapping Review',source_spreadsheet_id:'1ybv6cWMLGDEVzyELMDaewKTBpoHXdYyAdMFr1TWlUUY',sleeper_league_id:source.league.league_id,prepared_at:new Date().toISOString(),settlement_evidence:'Sleeper league Week 3 scores; accepted ticket lines and stored potential payouts; custom score overrides honored',approved_balance_rule:'Settle Week 3 then replenish balances below $100 to $100; keep higher balances. Replenishments excluded from betting profit.',pending_decisions:['Sheet account mapping approval'],sums,mappings,tickets:settled}
fs.writeFileSync(new URL('week3-import-prepared.json',dir),JSON.stringify(prepared,null,2)+'\n')
const money=n=>`$${(n/100).toFixed(2)}`
let report='# Week 3 Import Review\n\nPrepared for review; not applied to the database or original Google Sheet. All 19 tickets have determinate results. Settlement dates will record the actual import time; original placement dates are preserved.\n\n'
report+=`${sums.won} Won; ${sums.lost} Lost; 0 Push. Stakes: ${money(sums.stake_cents)}. Payouts: ${money(sums.payout_cents)}. Sheet available balances: ${money(sums.sheet_balance_cents)}. After settlement: ${money(sums.balance_after_settlement_cents)}. After proposed missed replenishments: ${money(sums.proposed_week5_balance_cents)}.\n\n`
report+='| Team | Name | Sleeper Account | Email | Sheet Balance | Week 3 Wagered | Week 3 Payout | After Settlement | Proposed Week 5 Balance |\n|---|---|---|---|---:|---:|---:|---:|---:|\n'
for(const u of mappings) report+=`| ${u.team_name} | ${u.name} | ${u.sleeper_username} (Roster ${u.roster_id}) | ${u.email} | ${money(u.sheet_balance_cents)} | ${money(u.stake_cents)} | ${money(u.payout_cents)} | ${money(u.balance_after_settlement_cents)} | ${money(u.proposed_week5_balance_cents)} |\n`
report+='\n## Ticket Results\n\nAccepted payouts are honored, including the Week 3 boosted moneyline odds. Losing tickets pay $0 even when some legs win. No wager is deducted again.\n\n'
for(const t of settled) { report+=`### ${t.legacy_ticket_id} — ${t.legacy_user_id} — ${t.result}\n\nStake ${money(t.stake_cents)}; Payout ${money(t.payout_cents)}; Net ${money(t.profit_cents)}.\n\n`; for(const l of t.legs) report+=`- ${l.source_text}: **${l.result}**. Actual ${l.actual_value.toFixed(2)}${l.type==='Spread'||l.type==='Moneyline'?' Point Margin':' Points'}.\n`; report+='\n' }
report+='## Import Rules\n\n- Store immutable source ticket IDs and accepted terms; enforce unique source IDs to prevent duplicate imports and credits.\n- Import settled ticket and leg history, all 12 team identities and wallets, and approved email memberships in one transaction.\n- Record opening available balances, settlement credits and any approved replenishments separately.\n- Original wagers are already deducted; historical stake figures count toward statistics without another wallet debit.\n- Record net profit from ticket payouts minus wagers; replenishments never count as betting profit.\n- Do not send historical confirmation or result emails automatically.\n- Source Markets remain open and contain different totals; they are reference data only and must not be reopened for betting.\n- Roster 8 account is Nelson / nellyknowsball only, despite Diabloo being the primary Sleeper owner.\n'
fs.writeFileSync(new URL('week3-import-review.md',dir),report)
console.log(JSON.stringify({sums,mappings},null,2))

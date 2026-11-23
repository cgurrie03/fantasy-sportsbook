export type FeedStory = { id: string; category: string; title: string; detail: string; playerId?: string };
type Team = { rosterId: number; name: string };
type Player = { id: string; name: string; injury?: string; injuryBody?: string; injuryUpdatedAt?: string; gameState?: string };
type DraftPick = { season: string | number; round: number; owner_id: number; roster_id?: number };
type Trade = { transaction_id: string; type: string; status: string; roster_ids?: number[]; adds?: Record<string, number>; draft_picks?: DraftPick[] | null };

type RosterOwner = { owner_id: string; roster_id: number };
type SleeperUser = { user_id: string; username?: string; display_name?: string; metadata?: { team_name?: string } };
type CurrentTeam = Team & { ownerId?: string };

export function historicalTeamNames(rosters: RosterOwner[], users: SleeperUser[], current: CurrentTeam[]): Team[] {
 const byOwner = new Map(current.filter(team => team.ownerId).map(team => [team.ownerId, team.name]));
 return rosters.map(roster => {
  const owner = users.find(user => user.user_id === roster.owner_id);
  const original = owner?.metadata?.team_name || owner?.display_name || owner?.username;
  const currentName = byOwner.get(roster.owner_id);
  const name = currentName && original && currentName !== original
   ? `${currentName} (then ${original})`
   : currentName || original || `Team ${roster.roster_id}`;
  return { rosterId: roster.roster_id, name };
 });
}

function ordinal(round: number) {
 const lastTwo = round % 100;
 const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({1:"st",2:"nd",3:"rd"}[round % 10] ?? "th");
 return `${round}${suffix}`;
}

export function tradeStories(rows: Trade[], teams: Team[], players: Player[], week: number, season?: number, drafted: Record<string,string> = {}): FeedStory[] {
 const teamNames = new Map(teams.map(team => [team.rosterId, team.name]));
 const playerNames = new Map(players.map(player => [player.id, player.name]));
 return rows.filter(row => row.type === 'trade' && row.status === 'complete').slice(0, 8).flatMap(row => {
  const names = [...new Set(row.roster_ids ?? [])].flatMap(id => teamNames.get(id) ?? []);
  if (names.length < 2) return [];
  const additions = new Map<number,string[]>();
  for(const [id,roster] of Object.entries(row.adds ?? {})){
   const player=playerNames.get(id) ?? "Player";
   additions.set(roster,[...(additions.get(roster)??[]),player]);
  }
  const picks = new Map<number, Map<string, number>>();
  for (const pick of row.draft_picks ?? []) {
   if (!/^\d{4}$/.test(String(pick.season)) || !Number.isInteger(pick.round) || pick.round < 1) continue;
   const assets = picks.get(pick.owner_id) ?? new Map<string, number>();
   const used=drafted[[pick.season,pick.round,pick.roster_id].join(":")];
   const label = `${pick.season} ${ordinal(pick.round)}${used?` (${used})`:""}`;
   assets.set(label, (assets.get(label) ?? 0) + 1);
   picks.set(pick.owner_id, assets);
  }
  const recipients = new Set([...additions.keys(),...picks.keys()]);
  const groups = [...recipients].map(roster=>{
   const assets=[...additions.get(roster)??[], ...[...(picks.get(roster)??[])].map(([label,count])=>count>1?`${label} ×${count}`:label)];
   return `${teamNames.get(roster)??`Team ${roster}`} receives ${assets.join(", ")}`;
  });
  return [{id: 'trade:' + row.transaction_id, category: season ? 'This Week in History' : 'Trade',
   title: season ? 'Trade Flashback' : 'Trade Completed',
   detail: [season ? `${season} · Wk. ${week}` : "", ...groups.length ? groups : names].filter(Boolean).join(" · ")}];
 });
}

export function injuryStories(before: Record<string, string>, players: Player[], week: number, weekStart: number) {
 const latest: Record<string, string> = {...before};
 const stories: FeedStory[] = [];
 const seen=new Set<string>();
 for(const player of players){
  if(seen.has(player.id))continue;
  seen.add(player.id);
  const status=player.injury?.trim()??"";
  const body=player.injuryBody?.replace(/[_-]+/g," ").toLowerCase().replace(/(^| )\p{L}/gu,letter=>letter.toUpperCase())??"";
  const fingerprint=JSON.stringify([status.toLowerCase(),body,player.injuryUpdatedAt??""]);
  const prior=before[player.id];
  latest[player.id]=fingerprint;
  if(player.gameState==="post"||prior===fingerprint)continue;
  const previousStatus=prior?.startsWith("[") ? JSON.parse(prior)[0] : prior?.toLowerCase();
  const freshDate=Date.parse(player.injuryUpdatedAt??"")>=weekStart;
  const observedChange=prior!==undefined && (prior.startsWith("[") || previousStatus!==status.toLowerCase());
  if(!freshDate&&!observedChange)continue;
  if(!status&&!previousStatus)continue;
  const label=({ir:"Injured Reserve",pup:"Physically Unable to Perform",out:"Out","coach's decision":"Coach’s Decision"} as Record<string,string>)[status.toLowerCase()]??status;
  stories.push({id:`injury:${week}:${player.id}`,playerId:player.id,category:status?"Injury Report":"Injury Update",
   title:status?`${player.name} · ${label}`:`${player.name} cleared the injury report`,
   detail:status?body.replace(/Coach'S Decision/gi,"Coach’s Decision")||"Injury details unavailable":""});
 }
 return {latest,stories};
}

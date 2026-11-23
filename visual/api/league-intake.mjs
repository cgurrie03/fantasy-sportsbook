import { fetchSleeperIntake, sleeperLeagueId } from "../lib/league-intake.mjs";
import {serverTarget} from '../lib/release-target.mjs';
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  const target=serverTarget(process.env);
  if (!target) {
    return res.status(503).json({ error: "League intake is unavailable." });
  }
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || authorization === `Bearer ${key}`) {
    return res.status(401).json({ error: "Sign in as the platform owner." });
  }
  if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`)return res.status(403).json({error:'Invalid request origin.'});

  const call = (path, options = {}) => fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: authorization, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const rpc = (name, data = {}) => call(`rpc/${name}`, { method: "POST", body: JSON.stringify(data) });
  try {
    const [identity, owner] = await Promise.all([rpc("application_environment_identity"), rpc("league_intake_owner")]);
    const marker = identity.ok ? await identity.json() : null;
    if (marker?.environment !== target.name || marker.project_ref !== target.projectRef) {
      return res.status(503).json({ error: "Database identity could not be verified." });
    }
    if (!owner.ok || await owner.json() !== true) {
      return res.status(403).json({ error: "Platform owner access required." });
    }
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(raw) > 2048) return res.status(413).json({ error: "Intake request is too large." });
    const input=JSON.parse(raw);
    if(!input||typeof input!=='object'||Array.isArray(input))return res.status(400).json({error:'Invalid intake request.'});
    const contextResponse=await rpc('dev_league_intake_context');
    if(!contextResponse.ok)return res.status(503).json({error:'Linked league information is unavailable.'});
    const context=await contextResponse.json();
    if(input.action==='discover'){
      const season=String(context.season);
      if(!/^20\d{2}$/.test(season))return res.status(503).json({error:'Sleeper season is unavailable.'});
      const known=new Set(context.linked.map(row=>row.sleeperId));
      const leagues=new Map();
      const users=(context.sleeperUsers??[]).filter(user=>/^\d{1,32}$/.test(user.id)).slice(0,3);
      await Promise.all(users.map(async user=>{
        const response=await fetch(`https://api.sleeper.app/v1/user/${user.id}/leagues/nfl/${season}`,{signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw Error('Your Sleeper leagues could not be loaded. You can still enter a league ID.');
        const text=await response.text();if(Buffer.byteLength(text)>1048576)throw Error('Sleeper league list exceeds its read budget. Enter a league ID instead.');
        const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.length>200)throw Error('Sleeper league list is unavailable.');
        for(const league of rows){
          if(!/^\d{1,32}$/.test(league.league_id)||String(league.season)!==season||typeof league.name!=='string')continue;
          leagues.set(league.league_id,{id:league.league_id,name:league.name.slice(0,80),teams:league.total_rosters,season:Number(season),linked:known.has(league.league_id)});
        }
      }));
      return res.status(200).json({season:Number(season),hasSleeperAccount:users.length>0,leagues:[...leagues.values()].sort((a,b)=>Number(a.linked)-Number(b.linked)||a.name.localeCompare(b.name)),linked:context.linked});
    }
    const { sleeper_league_id, request_key } = input;
    const leagueId = sleeperLeagueId(sleeper_league_id);
    if (typeof request_key !== "string" || !uuid.test(request_key)) {
      return res.status(400).json({ error: "An intake request identifier is required." });
    }
    if(context.linked.some(row=>row.sleeperId===leagueId))return res.status(409).json({error:'This Sleeper league is already connected. Review its existing setup or renewal.'});
    const prior = await call(`league_intake_drafts?request_key=eq.${request_key}&select=id,revision,state,source_league_id,expires_at`);
    if (!prior.ok) return res.status(503).json({ error: "Intake draft lookup is unavailable." });
    const [draft] = await prior.json();
    if (draft) {
      if (draft.source_league_id !== leagueId) return res.status(409).json({ error: "This request belongs to another Sleeper league." });
      if (draft.state === "expired" || (draft.state === "draft" && Date.parse(draft.expires_at) <= Date.now())) {
        return res.status(410).json({ error: "Draft expired. Refresh the provider preview." });
      }
      return res.status(200).json(draft);
    }
    const { source, capabilities } = await fetchSleeperIntake(leagueId);
    const result = await rpc("save_league_intake_draft", { p_request: request_key, p_source: source, p_capabilities: capabilities });
    if (!result.ok) {
      const error = await result.json();
      return res.status(400).json({ error: error.message || "League draft could not be saved." });
    }
    return res.status(200).json(await result.json());
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "League intake failed." });
  }
}

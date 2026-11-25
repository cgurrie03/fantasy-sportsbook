import { useEffect, useRef, useState } from "react";
import { fantasyRewards } from "../server/fantasy-rewards";
import type { RewardKind, RewardRules } from "../server/fantasy-rewards";
import { auth, live } from "./live";
import { Modal, Icon, Toggle } from "./ui";

const entries = Object.entries(fantasyRewards) as [RewardKind, (typeof fantasyRewards)[RewardKind]][];
const defaultCap = (key: RewardKind) => key === "highLoss" ? 3 : /^(win|loss)|^playoffClinch$/.test(key) ? 2 : 1;
function RewardHelp({id,children}: {id:string;children:string}) {
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useRef<HTMLSpanElement>(null);
  function place(){
    const anchor=trigger.current?.getBoundingClientRect(), panel=popup.current;
    if(!anchor||!panel?.matches(":popover-open"))return;
    panel.style.left=`${Math.max(12,Math.min(anchor.left,innerWidth-panel.offsetWidth-12))}px`;
    panel.style.top=`${anchor.bottom+panel.offsetHeight+12<innerHeight ? anchor.bottom+6 : Math.max(12,anchor.top-panel.offsetHeight-6)}px`;
  }
  useEffect(()=>{
    window.addEventListener("resize",place);
    window.addEventListener("scroll",place,true);
    return ()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
  },[]);
  return <span className="reward-help"><button ref={trigger} type="button" className="icon-button"
    aria-label="More information" popoverTarget={id}><Icon name="info" size={14}/></button>
    <span ref={popup} onToggle={place} popover="auto" id={id}>{children}</span></span>;
}
const groupHelp: Record<string,string> = {
  Scoring:"Scoring awards use final Sleeper results. Beat the Projection requires the largest gain above the opening projection. High Score in a Loss requires a top-three score and a loss.",
  "Matchup Results":"Close Win goes to the smallest qualifying winning margin. Upset requires an outright win by an underdog at or above the configured opening spread.",
  "Win Streaks":"Awards trigger when a team reaches the listed streak length. A tie breaks the streak.",
  "Losing Streaks":"Awards trigger when a team reaches the listed losing streak length. A tie breaks the streak.",
  Playoffs:"A verified playoff berth qualifies once. The championship boost is redeemable next season.",
};
const thresholds = [
  ["closeMargin", "Maximum Close Win Margin", 10],
  ["upsetSpread", "Minimum Underdog Spread", 20],
  ["projectionMargin", "Minimum Points Above Projection", 20],
] as const;

export function FantasyRewardsSettings() {
  const [saved, setSaved] = useState<RewardRules>({});
  const [draft, setDraft] = useState<RewardRules>({});
  const [revision, setRevision] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const limitedCaps = useRef<Partial<Record<RewardKind,number>>>({});
  const leagueId = live()?.leagueId;
  useEffect(() => {
    if (!leagueId) return;
    let active = true;
    void auth.rpc("dev_fantasy_reward_rules", { p_league: leagueId }).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      else {
        setSaved(data.rules);
        setDraft(data.rules);
        setRevision(data.revision);
      }
    });
    return () => { active = false; };
  }, [leagueId]);
  const rewardGroups: [string, RewardKind[]][] = [
    ["Scoring", ["topScorer", "highLoss", "beatProjection", "seasonRecord", "leagueRecord"]],
    ["Matchup Results", ["closeWin", "upset"]],
    ["Win Streaks", ["win3", "win5", "win7", "win10"]],
    ["Losing Streaks", ["loss3", "loss5", "loss7", "loss10"]],
    ["Playoffs", ["playoffClinch", "champion"]],
  ];
  const changes = [
    ...(!!draft.weeklyLimit !== !!saved.weeklyLimit
      ? [`One Earned Boost Per Week: ${draft.weeklyLimit ? "On" : "Off"}`] : []),
    ...entries.flatMap(([key, reward]) => {
      const before = saved.boost?.[key] ?? reward.percent;
      const after = draft.boost?.[key] ?? reward.percent;
      const wasEnabled = saved.enabled?.[key] ?? before>0;
      const enabled = draft.enabled?.[key] ?? after>0;
      const oldCap = saved.maxRecipients?.[key] ?? defaultCap(key);
      const cap = draft.maxRecipients?.[key] ?? defaultCap(key);
      return [
        ...(before===after ? [] : [`${reward.label} boost ${before}% → ${after}%`]),
        ...(wasEnabled===enabled ? [] : [`${reward.label} ${enabled ? "enabled" : "disabled"}`]),
        ...(oldCap===cap ? [] : [`${reward.label} limit ${cap || "unlimited"}`]),
      ];
    }),
    ...thresholds.flatMap(([key, label, value]) => {
      const before = saved[key] ?? value;
      const after = draft[key] ?? value;
      return before === after ? [] : [`${label}: ${before} → ${after}`];
    }),
  ];
  async function save() {
    if (revision == null || !leagueId || busy) return;
    setBusy(true);
    const { data, error } = await auth.rpc("dev_fantasy_reward_rules", {
      p_league: leagueId, p_revision: revision, p_rules: { weeklyLimit: false, boost: {}, ...draft },
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setSaved(data.rules);
      setDraft(data.rules);
      setRevision(data.revision);
      setConfirming(false);
      setMessage("Fantasy reward settings saved.");
    }
  }
  return (
    <section className="panel form-panel fantasy-reward-settings">
      <h2>Fantasy Rewards</h2>
      
      <form onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
        <fieldset disabled={revision == null || busy}>
          <div className="reward-weekly-limit"><Toggle label="One Earned Boost Per Week"
            checked={!!draft.weeklyLimit} onChange={()=>setDraft({...draft,weeklyLimit:!draft.weeklyLimit})}/>
          <RewardHelp id="reward-weekly-help">When enabled, each user keeps their highest qualifying boost for the week.</RewardHelp></div>
          <div className="reward-groups">
            {rewardGroups.map(([group, kinds]) => (
              <section className="reward-group" key={group}>
                <h3>{group} <RewardHelp id={`reward-group-${kinds[0]}`}>{groupHelp[group]}</RewardHelp></h3>
                <div className="reward-rule-header"><span>Award</span><span>Boost %</span><span>Max Users / Week <RewardHelp id={`reward-cap-${kinds[0]}`}>Co-managers qualify together, even when their team takes the award above the limit. Allow all removes the limit for that award.</RewardHelp></span></div>
                {kinds.map(key => {
                  const reward=fantasyRewards[key];
                  const percent=draft.boost?.[key] ?? reward.percent;
                  const cap=draft.maxRecipients?.[key] ?? defaultCap(key);
                  return <div className="reward-rule-row" key={key}>
                    <label className="toggle-row"><input type="checkbox" checked={draft.enabled?.[key] ?? percent>0}
                      onChange={event=>setDraft({...draft,enabled:{...draft.enabled,[key]:event.target.checked},
                        boost:{...draft.boost,[key]:percent || reward.percent}})} /><span className="switch" aria-hidden="true" />{reward.label}</label>
                    <label className="reward-boost-field"><span className="reward-input-label" aria-hidden="true">Boost %</span>
                    <input aria-label={reward.label+" profit boost percent"} type="number" min={1} max={100} step={0.01}
                      required value={percent || reward.percent} onChange={event=>setDraft({...draft,boost:{...draft.boost,[key]:event.target.valueAsNumber}})} /></label>
                    <div className="reward-recipient-cap">
                      <span className="reward-input-label" aria-hidden="true">Max Users / Week</span>
                      <input aria-label={reward.label+" maximum weekly users"} type="number" min={1} max={128} step={1}
                        required disabled={cap===0} value={cap===0?"":cap} placeholder={cap===0?"All":undefined}
                        onChange={event=>setDraft({...draft,maxRecipients:{...draft.maxRecipients,[key]:event.target.valueAsNumber}})} />
                      <label><input type="checkbox" aria-label={reward.label+" allow all qualifying recipients"} checked={cap===0}
                        onChange={event=>{if(event.target.checked)limitedCaps.current[key]=cap;setDraft({...draft,maxRecipients:{...draft.maxRecipients,[key]:event.target.checked?0:limitedCaps.current[key]??defaultCap(key)}});}}/>Allow All</label>
                    </div>
                  </div>;
                })}
                {thresholds.filter(([key]) => group==="Scoring" ? key==="projectionMargin" :
                  group==="Matchup Results" && key!=="projectionMargin").map(([key,label,value])=>
                  <label className="reward-threshold" key={key}>{label}
                    <input type="number" min={0.01} max={1000} step={0.01} required value={draft[key] ?? value}
                      onChange={event=>setDraft({...draft,[key]:event.target.valueAsNumber})}/>
                  </label>)}
              </section>
            ))}
          </div>
          <div className="reward-actions"><button type="submit" className="button primary" disabled={!changes.length}>Review Changes</button></div>
        </fieldset>
      </form>
      {message && <p role="status">{message}</p>}
      {confirming && <Modal title="Confirm Fantasy Reward Changes" onClose={() => setConfirming(false)}>
        <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>
        {message && <p role="status">{message}</p>}
        <button className="button primary" disabled={busy} onClick={() => void save()}>Save Changes</button>
      </Modal>}
    </section>
  );
}

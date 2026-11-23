import { feedOptions } from "./feedOptions";
import { useEffect, useState } from "react";
import { auth,live } from "./live";
import { Toggle } from "./ui";

const categories = ["Trade","This Week in History","Playoff History","Injury Report","Injury Update","Fantasy Reward",
  "Featured","Big Win","Underdog Watch","Live Score","Parlay Watch","Ticket Placed","Week Recap"];

export function LeagueFeedSettings() {
  const leagueId=live()?.leagueId;
  const [choices,setChoices]=useState<Record<string,boolean|number>|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!leagueId)return;
    let active=true;
    void auth.rpc("dev_league_feed_preferences",{p_league:leagueId}).then(({data,error})=>{
      if(!active)return;
      if(error)setMessage(error.message);
      else setChoices(data);
    });
    return ()=>{active=false;};
  },[leagueId]);
  async function save(){
    setBusy(true);
    const {data,error}=await auth.rpc("dev_league_feed_preferences",{p_league:leagueId,p_choices:choices});
    setBusy(false);
    if(error){setMessage(error.message);return;}
    if(live())live().feedPreferences=data;
    setMessage("League feed settings saved.");
  }
  return <section className="panel form-panel league-feed-settings">
    <h3>League Feed</h3>
    <p className="field-note">Choose which stories appear on the Weekly Slate for your league.</p>
    {choices && <>
      <div className="feed-setting-list">{categories.map(category=><section className="feed-setting" key={category}>
        <div className="feed-setting-heading">
          <span className="slate-headline-category" data-category={category}>{category}</span>
          <Toggle label="Show" note={category} disabled={busy} checked={choices[category]!==false}
            onChange={()=>setChoices({...choices,[category]:choices[category]===false})}/>
        </div>
        {choices[category]!==false && feedOptions.filter(option=>option.category===category).map(option=>
          "min" in option ? <label className="feed-setting-number" key={option.key}>{option.label}
            <input type="number" min={option.min} max={option.max} step={1} disabled={busy}
              value={Number(choices[option.key] ?? option.defaultValue)}
              onChange={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value))setChoices({...choices,[option.key]:value});}}/>
          </label> : <Toggle key={option.key} label={option.label} disabled={busy}
            checked={Boolean(choices[option.key] ?? option.defaultValue)}
            onChange={()=>setChoices({...choices,[option.key]:!(choices[option.key] ?? option.defaultValue)})}/>
        )}
      </section>)}</div>
      <button className="button primary" disabled={busy} onClick={()=>void save()}>Save Feed Settings</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}

import { useEffect, useId, useRef, useState } from "react";
import { auth, live } from "./live";
import { Icon, Modal, Toggle, InfoPopover } from "./ui";

type Rules = {
  qualification: "sleeper" | "head_to_head" | "official_bracket";
  firstPick: "disabled" | "regular_season" | "toilet_bowl";
  rostersReady: boolean;
};
type Settings = {
  revision: number;
  season: number;
  leagueSize: number | null;
  sleeper: { playoffTeams?: number; playoffWeekStart?: number; leagueType?: number } | null;
  rules: Rules;
};

const help = {
  timing: {
    title: "Playoff Timing Rule",
    content: <>
      <p>This sets when Boff can grade the league-wide markets for the first team to clinch a playoff spot and the first team to be eliminated.</p>
      <dl>
        <dt>Use Sleeper Settings</dt><dd>Boff uses finalized head-to-head results and the remaining schedule in leagues without divisions or a median game. Leagues with either use the official bracket.</dd>
        <dt>Head-to-Head Record</dt><dd>Boff checks whether any remaining results could change a team’s playoff status. Tied records stay undecided until the bracket confirms them.</dd>
        <dt>Use Official Bracket Week</dt><dd>Boff grades both markets in the week the official bracket is set. This is also the fallback when an earlier clinch or elimination can’t be confirmed.</dd>
      </dl>
    </>,
  },
  pick: {
    title: "Draft #1 Pick",
    content: <p>Dynasty leagues can grade this market using regular-season last place or the Toilet Bowl result. The winning selection is the team that earned the pick. Boff also shows the current pick holder when Sleeper provides it.</p>,
  },
  rosters: {
    title: "Rosters Are Ready",
    content: <p>Check this after roster mapping is complete and you’re ready to publish eligible futures. Confirming changes immediately recalculates the board. Clearing this setting returns the board to Draft.</p>,
  },
};

function RuleHelp({ topic }: { topic: keyof typeof help }) {
  return <InfoPopover title={help[topic].title}>{help[topic].content}</InfoPopover>;
}

export function FuturesRules() {
  const leagueId = live()?.leagueId;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!leagueId) return;
    let active = true;
    void auth.rpc("dev_futures_rules", { p_league: leagueId }).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      else {
        setSettings(data);
        setDraft(data.rules);
      }
    });
    return () => { active = false; };
  }, [leagueId]);
  async function rebuild(revision: number) {
    const { data, error } = await auth.functions.invoke("boff-dev-live-refresh", {
      body: { action: "refresh_futures", revision, leagueId },
    });
    if (error || !data?.board) {
      setRetry(true);
      setMessage("Rules saved. The board refresh couldn’t be confirmed. Retry the refresh.");
      return;
    }
    const session = live();
    if (session) {
      session.futuresBoard = data.board;
      session.futuresQuotes = data.quotes;
    }
    setRetry(false);
    setMessage(data.board.status === "published" ? "Futures board refreshed and published."
      : data.board.status === "closed" ? "Futures board refreshed. Betting is closed." : "Futures board refreshed. Status: Draft.");
  }
  async function save() {
    if (!settings || !draft || saving) return;
    setSaving(true);
    setMessage("");
    setRetry(false);
    const { data, error } = await auth.rpc("dev_futures_rules", {
      p_league: leagueId, p_revision: settings.revision, p_rules: draft, p_confirmed: true,
    });
    if (error) setMessage(error.message);
    else {
      setSettings(data);
      setDraft(data.rules);
      setConfirming(false);
      setMessage("Rules saved. Recalculating the futures board…");
      await rebuild(data.revision);
    }
    setSaving(false);
  }
  return (
    <section className="panel form-panel futures-rule-settings">
      <h2>Season Futures Rules</h2>
      {settings && draft && <>
        <dl className="review-summary futures-rule-summary">
          <div><dt>Season</dt><dd>{settings.season}</dd></div>
          <div><dt>League Size</dt><dd>{settings.leagueSize ?? "Pending"}</dd></div>
          <div><dt>Playoff Teams</dt><dd>{settings.sleeper?.playoffTeams ?? "Pending"}</dd></div>
          <div><dt>Playoffs Start</dt><dd>{settings.sleeper?.playoffWeekStart ? `Week ${settings.sleeper.playoffWeekStart}` : "Pending"}</dd></div>
        </dl>
        <form onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
          <div className="preferences-fields futures-rule-fields">
            <div><div className="futures-rule-label"><label htmlFor="futures-timing">Playoff Timing Rule</label><RuleHelp topic="timing" /></div>
              <select id="futures-timing" disabled={saving} value={draft.qualification} onChange={(e) => setDraft({ ...draft, qualification: e.target.value as Rules["qualification"] })}>
                <option value="sleeper">Use Sleeper Settings</option>
                <option value="head_to_head">Head-to-Head Record</option>
                <option value="official_bracket">Use Official Bracket Week</option>
              </select>
            </div>
            <div><div className="futures-rule-label"><label htmlFor="futures-draft-pick">Draft #1 Pick</label><RuleHelp topic="pick" /></div>
              <select id="futures-draft-pick" disabled={saving} value={draft.firstPick} onChange={(e) => setDraft({ ...draft, firstPick: e.target.value as Rules["firstPick"] })}>
                <option value="disabled">Disabled</option>
                <option value="regular_season" disabled={settings.sleeper?.leagueType !== 2}>Regular-Season Last Place</option>
                <option value="toilet_bowl" disabled={settings.sleeper?.leagueType !== 2}>Toilet Bowl Result</option>
              </select>
            </div>
          </div>
          <div className="futures-rule-footer">
            <div className="futures-rule-label">
              <Toggle label="Rosters Are Ready" disabled={saving} checked={draft.rostersReady}
                onChange={()=>setDraft({...draft,rostersReady:!draft.rostersReady})}/>
              <RuleHelp topic="rosters" />
            </div>
            <button className="button primary" disabled={saving || (draft.qualification === settings.rules.qualification &&
              draft.firstPick === settings.rules.firstPick && draft.rostersReady === settings.rules.rostersReady)}>Review Changes</button>
          </div>
        </form>
      </>}
      {message && <p role="status">{message}</p>}
      {retry && settings && <button className="button quiet" disabled={saving} onClick={async () => {
        setSaving(true);
        setMessage("Recalculating the futures board…");
        await rebuild(settings.revision);
        setSaving(false);
      }}>Retry Board Refresh</button>}
      {confirming && <Modal title="Confirm Futures Rules" onClose={() => setConfirming(false)}>
        <p>Save these settings and recalculate the futures board now?</p>
        {message && <p role="status">{message}</p>}
        <button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Confirm and Refresh"}</button>
      </Modal>}
    </section>
  );
}

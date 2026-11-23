import { auth, live } from "./live";
import { featuredAssignment } from "./model";
import { useEffect, useState } from "react";
import { league, teams, matchups } from "./model";
import { featureCatalog, featurePriority } from "./featuredOptions";
import type { FeatureKind } from "./featuredOptions";
import {
  getFeatureSettings,
  defaultFeatureSettings,
  cleanWeekPlans,
  validCutoffs,
  saveFeatureSettings,
  selectFeatureAssignments,
  rivalTeams,
  divisionRivals,
  historyRivals,
  standingsRivals,
  validRivals,
  featureSettingsForWeek,
  putWeekPlan,
} from "./featuredRules";
import type {
  Cutoffs,
  RivalPair,
  FeatureSettings,
  WeekPlan,
  PlayoffMode,
} from "./featuredRules";
import { FeatureBadge } from "./FeatureBadge";
import { Avatar } from "./Markets";
import { Icon, Modal, Toggle, InfoPopover } from "./ui";
import { scheduledMatches, plannedFeature } from "./featuredPlanning";
import featuredSource from "./featured-source.json";
import seasonSchedule from "./featured-schedule.json";
function useCommissionerFeatureSettings(notify: (message:string)=>void){
  const leagueId=live()?.leagueId as string|undefined;
  const [settings,setSettings]=useState(()=>leagueId?defaultFeatureSettings():getFeatureSettings());
  const [revision,setRevision]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!leagueId)return;
    let active=true;
    void auth.rpc("dev_feature_settings",{p_league:leagueId,p_season:Number(league.season)}).then(({data,error})=>{
      if(!active)return;
      if(error){notify(error.message);return;}
      if(data.settings)setSettings(featureSettingsForWeek(data.settings,league.week));
      setRevision(data.revision);
    });
    return ()=>{active=false;};
  },[leagueId]);
  async function persist(next:FeatureSettings){
    if(!validCutoffs(next.cutoffs))throw Error("Enter valid numeric eligibility cutoffs before saving.");
    if(!validRivals(next.rivals))throw Error("Each team can have up to three rival teams.");
    if(!leagueId){saveFeatureSettings(next);return;}
    if(revision===null||busy)throw Error("Wait for league settings to load.");
    setBusy(true);
    try{
      const {data,error}=await auth.rpc("dev_feature_settings",{
        p_league:leagueId,p_season:Number(league.season),p_revision:revision,
        p_settings:{...next,plans:cleanWeekPlans(next.plans)},
      });
      if(error)throw Error(error.message);
      setRevision(data.revision);
      setSettings(featureSettingsForWeek(data.settings,league.week));
    }finally{setBusy(false);}
  }
  return {settings,setSettings,persist,disabled:!!leagueId&&(revision===null||busy)};
}
function ChampionshipContext() {
  const prior = featuredSource.previousChampionship;
  if (!prior)
    return <span className="field-note">No Verified Prior Championship</span>;
  const weeks = seasonSchedule.weeks
    .filter((w) =>
      w.pairs.some(
        (pair) =>
          pair.includes(prior.champion.roster!) &&
          pair.includes(prior.runnerUp.roster!),
      ),
    )
    .map((w) => w.week);
  return (
    <div className="championship-rule-context">
      {[
        ["Champion", prior.champion],
        ["Runner-Up", prior.runnerUp],
      ].map(([role, person]) => {
        const p = person as typeof prior.champion,
          t = teams.find((t) => t.roster_id === p.roster);
        return (
          <span
            className="championship-person"
            key={String(role)}
            title={t ? "Current Team: " + t.name : undefined}
          >
            {t && <Avatar team={t} small />}
            <span>
              <small>
                {prior.season} {String(role)}
              </small>
              <strong>{t?.name??p.name}{t&&t.name!==p.name?` (${p.name})`:""}</strong>
            </span>
          </span>
        );
      })}
      <span className="championship-meeting">
        <small>This Season</small>
        <strong>
          {weeks.length
            ? `${weeks.length === 1 ? "Week" : "Weeks"} ${weeks.join(", ")}`
            : "No Scheduled Meeting"}
        </strong>
      </span>
    </div>
  );
}
const fields: Record<
  FeatureKind,
  {
    key: keyof Cutoffs;
    label: string;
    min: number;
    max: number;
    step: number;
  }[]
> = {
  championship: [],
  rivalry: [],
  game: [],
  tank: [
    {
      key: "tankStart",
      label: "Start Week",
      min: 1,
      max: league.regularSeasonWeeks,
      step: 1,
    },
    {
      key: "tankPct",
      label: "Combined Win % At Most",
      min: 0,
      max: 100,
      step: 0.1,
    },
  ],
  playoff: [
    {
      key: "playoffWeeks",
      label: "Final Regular-Season Weeks",
      min: 1,
      max: league.regularSeasonWeeks,
      step: 1,
    },
    {
      key: "playoffGap",
      label: "Wins From Final Playoff Place",
      min: 0,
      max: league.regularSeasonWeeks,
      step: 0.5,
    },
  ],
  upset: [
    {
      key: "upsetStart",
      label: "Start Week",
      min: 1,
      max: league.regularSeasonWeeks,
      step: 1,
    },
    {
      key: "upsetOutside",
      label: "Underdog Outside Top %",
      min: 1,
      max: 99,
      step: 1,
    },
    { key: "upsetTop", label: "Opponent In Top %", min: 1, max: 99, step: 1 },
    {
      key: "upsetGap",
      label: "Pre-Scoring Projection Gap % At Most",
      min: 0,
      max: 100,
      step: 0.1,
    },
  ],
  revenge: [
    {
      key: "revengeMargin",
      label: "Previous Loss Margin At Most",
      min: 0,
      max: 200,
      step: 0.5,
    },
  ],
  streak: [
    {
      key: "streakWins",
      label: "Winning Streak At Least",
      min: 1,
      max: league.regularSeasonWeeks,
      step: 1,
    },
  ],
};
export function FeaturedCommissioner({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const {settings,setSettings,persist,disabled}=useCommissionerFeatureSettings(notify);
  const [week, setWeek] = useState(league.week),
    [cutoffDraft, setCutoffDraft] = useState<FeatureSettings | null>(null);
  const games = scheduledMatches(week),
    weekly = featureSettingsForWeek(settings, week),
    isCurrent = week === league.week,
    isPast = week < league.week;
  const active = isCurrent
    ? live() ? new Map(matchups.map(m => [m.id, featuredAssignment(m)])) : selectFeatureAssignments(matchups, teams, weekly)
    : new Map(games.map((m) => [m.id, plannedFeature(m, week, settings)]));
  const cap = Math.floor(games.length / 2),
    presets = Object.keys(weekly.overrides).length;
  const updatePlan = (transform: (p: WeekPlan) => WeekPlan) =>
    setSettings((s) => {
      const local = featureSettingsForWeek(s, week);
      return putWeekPlan(
        s,
        week,
        transform({
          overrides: { ...local.overrides },
          playoffModes: { ...local.playoffModes },
        }),
      );
    });
  const save = async () => {
    try {
      await persist(settings);
      notify("Matchup presets saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Check the settings.");
    }
  };
  const saveCutoffs = async () => {
    if (!cutoffDraft) return;
    try {
      await persist({
        ...settings,
        cutoffs: cutoffDraft.cutoffs,
        enabled: cutoffDraft.enabled,
      });
      setSettings((s) => ({
        ...s,
        cutoffs: cutoffDraft.cutoffs,
        enabled: cutoffDraft.enabled,
      }));
      setCutoffDraft(null);
      notify("Matchup rules saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Check the cutoffs.");
    }
  };
  return (
    <section className="panel feature-assignment-panel compact-feature-planner">
      {live() && <p className="field-note">Current-week badges show published boosts. Saved presets and rivalries apply on the next board refresh.</p>}
      <div className="feature-toolbar">
        <h2>Week {week} Assignments</h2>
        <button
          className="button secondary compact-button"
          onClick={() => setCutoffDraft(structuredClone(settings))}
        >
          <Icon name="settings" size={15} />
          Configure Matchup Rules
        </button>
      </div>
      <nav className="feature-week-picker" aria-label="Assignment Week">
        {Array.from({ length: league.regularSeasonWeeks }, (_, i) => i + 1).map(
          (w) => (
            <button
              key={w}
              aria-label={
                "Week " + w + (w === league.week ? " · Current Week" : "")
              }
              aria-pressed={week === w}
              className={
                (week === w ? "selected " : "") +
                (w === league.week ? "current-week " : "") +
                (Object.keys(featureSettingsForWeek(settings, w).overrides)
                  .length
                  ? "has-presets"
                  : "")
              }
              onClick={() => setWeek(w)}
            >
              <span className="feature-week-prefix">Week </span>{w}
            </button>
          ),
        )}
      </nav>
      <div className="feature-week-summary">
        <span>
          {isCurrent
            ? "Current Week"
            : isPast
              ? "Past Week · Saved Presets Only"
              : "Future Week · Eligibility Rechecked At Opening"}
        </span>
        <span>
          {isCurrent
            ? [...active.values()].filter(
                (a) => a?.source === "Automatic" && a.kind !== "rivalry",
              ).length +
              " / " +
              cap +
              " Non-Rivalry Auto"
            : presets + " Saved Presets"}
        </span>
      </div>
      <div className="feature-grid-heading" aria-hidden="true">
        <span>Matchup</span>
        <span>Feature</span>
        <span>Assignment</span>
      </div>
      {games.map((m) => {
        const a = active.get(m.id);
        const current = Object.prototype.hasOwnProperty.call(
          weekly.overrides,
          m.id,
        )
          ? (weekly.overrides[m.id] ?? "none")
          : "auto";
        const pending =
          current !== "auto" && current !== "none"
            ? (current as FeatureKind)
            : null;
        return (
          <div
            className="feature-assignment-row"
            key={m.id}
            data-planned-matchup={m.id}
          >
            <div className="feature-fixture">
              <div>
                <Avatar team={m.away} small />
                <strong>{m.away.name}</strong>
              </div>
              <div>
                <Avatar team={m.home} small />
                <span>{m.home.name}</span>
              </div>
            </div>
            <div className="feature-assignment-summary" title={a?.reason}>
              {a || (pending && !(live() && isCurrent)) ? (
                <>
                  <FeatureBadge kind={a?.kind || pending!} label={a?.label} />
                  <small>
                    {isPast
                      ? "Saved Preset"
                      : !isCurrent
                        ? a?.source === "Automatic"
                          ? "Auto At Opening"
                          : "Scheduled"
                        : a?.source || "Pending"}{" "}
                    ·{" "}
                    {a?.market === "over"
                      ? "Match-Total Over"
                      : a?.targets.length === 2
                        ? "Both Moneylines"
                        : a?.targets.length === 1
                          ? teams.find((t) => t.id === a.targets[0])?.name +
                            " Moneyline"
                          : "Recipient At Week Opening"}
                  </small>
                </>
              ) : (
                <span className="muted">
                  {isCurrent
                    ? "No Boost Assigned"
                    : current === "none"
                      ? "No Boost Assigned"
                      : isPast
                        ? "No Saved Preset"
                        : "Automatic At Week Opening"}
                </span>
              )}
            </div>
            <div className="feature-row-controls">
              <select
                aria-label={"Assignment For " + m.id}
                disabled={isPast}
                value={current}
                onChange={(e) =>
                  updatePlan((p) => {
                    const overrides = { ...p.overrides },
                      playoffModes = { ...p.playoffModes };
                    if (e.target.value === "auto") delete overrides[m.id];
                    else
                      overrides[m.id] =
                        e.target.value === "none"
                          ? null
                          : (e.target.value as FeatureKind);
                    if (e.target.value === "playoff" && !playoffModes[m.id])
                      playoffModes[m.id] = isCurrent ? "both" : "auto";
                    return { overrides, playoffModes };
                  })
                }
              >
                <option value="auto">Automatic</option>
                <option value="none">No Boost</option>
                {featurePriority.map((k) => (
                  <option value={k} key={k}>
                    {featureCatalog[k].label} · {featureCatalog[k].boost}%
                  </option>
                ))}
              </select>
              {current === "playoff" && (
                <select
                  aria-label={"Playoff Context For " + m.id}
                  disabled={isPast}
                  value={
                    weekly.playoffModes?.[m.id] || (isCurrent ? "both" : "auto")
                  }
                  onChange={(e) =>
                    updatePlan((p) => ({
                      ...p,
                      playoffModes: {
                        ...p.playoffModes,
                        [m.id]: e.target.value as PlayoffMode,
                      },
                    }))
                  }
                >
                  <option value="auto">Decide At Week Opening</option>
                  <option value="both">Both Teams In Race</option>
                  <option value="away-racing">
                    {m.away.name} In Race · Opponent Boosted
                  </option>
                  <option value="home-racing">
                    {m.home.name} In Race · Opponent Boosted
                  </option>
                </select>
              )}
              {current === "revenge" && !a && isCurrent && (
                <small>Earlier Result Required</small>
              )}
            </div>
          </div>
        );
      })}
      {!games.length && (
        <p className="field-note">
          Sleeper Has Not Published Matchups For This Week.
        </p>
      )}
      <div className="feature-planner-footer">
        <small>
          Rivalries Exempt From Auto Cap · Manual Assignments Can Exceed It
        </small>
        <button
          className="button primary compact-button"
          disabled={isPast || disabled}
          onClick={()=>void save()}
        >
          Save Presets
        </button>
      </div>
      {cutoffDraft && (
        <Modal
          title="Configure Matchup Rules"
          onClose={() => setCutoffDraft(null)}
          wide
          className="feature-cutoff-modal"
        >
          <form
            className="feature-cutoffs compact-cutoffs"
            onSubmit={(e) => {
              e.preventDefault();
              saveCutoffs();
            }}
          >
            <p className="locked-rules">
              <Icon name="shield" size={14} />
              Automatic assignments lock when NFL scoring begins. Changes after kickoff apply to future weeks.
            </p>
            {featurePriority.map((kind, i) => {
              const c = featureCatalog[kind];
              return (
                <section className="feature-rule-editor" key={kind}>
                    <div className="feature-enabled">
                      <Toggle label="Automatic" checked={cutoffDraft.enabled[kind]} onChange={()=>
                        setCutoffDraft(draft=>draft&&({...draft,enabled:{...draft.enabled,[kind]:!draft.enabled[kind]}}))}/>
                    </div>
                  <div className="feature-rule-description">
                    <div
                      className="feature-rule-title"
                      title={c.market + ". " + c.rule}
                    >
                      <span className="feature-priority-position">{i + 1}</span>
                      <FeatureBadge kind={kind} /><InfoPopover title={c.label}><p>{c.rule}</p></InfoPopover>
                    </div>
                    <small>{c.market}</small>

                  </div>
                  <div className="feature-cutoff-inputs">
                    {fields[kind].map((f) => (
                      <label key={f.key}>
                        {f.label}
                        <input
                          type="number"
                          aria-label={c.label + ": " + f.label}
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          required
                          value={cutoffDraft.cutoffs[f.key]}
                          onChange={(e) =>
                            setCutoffDraft(
                              (s) =>
                                s && {
                                  ...s,
                                  cutoffs: {
                                    ...s.cutoffs,
                                    [f.key]:
                                      e.target.value === ""
                                        ? NaN
                                        : Number(e.target.value),
                                  },
                                },
                            )
                          }
                        />
                      </label>
                    ))}
                    {kind === "championship" ? (
                      <ChampionshipContext />
                    ) : (
                      !fields[kind].length && (
                        <span className="field-note">
                          {kind === "rivalry"
                            ? "Manage Pairings In Rivalries"
                            : "Fixed Matchup Rating"}
                        </span>
                      )
                    )}
                  </div>
                </section>
              );
            })}
            <p className="field-note">
              Automatic playoff stories wait for verified qualification status.
              Future presets do not store odds or forecasts.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary compact-button"
                onClick={() => setCutoffDraft(null)}
              >
                Cancel
              </button>
              <button className="button primary compact-button" type="submit">
                Save Rules
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function RivalriesPanel({ notify }: { notify: (s: string) => void }) {
  const {settings,setSettings,persist,disabled}=useCommissionerFeatureSettings(notify);
  const [error, setError] = useState(""),
    [showHelp, setShowHelp] = useState(false);
  const hasDivisions = rivalTeams.some((p) => p.division != null);
  const pairs = settings.rivals;
  const rivalsFor = (id: string) =>
    pairs
      .filter((pair) => pair.includes(id))
      .map((pair) => pair.find((other) => other !== id)!);
  const change = (user: string, slot: number, id: string) => {
    const previous = rivalsFor(user)[slot];
    const next = pairs.filter(
      (pair) => !(previous && pair.includes(user) && pair.includes(previous)),
    );
    if (id) next.push([user, id]);
    if (!validRivals(next)) {
      setError(
        "Each team can have up to three rivals. Choose a team with a free slot.",
      );
      return;
    }
    setError("");
    setSettings((s) => ({ ...s, rivals: next as RivalPair[] }));
  };
  const populate = (method: "divisions" | "history" | "standings") => {
    const suggested =
      method === "divisions"
        ? divisionRivals(rivalTeams)
        : method === "history"
          ? historyRivals()
          : standingsRivals();
    setSettings((s) => ({ ...s, rivals: suggested }));
    setError("");
    notify(
      suggested.length
        ? "Rival Suggestions Loaded · Edit And Save When Ready"
        : "Not Enough League Data For These Suggestions",
    );
  };
  return (
    <section className="panel rivalry-management compact-rivalries">
      <div className="feature-toolbar">
        <h2>Rivalries</h2>
        <button
          className="text-button rivalry-help-button"
          aria-label="How Rivalry Boosts Work"
          onClick={() => setShowHelp(true)}
        >
          <Icon name="info" size={16} />
          How It Works
        </button>
      </div>
      <div className="rivalry-toolbar">
        <InfoPopover title="Auto-populate rivalries" label="Auto-Populate">
          <div className="rivalry-populate-options">
            <button disabled={!hasDivisions} onClick={()=>populate("divisions")}>Sleeper Divisions</button>
            <button onClick={()=>populate("history")}>Competitive History</button>
            <button onClick={()=>populate("standings")}>Similar Standings</button>
          </div>
        </InfoPopover>
        <button
          className="text-button"
          onClick={() => {
            setSettings((s) => ({ ...s, rivals: [] }));
            setError("");
          }}
        >
          Clear All
        </button>
        <button
          className="button primary compact-button"
          disabled={disabled}
          onClick={async () => {
            try {
              await persist(settings);
              notify("Rivalries saved.");
            } catch (e) {
              notify(e instanceof Error ? e.message : "Check the rivalries.");
            }
          }}
        >
          Save Rivalries
        </button>
        <span className="field-note">
          Up To Three Rival Teams · All Pairings Stay Editable
        </span>
      </div>
      <div className="rivalry-table-wrap">
        <table className="rivals-table"><colgroup><col className="rival-team-col"/><col className="rival-count-col"/><col/><col/><col/></colgroup>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Rivals</th>
              <th scope="col">Rival 1</th>
              <th scope="col">Rival 2</th>
              <th scope="col">Rival 3</th>
            </tr>
          </thead>
          <tbody>
            {rivalTeams.map((user) => {
              const team = teams.find((t) => t.roster_id === user.roster)!;
              const own = rivalsFor(user.id);
              return (
                <tr key={user.id} data-rival-team-id={user.id}>
                  <th scope="row">
                    <div className="rivalry-table-person">
                      <Avatar team={team} small />
                      <span title={team.manager}>
                        <strong>{team.name}</strong>
                      </span>
                    </div>
                  </th>
                  <td>{own.length}/3</td>
                  {[0, 1, 2].map((slot) => (
                    <td key={slot}>
                      <select
                        aria-label={user.name + ": Rival " + (slot + 1)}
                        value={own[slot] || ""}
                        onChange={(e) => change(user.id, slot, e.target.value)}
                      >
                        <option value="">No Rival</option>
                        {rivalTeams
                          .filter((p) => p.roster !== user.roster)
                          .map((p) => (
                            <option
                              key={p.id}
                              value={p.id}
                              disabled={
                                (own.includes(p.id) && own[slot] !== p.id) ||
                                (!own.includes(p.id) &&
                                  rivalsFor(p.id).length >= 3)
                              }
                            >
                              {p.name}
                              {rivalsFor(p.id).length >= 3 ? " · 3/3" : ""}
                            </option>
                          ))}
                      </select>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showHelp && (
        <Modal title="Rivalry Boosts" onClose={() => setShowHelp(false)}>
          <p>
            When rival teams meet, both moneylines automatically receive a 35%
            Profit Boost. Rivalries are exempt from the default 50% automatic
            featured-matchup cap.
          </p>
          <p>
            Each team can have up to three reciprocal rivals. Auto-Populate
            suggests pairings; edit or clear them, then save. Matchups receive
            one featured boost, with priority deciding overlaps.
          </p>
          <button className="button primary" onClick={() => setShowHelp(false)}>
            Got It
          </button>
        </Modal>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCapabilityReport } from "../../api/_lib/league-intake";
import {managerStatus} from '../../api/_lib/manager-status';
import type {
  IntakeSource,
  CapabilityReport,
} from "../../api/_lib/league-intake";
const errorMessage=(error:unknown)=>error&&typeof error==='object'&&'message' in error?String(error.message):'League intake is unavailable. Please try again.';
type Draft = {
  id: string;
  revision: number;
  state: "draft" | "imported" | "expired";
  source: Partial<IntakeSource>;
  capabilities: Partial<CapabilityReport>;
  created_at: string;
  expires_at: string;
  imported_league_id: string | null;
  source_league_id: string;
};
type LeagueChoice={id:string;name:string;season:number;teams:number;linked:boolean};
export function LeagueIntake({
  onImported,
  client,
  discoverLeagues = false,
}: {
  onImported?: () => Promise<void>;
  client: SupabaseClient | null;
  discoverLeagues?: boolean;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [selected, setSelected] = useState(""),
    [leagueId, setLeagueId] = useState(""),
    [season, setSeason] = useState("1"),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [importedReport, setImportedReport] = useState<CapabilityReport | null>(
    null,
  );
  const [request, setRequest] = useState(() => crypto.randomUUID());
  const [choices,setChoices]=useState<LeagueChoice[]>([]),[linked,setLinked]=useState<{sleeperId:string;name:string}[]>([]);
  const [discovering,setDiscovering]=useState(false),[discoveryNote,setDiscoveryNote]=useState('');
  const alive = useRef(true);
  const current = drafts.find((d) => d.id === selected) ?? drafts[0];
  const alreadyLinked=linked.some(row=>row.sleeperId===leagueId.trim());
  async function discover(signal?:AbortSignal){
    setDiscovering(true);setDiscoveryNote('');
    try{
      const session=await client!.auth.getSession();if(signal?.aborted)return;
      if(!session.data.session)throw Error('Sign in as the platform owner.');
      const response=await fetch('/api/league-intake',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.data.session.access_token},body:JSON.stringify({action:'discover'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      const data=await response.json();if(!response.ok)throw Error(data.error??'Your Sleeper leagues could not be loaded.');
      if(!alive.current||signal?.aborted)return;
      setChoices(data.leagues??[]);setLinked(data.linked??[]);
      setDiscoveryNote(!data.hasSleeperAccount?'No Sleeper account is linked to this Boff account yet. You can enter a league ID below.':!data.leagues.length?'No leagues were found for this season. You can still enter a league ID.':'');
    }catch(error){if(alive.current&&!signal?.aborted)setDiscoveryNote(errorMessage(error));}
    finally{if(alive.current&&!signal?.aborted)setDiscovering(false);}
  }
  async function load(signal?: AbortSignal) {
    const result = await client!
      .from("league_intake_drafts")
      .select(
        "id,revision,state,source,capabilities,created_at,expires_at,imported_league_id,source_league_id",
      )
      .order("created_at", { ascending: false })
      .limit(16)
      .abortSignal(signal ?? AbortSignal.timeout(15000));
    if (result.error) throw result.error;
    if (
      !Array.isArray(result.data) ||
      result.data.length > 16 ||
      new TextEncoder().encode(JSON.stringify(result.data)).length > 400000
    )
      throw Error("Intake directory exceeds its read budget.");
    for (const draft of result.data) {
      if (draft.state === "draft") {
        if (
          draft.source?.contract !== "sleeper-nfl-intake-v1" ||
          typeof draft.source?.name !== "string"
        )
          throw Error("Draft provider contract is incomplete.");
        validateCapabilityReport(draft.capabilities);
      }
    }
    if (alive.current && !signal?.aborted) setDrafts(result.data as Draft[]);
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        await load(
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        );
        if (!controller.signal.aborted) setReady(true);
      } catch (e) {
        if (!controller.signal.aborted) setNotice(errorMessage(e));
      }
    })();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);
  useEffect(()=>{
    if(!discoverLeagues)return;
    const controller=new AbortController();void discover(controller.signal);
    return()=>controller.abort();
  },[discoverLeagues]);
  async function preview(fresh = false) {
    if (busy) return;
    const key = fresh ? crypto.randomUUID() : request;
    if (fresh) setRequest(key);
    setBusy(true);
    setNotice("");
    try {
      if(alreadyLinked)throw Error('This Sleeper league is already connected. Review its existing setup or renewal.');
      if (!/^\d{1,32}$/.test(leagueId.trim()))
        throw Error("Enter the numeric Sleeper league ID.");
      const session = await client!.auth.getSession();
      if (!session.data.session) throw Error("Sign in as the platform owner.");
      const response = await fetch("/api/league-intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.data.session.access_token,
        },
        body: JSON.stringify({ sleeper_league_id: leagueId.trim(), request_key: key }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error ?? "Intake preview unavailable.");
      if (!data.id || !["draft", "imported", "expired"].includes(data.state))
        throw Error("Intake preview receipt is incomplete.");
      if (!alive.current) return;
      await load();
      if (!alive.current) return;
      setSelected(data.id);
      setAck(false);
      setNotice("Draft saved. Review the rule report before importing.");
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function readImportedReport() {
    if (!current?.imported_league_id || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await client!
        .from("leagues")
        .select("provider_contract")
        .eq("id", current.imported_league_id)
        .abortSignal(AbortSignal.timeout(15000))
        .maybeSingle();
      if (result.error) throw result.error;
      const contract = result.data?.provider_contract;
      if (
        contract?.version !== 1 ||
        new TextEncoder().encode(JSON.stringify(contract)).length > 32768
      )
        throw Error("Imported provider contract is unavailable.");
      const report = validateCapabilityReport(contract.capabilities);
      if (alive.current) setImportedReport(report);
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function importDraft() {
    if (busy || !current || current.state !== "draft" || !ack) return;
    setBusy(true);
    setNotice("");
    try {
      if (
        reason.trim().length < 8 ||
        !/^\d{1,3}$/.test(season) ||
        Number(season) < 1 ||
        Number(season) > 100
      )
        throw Error(
          "Enter a league season and a review reason of at least 8 characters.",
        );
      const result = await client!
        .rpc("import_league_intake_draft", {
          p_draft: current.id,
          p_expected: current.revision,
          p_league_season: Number(season),
          p_reason: reason.trim(),
        })
        .abortSignal(AbortSignal.timeout(20000));
      if (result.error) throw result.error;
      if (!result.data?.league_id || result.data.operations_enabled !== false)
        throw Error("Inactive import receipt is unavailable.");
      if (!alive.current) return;
      await load();
      if (!alive.current) return;
      setAck(false);
      setNotice(
        "Draft league imported. Settings approval and verified participant claims remain pending.",
      );
      await onImported?.();
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section aria-label="League intake">
      <h2>Import a league draft</h2>
      <p>
        Preview Sleeper rules and real fantasy teams. Importing keeps operations
        paused and grants no participant or staff access.
      </p>
      {discoverLeagues&&<section className="intake-discovery" aria-label="Your Sleeper Leagues">
        <div className="intake-section-heading"><h3>Your Sleeper Leagues</h3><button type="button" className="button secondary" disabled={discovering||busy} onClick={()=>void discover()}>{discovering?'Loading…':'Refresh Leagues'}</button></div>
        <p className="field-note">Choose a league from your linked Sleeper account, or enter its ID below.</p>
        {choices.length>0&&<div className="intake-league-list">{choices.map(choice=><div className="intake-league-row" key={choice.id}>
          <span><strong>{choice.name}</strong><small>{choice.season} · {choice.teams} Teams</small></span>
          {choice.linked?<span className="badge">Already Connected</span>:<button type="button" className="button secondary" disabled={busy} onClick={()=>{setLeagueId(choice.id);setRequest(crypto.randomUUID());setNotice('League selected. Preview its rules and managers below.');}}>Select League</button>}
        </div>)}</div>}
        {discoveryNote&&<p role="status">{discoveryNote}</p>}
      </section>}
      <label>
        Sleeper league ID
        <input
          aria-label="Sleeper league ID"
          inputMode="numeric"
          maxLength={32}
          value={leagueId}
          disabled={busy}
          onChange={(e) => {
            setLeagueId(e.target.value);
            setRequest(crypto.randomUUID());
          }}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy || !ready || alreadyLinked}
        onClick={() => void preview()}
      >
        Preview league import
      </button>
      <button
        className="button secondary"
        disabled={busy || !ready || alreadyLinked || !/^\d{1,32}$/.test(leagueId.trim())}
        onClick={() => void preview(true)}
      >
        Refresh provider preview
      </button>
      {alreadyLinked&&<p role="status">This Sleeper league is already connected. Review its existing setup or renewal.</p>}
      {drafts.length > 0 && (
        <label>
          Saved intake draft
          <select
            aria-label="Saved intake draft"
            value={current?.id ?? ""}
            disabled={busy}
            onChange={(e) => {
              setSelected(e.target.value);
              setAck(false);
              setReason("");
              setImportedReport(null);
            }}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.source.name ?? d.source_league_id} · {d.state}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <>
          {current.state === "draft" ? (
            <>
              <h3>
                {current.source.name} · NFL {current.source.season}
              </h3>
              <p>
                {current.source.total_rosters} fantasy teams · provider contract{" "}
                {current.source.contract} · activation review required
              </p>
              <section className="intake-managers" aria-label="Sleeper Managers"><h3>Teams And Managers</h3>
                <p className="field-note">Manager status comes from Sleeper. Linking a Boff account and granting commissioner permissions are separate steps.</p>
                <div className="intake-manager-grid">{current.source.teams?.map(team=><section className="intake-team" key={team.roster_id}>
                  <h4>{team.team_name}</h4>
                  <div className="intake-manager-row"><strong>{team.owner_name}</strong><span className="badge">{managerStatus(false,team.co_owner_ids.length,!!team.owner_id)}</span></div>
                  {team.co_owner_ids.map((id,index)=><div className="intake-manager-row" key={id}><strong>{team.co_owner_names[index]}</strong><span className="badge">Co-Manager</span></div>)}
                </section>)}</div>
              </section>
              <p>
                Draft expires {new Date(current.expires_at).toLocaleString()}.
                Public Sleeper owner names and IDs never prove a sportsbook
                claim.
              </p>
              <ul>
                {current.capabilities.families?.map((f) => (
                  <li key={f.name}>
                    <strong>{f.name}</strong>:{" "}
                    {f.state === "input_compatible"
                      ? "Input shape compatible; runtime review pending"
                      : f.state === "blocked"
                        ? "Blocked pending support review"
                        : "Review required"}
                  </li>
                ))}
              </ul>
              <ul>
                {current.capabilities.issues?.map((i) => (
                  <li key={i.code}>{i.detail}</li>
                ))}
              </ul>
              <label>
                Sportsbook league season
                <input
                  aria-label="Sportsbook league season"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={season}
                  disabled={busy}
                  onChange={(e) => setSeason(e.target.value)}
                />
              </label>
              <label>
                Import review reason
                <textarea
                  aria-label="Import review reason"
                  minLength={8}
                  maxLength={400}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  aria-label="Confirm inactive draft import"
                  checked={ack}
                  disabled={busy}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I reviewed the report. Import remains inactive until settings
                and participant claims are approved.
              </label>
              <button
                className="button primary"
                disabled={busy || !ack || reason.trim().length < 8}
                onClick={() => void importDraft()}
              >
                Import inactive league draft
              </button>
            </>
          ) : (
            <>
              <p>
                {current.state === "imported"
                  ? "Imported league is available in the league selector with operations disabled."
                  : "This draft expired; preview the provider league again with a fresh request."}
              </p>
              {current.state === "imported" && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void readImportedReport()}
                >
                  View imported capability report
                </button>
              )}
              {importedReport && (
                <ul>
                  {importedReport.issues.map((i) => (
                    <li key={i.code}>{i.detail}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

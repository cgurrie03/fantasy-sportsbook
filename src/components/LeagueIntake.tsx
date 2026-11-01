import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import { validateCapabilityReport } from "../../api/_lib/league-intake";
import type {
  IntakeSource,
  CapabilityReport,
} from "../../api/_lib/league-intake";
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
export function LeagueIntake({
  onImported,
}: {
  onImported?: () => Promise<void>;
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
  const alive = useRef(true);
  const current = drafts.find((d) => d.id === selected) ?? drafts[0];
  async function load(signal?: AbortSignal) {
    const result = await supabase!
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
  async function preview(fresh = false) {
    if (busy) return;
    const key = fresh ? crypto.randomUUID() : request;
    if (fresh) setRequest(key);
    setBusy(true);
    setNotice("");
    try {
      if (!/^\d{1,32}$/.test(leagueId))
        throw Error("Enter the numeric Sleeper league ID.");
      const session = await supabase!.auth.getSession();
      if (!session.data.session) throw Error("Sign in as the platform owner.");
      const response = await fetch("/api/league-intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.data.session.access_token,
        },
        body: JSON.stringify({ sleeper_league_id: leagueId, request_key: key }),
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
      const result = await supabase!
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
      const result = await supabase!
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
        className="secondary"
        disabled={busy || !ready}
        onClick={() => void preview()}
      >
        Preview league import
      </button>
      <button
        className="secondary"
        disabled={busy || !ready || !/^\d{1,32}$/.test(leagueId)}
        onClick={() => void preview(true)}
      >
        Refresh provider preview
      </button>
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
                className="primary"
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
                  className="secondary"
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

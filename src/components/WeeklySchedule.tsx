import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import { emailLabels, renderEmail, sampleEmail } from "../lib/emailTemplates";
import type { EmailKind } from "../lib/emailTemplates";
import "./Sportsbook.css";
interface Settings {
  publication_paused: boolean;
  opening_email: boolean;
  reminder_email: boolean;
  recap_email: boolean;
  opening_time: string;
  reminder_time: string;
  recap_time: string;
  automation_enabled: boolean;
}
const defaults: Settings = {
  publication_paused: false,
  opening_email: true,
  reminder_email: true,
  recap_email: true,
  opening_time: "08:00",
  reminder_time: "19:00",
  recap_time: "08:15",
  automation_enabled: false,
};
interface Preview {
  week: number;
  mode: string;
  tickets: {
    ticket_id: string;
    market_week: number;
    pending: boolean;
    legs: { id: string; status: string; evidence: string }[];
  }[];
  note: string;
}
export function WeeklySchedule({
  leagueId,
  reviewMode = false,
}: {
  leagueId: string;
  reviewMode?: boolean;
}) {
  const [settings, setSettings] = useState(defaults),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null);
  const [runs, setRuns] = useState<
    { id: string; operation: string; market_week: number; created_at: string }[]
  >([]);
  const [emailKind, setEmailKind] = useState<EmailKind>("opening");
  const email = sampleEmail(emailKind);
  function emailButton(kind: EmailKind) {
    return (
      <button
        className="email-preview-button"
        onClick={() => {
          setEmailKind(kind);
          document
            .getElementById("email-template-preview")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        Preview
      </button>
    );
  }
  useEffect(() => {
    if (reviewMode) return;
    let active = true;
    void Promise.all([
      supabase!
        .from("weekly_schedule")
        .select("*")
        .eq("league_id", leagueId)
        .maybeSingle(),
      supabase!
        .from("weekly_execution_runs")
        .select("id,operation,market_week,created_at")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(20),
    ])
      .then(([schedule, logs]) => {
        if (!active) return;
        if (schedule.error || logs.error) {
          setNotice(
            "Weekly execution setup has not been applied yet. The schedule below is your approved plan.",
          );
          return;
        }
        if (schedule.data) {
          setSettings(schedule.data as Settings);
          setReady(true);
        }
        setRuns(logs.data ?? []);
      })
      .catch((e) => {
        if (active) setNotice(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [leagueId, reviewMode]);
  async function save() {
    setBusy(true);
    try {
      const r = await supabase!.rpc("configure_weekly_schedule", {
        p_league: leagueId,
        p_paused: settings.publication_paused,
        p_opening: settings.opening_email,
        p_reminder: settings.reminder_email,
        p_recap: settings.recap_email,
        p_opening_time: settings.opening_time,
        p_reminder_time: settings.reminder_time,
        p_recap_time: settings.recap_time,
      });
      if (r.error) throw r.error;
      setNotice(
        "Schedule preferences saved. Background execution is not activated yet.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    if (reviewMode) {
      setPreview({
        week: 5,
        mode: "preview",
        tickets: [
          {
            ticket_id: "EXAMPLE-01",
            market_week: 5,
            pending: true,
            legs: [
              {
                id: "example",
                status: "OPEN",
                evidence: "Waiting for confirmed weekly results.",
              },
            ],
          },
        ],
        note: "Sample execution preview. No tickets, balances, or emails were changed.",
      });
      return;
    }
    setBusy(true);
    try {
      const session = (await supabase!.auth.getSession()).data.session;
      if (!session) throw new Error("Sign in again.");
      const r = await fetch("/api/weekly-execution", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ league_id: leagueId }),
      });
      const text = await r.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(
          "Weekly execution could not start. Check the deployment logs.",
        );
      }
      if (!r.ok) throw new Error(result.error);
      setPreview(result as Preview);
      setNotice(
        "Preview complete. No tickets, balances, or emails were changed.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="weekly-schedule">
      <p className="schedule-status">
        <strong>
          {settings.automation_enabled
            ? "Automation Active"
            : "Automation Not Activated"}
        </strong>{" "}
        · All times Eastern
      </p>
      {notice && <p role="status">{notice}</p>}
      <div className="schedule-controls">
        <label>
          <input
            type="checkbox"
            checked={settings.publication_paused}
            onChange={(e) =>
              setSettings({ ...settings, publication_paused: e.target.checked })
            }
          />{" "}
          Pause automatic publication
        </label>
        <button
          className="primary"
          disabled={!ready || busy}
          onClick={() => void save()}
        >
          Save Schedule
        </button>
        <button
          disabled={(!ready && !reviewMode) || busy}
          onClick={() => void review()}
        >
          {busy ? "Working…" : "Preview Weekly Execution"}
        </button>
      </div>
      <p className="execution-preview-help">
        <strong>What does the preview do?</strong> It checks Sleeper results
        against accepted tickets, shows which legs are ready to settle or need
        review, and assesses replenishment eligibility. It does not settle bets,
        change balances, publish markets, or send emails.
      </p>
      <div className="schedule-table-wrap">
        <table className="schedule-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Execution</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>After Monday games finish</td>
              <td>Confirm results and settle resolved tickets</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Tuesday 7 AM</td>
              <td>Recheck unresolved results; flag admin review</td>
              <td>
                <span className="email-cell">
                  <span>Admin attention</span> {emailButton("attention")}
                </span>
              </td>
            </tr>
            <tr>
              <td>Tuesday 8 AM</td>
              <td>Replenish eligible balances; advance the week</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Tuesday–Wednesday</td>
              <td>Generate and refresh lines and featured matches</td>
              <td>—</td>
            </tr>
            <tr>
              <td>
                Wednesday{" "}
                <input
                  aria-label="Opening email time"
                  type="time"
                  value={settings.opening_time.slice(0, 5)}
                  onChange={(e) =>
                    setSettings({ ...settings, opening_time: e.target.value })
                  }
                />
              </td>
              <td>Publish automatically unless paused</td>
              <td>
                <span className="email-cell">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.opening_email}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          opening_email: e.target.checked,
                        })
                      }
                    />{" "}
                    Opening
                  </label>
                  {emailButton("opening")}
                </span>
              </td>
            </tr>
            <tr>
              <td>
                Thursday{" "}
                <input
                  aria-label="Reminder email time"
                  type="time"
                  value={settings.reminder_time.slice(0, 5)}
                  onChange={(e) =>
                    setSettings({ ...settings, reminder_time: e.target.value })
                  }
                />
              </td>
              <td>Check betting is open</td>
              <td>
                <span className="email-cell">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.reminder_email}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reminder_email: e.target.checked,
                        })
                      }
                    />{" "}
                    Reminder
                  </label>
                  {emailButton("reminder")}
                </span>
              </td>
            </tr>
            <tr>
              <td>Thursday 8 PM</td>
              <td>Close static weekly markets</td>
              <td>—</td>
            </tr>
            <tr>
              <td>
                Tuesday{" "}
                <input
                  aria-label="Recap email time"
                  type="time"
                  value={settings.recap_time.slice(0, 5)}
                  onChange={(e) =>
                    setSettings({ ...settings, recap_time: e.target.value })
                  }
                />
              </td>
              <td>Results, leaderboard, and updated balances</td>
              <td>
                <span className="email-cell">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.recap_email}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          recap_email: e.target.checked,
                        })
                      }
                    />{" "}
                    Recap
                  </label>
                  {emailButton("recap")}
                </span>
              </td>
            </tr>
            <tr>
              <td>When a ticket is accepted</td>
              <td>Save original selections and odds</td>
              <td>
                <span className="email-cell">
                  <span>Required confirmation</span> {emailButton("confirmation")}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section id="email-template-preview" className="email-template-preview">
        <div className="email-preview-heading">
          <h2>Email Templates</h2>
          <select
            aria-label="Email template"
            value={emailKind}
            onChange={(e) => setEmailKind(e.target.value as EmailKind)}
          >
            {(Object.keys(emailLabels) as EmailKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {emailLabels[kind]}
              </option>
            ))}
          </select>
        </div>
        <p>
          Sample content for approval. These templates are not connected to
          scheduled delivery yet; no emails are sent from this preview.
        </p>
        <div className="email-envelope">
          <span>
            <strong>From:</strong> Goldy Fantasy Sportsbook
            &lt;sportsbook@coopergurrie.com&gt;
          </span>
          <span>
            <strong>To:</strong>{" "}
            {emailKind === "attention"
              ? "League admin"
              : "The approved league member"}
          </span>
          <span>
            <strong>Subject:</strong> {email.subject}
          </span>
        </div>
        <iframe
          title={`${emailLabels[emailKind]} sample`}
          sandbox=""
          srcDoc={renderEmail(email)}
        />
      </section>
      {preview && (
        <section>
          <h2>Execution Preview · Week {preview.week}</h2>
          <p>{preview.note}</p>
          {preview.tickets.length === 0 ? (
            <p>No open weekly tickets need settlement.</p>
          ) : (
            preview.tickets.map((t) => (
              <details key={t.ticket_id}>
                <summary>
                  Week {t.market_week} · {t.ticket_id.slice(0, 8)} ·{" "}
                  {t.pending ? "Needs Review" : "Ready To Settle"}
                </summary>
                {t.legs.map((l) => (
                  <p key={l.id}>
                    <strong>{l.status}</strong> · {l.evidence}
                  </p>
                ))}
              </details>
            ))
          )}
        </section>
      )}
      <h2>Execution History</h2>
      {runs.length ? (
        runs.map((r) => (
          <p key={r.id}>
            {r.operation} · Week {r.market_week} ·{" "}
            {new Date(r.created_at).toLocaleString("en-US", {
              timeZone: "America/New_York",
            })}
          </p>
        ))
      ) : (
        <p>No weekly execution jobs have run.</p>
      )}
    </section>
  );
}

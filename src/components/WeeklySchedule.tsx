import {
  groupedExecutions,
  executionOutcome,
  jobState,
  safeJobDetail,
  operationName,
} from "../lib/execution-health";
import type { ExecutionRun, ExecutionJob } from "../lib/execution-health";
import type { League } from "../lib/accounts";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import {
  emailLabels,
  emailTemplateGroups,
  renderEmail,
  sampleEmail,
} from "../lib/emailTemplates";
import type { EmailKind } from "../lib/emailTemplates";
import "./Sportsbook.css";
import { LineRefreshStatus } from "./LineRefreshStatus";
import { LiveModelLog } from "./LiveModelLog";
interface Settings {
  publication_paused: boolean;
  opening_email: boolean;
  reminder_email: boolean;
  recap_email: boolean;
  opening_time: string;
  reminder_time: string;
  reminder_lead_minutes: number;
  recap_time: string;
  automation_enabled: boolean;
  activation_requested?: boolean;
  job_times: Record<string, string>;
}
const defaults: Settings = {
  publication_paused: false,
  opening_email: true,
  reminder_email: true,
  recap_email: true,
  opening_time: "08:00",
  reminder_time: "19:00",
  reminder_lead_minutes: 60,
  recap_time: "08:15",
  automation_enabled: false,
  job_times: {
    settlement: "00:30",
    recheck: "07:00",
    replenishment: "08:00",
    generation: "08:30",
    refresh: "07:30",
    cutoff: "20:00",
  },
};
interface Preview {
  week: number;
  mode: string;
  replenishment_due?: boolean;
  balances?: {
    wallet_id?: string | null;
    team_id: string;
    name: string;
    current: number | null;
    eligible: boolean;
    reason: string;
    target: number | null;
  }[];
  tickets: {
    ticket_id: string;
    ticket_type?: string;
    market_week: number;
    pending: boolean;
    final?: boolean;
    projected_payout?: number | null;
    legs: {
      id: string;
      selection?: string;
      status: string;
      evidence: string;
      actual_value?: number | null;
    }[];
  }[];
  note: string;
}
interface ReminderTiming {
  league_id: string;
  market_week: number;
  automation_enabled: boolean;
  saved_lead_minutes: number;
  proposed_lead_minutes: number;
  saved: {
    eligible: boolean;
    reason?: string;
    send_after?: string;
    deadline?: string;
  };
  proposed: {
    eligible: boolean;
    reason?: string;
    send_after?: string;
    deadline?: string;
  };
}
export function WeeklySchedule({
  league,
  leagueId,
  reviewMode = false,
  onApplied,
  exceptionsOnly = false,
  canConfigure = false,
}: {
  league?: League;
  leagueId: string;
  reviewMode?: boolean;
  onApplied?: () => Promise<void>;
  exceptionsOnly?: boolean;
  canConfigure?: boolean;
}) {
  const [settings, setSettings] = useState(defaults),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null);
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const [deliveryLogs, setDeliveryLogs] = useState<
    {
      id: string;
      kind: string;
      recipient: string;
      status: string;
      last_error: string | null;
      created_at: string;
    }[]
  >([]);
  const [jobLogs, setJobLogs] = useState<ExecutionJob[]>([]);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState(!reviewMode);
  const [loadError, setLoadError] = useState("");
  const [logErrors, setLogErrors] = useState<string[]>([]);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [reminderTiming, setReminderTiming] = useState<ReminderTiming | null>(
    null,
  );
  const [reminderError, setReminderError] = useState("");
  const [reminderLoading, setReminderLoading] = useState(false);
  const reminderRequest = useRef(0);
  const loadedLeague = useRef(leagueId);
  const validReminderLead =
    Number.isInteger(settings.reminder_lead_minutes) &&
    settings.reminder_lead_minutes >= 5 &&
    settings.reminder_lead_minutes <= 1440;
  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }) + " ET"
      : "Not recorded";
  const [confirmApply, setConfirmApply] = useState(false);
  const [overrides, setOverrides] = useState<
    Record<string, { status: string; actual_value: string; evidence: string }>
  >({});
  const [emailKind, setEmailKind] = useState<EmailKind | "">("");
  const [availability, setAvailability] = useState<{
    eligible: boolean;
    phase: string;
    calendar_week: number;
    market_week: number;
    reason: string;
    note: string;
    window?: { send_after?: string; deadline?: string };
  } | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const availabilityRequest = useRef(0);
  const invalidateAvailability = useCallback(() => {
    availabilityRequest.current++;
  }, []);
  useEffect(() => {
    invalidateAvailability();
    return invalidateAvailability;
  }, [leagueId, emailKind, invalidateAvailability]);
  function chooseEmailKind(kind: EmailKind | "") {
    availabilityRequest.current++;
    setAvailability(null);
    setAvailabilityError("");
    setAvailabilityLoading(false);
    setEmailKind(kind);
  }
  async function checkAvailability() {
    if (!emailKind || reviewMode || !supabase) return;
    const request = ++availabilityRequest.current;
    setAvailabilityLoading(true);
    setAvailability(null);
    setAvailabilityError("");
    try {
      const r = await supabase.rpc("notification_preview", {
        p_league: leagueId,
        p_kind: emailKind,
      });
      if (r.error) throw r.error;
      if (
        r.data?.contract !== "notification-preview-v1" ||
        r.data.league_id !== leagueId ||
        r.data.kind !== emailKind
      )
        throw Error(
          "Notification availability scope changed. Refresh and try again.",
        );
      if (request === availabilityRequest.current) setAvailability(r.data);
    } catch (e) {
      if (request === availabilityRequest.current)
        setAvailabilityError(errorMessage(e));
    } finally {
      if (request === availabilityRequest.current)
        setAvailabilityLoading(false);
    }
  }
  const email = {
    ...sampleEmail(emailKind || "opening"),
    brand: league
      ? `${league.name} · Fantasy Sportsbook`
      : "Fantasy Sportsbook",
    url: league?.sportsbook_url ?? "https://example.invalid/",
  };
  function emailButton(kind: EmailKind) {
    return (
      <button
        className="email-preview-button"
        onClick={() => {
          chooseEmailKind(kind);
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
    if (reviewMode) {
      setLoadingStatus(false);
      return;
    }
    let active = true,
      pending = false;
    if (loadedLeague.current !== leagueId) {
      loadedLeague.current = leagueId;
      setReady(false);
      setSettings(defaults);
      reminderRequest.current++;
      setReminderTiming(null);
      setReminderError("");
      setReminderLoading(false);
      setRuns([]);
      setJobLogs([]);
      setDeliveryLogs([]);
      setAvailability(null);
      setAvailabilityError("");
      setAvailabilityLoading(false);
      setLastChecked(null);
    }
    const load = async (reloadSettings = true) => {
      if (pending) return;
      pending = true;
      setLoadingStatus(true);
      try {
        const [schedule, logs, delivery, jobs] = await Promise.all([
          supabase!
            .from("weekly_schedule")
            .select("*")
            .eq("league_id", leagueId)
            .maybeSingle(),
          supabase!
            .from("weekly_execution_runs")
            .select("id,operation,nfl_season,market_week,summary,created_at")
            .eq("league_id", leagueId)
            .order("created_at", { ascending: false })
            .limit(100),
          supabase!
            .from("outbound_emails")
            .select("id,kind,recipient,status,last_error,created_at")
            .eq("league_id", leagueId)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase!
            .from("automation_jobs")
            .select(
              "id,operation,market_week,status,last_error,created_at,scheduled_for,lease_until,completed_at,attempts",
            )
            .eq("league_id", leagueId)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        if (!active) return;
        if (schedule.error)
          setLoadError(
            "Schedule status could not load. Retry to check automation.",
          );
        else if (!schedule.data) {
          setReady(false);
          setLoadError("No schedule is configured for this league.");
        } else {
          setSettings((current) =>
            reloadSettings
              ? ({
                  ...defaults,
                  ...schedule.data,
                  job_times: {
                    ...defaults.job_times,
                    ...schedule.data.job_times,
                  },
                } as Settings)
              : {
                  ...current,
                  automation_enabled: schedule.data.automation_enabled,
                  activation_requested: schedule.data.activation_requested,
                },
          );
          setReady(true);
          setLoadError("");
          setLastChecked(new Date().toISOString());
        }
        const errors: string[] = [];
        if (logs.error) errors.push("Execution history");
        else setRuns(logs.data ?? []);
        if (delivery.error) errors.push("Email delivery");
        else setDeliveryLogs(delivery.data ?? []);
        if (jobs.error) errors.push("Scheduled jobs");
        else setJobLogs(jobs.data ?? []);
        setLogErrors(errors);
      } catch {
        if (active) {
          setLogErrors([
            "Execution history",
            "Email delivery",
            "Scheduled jobs",
          ]);
          setLoadError(
            "Operating status could not load. Retry to check automation.",
          );
        }
      } finally {
        pending = false;
        if (active) setLoadingStatus(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, 30000);
    return () => {
      active = false;
      reminderRequest.current++;
      clearInterval(timer);
    };
  }, [leagueId, reviewMode, loadVersion]);
  async function save() {
    if (!canConfigure || !validReminderLead) return;
    setBusy(true);
    try {
      const r = await supabase!.rpc("configure_weekly_schedule_v3", {
        p_league: leagueId,
        p_paused: settings.publication_paused,
        p_opening: settings.opening_email,
        p_reminder: settings.reminder_email,
        p_recap: settings.recap_email,
        p_opening_time: settings.opening_time,
        p_reminder_time: settings.reminder_time,
        p_recap_time: settings.recap_time,
        p_job_times: settings.job_times,
        p_reminder_lead_minutes: settings.reminder_lead_minutes,
      });
      if (r.error) throw r.error;
      if (loadedLeague.current !== leagueId) return;
      setNotice(
        "Schedule preferences saved. Reminders follow the available betting deadline when automation is enabled.",
      );
      reminderRequest.current++;
      setReminderTiming(null);
    } catch (e) {
      if (loadedLeague.current === leagueId) setNotice(errorMessage(e));
    } finally {
      if (loadedLeague.current === leagueId) setBusy(false);
    }
  }
  async function previewReminder() {
    const request = ++reminderRequest.current;
    setReminderLoading(true);
    setReminderError("");
    setReminderTiming(null);
    try {
      const r = await supabase!.rpc("reminder_schedule_preview", {
        p_league: leagueId,
        p_lead: settings.reminder_lead_minutes,
      });
      if (r.error) throw r.error;
      if (
        request !== reminderRequest.current ||
        loadedLeague.current !== leagueId
      )
        return;
      if (r.data?.league_id !== leagueId)
        throw Error("Reminder timing is unavailable.");
      setReminderTiming(r.data as ReminderTiming);
    } catch (e) {
      if (
        request === reminderRequest.current &&
        loadedLeague.current === leagueId
      )
        setReminderError(errorMessage(e));
    } finally {
      if (
        request === reminderRequest.current &&
        loadedLeague.current === leagueId
      )
        setReminderLoading(false);
    }
  }
  async function review(apply = false) {
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
        body: JSON.stringify({
          league_id: leagueId,
          apply,
          overrides: Object.entries(overrides)
            .filter(([, o]) => o.status)
            .map(([id, o]) => ({
              id,
              status: o.status,
              actual_value:
                o.actual_value.trim() === "" ? null : Number(o.actual_value),
              evidence: o.evidence,
            })),
        }),
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
      setConfirmApply(false);
      if (apply) {
        setOverrides({});
        await onApplied?.();
        const logs = await supabase!
          .from("weekly_execution_runs")
          .select("id,operation,nfl_season,market_week,summary,created_at")
          .eq("league_id", leagueId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (!logs.error) setRuns(logs.data ?? []);
      }
      setNotice(
        apply
          ? "Execution completed. Ticket results, balances, and leaderboard are refreshed."
          : "Preview complete. No tickets, balances, or emails were changed.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const scheduleRows: {
    key: string;
    day: string;
    time?: string;
    description: string;
    email?: EmailKind;
    toggle?: "opening_email" | "reminder_email" | "recap_email";
    who: string;
  }[] = [
    {
      key: "monday_watch",
      day: "Monday · 5:00 PM",
      description:
        "Send personal tickets to watch tonight, decided results, or a no-bets message",
      email: "monday_watch",
      who: "All league members; each receives only their own weekly tickets",
    },
    {
      key: "settlement",
      day: "Tuesday",
      time: "settlement",
      description: "Confirm final results and settle resolved weekly tickets",
      who: "Automated Process",
    },
    {
      key: "recheck",
      day: "Tuesday",
      time: "recheck",
      description: "Recheck unresolved results; flag held replenishments",
      email: "attention",
      who: "League admin, only if review is needed",
    },
    {
      key: "replenishment",
      day: "Tuesday",
      time: "replenishment",
      description: "Replenish eligible balances and advance the week",
      who: "Automated Process",
    },
    {
      key: "generation",
      day: "Tuesday",
      time: "generation",
      description: "Generate upcoming lines and featured matchups",
      who: "Automated Process",
    },
    {
      key: "refresh",
      day: "Wednesday",
      time: "refresh",
      description: "Refresh projections, injuries, and generated lines",
      who: "Automated Process",
    },
    {
      key: "opening",
      day: "Wednesday",
      time: "opening_time",
      description: "Publish the board unless paused; send the opening email",
      email: "opening",
      toggle: "opening_email",
      who: "All league members",
    },
    {
      key: "reminder",
      day: "Before the available betting deadline",
      description:
        "Remind eligible users while weekly picks are still available",
      email: "reminder",
      toggle: "reminder_email",
      who: "Approved participants whose available balance meets the minimum wager",
    },
    {
      key: "cutoff",
      day: "Thursday",
      time: "cutoff",
      description: "Close static weekly betting",
      who: "Automated Process",
    },
    {
      key: "recap",
      day: "Tuesday",
      time: "recap_time",
      description:
        "Send the league roundup and personal results after replenishment",
      email: "recap",
      toggle: "recap_email",
      who: "All league members; personal stats are individualized",
    },
    {
      key: "confirmation",
      day: "On ticket acceptance",
      description: "Confirm the accepted wager, selections, odds, and payout",
      email: "confirmation",
      who: "The bettor only",
    },
    {
      key: "signin",
      day: "On sign-in request",
      description: "Send a secure sign-in link to the approved account",
      email: "signin",
      who: "The requesting account only",
    },
  ];
  const getTime = (key: string) =>
    (key === "opening_time" || key === "reminder_time" || key === "recap_time"
      ? settings[key]
      : settings.job_times[key]
    ).slice(0, 5);
  const changeTime = (key: string, value: string) =>
    setSettings(
      key === "opening_time" || key === "reminder_time" || key === "recap_time"
        ? { ...settings, [key]: value }
        : { ...settings, job_times: { ...settings.job_times, [key]: value } },
    );
  return (
    <section className="weekly-schedule">
      {!exceptionsOnly && (
        <>
          <LineRefreshStatus leagueId={leagueId} review={reviewMode} admin />
          <LiveModelLog leagueId={leagueId} review={reviewMode} />
        </>
      )}
      {exceptionsOnly && (
        <>
          <button disabled={busy || !ready} onClick={() => void review()}>
            Check results and replenishment
          </button>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
      {!exceptionsOnly && (
        <>
          <p className="schedule-status">
            <strong>
              {!ready && !reviewMode
                ? loadingStatus
                  ? "Checking automation…"
                  : "Automation status unavailable"
                : settings.automation_enabled
                  ? "Automation Active"
                  : settings.activation_requested
                    ? "Waiting For Deployment Verification"
                    : "Automation Paused"}
            </strong>{" "}
            · All times Eastern
          </p>
          {lastChecked && (
            <p className="history-note">
              Schedule checked {time(lastChecked)}
              {loadingStatus ? " · Refreshing…" : ""}
            </p>
          )}
          {(loadError || logErrors.length > 0) && (
            <div role="status" className="feedback">
              <p>
                {loadError ||
                  "Some operating logs could not refresh. Last successful data remains visible."}
              </p>
              {logErrors.length > 0 && (
                <p>Unavailable: {logErrors.join(", ")}</p>
              )}
              <button
                disabled={loadingStatus}
                onClick={() => setLoadVersion((v) => v + 1)}
              >
                Retry operating status
              </button>
            </div>
          )}
          <section className="operation-health" aria-label="Weekly job health">
            <h3>Settlement and communications</h3>
            {loadingStatus && !lastChecked ? (
              <p role="status">Loading operating history…</p>
            ) : (
              <>
                <p>
                  Settlement:{" "}
                  {logErrors.includes("Execution history")
                    ? "status unavailable"
                    : runs.find((r) => r.operation === "settlement")
                      ? "last result " +
                        time(
                          runs.find((r) => r.operation === "settlement")
                            ?.created_at,
                        )
                      : "no result in the recent history"}
                  .
                </p>
                <p>
                  Recent jobs:{" "}
                  {logErrors.includes("Scheduled jobs")
                    ? "status unavailable"
                    : jobLogs.length
                      ? jobLogs.filter((j) =>
                          /Overdue|Failed/.test(jobState(j)),
                        ).length +
                        " need attention; " +
                        jobLogs.filter((j) => j.status === "running").length +
                        " running"
                      : "no jobs recorded"}
                  .
                </p>
                <p>
                  Email:{" "}
                  {logErrors.includes("Email delivery")
                    ? "status unavailable"
                    : deliveryLogs.some((r) => r.status === "failed")
                      ? "delivery failures need review below"
                      : deliveryLogs.some((r) => r.status === "sent")
                        ? "last successful send " +
                          time(
                            deliveryLogs.find((r) => r.status === "sent")
                              ?.created_at,
                          )
                        : "no successful send in the recent history"}
                  .
                </p>
                {jobLogs
                  .filter((j) => /Overdue|Failed/.test(jobState(j)))
                  .map((job) => (
                    <button
                      key={job.id}
                      onClick={() => {
                        const logs = document.getElementById(
                          "scheduled-execution-logs",
                        ) as HTMLDetailsElement | null;
                        if (logs) logs.open = true;
                        const row = document.getElementById(
                          `execution-job-${job.id}`,
                        );
                        row?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                        row?.focus({ preventScroll: true });
                      }}
                    >
                      Review {operationName(job.operation)} · Week{" "}
                      {job.market_week}
                    </button>
                  ))}
                <p className="history-note">
                  History shows recent records. Held replenishments wait for
                  verified results; retries do not mean another payment.
                </p>
              </>
            )}
          </section>
          {notice && <p role="status">{notice}</p>}
          {!canConfigure && (
            <p>
              Only the platform owner can change configuration or activate
              automation.
            </p>
          )}
          <div className="schedule-controls">
            <label>
              <input
                type="checkbox"
                checked={
                  settings.automation_enabled ||
                  Boolean(settings.activation_requested)
                }
                disabled={!canConfigure || busy || reviewMode || !ready}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setBusy(true);
                  try {
                    const r = await supabase!.rpc("set_weekly_automation", {
                      p_league: leagueId,
                      p_enabled: enabled,
                    });
                    if (r.error) throw r.error;
                    setSettings({
                      ...settings,
                      automation_enabled: false,
                      activation_requested: enabled,
                    });
                    setNotice(
                      enabled
                        ? "Automation will start after the worker connection is verified."
                        : "Weekly automation paused.",
                    );
                  } catch (error) {
                    setNotice(errorMessage(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              Enable Weekly Automation
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.publication_paused}
                disabled={!canConfigure || busy || !ready}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    publication_paused: e.target.checked,
                  })
                }
              />{" "}
              Pause automatic publication
            </label>
            <button
              className="primary"
              disabled={!canConfigure || !ready || busy || !validReminderLead}
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
            against accepted tickets, shows which legs are ready to settle or
            need review, and assesses replenishment eligibility. It does not
            settle bets, change balances, publish markets, or send emails.
          </p>
          <div className="schedule-table-wrap">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Description</th>
                  <th>Email</th>
                  <th>Who</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {row.day}
                      {row.key === "reminder" ? (
                        <label>
                          Minutes before deadline
                          <input
                            type="number"
                            min={5}
                            max={1440}
                            step={1}
                            aria-label="Reminder lead minutes"
                            disabled={!canConfigure || busy}
                            value={settings.reminder_lead_minutes}
                            onChange={(e) => {
                              reminderRequest.current++;
                              setReminderTiming(null);
                              setReminderLoading(false);
                              setReminderError("");
                              setSettings({
                                ...settings,
                                reminder_lead_minutes: Number(e.target.value),
                              });
                            }}
                          />
                          <small>
                            5–1,440 minutes. Rechecked before sending.
                          </small>
                        </label>
                      ) : row.time ? (
                        <input
                          aria-label={row.description + " time"}
                          type="time"
                          disabled={!canConfigure || busy}
                          value={getTime(row.time)}
                          onChange={(e) =>
                            changeTime(row.time!, e.target.value)
                          }
                        />
                      ) : (
                        <small className="event-timing">Immediately</small>
                      )}
                    </td>
                    <td>{row.description}</td>
                    <td>
                      {row.email ? (
                        <span className="email-cell">
                          {row.toggle ? (
                            <label>
                              <input
                                type="checkbox"
                                checked={Boolean(settings[row.toggle])}
                                disabled={!canConfigure || busy}
                                onChange={(e) =>
                                  setSettings({
                                    ...settings,
                                    [row.toggle!]: e.target.checked,
                                  })
                                }
                              />
                              {emailLabels[row.email]}
                            </label>
                          ) : (
                            <span>{emailLabels[row.email]}</span>
                          )}
                          {emailButton(row.email)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{row.who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section aria-label="Reminder timing preview">
            <h3>Reminder timing</h3>
            <p>
              Preview the saved and proposed lead time against this week’s
              available picks. Changes do not alter when betting is accepted. A
              delayed reminder is skipped once its opportunity closes.
            </p>
            <button
              disabled={
                busy || reminderLoading || reviewMode || !validReminderLead
              }
              onClick={() => void previewReminder()}
            >
              {reminderLoading ? "Checking timing…" : "Preview reminder timing"}
            </button>
            {reminderError && <p role="alert">{reminderError}</p>}
            {reminderTiming && (
              <div role="status">
                <p>
                  Week {reminderTiming.market_week}.{" "}
                  {reminderTiming.automation_enabled
                    ? "Automation enabled."
                    : "Automation is off; this preview sends nothing."}
                </p>
                {reminderTiming.proposed.eligible ? (
                  <>
                    <p>
                      Saved ({reminderTiming.saved_lead_minutes} minutes):{" "}
                      {time(reminderTiming.saved.send_after)}.
                    </p>
                    <p>
                      Proposed ({reminderTiming.proposed_lead_minutes} minutes):{" "}
                      {time(reminderTiming.proposed.send_after)}. Available
                      opportunity until {time(reminderTiming.proposed.deadline)}
                      .
                    </p>
                    <p>
                      Times may change as picks lock or a window changes. A
                      reminder already sent or awaiting delivery review is not
                      sent again for this week.
                    </p>
                  </>
                ) : (
                  <p>
                    No actionable weekly window is available for reminders. It
                    may be paused, disabled, unpublished, stale or closed. No
                    reminder will be queued from this preview.
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
      {preview && !reviewMode && (
        <section className="execution-review">
          <h2>
            {preview.mode === "applied"
              ? "Execution Results"
              : "Review Before Applying"}
          </h2>
          <div className="execution-balance-wrap">
            <table className="execution-balances">
              <caption>Potential Balance Changes</caption>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Balance</th>
                  <th>After Replenishment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.balances?.map((b) => (
                  <tr key={b.wallet_id ?? b.team_id}>
                    <td>{b.name}</td>
                    <td>
                      {b.current === null
                        ? "Funding pending"
                        : "$" + b.current.toFixed(2)}
                    </td>
                    <td>
                      {b.target === null ? "—" : "$" + b.target.toFixed(2)}
                    </td>
                    <td>
                      <span title={b.reason}>
                        {b.eligible
                          ? b.current !== null && b.target! > b.current
                            ? "Top Up"
                            : "Keep Balance"
                          : b.reason === "Already processed this week"
                            ? "Processed"
                            : b.reason === "Current-week wager already placed"
                              ? "Already Wagered"
                              : b.reason.startsWith("Not due")
                                ? "Not Due"
                                : "On Hold"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            Balances are rechecked after settlement. Unresolved tickets hold
            replenishment.
          </small>
          <button
            disabled={busy || !ready}
            onClick={() => setConfirmApply(true)}
          >
            Apply Settlement & Eligible Replenishment
          </button>
          {confirmApply && (
            <div role="region" aria-label="Confirm weekly execution">
              <p>
                Save confirmed results, pay resolved tickets once, and replenish
                eligible balances. Unresolved weekly tickets stay open and hold
                that user's replenishment. No emails will be sent.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void review(true)}
              >
                Confirm & Apply
              </button>
              <button disabled={busy} onClick={() => setConfirmApply(false)}>
                Cancel
              </button>
            </div>
          )}
        </section>
      )}
      {preview && (
        <section>
          <h2>Execution Preview · Week {preview.week}</h2>
          <p>{preview.note}</p>
          {preview.tickets.length === 0 ? (
            <p>No open tickets need settlement.</p>
          ) : (
            preview.tickets.map((t) => (
              <details key={t.ticket_id}>
                <summary>
                  {t.ticket_type === "future"
                    ? "Season Futures"
                    : `Week ${t.market_week}`}{" "}
                  · {t.ticket_id.slice(0, 8)} ·{" "}
                  {t.pending
                    ? t.final
                      ? "Needs Review"
                      : "Awaiting Final Results"
                    : "Ready To Settle"}
                </summary>
                {t.legs.map((l) => (
                  <p key={l.id}>
                    <strong>
                      {l.selection ?? "Leg"} · {l.status}
                    </strong>{" "}
                    · {l.evidence}
                  </p>
                ))}
                {t.final &&
                  t.legs
                    .filter((l) => l.status === "OPEN")
                    .map((l) => {
                      const o = overrides[l.id] ?? {
                        status: "",
                        actual_value: "",
                        evidence: "",
                      };
                      const update = (key: string, value: string) => {
                        setOverrides({
                          ...overrides,
                          [l.id]: { ...o, [key]: value },
                        });
                        setConfirmApply(false);
                      };
                      return (
                        <fieldset key={l.id}>
                          <legend>
                            Review Unresolved Leg ·{" "}
                            {l.selection ?? l.id.slice(0, 8)}
                          </legend>
                          <label>
                            Confirmed Result
                            <select
                              value={o.status}
                              onChange={(e) => update("status", e.target.value)}
                            >
                              <option value="">Keep Pending</option>
                              <option value="WON">Won</option>
                              <option value="LOST">Lost</option>
                              <option value="PUSH">Push / Did Not Play</option>
                            </select>
                          </label>
                          <label>
                            Actual Score Or Margin
                            <input
                              type="number"
                              step="0.01"
                              value={o.actual_value}
                              onChange={(e) =>
                                update("actual_value", e.target.value)
                              }
                            />
                          </label>
                          <label>
                            Result Evidence
                            <input
                              maxLength={500}
                              value={o.evidence}
                              onChange={(e) =>
                                update("evidence", e.target.value)
                              }
                              placeholder="Verified source or reason for this result"
                            />
                          </label>
                          <small>
                            For a confirmed inactive player, choose Push and
                            enter 0. Preview again to review this decision.
                          </small>
                        </fieldset>
                      );
                    })}
              </details>
            ))
          )}
        </section>
      )}
      {!exceptionsOnly && (
        <>
          <section
            id="email-template-preview"
            className="email-template-preview"
          >
            <div className="email-preview-heading">
              <h2>Email Templates</h2>
              <select
                aria-label="Email template"
                value={emailKind}
                onChange={(e) =>
                  chooseEmailKind(e.target.value as EmailKind | "")
                }
              >
                <option value="">Choose A Template…</option>
                {emailTemplateGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.kinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {emailLabels[kind]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {emailKind && (
              <>
                <p>
                  Sample template preview. Scheduled emails use live league
                  data; this preview sends nothing.
                </p>
                <div className="email-envelope">
                  <span>
                    <strong>From:</strong> {league?.name ?? "League"} · Fantasy
                    Sportsbook &lt;
                    {league?.email_sender ?? "Configure a verified sender"}&gt;
                  </span>
                  <span>
                    <strong>To:</strong>{" "}
                    {emailKind === "attention"
                      ? "Verified current sportsbook operators and platform owner"
                      : emailKind === "reminder"
                        ? "Approved participants meeting the effective minimum wager"
                        : "The approved league member"}
                  </span>
                  <span>
                    <strong>Subject:</strong> {email.subject}
                  </span>
                </div>
                {!reviewMode && (
                  <section aria-label="Current notification availability">
                    <button
                      disabled={availabilityLoading}
                      onClick={() => void checkAvailability()}
                    >
                      {availabilityLoading
                        ? "Checking availability…"
                        : "Check notification availability"}
                    </button>
                    {availabilityError && (
                      <p role="alert">{availabilityError}</p>
                    )}
                    {availability && (
                      <div role="status">
                        <p>
                          <strong>
                            {availability.eligible
                              ? "Shared conditions available"
                              : "Currently unavailable"}
                          </strong>{" "}
                          · {availability.phase} phase · calendar week{" "}
                          {availability.calendar_week} · content week{" "}
                          {availability.market_week}
                        </p>
                        <p>{availability.reason}</p>
                        {availability.window?.send_after && (
                          <p>Due: {time(availability.window.send_after)}</p>
                        )}
                        {availability.window?.deadline && (
                          <p>Deadline: {time(availability.window.deadline)}</p>
                        )}
                        <p>{availability.note}</p>
                      </div>
                    )}
                  </section>
                )}
                <iframe
                  title={`${emailLabels[emailKind]} sample`}
                  sandbox=""
                  srcDoc={renderEmail(email)}
                />
                <button
                  className="text-button"
                  onClick={() => chooseEmailKind("")}
                >
                  Hide Preview
                </button>
              </>
            )}
          </section>
          <details>
            <summary>
              Email Delivery Logs ·{" "}
              {loadingStatus && !lastChecked
                ? "Loading…"
                : logErrors.includes("Email delivery")
                  ? "Unavailable"
                  : deliveryLogs.length}
            </summary>
            <table className="execution-balances">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {deliveryLogs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.kind}</td>
                    <td>{r.recipient}</td>
                    <td>{r.status}</td>
                    <td>
                      {r.last_error ??
                        new Date(r.created_at).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                        })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <details id="scheduled-execution-logs">
            <summary>
              Scheduled Execution Logs ·{" "}
              {loadingStatus && !lastChecked
                ? "Loading…"
                : logErrors.includes("Scheduled jobs")
                  ? "Unavailable"
                  : jobLogs.length}
            </summary>
            <table className="execution-balances">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {jobLogs.map((r) => (
                  <tr key={r.id} id={`execution-job-${r.id}`} tabIndex={-1}>
                    <td>
                      {operationName(r.operation)}
                      {r.market_week ? " · Week " + r.market_week : ""}
                    </td>
                    <td>{jobState(r)}</td>
                    <td>
                      {safeJobDetail(r.last_error)}
                      <div>
                        {r.attempts ?? 0} attempts ·{" "}
                        {r.status === "done"
                          ? "Finished " + time(r.completed_at)
                          : "Next check " +
                            time(
                              r.lease_until || r.scheduled_for || r.created_at,
                            )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <h2>Execution History</h2>
          {loadingStatus && !lastChecked ? (
            <p role="status">Loading execution history…</p>
          ) : logErrors.includes("Execution history") && !runs.length ? (
            <p>
              Execution history unavailable. Use Retry operating status above.
            </p>
          ) : runs.length ? (
            groupedExecutions(runs).map(({ latest, attempts }) => (
              <details className="execution-group" key={latest.id}>
                <summary>
                  {operationName(latest.operation)} · Week {latest.market_week}
                  {latest.nfl_season ? " · " + latest.nfl_season : ""} ·{" "}
                  {executionOutcome(latest)} · {attempts.length} recent{" "}
                  {attempts.length === 1 ? "attempt" : "attempts"}
                </summary>
                <p>
                  Latest attempt {time(latest.created_at)}. Retry timing is
                  shown in Scheduled Execution Logs.
                </p>
                <ul>
                  {attempts.map((r) => (
                    <li key={r.id}>
                      {time(r.created_at)} · {executionOutcome(r)}
                    </li>
                  ))}
                </ul>
              </details>
            ))
          ) : (
            <p>No weekly execution jobs have run.</p>
          )}
        </>
      )}
    </section>
  );
}

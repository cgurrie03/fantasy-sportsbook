import { useState } from "react";
import type { AccountData } from "../lib/accounts";
import { supabase } from "../lib/supabase";
import { Sportsbook } from "./Sportsbook";
import { renderEmail } from "../../api/_lib/email-templates";
import { reopeningEmail } from "../../api/_lib/reopening-email";
import { easternInstant, upcomingSundayNoon } from "../../api/_lib/event-time";
export function ReopeningReview({
  data,
  leagueId,
  initialPreview,
  readOnly = false,
}: {
  data: AccountData;
  leagueId: string;
  initialPreview?: any;
  readOnly?: boolean;
}) {
  const [preview, setPreview] = useState<any>(initialPreview ?? null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [emailReviewed, setEmailReviewed] = useState(false),
    [published, setPublished] = useState(false);
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(initialPreview?.closes_at ?? upcomingSundayNoon())),
  );
  const league = data.leagues.find((l) => l.id === leagueId)!,
    member =
      data.memberships.find(
        (m) => m.league_id === leagueId && m.role === "admin",
      ) ?? data.memberships.find((m) => m.league_id === leagueId)!;
  const closes = preview?.closes_at ?? easternInstant(date, "12:00:00");
  async function request(action: "preview" | "publish" | "announce") {
    if (readOnly || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const token = (await supabase!.auth.getSession()).data.session
        ?.access_token;
      const response = await fetch("/api/reopening-review", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action,
          league_id: leagueId,
          closes_at: easternInstant(date, "12:00:00"),
          review_id: preview?.id,
          snapshot_hash: preview?.snapshot_hash,
        }),
      });
      const result = (await response.json()) as any;
      if (!response.ok)
        throw Error(result.error ?? "Reopening request failed.");
      if (action === "preview") {
        setPreview(result);
        setReviewed(false);
        setEmailReviewed(false);
        setPublished(false);
        setNotice(
          "Preview prepared. Nothing is published or emailed. Review the prices and cutoff below.",
        );
      }
      if (action === "publish") {
        setPublished(true);
        setNotice("Reopening published. The announcement has not been sent.");
      }
      if (action === "announce")
        setNotice(
          "Announcement queued for approved league members. Duplicate requests cannot create duplicate emails.",
        );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Reopening request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const email = reopeningEmail({
    brand: league.name + " · Fantasy Sportsbook",
    greeting: "Hi league member,",
    week: preview?.week ?? 6,
    closes_at: closes,
    url: league.sportsbook_url ?? "https://sportsbook.coopergurrie.com/",
  });
  const board = {
    id: preview?.weekly_board ?? "reopening-preview",
    league_id: leagueId,
    market_week: preview?.week ?? 6,
    nfl_season: league.nfl_season,
    league_season: league.league_season,
    status: "published" as const,
    revision: 1,
    opens_at: preview?.checked_at ?? new Date().toISOString(),
    closes_at: closes,
    phase: "live" as const,
    reopening_id: preview?.id ?? "review-only",
    reopening_until: closes,
  };
  return (
    <section className="reopening-review">
      <h2>Review a Sunday reopening</h2>
      <p>
        This is a one-time window. Regular weekly opening and cutoff settings
        stay separate. Completed-game scores are included; affected live games,
        started-player bets, missing data, and incomplete lineups stay locked.
      </p>
      <label>
        Sunday closing date (12:00 PM Eastern)
        <input
          type="date"
          value={date}
          disabled={busy || readOnly}
          onChange={(e) => {
            setDate(e.target.value);
            setPreview(null);
            setReviewed(false);
          }}
        />
      </label>
      <button
        className="secondary"
        disabled={busy || readOnly}
        onClick={() => void request("preview")}
      >
        {busy ? "Preparing…" : "Refresh all categories for review"}
      </button>
      {readOnly && (
        <p role="status">
          Local review only. Deployment, live reopening, and email delivery are
          on hold.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <>
          <p>
            Source checked:{" "}
            {new Date(preview.checked_at).toLocaleString("en-US", {
              timeZone: "America/New_York",
            })}{" "}
            Eastern. Approval requires a current preview; expired or changed
            prices must be refreshed.
          </p>
          <p>
            {preview.weekly_quotes.length} weekly selections /{" "}
            {preview.future_quotes.length} futures selections. Locked selections
            remain visible with explanations.
          </p>
          <details>
            <summary>Pricing method and source checks</summary>
            <p>{preview.context?.formula}</p>
            <ul>
              {(preview.context?.limitations ?? []).map((v: string) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            {(preview.context?.teams ?? [])
              .filter((t: any) => t.reasons.length)
              .map((t: any) => (
                <p key={t.team_id}>
                  {t.name}: {t.reasons.join(" ")}
                </p>
              ))}
          </details>
          <Sportsbook
            data={data}
            member={member}
            refresh={async () => {}}
            review={{
              embedded: true,
              reviewLabel:
                "Reopening review / prices and current scores from the captured sources. No bets or emails are submitted.",
              board,
              markets: preview.weekly_quotes,
              standings: [],
              futureBoard: {
                ...board,
                id: "reopening-futures-preview",
                board_type: "future",
              },
              futureMarkets: preview.future_quotes,
              scoreObservation: {
                league_id: leagueId,
                nfl_season: league.nfl_season,
                market_week: preview.week,
                fetched_at: preview.checked_at,
                cadence_minutes: 120,
                payload: { teams: preview.context?.scores ?? {}, players: {} },
              },
            }}
          />
          <label className="review-approval">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={readOnly || busy || published}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the updated selections, locks, model assumptions, and
            Sunday noon Eastern cutoff.
          </label>
          <button
            className="primary"
            disabled={readOnly || busy || !reviewed || published}
            onClick={() => void request("publish")}
          >
            Approve and reopen this window
          </button>
        </>
      )}
      <h2>Reopening announcement / draft</h2>
      <p>The announcement is a separate action after verified publication.</p>
      <iframe
        title="Reopening email draft"
        className="email-preview"
        srcDoc={renderEmail({ ...email, sample: true })}
      />
      <label className="review-approval">
        <input
          type="checkbox"
          checked={emailReviewed}
          disabled={readOnly || busy}
          onChange={(e) => setEmailReviewed(e.target.checked)}
        />
        I reviewed the announcement and want it sent to approved league members.
      </label>
      <button
        className="secondary"
        disabled={readOnly || busy || !published || !emailReviewed}
        onClick={() => void request("announce")}
      >
        Send reopening announcement
      </button>
    </section>
  );
}

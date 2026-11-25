import {live} from "./live";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import context from "./season-context.json";
import { league, teams, price, line, currentTeamScore, pregameTeamProjection, liveTeamProjection } from "./model";
import players from "./players.json";
import { previewLines, exampleATS } from "./previewLines";
import type { Team, Matchup } from "./model";
import { Avatar } from "./Markets";

type SpreadResult = {
  week: number;
  roster: number;
  opponent: number;
  points: number;
  against: number;
  spread: number;
  source?: "opening" | "reconstructed";
};
function atsSources(rows: SpreadResult[]) {
  const published = rows.filter(row=>row.source==="opening").length;
  const reconstructed = rows.filter(row=>row.source==="reconstructed").length;
  return [published ? `${published} published opening ${published===1?"spread":"spreads"}` : "",
    reconstructed ? `${reconstructed} ${reconstructed===1?"spread":"spreads"} reconstructed from projections` : ""].filter(Boolean).join(" · ");
}
function spreadRecord(roster: number) {
  const rows: SpreadResult[] = (live()?.spreadHistory ?? []).filter((row: SpreadResult) => row.roster === roster);
  const margins = rows.map((row) => Math.round((row.points + row.spread - row.against) * 100));
  return {
    rows,
    wins: margins.filter((margin) => margin > 0).length,
    losses: margins.filter((margin) => margin < 0).length,
    pushes: margins.filter((margin) => margin === 0).length,
  };
}
const games = (t: Team): typeof context.rows =>
  (live() ? live().matchupHistory ?? [] : context.rows)
    .filter((r: {roster:number;week:number}) => r.roster === t.roster_id && (!live() || r.week < league.week))
    .sort((a: {week:number},b: {week:number}) => a.week-b.week);
const outcome = (r: (typeof context.rows)[number]) =>
  r.points > r.against ? "W" : r.points < r.against ? "L" : "T";
export function ordinalSeed(n: number) {
  const mod = n % 100;
  return `${n}${mod >= 11 && mod <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"} Seed`;
}
export function RecentForm({ team }: { team: Team }) {
  const id = useId();
  const [shown, setShown] = useState<{
    row: (typeof context.rows)[number];
    left: number;
    top: number;
  } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const close = () => {
    cancel();
    closeTimer.current = setTimeout(() => setShown(null), 120);
  };
  useEffect(() => {
    const dismiss = () => setShown(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", key);
    return () => {
      cancel();
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const show = (row: (typeof context.rows)[number], target: HTMLElement) => {
    cancel();
    const rect = target.getBoundingClientRect();
    setShown({
      row,
      left: Math.max(
        12,
        Math.min(
          innerWidth - Math.min(330, innerWidth - 24) - 12,
          rect.left + rect.width / 2 - Math.min(330, innerWidth - 24) / 2,
        ),
      ),
      top: rect.bottom + 8,
    });
  };
  const opponent =
    shown && teams.find((t) => t.roster_id === shown.row.opponent);
  const quotes = shown&&!live() ? previewLines(shown.row) : null;
  const covering =
    quotes && teams.find((t) => t.roster_id === quotes.coverRoster);
  const winning = quotes && teams.find((t) => t.roster_id === quotes.winner);
  return (
    <div className="recent-form" aria-label={team.name + " Last Five Results"}>
      {games(team)
        .slice(-5)
        .map((row) => {
          const other = teams.find((t) => t.roster_id === row.opponent);
          return (
            <button
              key={row.week}
              className={"form-result form-" + outcome(row)}
              aria-label={
                "Week " +
                row.week +
                ": " +
                (outcome(row) === "W"
                  ? "Won"
                  : outcome(row) === "L"
                    ? "Lost"
                    : "Tied") +
                " Against " +
                (other?.name || "Opponent")
              }
              aria-describedby={shown?.row.week === row.week ? id : undefined}
              onMouseEnter={(e) => show(row, e.currentTarget)}
              onMouseLeave={close}
              onFocus={(e) => show(row, e.currentTarget)}
              onBlur={() => setShown(null)}
              onClick={(e) => show(row, e.currentTarget)}
            >
              {outcome(row)}
            </button>
          );
        })}
      {shown &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="form-result-popover"
            style={{ left: shown.left, top: shown.top }}
            onMouseEnter={cancel}
            onMouseLeave={close}
          >
            <strong>
              Week {shown.row.week} ·{" "}
              {outcome(shown.row) === "W"
                ? "Won"
                : outcome(shown.row) === "L"
                  ? "Lost"
                  : "Tied"}
            </strong>
            <div className="historical-team-score">
              <span>
                <Avatar team={team} small />
                {team.name}
              </span>
              <b>{shown.row.points.toFixed(2)}</b>
            </div>
            <div className="historical-team-score">
              <span>
                {opponent && <Avatar team={opponent} small />}
                {opponent?.name || "Opponent"}
              </span>
              <b>{shown.row.against.toFixed(2)}</b>
            </div>
            {quotes && (
              <dl className="historical-lines">
                <div>
                  <dt>Spread Covered</dt>
                  <dd>
                    {covering?.name} <b>{line(quotes.coverLine)}</b>{" "}
                  </dd>
                </div>
                <div>
                  <dt>Moneyline Won</dt>
                  <dd>
                    {winning?.name} <b>{price(quotes.moneyline)}</b>
                  </dd>
                </div>
                <div>
                  <dt>Total Won</dt>
                  <dd>
                    <b className="historical-total-line">
                      {quotes.totalSide} {quotes.totalLine}
                    </b>
                    <small className="historical-actual">
                      Final {quotes.total.toFixed(2)}
                    </small>
                  </dd>
                </div>
              </dl>
            )}
            <small className="example-line-note">
              {live() ? atsSources(spreadRecord(team.roster_id).rows.filter(row=>row.week===shown.row.week)) || "Actual final score" : "Example Lines · Actual Final Scores"}
            </small>
          </div>,
          document.body,
        )}
    </div>
  );
}
export type InjuryEntry = {
  id: string;
  name: string;
  headshot: string;
  position: string;
  bodyPart: string;
  status: "Out" | "Doubtful" | "IR" | "Questionable";
};
export function InjuryReport({ injuries }: { injuries: InjuryEntry[] }) {
  return (
    <section className="injury-preview">
      <h4>
        Injury Report{" "}
        <span className="injury-count">{injuries.length}</span>
      </h4>
      <div
        className="injury-list"
        role="region"
        aria-label="Injury Details"
        tabIndex={0}
      >
        {[...injuries].sort((a,b) => ["Questionable", "Doubtful", "Out", "IR"].indexOf(a.status) - ["Questionable", "Doubtful", "Out", "IR"].indexOf(b.status)).map((p) => (
          <div className="injury-row" key={p.id}>
            <img src={p.headshot} alt="" />
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.position} · {p.bodyPart} ·{" "}
                <span className={"injury-status " + p.status.toLowerCase()}>
                  {p.status}
                </span>
              </small>
            </div>
          </div>
        ))}
        {!injuries.length && <p>No Reported Injuries</p>}
      </div>
    </section>
  );
}
const sampleInjuries = (roster: number): InjuryEntry[] =>
  live() ? live().book.payload.players.filter((p:any)=>p.roster===roster&&["Questionable","Doubtful","Out","IR"].includes(p.injury)).map((p:any)=>({id:p.id,name:p.name,headshot:p.headshot,position:p.position,bodyPart:p.injuryBody||"Not Specified",status:p.injury})) : players
    .filter((p) => p.roster === roster)
    .sort((a, b) => (b.seasonAverage || 0) - (a.seasonAverage || 0))
    .slice(0, roster === 1 ? 5 : 2)
    .map((p, i) => ({
      id: p.id,
      name: p.name,
      headshot: p.headshot,
      position: p.position,
      bodyPart: ["Ankle", "Hamstring", "Knee", "Shoulder", "Wrist"][i],
      status:
        roster === 1
          ? (["Out", "Doubtful", "IR", "Out", "Doubtful"] as const)[i]
          : i === 0
            ? "Out"
            : "Questionable",
    }));
export function MatchupCarousel({ m }: { m: Matchup }) {
  const [page, setPage] = useState(0),
    [paused, setPaused] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [hidden, setHidden] = useState(document.hidden);
  const timerCircle = useRef<SVGCircleElement>(null),
    elapsed = useRef(0);
  const labels = [
    "Teams & Records",
    "Season Stats",
    "Recent Form & Availability",
  ];
  useEffect(() => {
    setPage(0);
  }, [m.id]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    elapsed.current = 0;
    timerCircle.current?.style.setProperty("stroke-dashoffset", "1");
  }, [page, m.id]);
  useEffect(() => {
    if (paused || hovered || focused || hidden) return;
    let frame = 0,
      previous = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - previous;
      previous = now;
      timerCircle.current?.style.setProperty(
        "stroke-dashoffset",
        String(Math.max(0, 1 - elapsed.current / 8000)),
      );
      if (elapsed.current >= 8000) setPage((p) => (p + 1) % 3);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [page, paused, hovered, focused, hidden, m.id]);
  const seed = (t: Team) =>
    teams
      .slice()
      .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
      .findIndex((x) => x.id === t.id) + 1;
  const metricRank = (t: Team, value: (x: Team) => number, lower = false) =>
    1 +
    teams.filter((other) =>
      lower ? value(other) < value(t) : value(other) > value(t),
    ).length;
  const metrics = (t: Team) => [
    {
      label: "Win %",
      value:
        (((t.wins + t.ties * 0.5) / Math.max(1, t.games)) * 100).toFixed(1) +
        "%",
      rank: metricRank(
        t,
        (x) => (x.wins + x.ties * 0.5) / Math.max(1, x.games),
      ),
    },
    {
      label: "Points For",
      value: t.pointsFor.toFixed(2),
      rank: metricRank(t, (x) => x.pointsFor),
    },
    {
      label: "Points Per Game",
      value: (t.pointsFor / Math.max(1, t.games)).toFixed(2),
      rank: metricRank(t, (x) => x.pointsFor / Math.max(1, x.games)),
    },
    {
      label: "Points Against",
      value: t.pointsAgainst.toFixed(2),
      rank: metricRank(t, (x) => x.pointsAgainst, true),
    },
    {
      label: "Lineup Efficiency",
      explanation: "Sleeper regular-season points scored divided by Max PF, the total from each week’s best possible lineup.",
      value: t.potentialPoints > 0
        ? `${(100 * t.pointsFor / t.potentialPoints).toFixed(1)}%` : "Unavailable",
      rank: 0,
    },
    {
      label: "Against The Spread",
      value: live()
        ? (() => {
            const record = spreadRecord(t.roster_id);
            return record.rows.length ? `${record.wins}–${record.losses}–${record.pushes}` : "Unavailable";
          })()
        : exampleATS(t.roster_id).wins + "–" + exampleATS(t.roster_id).losses,
      rank: live() ? 0 : metricRank(t, (x) => exampleATS(x.roster_id).rate),
    },
  ];
  const byePlayers: {roster:number;name:string}[] = live()
    ? live().book.payload.players.filter((p: {opponent:string}) => p.opponent === "Bye") : context.byePlayers;
  const earlier = games(m.away).filter(
    (r) => r.opponent === m.home.roster_id && r.week < (live() ? league.week : context.throughWeek),
  );
  return (
    <section
      className={"matchup-carousel carousel-view-" + page}
      role="region"
      aria-roledescription="carousel"
      aria-label="Matchup Information"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false);
      }}
    >
      <div className="carousel-pages">
        {labels.map((label, index) => (
          <div
            className={
              "carousel-page " +
              (page === index ? "active " : "") +
              (index === 0 ? "carousel-identity" : "")
            }
            key={label}
            aria-hidden={page !== index}
            inert={page !== index}
            role="group"
            aria-roledescription="slide"
            aria-label={index + 1 + " Of 3: " + label}
          >
            {[m.away, m.home].map((t, i) => (
              <div className={"carousel-team team-" + i} key={t.id}>
                <header className="carousel-team-header">
                  <Avatar team={t} />
                  <div className="carousel-team-identity">
                    <h2>{t.name}</h2>
                    <p>
                      {t.wins}–{t.losses}
                      {t.ties ? "–" + t.ties : ""}
                      <span className="team-seed">{ordinalSeed(seed(t))}</span>
                    </p>
                  </div>
                </header>
                {index === 0 && (
                  <dl className="carousel-season-stats carousel-opening-stats">
                    {live() && <div className="carousel-current-score"><dt>Current Score</dt><dd>{currentTeamScore(t)}</dd></div>}
                    <div><dt>{live()?"Current Projection":"Projected Points"}</dt><dd>{liveTeamProjection(t,t.id===m.away.id?m.awayProjection:m.homeProjection)}</dd></div>
                    {live()&&<div><dt>Pre-game Projection</dt><dd>{pregameTeamProjection(t)}</dd></div>}
                    <div><dt>Current Streak</dt><dd>{t.streak || "—"}</dd></div>
                  </dl>
                )}
                {index === 1 && (
                  <dl className="carousel-season-stats">
                    {metrics(t).map((metric) => (
                      <div key={metric.label}>
                        <dt title={metric.explanation}>{metric.label}</dt>
                        <dd>
                          {metric.value}
                          {metric.rank > 0 && <small
                            className="metric-rank"
                            title={"League Rank " + metric.rank}
                          >
                            #{metric.rank}
                          </small>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {index === 2 && (
                  <div className="carousel-form">
                    <div className="form-summary-row">
                      <h4>Last Five</h4>
                      <RecentForm team={t} />
                    </div>
                    <div className="form-summary-row">
                      <h4>Current Streak</h4>
                      <b>{t.streak}</b>
                    </div>
                    {byePlayers.some(
                      (p) => p.roster === t.roster_id,
                    ) && (
                      <div className="availability-section">
                        <h4>Week {live() ? league.week : context.throughWeek} Byes</h4>
                        <p tabIndex={0} aria-label="Bye Players">
                          {byePlayers
                            .filter((p) => p.roster === t.roster_id)
                            .map((p) => p.name)
                            .join(", ")}
                        </p>
                      </div>
                    )}
                    <InjuryReport injuries={sampleInjuries(t.roster_id)} />
                  </div>
                )}
              </div>
            ))}
            <span className="carousel-versus">vs</span>
            {index === 1 && (
              <p className="carousel-source-note" tabIndex={0}>
                {live()
                  ? atsSources(spreadRecord(m.away.roster_id).rows) || "Current season · ATS data unavailable"
                  : "Through Week " + context.throughWeek + " · ATS Uses Example Lines"}
              </p>
            )}
            {index === 2 && (
              <div className="carousel-source-note" tabIndex={0}>
                {earlier.length > 0 && (
                  <p>
                    Earlier Meetings:{" "}
                    {earlier
                      .map(
                        (r) =>
                          "Week " +
                          r.week +
                          " · " +
                          m.away.name +
                          " " +
                          r.points.toFixed(2) +
                          "–" +
                          r.against.toFixed(2) +
                          " " +
                          m.home.name,
                      )
                      .join("; ")}
                  </p>
                )}
                <p>{live()?"Sleeper Player Status":"Injury Design Examples · Not Actual Player Status"}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="carousel-controls">
        <button
          className="carousel-pause"
          aria-label={
            paused ? "Start Matchup Rotation" : "Pause Matchup Rotation"
          }
          onClick={() => setPaused(!paused)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {paused ? <path d="m5 3 7 5-7 5Z" /> : <path d="M5 3v10M11 3v10" />}
          </svg>
        </button>
        {labels.map((label, i) => (
          <button
            className={"carousel-dot " + (page === i ? "active" : "")}
            key={label}
            aria-label={"Show " + label}
            aria-current={page === i ? "true" : undefined}
            onClick={() => {
              elapsed.current = 0;
              timerCircle.current?.style.setProperty("stroke-dashoffset", "1");
              setPage(i);
            }}
          >
            {page === i && (
              <svg
                className="carousel-timer"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <circle className="timer-track" cx="10" cy="10" r="8" />
                <circle
                  ref={timerCircle}
                  className="timer-progress"
                  cx="10"
                  cy="10"
                  r="8"
                  pathLength="1"
                />
              </svg>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

import type { ScoreRow } from "../lib/reporting";
export function ScoreTrend({
  rows,
  owner,
}: {
  rows: ScoreRow[];
  owner: (id: string) => string;
}) {
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);
  const teams = [...new Set(rows.map((r) => r.team))];
  if (!weeks.length) return null;
  const max = Math.max(
    50,
    Math.ceil(Math.max(...rows.map((r) => r.actual)) / 50) * 50,
  );
  const x = (week: number) =>
    230 + (weeks.indexOf(week) * 460) / Math.max(1, weeks.length - 1);
  return (
    <figure className="report-chart">
      <figcaption>
        Each team's scoring trajectory
        <span>Shared 0–{max} point scale · final scores only</span>
      </figcaption>
      <div className="report-svg-wrap">
        <svg
          viewBox={`0 0 760 ${teams.length * 70 + 30}`}
          role="img"
          aria-label="Team-by-team weekly scores on the same scale"
        >
          {teams.map((team, i) => {
            const series = rows
              .filter((r) => r.team === team)
              .sort((a, b) => a.week - b.week);
            const y = (v: number) => i * 70 + 58 - (v / max) * 46;
            return (
              <g key={team}>
                <text x="10" y={i * 70 + 32} fill="var(--text)" fontSize="12">
                  {owner(team)}
                </text>
                <line
                  x1="230"
                  x2="690"
                  y1={y(0)}
                  y2={y(0)}
                  stroke="var(--border)"
                />
                {series
                  .slice(1)
                  .map(
                    (r, j) =>
                      r.week - series[j].week === 1 && (
                        <line
                          key={r.week}
                          x1={x(series[j].week)}
                          x2={x(r.week)}
                          y1={y(series[j].actual)}
                          y2={y(r.actual)}
                          stroke="var(--chart-blue)"
                          strokeWidth="2"
                        />
                      ),
                  )}
                {series.map((r) => (
                  <g key={r.week}>
                    <circle
                      cx={x(r.week)}
                      cy={y(r.actual)}
                      r="4"
                      fill="var(--chart-gold)"
                    />
                    <title>
                      {owner(team)} · Week {r.week}: {r.actual.toFixed(2)}{" "}
                      points
                    </title>
                  </g>
                ))}
                <text x="710" y={i * 70 + 32} fill="var(--muted)" fontSize="11">
                  {series.at(-1)?.actual.toFixed(1)}
                </text>
              </g>
            );
          })}
          {weeks.map((w) => (
            <text
              key={w}
              x={x(w)}
              y={teams.length * 70 + 17}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="11"
            >
              W{w}
            </text>
          ))}
        </svg>
      </div>
      <p className="report-note">
        Separate team paths reveal scoring momentum without mixing it with
        projection error. Gaps are not connected.
      </p>
    </figure>
  );
}

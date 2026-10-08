import type { ScoreRow } from "../lib/reporting";
export function ScoreTrend({ rows }: { rows: ScoreRow[] }) {
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);
  const series = weeks.map((week) => {
    const values = rows.filter((r) => r.week === week),
      projected = values.filter((r) => r.projection !== null);
    return {
      week,
      actual: values.reduce((n, r) => n + r.actual, 0) / values.length,
      projection: projected.length
        ? projected.reduce((n, r) => n + r.projection!, 0) / projected.length
        : null,
    };
  });
  if (!series.length) return null;
  const max = Math.max(
    50,
    Math.ceil(
      Math.max(...series.flatMap((s) => [s.actual, s.projection ?? 0])) / 50,
    ) * 50,
  );
  const x = (i: number) => 60 + i * (660 / series.length),
    y = (n: number) => 240 - (n / max) * 190;
  return (
    <figure className="report-chart">
      <figcaption>
        Average points by week{" "}
        <span>
          <i className="actual-key" />
          Actual <i className="projected-key" />
          Projected
        </span>
      </figcaption>
      <svg
        viewBox="0 0 760 280"
        role="img"
        aria-label="Weekly average actual and projected scores; chart starts at zero"
      >
        <title>Weekly scores, actual compared with projected</title>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1="50"
              x2="735"
              y1={y(max * t)}
              y2={y(max * t)}
              stroke="var(--border)"
            />
            <text
              x="40"
              y={y(max * t) + 4}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="11"
            >
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <g key={s.week}>
            <rect
              x={x(i) + 10}
              y={y(s.actual)}
              width={Math.min(36, 240 / series.length)}
              height={240 - y(s.actual)}
              rx="4"
              fill="#68b9e8"
            >
              <title>
                Week {s.week} actual average: {s.actual.toFixed(2)}
              </title>
            </rect>
            {s.projection !== null && (
              <rect
                x={x(i) + 14 + Math.min(36, 240 / series.length)}
                y={y(s.projection)}
                width={Math.min(36, 240 / series.length)}
                height={240 - y(s.projection)}
                rx="4"
                fill="var(--gold)"
              >
                <title>
                  Week {s.week} projected average: {s.projection.toFixed(2)}
                </title>
              </rect>
            )}
            <text
              x={x(i) + 30}
              y="264"
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="12"
            >
              W{s.week}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

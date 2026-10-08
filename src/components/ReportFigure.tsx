export type FigurePoint = {
  label: string;
  value: number;
  second?: number;
  low?: number;
  high?: number;
  count?: number;
};
export type FigureSpec = {
  title: string;
  note: string;
  type: "paired" | "range" | "diverging" | "bars" | "stacked" | "calibration";
  points: FigurePoint[];
  unit: string;
  legend?: string[];
};
const colors = ["var(--chart-blue)", "var(--chart-gold)", "var(--chart-orange)"];
export function ReportFigure({ spec }: { spec: FigureSpec }) {
  const points = spec.points.filter((p) => Number.isFinite(p.value));
  if (!points.length)
    return (
      <p className="report-empty">
        This chart needs eligible data. Missing or unresolved values are not
        plotted.
      </p>
    );
  const calibration = spec.type === "calibration";
  const height = calibration ? 330 : Math.max(170, points.length * 34 + 60);
  const left = calibration ? 60 : 205,
    right = 690;
  const max =
    spec.unit === "%"
      ? 100
      : Math.max(
          1,
          ...points.flatMap((p) => [
            Math.abs(p.value),
            Math.abs(p.second ?? 0),
            p.high ?? 0,
            spec.type === "stacked"
              ? p.value + (p.second ?? 0) + (p.high ?? 0)
              : 0,
          ]),
        );
  const ceiling = spec.unit === "wins" ? Math.max(14, Math.ceil(max)) : max;
  const x = (v: number) => left + (v / ceiling) * (right - left);
  const center = (left + right) / 2;
  const signedX = (v: number) => center + ((v / ceiling) * (right - left)) / 2;
  const format = (v: number) =>
    `${v.toFixed(spec.unit === "tickets" || spec.unit === "jobs" || spec.unit === "emails" ? 0 : 1)}${spec.unit === "%" ? "%" : ""}`;
  return (
    <figure className="report-chart">
      <figcaption>
        {spec.title}
        <span>
          {(spec.legend ?? [spec.unit]).map((label, i) => (
            <span key={label}>
              <i style={{ background: colors[i % 3] }} />
              {label}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="report-svg-wrap">
        <svg
          viewBox={`0 0 760 ${height}`}
          role="img"
          aria-label={`${spec.title}. ${spec.note}`}
        >
          <title>{spec.title}</title>
          {calibration ? (
            <>
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line
                    x1="60"
                    x2="700"
                    y1={280 - v * 2.4}
                    y2={280 - v * 2.4}
                    stroke="var(--border)"
                  />
                  <text
                    x="50"
                    y={284 - v * 2.4}
                    textAnchor="end"
                    fill="var(--muted)"
                    fontSize="11"
                  >
                    {v}%
                  </text>
                  <text
                    x={60 + v * 6.4}
                    y="300"
                    textAnchor="middle"
                    fill="var(--muted)"
                    fontSize="11"
                  >
                    {v}%
                  </text>
                </g>
              ))}
              <line
                x1="60"
                y1="280"
                x2="700"
                y2="40"
                stroke="var(--chart-gold)"
                strokeDasharray="6 5"
              />
              {points.map((p) => (
                <circle
                  key={p.label}
                  cx={60 + p.value * 6.4}
                  cy={280 - (p.second ?? 0) * 2.4}
                  r={Math.min(16, 5 + Math.sqrt(p.count ?? 1))}
                  fill={colors[0]}
                  fillOpacity=".8"
                >
                  <title>
                    {p.label}: predicted {format(p.value)}, won{" "}
                    {format(p.second ?? 0)}; {p.count} outcomes
                  </title>
                </circle>
              ))}
              <text
                x="380"
                y="326"
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="12"
              >
                Predicted probability → · vertical axis: actual win rate
              </text>
            </>
          ) : (
            <>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <g key={t}>
                  <line
                    x1={
                      spec.type === "diverging"
                        ? signedX((t * 2 - 1) * ceiling)
                        : x(t * ceiling)
                    }
                    x2={
                      spec.type === "diverging"
                        ? signedX((t * 2 - 1) * ceiling)
                        : x(t * ceiling)
                    }
                    y1="22"
                    y2={height - 35}
                    stroke="var(--border)"
                  />
                  <text
                    x={
                      spec.type === "diverging"
                        ? signedX((t * 2 - 1) * ceiling)
                        : x(t * ceiling)
                    }
                    y={height - 15}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--muted)"
                  >
                    {format(
                      spec.type === "diverging"
                        ? (t * 2 - 1) * ceiling
                        : t * ceiling,
                    )}
                  </text>
                </g>
              ))}
              {points.map((p, i) => {
                const y = 40 + i * 34;
                return (
                  <g key={`${p.label}:${i}`}>
                    <text
                      x={left - 15}
                      y={y + 4}
                      textAnchor="end"
                      fill="var(--text)"
                      fontSize="12"
                    >
                      <title>{p.label}</title>
                      {p.label.length > 24
                        ? p.label.slice(0, 23) + "…"
                        : p.label}
                    </text>
                    {spec.type === "paired" ? (
                      <>
                        <line
                          x1={x(p.value)}
                          x2={x(p.second ?? p.value)}
                          y1={y}
                          y2={y}
                          stroke="var(--muted)"
                          strokeWidth="3"
                        />
                        <circle cx={x(p.value)} cy={y} r="5" fill={colors[0]} />
                        <circle
                          cx={x(p.second ?? p.value)}
                          cy={y}
                          r="5"
                          fill={colors[1]}
                        />
                      </>
                    ) : spec.type === "range" ? (
                      <>
                        <line
                          x1={x(p.low ?? p.value)}
                          x2={x(p.high ?? p.value)}
                          y1={y}
                          y2={y}
                          stroke={colors[0]}
                          strokeWidth="7"
                          strokeLinecap="round"
                        />
                        <circle cx={x(p.value)} cy={y} r="5" fill={colors[1]} />
                        {p.second !== undefined && (
                          <line
                            x1={x(p.second)}
                            x2={x(p.second)}
                            y1={y - 10}
                            y2={y + 10}
                            stroke="var(--text)"
                            strokeWidth="2"
                          />
                        )}
                      </>
                    ) : spec.type === "diverging" ? (
                      <rect
                        x={Math.min(center, signedX(p.value))}
                        y={y - 8}
                        width={Math.abs(signedX(p.value) - center)}
                        height="16"
                        rx="3"
                        fill={p.value >= 0 ? colors[0] : colors[2]}
                      />
                    ) : spec.type === "stacked" ? (
                      [p.value, p.second ?? 0, p.high ?? 0].map((v, j) => {
                        const start = [p.value, p.second ?? 0, p.high ?? 0]
                          .slice(0, j)
                          .reduce((a, b) => a + b, 0);
                        return (
                          <rect
                            key={j}
                            x={x(start)}
                            y={y - 8}
                            width={(v / ceiling) * (right - left)}
                            height="16"
                            fill={colors[j]}
                          />
                        );
                      })
                    ) : (
                      <rect
                        x={left}
                        y={y - 8}
                        width={(p.value / ceiling) * (right - left)}
                        height="16"
                        rx="3"
                        fill={colors[0]}
                      />
                    )}
                    <text x="705" y={y + 4} fill="var(--text)" fontSize="11">
                      {format(p.value)}
                    </text>
                    <title>
                      {p.label}: {format(p.value)}
                      {p.second !== undefined ? ` / ${format(p.second)}` : ""}
                      {p.low !== undefined
                        ? `; range ${format(p.low)}–${format(p.high ?? p.value)}`
                        : ""}
                    </title>
                  </g>
                );
              })}
            </>
          )}
        </svg>
      </div>
      <p className="report-note">{spec.note}</p>
    </figure>
  );
}

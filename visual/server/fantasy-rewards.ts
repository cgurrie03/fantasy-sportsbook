export type FantasyResult = {
  rosterId: number;
  opponentId: number;
  points: number;
  projection?: number;
  spread?: number;
};
export type FantasyWeek = { week: number; results: readonly FantasyResult[] };
export const fantasyRewards = {
  topScorer: { label: "Top Scorer of the Week", percent: 25 },
  win3: { label: "3-Game Win Streak", percent: 10 },
  win5: { label: "5-Game Win Streak", percent: 15 },
  win7: { label: "7-Game Win Streak", percent: 20 },
  win10: { label: "10-Game Win Streak", percent: 30 },
  loss3: { label: "3-Game Losing Streak", percent: 10 },
  loss5: { label: "5-Game Losing Streak", percent: 15 },
  loss7: { label: "7-Game Losing Streak", percent: 20 },
  loss10: { label: "10-Game Losing Streak", percent: 25 },
  closeWin: { label: "Close Win of the Week", percent: 15 },
  upset: { label: "Upset of the Week", percent: 25 },
  highLoss: { label: "High Score in a Loss", percent: 15 },
  beatProjection: { label: "Beat the Projection", percent: 15 },
  seasonRecord: { label: "Season Scoring Record", percent: 30 },
  leagueRecord: { label: "All-Time League Scoring Record", percent: 50 },
  playoffClinch: { label: "Playoff Berth Clinched", percent: 15 },
  champion: { label: "League Champion", percent: 30 },
} as const;
export type RewardKind = keyof typeof fantasyRewards;
export type Reward = { kind: RewardKind; rosterId: number; percent: number };
export type RewardRules = {
  weeklyLimit?: boolean;
  boost?: Partial<Record<RewardKind, number>>;
  enabled?: Partial<Record<RewardKind, boolean>>;
  maxRecipients?: Partial<Record<RewardKind, number>>;
  closeMargin?: number;
  upsetSpread?: number;
  projectionMargin?: number;
};
type RewardContext = {
  current: FantasyWeek;
  previous: readonly FantasyWeek[];
  historicalHigh?: number;
  firstClinches?: readonly number[];
  champion?: number;
  seasonClosing?: boolean;
  rules?: RewardRules;
};

const cents = (points: number) => Math.round(points * 100);
function margin(results: readonly FantasyResult[], row: FantasyResult) {
  const opponent = results.find((result) => result.rosterId === row.opponentId);
  return opponent ? cents(row.points) - cents(opponent.points) : null;
}

export function selectFantasyRewards({
  current,
  previous,
  historicalHigh,
  firstClinches = [],
  champion,
  seasonClosing,
  rules = {},
}: RewardContext) {
  const ranked = [...current.results].sort(
    (a, b) => cents(b.points) - cents(a.points),
  );
  const earned: Reward[] = [];
  const add = (kind: RewardKind, rosterId: number) => {
    const percent = rules.boost?.[kind] ?? fantasyRewards[kind].percent;
    if (percent > 0 && rules.enabled?.[kind] !== false) earned.push({ kind, rosterId, percent });
  };
  const earlier = previous
    .filter((week) => week.week < current.week)
    .sort((a, b) => b.week - a.week);
  const highest = ranked[0];
  if (highest) {
    const leaders = ranked.filter(
      (row) => cents(row.points) === cents(highest.points),
    );
    const priorHigh = Math.max(
      -Infinity,
      ...earlier.flatMap((week) =>
        week.results.map((row) => cents(row.points)),
      ),
    );
    const archive = historicalHigh == null ? null : cents(historicalHigh);
    for (const row of leaders) {
      add("topScorer", row.rosterId);
      if (
        current.week >= 2 &&
        Number.isFinite(priorHigh) &&
        cents(row.points) > priorHigh
      )
        add("seasonRecord", row.rosterId);
      if (archive != null && cents(row.points) > Math.max(priorHigh, archive))
        add("leagueRecord", row.rosterId);
    }
  }

  const close = ranked
    .flatMap((row) => {
      const result = margin(ranked, row);
      return result != null &&
        result > 0 &&
        result <= cents(rules.closeMargin ?? 10)
        ? [{ row, result }]
        : [];
    })
    .sort(
      (a, b) =>
        a.result - b.result || cents(b.row.points) - cents(a.row.points),
    );
  if (
    close[0] &&
    !(
      close[1]?.result === close[0].result &&
      cents(close[1].row.points) === cents(close[0].row.points)
    )
  ) {
    add("closeWin", close[0].row.rosterId);
  }
  const projectionBeaters = ranked
    .filter((row) => row.projection != null)
    .map((row) => ({ row, over: cents(row.points) - cents(row.projection!) }))
    .sort((a, b) => b.over - a.over);
  for (const { row, over } of projectionBeaters) {
    if (
      over < cents(rules.projectionMargin ?? 20) ||
      over !== projectionBeaters[0].over
    )
      break;
    add("beatProjection", row.rosterId);
  }

  for (const [index, row] of ranked.entries()) {
    const result = margin(ranked, row);
    if (
      result != null &&
      result > 0 &&
      (row.spread ?? 0) >= (rules.upsetSpread ?? 20)
    )
      add("upset", row.rosterId);
    if (index < 3 && result != null && result < 0)
      add("highLoss", row.rosterId);
    if (!result) continue;
    const sign = Math.sign(result);
    let streak = 1;
    for (const week of earlier) {
      if (week.week !== current.week - streak) break;
      const past = week.results.find(
        (entry) => entry.rosterId === row.rosterId,
      );
      const pastMargin = past && margin(week.results, past);
      if (pastMargin == null || Math.sign(pastMargin) !== sign) break;
      streak++;
    }
    if ([3, 5, 7, 10].includes(streak))
      add(((sign > 0 ? "win" : "loss") + streak) as RewardKind, row.rosterId);
  }
  for (const rosterId of new Set(firstClinches)) add("playoffClinch", rosterId);
  if (champion != null) add("champion", champion);

  const redeemable = earned.filter(
    (award) => !seasonClosing || award.kind === "champion",
  );
  if (!rules.weeklyLimit) return { earned, awards: redeemable };
  const best = new Map<number, Reward>();
  for (const award of redeemable) {
    const previous = best.get(award.rosterId);
    if (
      !previous ||
      award.percent > previous.percent ||
      (award.percent === previous.percent && award.kind === "champion")
    )
      best.set(award.rosterId, award);
  }
  return { earned, awards: [...best.values()] };
}

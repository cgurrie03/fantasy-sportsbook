export type TimingTeam = { rosterId: number; recordUnits: number };
export type TimingGame = { home: number; away: number };
export type TimingResult = { clinched: number[]; eliminated: number[] };

// Each remaining game distributes two record units. A split represents a tie.
function canAllocate(
  games: readonly TimingGame[],
  limits: Map<number, number>,
  minima: boolean,
) {
  const ids = [...limits.keys()];
  const source = 0;
  const teamStart = games.length + 1;
  const sink = teamStart + ids.length;
  const graph: { to: number; remaining: number; reverse: number }[][] =
    Array.from({ length: sink + 1 }, () => []);
  function connect(from: number, to: number, remaining: number) {
    graph[from].push({ to, remaining, reverse: graph[to].length });
    graph[to].push({ to: from, remaining: 0, reverse: graph[from].length - 1 });
  }
  const nodes = new Map(ids.map((id, index) => [id, teamStart + index]));
  games.forEach(({ home, away }, index) => {
    const game = index + 1;
    connect(source, game, 2);
    connect(game, nodes.get(home)!, 2);
    connect(game, nodes.get(away)!, 2);
  });
  for (const [id, limit] of limits) connect(nodes.get(id)!, sink, limit);
  let required = minima
    ? [...limits.values()].reduce((sum, value) => sum + value, 0)
    : games.length * 2;
  while (required > 0) {
    const parent = new Map<number, { from: number; index: number }>();
    const queue = [source];
    for (let i = 0; i < queue.length && !parent.has(sink); i++) {
      const from = queue[i];
      graph[from].forEach((edge, index) => {
        if (edge.remaining && edge.to !== source && !parent.has(edge.to)) {
          parent.set(edge.to, { from, index });
          queue.push(edge.to);
        }
      });
    }
    if (!parent.has(sink)) return false;
    let amount = required;
    for (let node = sink; node !== source;) {
      const { from, index } = parent.get(node)!;
      amount = Math.min(amount, graph[from][index].remaining);
      node = from;
    }
    for (let node = sink; node !== source;) {
      const { from, index } = parent.get(node)!;
      const edge = graph[from][index];
      edge.remaining -= amount;
      graph[node][edge.reverse].remaining += amount;
      node = from;
    }
    required -= amount;
  }
  return true;
}

function someSubset(
  ids: readonly number[],
  count: number,
  test: (subset: Set<number>) => boolean,
) {
  const selected = new Set<number>();
  function visit(index: number, needed: number): boolean {
    if (!needed) return test(selected);
    if (ids.length - index < needed) return false;
    const id = ids[index];
    selected.add(id);
    if (visit(index + 1, needed - 1)) return true;
    selected.delete(id);
    return visit(index + 1, needed);
  }
  return visit(0, count);
}

export function playoffTiming(
  teams: readonly TimingTeam[],
  remaining: readonly TimingGame[],
  spots: number,
  officialField?: readonly number[],
): TimingResult {
  const ids = teams.map((team) => team.rosterId);
  if (
    !Number.isInteger(spots) ||
    spots < 1 ||
    spots > teams.length ||
    new Set(ids).size !== ids.length ||
    teams.some(
      (team) => !Number.isInteger(team.recordUnits) || team.recordUnits < 0,
    )
  ) {
    throw new Error("Invalid playoff timing inputs.");
  }
  if (officialField) {
    const field = new Set(officialField);
    if (field.size !== spots || [...field].some((id) => !ids.includes(id))) {
      throw new Error("Invalid official playoff field.");
    }
    return {
      clinched: ids.filter((id) => field.has(id)),
      eliminated: ids.filter((id) => !field.has(id)),
    };
  }
  const left = new Map(ids.map((id) => [id, 0]));
  for (const game of remaining) {
    if (
      game.home === game.away ||
      !left.has(game.home) ||
      !left.has(game.away)
    ) {
      throw new Error("Invalid remaining matchup.");
    }
    left.set(game.home, left.get(game.home)! + 1);
    left.set(game.away, left.get(game.away)! + 1);
  }

  // A tied record can favor either team until the official field is known.
  const clinched: number[] = [];
  const eliminated: number[] = [];
  for (const team of teams) {
    const id = team.rosterId;
    const opponents = teams.filter((other) => other.rosterId !== id);
    const games = remaining.filter(
      (game) => game.home !== id && game.away !== id,
    );
    const whenLosing = new Map(
      opponents.map((other) => [other.rosterId, other.recordUnits]),
    );
    for (const game of remaining) {
      const other =
        game.home === id ? game.away : game.away === id ? game.home : null;
      if (other !== null) whenLosing.set(other, whenLosing.get(other)! + 2);
    }
    const available = new Map(opponents.map((other) => [other.rosterId, 0]));
    for (const game of games) {
      available.set(game.home, available.get(game.home)! + 2);
      available.set(game.away, available.get(game.away)! + 2);
    }
    const possible = opponents.filter(
      (other) =>
        whenLosing.get(other.rosterId)! + available.get(other.rosterId)! >=
        team.recordUnits,
    );
    const already = possible.filter(
      (other) => whenLosing.get(other.rosterId)! >= team.recordUnits,
    ).length;
    const canFinishOutside =
      already >= spots ||
      someSubset(
        possible
          .filter((other) => whenLosing.get(other.rosterId)! < team.recordUnits)
          .map((other) => other.rosterId),
        spots - already,
        (chosen) =>
          canAllocate(
            games,
            new Map(
              opponents.map((other) => [
                other.rosterId,
                chosen.has(other.rosterId)
                  ? team.recordUnits - whenLosing.get(other.rosterId)!
                  : 0,
              ]),
            ),
            true,
          ),
      );
    if (!canFinishOutside) clinched.push(id);

    const maximum = team.recordUnits + 2 * left.get(id)!;
    const forcedAhead = opponents.filter(
      (other) => other.recordUnits > maximum,
    );
    const flexible = opponents.filter(
      (other) =>
        other.recordUnits <= maximum &&
        other.recordUnits + available.get(other.rosterId)! > maximum,
    );
    const canFinishInside =
      forcedAhead.length < spots &&
      someSubset(
        flexible.map((other) => other.rosterId),
        Math.min(flexible.length, spots - 1 - forcedAhead.length),
        (allowed) =>
          canAllocate(
            games,
            new Map(
              opponents.map((other) => [
                other.rosterId,
                other.recordUnits > maximum || allowed.has(other.rosterId)
                  ? available.get(other.rosterId)!
                  : Math.min(
                      available.get(other.rosterId)!,
                      maximum - other.recordUnits,
                    ),
              ]),
            ),
            false,
          ),
      );
    if (!canFinishInside) eliminated.push(id);
  }
  return { clinched, eliminated };
}

export function firstPlayoffEvents(
  weeks: readonly { week: number; result: TimingResult }[],
) {
  const ordered = [...weeks].sort((a, b) => a.week - b.week);
  const first = (kind: keyof TimingResult) => {
    const entry = ordered.find(({ result }) => result[kind].length > 0);
    return entry
      ? { week: entry.week, rosterIds: [...entry.result[kind]] }
      : null;
  };
  return { clinch: first("clinched"), elimination: first("eliminated") };
}

type TimingWeek = {
  week: number;
  games: readonly TimingGame[];
  scores?: Readonly<Record<number, number>>;
};
type TimingSeason = {
  rosterIds: readonly number[];
  playoffSpots: number;
  regularSeason: readonly TimingWeek[];
  standingsMode: "head-to-head-record" | "custom";
  officialBracket?: { week: number; playoffRosterIds: readonly number[] };
  onWeek?: (week: number, result: TimingResult) => void;
};

export function evaluatePlayoffTiming({
  rosterIds,
  playoffSpots,
  regularSeason,
  standingsMode,
  officialBracket,
  onWeek,
}: TimingSeason) {
  const schedule = [...regularSeason].sort((a, b) => a.week - b.week);
  const weeks: { week: number; result: TimingResult }[] = [];
  const records = rosterIds.map((rosterId) => ({ rosterId, recordUnits: 0 }));
  if (standingsMode === "head-to-head-record") {
    const rosters = new Set(rosterIds);
    const completeSchedule =
      schedule.length > 0 &&
      schedule.every(({ week, games }, index) => {
        const participants = games.flatMap(({ home, away }) => [home, away]);
        return (
          week === index + 1 &&
          participants.length === rosters.size &&
          new Set(participants).size === rosters.size &&
          participants.every((id) => rosters.has(id))
        );
      });
    if (completeSchedule) {
      for (const [index, { week, games, scores }] of schedule.entries()) {
        if (!scores || rosterIds.some((id) => !Number.isFinite(scores[id])))
          break;
        for (const { home, away } of games) {
          const result = Math.sign(
            Math.round(scores[home] * 100) - Math.round(scores[away] * 100),
          );
          records.find((team) => team.rosterId === home)!.recordUnits +=
            1 + result;
          records.find((team) => team.rosterId === away)!.recordUnits +=
            1 - result;
        }
        const remaining = schedule
          .slice(index + 1)
          .flatMap((entry) => entry.games);
        weeks.push({
          week,
          result: playoffTiming(records, remaining, playoffSpots),
        });
      }
    }
  }
  if (officialBracket) {
    weeks.push({
      week: officialBracket.week,
      result: playoffTiming(
        records,
        [],
        playoffSpots,
        officialBracket.playoffRosterIds,
      ),
    });
  }
  for (const {week, result} of weeks) onWeek?.(week, result);
  return firstPlayoffEvents(weeks);
}

export function score(stats, settings) {
    return Object.entries(settings).reduce((n, [key, weight]) => n + Number(stats[key] ?? 0) * weight, 0);
}
export function candidates(rows, settings, history) {
    return rows
        .filter((row) => row.player && row.date && row.stats?.gp > 0)
        .map((row) => {
        const actual = history.flatMap((h) => h.players_points?.[row.player_id] != null
            ? [Number(h.players_points[row.player_id])]
            : []);
        const average = actual.length
            ? actual.reduce((a, b) => a + b, 0) / actual.length
            : null;
        const projection = Math.max(0, score(row.stats, settings));
        const injury = row.player.injury_status ?? "";
        // Provider projections already incorporate expected availability. Confirmed inactive players are excluded;
        // questionable players retain the provider estimate rather than receiving a second arbitrary discount.
        const inactive = /^(out|ir|pup|suspended)$/i.test(injury);
        const adjustment = average == null
            ? 0
            : Math.max(-projection * 0.15, Math.min(projection * 0.15, (average - projection) * 0.15));
        return {
            id: row.player_id,
            name: [row.player.first_name, row.player.last_name]
                .filter(Boolean)
                .join(" ") || row.player_id,
            positions: row.player.fantasy_positions ?? [row.player.position ?? ""],
            projection,
            expected: inactive ? 0 : Math.max(0, projection + adjustment),
            average,
            injury,
            team: row.team ?? "",
            game: `${row.date}${row.opponent ? ` vs. ${row.opponent}` : ""}`,
        };
    });
}
const flexible = {
    FLEX: ["RB", "WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    REC_FLEX: ["WR", "TE"],
    WRRB_FLEX: ["WR", "RB"],
};
export function bestLineup(players, positions, allowEmpty = false) {
    const result = projectedLineup(players, positions);
    if (result.missingSlots.length && !allowEmpty)
        throw new Error("A complete projected lineup could not be formed. Check roster eligibility, injuries, and projection coverage.");
    return result.picks;
}
export function projectedLineup(players, positions) {
    const slots = positions.filter((p) => !["BN", "IR", "TAXI"].includes(p));
    if (slots.length > 16)
        throw new Error("This league has more starting slots than the line model supports.");
    // Exact assignment by slot mask: each player can occupy only one eligible slot, including flexible slots.
    const states = new Map([
        [0, { value: 0, picks: [] }],
    ]);
    const unique = new Map();
    for (const p of players.filter((p) => p.expected > 0 && p.projection > 0))
        if (!unique.has(p.id) || unique.get(p.id).projection < p.projection)
            unique.set(p.id, p);
    for (const player of unique.values()) {
        for (const [mask, state] of [...states]) {
            slots.forEach((slot, index) => {
                if (mask & (1 << index) ||
                    !player.positions.some((p) => (flexible[slot] ?? [slot]).includes(p)))
                    return;
                const next = mask | (1 << index), value = state.value + player.projection;
                if (!states.has(next) || states.get(next).value < value)
                    states.set(next, { value, picks: [...state.picks, player] });
            });
        }
    }
    // Cover as many mandatory slots as possible before maximizing points.
    const filled = (mask) => mask.toString(2).replace(/0/g, "").length;
    const [mask, result] = [...states].sort((a, b) => filled(b[0]) - filled(a[0]) || b[1].value - a[1].value)[0];
    const missingSlots = slots.flatMap((slot, index) => mask & (1 << index)
        ? []
        : [
            slots.filter((s) => s === slot).length > 1
                ? `${slot} ${slots.slice(0, index + 1).filter((s) => s === slot).length}`
                : slot,
        ]);
    return { picks: result.picks, missingSlots };
}
// Fill only gaps left after optimizing the team's own eligible roster. These are
// team forecast estimates, never actual starters or player-market selections.
export function lineupWithReplacements(players, freeAgents, positions) {
    const selected = projectedLineup(players, positions);
    const missingSlots = [];
    const replacements = [];
    for (const label of selected.missingSlots) {
        const slot = label.replace(/ \d+$/, "");
        const eligible = flexible[slot] ?? [slot];
        const top = [
            ...new Map(freeAgents
                .filter((p) => Number.isFinite(p.projection) &&
                p.projection > 0 &&
                Number.isFinite(p.expected) &&
                p.expected > 0 &&
                p.positions.some((position) => eligible.includes(position)))
                .map((p) => [p.id, p])).values(),
        ]
            .sort((a, b) => b.projection - a.projection || a.id.localeCompare(b.id))
            .slice(0, 3);
        if (!top.length) {
            missingSlots.push(label);
            continue;
        }
        const mean = top.reduce((sum, p) => sum + p.projection, 0) / top.length;
        replacements.push({
            id: `replacement:${label}`,
            name: `${label} free-agent estimate`,
            positions: [slot],
            projection: mean,
            expected: mean,
            average: null,
            injury: "",
            team: "",
            game: "",
            replacement: {
                slot: label,
                method: "top-three-unrostered-mean-v1",
                sources: top.map((p) => ({
                    id: p.id,
                    name: p.name,
                    projection: p.projection,
                })),
            },
        });
    }
    return {
        picks: [...selected.picks, ...replacements],
        missingSlots,
        replacements,
    };
}
export function deviation(scores, projection) {
    const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
    const empirical = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) /
        Math.max(1, scores.length - 1));
    return Math.max(12, Math.min(projection * 0.35, scores.length > 1 ? empirical : projection * 0.18));
}
export function highLowProbabilities(teams, seed = 42, projectionTargets = teams.map((t) => t.mean)) {
    const high = teams.map(() => 1), low = teams.map(() => 1), trials = 6000;
    const counts150 = Array.from({ length: teams.length + 1 }, () => 1);
    const countsProjection = Array.from({ length: teams.length + 1 }, () => 1), averageScores = [], highestScores = [];
    let anyBelow100 = 1, anyAtLeast200 = 1;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed + 1) / 4294967297;
    };
    for (let i = 0; i < trials; i++) {
        const scores = teams.map((t) => t.mean +
            t.sd *
                Math.sqrt(-2 * Math.log(random())) *
                Math.cos(2 * Math.PI * random()));
        high[scores.indexOf(Math.max(...scores))]++;
        low[scores.indexOf(Math.min(...scores))]++;
        counts150[scores.filter((s) => s >= 150).length]++;
        countsProjection[scores.filter((s, i) => s > projectionTargets[i]).length]++;
        averageScores.push(scores.reduce((a, b) => a + b, 0) / teams.length);
        highestScores.push(Math.max(...scores));
        if (scores.some((s) => s < 100))
            anyBelow100++;
        if (scores.some((s) => s >= 200))
            anyAtLeast200++;
    }
    return {
        high: high.map((n) => n / (trials + teams.length)),
        low: low.map((n) => n / (trials + teams.length)),
        counts150: counts150.map((n) => n / (trials + teams.length + 1)),
        countsProjection: countsProjection.map((n) => n / (trials + teams.length + 1)),
        averageScores,
        highestScores,
        anyBelow100: anyBelow100 / (trials + 2),
        anyAtLeast200: anyAtLeast200 / (trials + 2),
    };
}
// Half-point spreads prevent an accidental pick'em from rounding a narrow projection gap.
export function matchupSpread(home, away) {
    const difference = away - home;
    const magnitude = Math.max(0.5, Math.round(Math.abs(difference) * 2) / 2);
    return difference < 0 ? -magnitude : magnitude;
}
// Maximize the combined high/low likelihood while assigning each team to only
// one balanced field. Independent high/low lists can overlap for volatile teams.
export function weeklyScorerFields(high, low) {
    if (high.length !== low.length || high.length < 8 || high.length > 16 || high.length % 2)
        throw new Error("Weekly scorer fields support even leagues with 8–16 eligible teams; odd fields require a reviewed policy.");
    if ([...high, ...low].some((p) => !Number.isFinite(p) || p < 0 || p > 1))
        throw new Error("Weekly scorer probabilities are unavailable.");
    const half = high.length / 2;
    const ranked = high
        .map((_, i) => i)
        .sort((a, b) => high[b] - low[b] - (high[a] - low[a]) || a - b);
    return {
        high: ranked.slice(0, half).sort((a, b) => high[b] - high[a] || a - b),
        low: ranked.slice(half).sort((a, b) => low[b] - low[a] || a - b),
    };
}

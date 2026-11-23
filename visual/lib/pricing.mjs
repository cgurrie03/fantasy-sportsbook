import { candidates, lineupWithReplacements, score } from './_line-model.mjs';
const LEAGUE = '1312126153980391424';
const half = (n) => Math.floor(Math.abs(n)) + .5;
const rounded = (n) => Math.round(n * 100) / 100;
const american = (p) => { p = Math.min(.99, Math.max(.01, p)); const n = p <= .5 ? (1 / p - 1) * 100 : -100 * p / (1 - p); return Math.sign(n) * Math.max(100, Math.round(Math.abs(n) / 10) * 10); };
const houseMargin = 1.0476;
const price = (fair) => american(fair * houseMargin);
// Approximate a standard normal CDF with error below 1e-6.
const normal = (z) => {
    const t = 1 / (1 + .2316419 * Math.abs(z));
    const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t * (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z < 0 ? tail : 1 - tail;
};
async function source(url) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok)
    throw Error('pricing_source_' + new URL(url).hostname + '_' + r.status); return r.json(); }
// One source collection is shared by the league. Raw provider bodies are not stored.
export async function buildDevBook(dbTeams, requestedWeek, refreshMinutes, openingTargets) {
    const state = await source('https://api.sleeper.app/v1/state/nfl');
    const season = Number(state.season), week = requestedWeek ?? Number(state.week);
    if (season !== 2026 || week !== Number(state.week))
        throw Error('pricing_week_mismatch');
    const base = 'https://api.sleeper.app/v1/league/' + LEAGUE;
    const [league, rosters, users, matchups, projections, seasonStats, scoreboard] = await Promise.all([
        source(base), source(base + '/rosters'), source(base + '/users'), source(base + '/matchups/' + week),
        source(`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`),
        source(`https://api.sleeper.com/stats/nfl/${season}?season_type=regular`),
        source(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&year=${season}&seasontype=2`).catch(() => null)
    ]);
    if (rosters.length !== dbTeams.length || matchups.length !== rosters.length)
        throw Error('pricing_roster_mismatch');
    const settings = league.scoring_settings, slots = league.roster_positions.filter((p) => !['BN', 'IR', 'TAXI'].includes(p));
    const pool = candidates(projections, settings, []), byId = new Map(pool.map(p => [p.id, p])), owned = new Set(rosters.flatMap((r) => r.players || []));
    const free = pool.filter(p => !owned.has(p.id));
    const games = new Map();
    for (const e of scoreboard?.events || []) {
        const c = e.competitions?.[0], s = e.status || c?.status;
        if (!s)
            continue;
        const period = Number(s.period || 0), clock = Number(s.displayClock?.split(':')[0] || 0) * 60 + Number(s.displayClock?.split(':')[1] || 0);
        const remaining = s.type?.completed ? 0 : s.type?.state === 'pre' ? 1 : Math.max(0, Math.min(1, ((4 - Math.max(1, period)) * 900 + clock) / 3600));
        for (const t of c?.competitors || [])
            games.set(t.team.abbreviation, { state: s.type?.state, remaining, start: e.date });
    }
    if (!games.size) {
        const schedule = await source(`https://api.sleeper.app/schedule/nfl/regular/${season}`);
        for (const g of schedule.filter((g) => g.week === week)) {
            if (!['pre_game', 'complete'].includes(g.status))
                throw Error('pricing_live_clock_unavailable');
            for (const team of [g.home, g.away])
                games.set(team, { state: g.status === 'complete' ? 'post' : 'pre', remaining: g.status === 'complete' ? 0 : 1, start: projections.filter((p) => p.team === team && p.date).map((p) => p.date + 'T00:00:00Z').sort()[0] || g.date + 'T00:00:00Z' });
        }
    }
    if (!games.size)
        throw Error('pricing_schedule_unavailable');
    const stats = new Map((Array.isArray(seasonStats) ? seasonStats : []).map((p) => [p.player_id, p]));
    const players = [];
    const teams = rosters.map((r) => {
        const db = dbTeams.find(t => t.roster_id === r.roster_id);
        if (!db)
            throw Error('pricing_team_unmapped');
        const actual = matchups.find((m) => m.roster_id === r.roster_id), managers = [r.owner_id, ...(r.co_owners || [])].map(id => users.find((u) => u.user_id === id)).filter(Boolean), primary = managers[0];
        const lockedSlots = new Set();
        let lockedRemaining = 0;
        (actual.starters || []).forEach((id, i) => { const p = byId.get(id); const g = games.get(p?.team || projections.find((x) => x.player_id === id)?.team); if (g && g.state !== 'pre') {
            lockedSlots.add(i);
            lockedRemaining += (p?.projection || 0) * g.remaining;
        } });
        const unlocked = (r.players || []).map((id) => byId.get(id)).filter((p) => p && games.get(p.team)?.state === 'pre');
        const lineup = lineupWithReplacements(unlocked, free.filter(p => games.get(p.team)?.state === 'pre'), slots.filter((_, i) => !lockedSlots.has(i)));
        if (lineup.missingSlots.length)
            throw Error('pricing_lineup_incomplete');
        const mean = rounded(Number(actual.points || 0) + lockedRemaining + lineup.picks.reduce((n, p) => n + p.projection, 0));
        const selected = new Set(lineup.picks.map(p => p.id));
        for (const id of r.players || []) {
            const row = projections.find((p) => p.player_id === id), p = byId.get(id);
            if (!row?.player)
                continue;
            const st = stats.get(id);
            const pos = row.player.position;
            players.push({ id, name: [row.player.first_name, row.player.last_name].filter(Boolean).join(' '), position: pos, nflTeam: row.team, roster: r.roster_id, starter: selected.has(id) || (actual.starters || []).some((x, i) => x === id && lockedSlots.has(i)), seasonAverage: st?.stats?.gp ? rounded(score(st.stats, settings) / st.stats.gp) : null, gamesPlayed: st?.stats?.gp || 0, headshot: `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`, opponent: row.opponent || 'Bye', homeAway: '', kickoff: games.get(row.team)?.start || null, lineupIndex: (actual.starters || []).indexOf(id), lineupSlot: slots[(actual.starters || []).indexOf(id)] || pos, projection: p?.projection || 0, injury: row.player.injury_status || '', injuryBody: row.player.injury_body_part || '' });
        }
        const rs = r.settings || {}, wins = rs.wins || 0, losses = rs.losses || 0, ties = rs.ties || 0;
        return { id: db.id, roster_id: r.roster_id, name: primary?.metadata?.team_name || db.team_name, avatar: primary?.metadata?.avatar || primary?.avatar || db.avatar_url, manager: primary?.display_name || primary?.username || db.owner_name, managers: managers.map((u) => u.display_name || u.username), managerProfiles: managers.map((u) => ({ name: u.display_name || u.username, avatar: u.avatar, sleeperId: String(u.user_id) })), wins, losses, ties, games: wins + losses + ties, pointsFor: rounded((rs.fpts || 0) + (rs.fpts_decimal || 0) / 100), pointsAgainst: rounded((rs.fpts_against || 0) + (rs.fpts_against_decimal || 0) / 100), potentialPoints: rounded((rs.ppts || 0) + (rs.ppts_decimal || 0) / 100), streak: r.metadata?.streak || '', projection: mean, observed: Number(actual.points || 0), matchupId: actual.matchup_id, lineup: lineup.picks.map(p => ({ id: p.id, projection: p.projection, replacement: p.replacement || null })) };
    });
    const quotes = [];
    const groups = new Map();
    for (const t of teams) {
        if (t.matchupId != null)
            groups.set(t.matchupId, [...(groups.get(t.matchupId) || []), t]);
    }
    for (const [mid, pair] of groups) {
        if (pair.length !== 2)
            continue;
        const [away, home] = pair;
        const matchup = String(mid), total = half(away.projection + home.projection), spread = (away.projection > home.projection ? -1 : 1) * half(away.projection - home.projection), sd = Math.max(14, Math.sqrt(away.projection ** 2 + home.projection ** 2) * .14);
        const context = { model: 'dev-sleeper-projection-v1', scoring_settings: settings, roster_positions: league.roster_positions, away_lineup: away.lineup, home_lineup: home.lineup, projection_targets: { [away.id]: away.projection, [home.id]: home.projection }, source_week: week };
        const add = (kind, side, line, odds, t = null, suffix = '') => { const id = `${matchup}:${kind}${suffix}:${side}`; quotes.push({ ui_id: id, ui_group: `${matchup}:${kind}${suffix}`, matchup_key: matchup, kind, side, line, odds, label: kind === 'moneyline' ? t.name : kind === 'spread' ? `${t.name} ${line > 0 ? '+' : ''}${line}` : `${side === 'over' ? 'Over' : 'Under'} ${line}`, subject: t?.name || `${away.name} vs ${home.name}`, team_id: t?.id || null, home_team_id: home.id, away_team_id: away.id, home_projection: home.projection, away_projection: away.projection, metadata: context, boost_pct: 0, featured: '' }); };
        for (const [side, t, other] of [['away', away, home], ['home', home, away]]) {
            add('spread', side, side === 'away' ? spread : -spread, -110, t);
            add('moneyline', side, null, price(normal((t.projection - other.projection) / sd)), t);
        }
        add('match_total', 'over', total, -110);
        add('match_total', 'under', total, -110);
        for (const delta of [-10, -5, 5, 10]) {
            for (const [side, t, line] of [['away', away, spread + delta], ['home', home, -spread - delta]]) {
                add('spread', side, line, price(normal(((t.projection - (side === 'away' ? home : away).projection) + line) / sd)), t, ':alternate:' + delta);
                Object.assign(quotes.at(-1), { ui_id: `alternate-${matchup}-spread-${side}-${line}`, ui_group: `${matchup}:spread`, variant_key: `${matchup}:spread:alternate:${delta}`, metadata: { ...context, alternate: true } });
            }
            for (const side of ['over', 'under']) {
                const line = total + delta;
                add('match_total', side, line, price(normal((side === 'over' ? 1 : -1) * (away.projection + home.projection - line) / sd)), null, ':alternate:' + delta);
                Object.assign(quotes.at(-1), { ui_id: `alternate-${matchup}-match_total-${side}-${line}`, ui_group: `${matchup}:match_total`, variant_key: `${matchup}:match_total:alternate:${delta}`, metadata: { ...context, alternate: true } });
            }
        }
        for (const t of pair) {
            const line = half(t.projection);
            for (const side of ['over', 'under'])
                add('team_total', side, line, -110, t, ':' + t.id);
        }
        const available = (player) => player && player.opponent !== 'Bye' && player.projection > 0
            && !/^(out|ir|pup|suspended)$/i.test(player.injury)
            && games.get(player.nflTeam)?.state === 'pre' && Date.parse(player.kickoff) > Date.now();
        league.roster_positions.forEach((slot, index) => {
            if (['K', 'BN', 'IR', 'TAXI'].includes(slot))
                return;
            const a = players.find(p => p.roster === away.roster_id && p.lineupIndex === index);
            const b = players.find(p => p.roster === home.roster_id && p.lineupIndex === index);
            if (!available(a) || !available(b) || a.id === b.id)
                return;
            const deadline = new Date(Math.min(Date.parse(a.kickoff), Date.parse(b.kickoff))).toISOString();
            const group = `${matchup}:player_h2h:${index}:${a.id}:${b.id}`;
            const chance = normal((b.projection - a.projection) / Math.max(5, Math.hypot(a.projection, b.projection) * .32));
            for (const [side, player, team, p] of [['away', a, away, 1 - chance], ['home', b, home, chance]]) {
                quotes.push({ ui_id: `player-${matchup}-${slot.replaceAll('_', ' ')}-${index}-${player.id}`, ui_group: group,
                    matchup_key: matchup, kind: 'player_h2h', side, line: null, odds: price(p), label: player.name,
                    subject: `${a.name} vs ${b.name}`, team_id: team.id, home_team_id: home.id, away_team_id: away.id,
                    home_projection: b.projection, away_projection: a.projection, boost_pct: 0, featured: '',
                    metadata: { player_id: b.id, opponent_player_id: a.id, slot, cutoff: deadline, cutoff_at: deadline } });
            }
        });
        for (const player of players.filter(p => pair.some(t => t.roster_id === p.roster) && available(p))) {
            const team = pair.find(t => t.roster_id === player.roster);
            const target = half(player.projection);
            const deviation = Math.max(5.8, player.projection * .51);
            const addProp = (kind, side, line, label, probability) => {
                const group = `${matchup}:${kind}:${player.id}`;
                quotes.push({ ui_id: `prop-${player.id}-${kind === 'player_points' ? 'Fantasy Points' : 'Milestone Ladders'}-${label}`,
                    ui_group: group, variant_key: `${group}:${line}`, matchup_key: matchup, kind, side, line, odds: price(probability),
                    label: `${player.name} · ${label} Fantasy Points`, subject: player.name, team_id: team.id,
                    home_team_id: home.id, away_team_id: away.id, boost_pct: 0, featured: '',
                    metadata: { player_id: player.id, cutoff: player.kickoff, cutoff_at: player.kickoff } });
            };
            for (const side of ['over', 'under']) {
                const probability = normal((side === 'over' ? player.projection - target : target - player.projection) / deviation);
                addProp('player_points', side, target, `${side === 'over' ? 'Over' : 'Under'} ${target}`, probability);
            }
            for (const line of [10, 15, 20, 25])
                addProp('player_milestone', 'at_least', line, `${line}+`, normal((player.projection - line) / deviation));
        }
    }
    if (quotes.length < 36 || teams.some((t) => !Number.isFinite(t.projection) || t.projection <= 0))
        throw Error('pricing_incomplete');
    const first = [...games.values()].map(g => g.start).filter(Boolean).sort()[0];
    const close = new Date(first);
    close.setUTCDate(close.getUTCDate() + ((9 - close.getUTCDay()) % 7 || 7));
    close.setUTCHours(6, 0, 0, 0);
    const active = [...games.values()].some(g => g.state === 'in');
    const minutes = refreshMinutes ?? (active ? 5 : 60);
    if (first && Date.parse(first) > Date.now()) {
        const projections = teams.map(t => t.projection);
        const targets = Object.fromEntries(teams.map(t => [t.id, openingTargets?.[t.id] ?? t.projection]));
        const add = (kind, title, side, line, probability, label, teamId = null, variant) => {
            quotes.push({ ui_id: `special-${title}-${variant ?? side}`, ui_group: kind, variant_key: `${kind}:${variant ?? side}`,
                kind, side, line, odds: price(probability), label, subject: title, team_id: teamId, boost_pct: 0, featured: '',
                metadata: { cutoff: first, expected_team_count: teams.length, ...(kind === 'weekly_count_projection' ? { projection_targets: targets } : {}) } });
        };
        const teamDeviation = (projection) => Math.max(16, projection * .18);
        const above = (projection, line) => normal((projection - line) / teamDeviation(projection));
        // Integrate each team's score density against the other teams' CDFs.
        const extremeProbabilities = (sign) => {
            const bins = 160, step = 12 / bins;
            const weights = projections.map((mean, i) => {
                let probability = 0;
                for (let bin = 0; bin < bins; bin++) {
                    const z = -6 + (bin + .5) * step;
                    const score = mean + z * teamDeviation(mean);
                    const allOthers = projections.reduce((chance, other, j) => j === i ? chance :
                        chance * (sign === 1 ? 1 - above(other, score) : above(other, score)), 1);
                    probability += Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * allOthers * step;
                }
                return probability;
            });
            const sum = weights.reduce((a, b) => a + b, 0);
            return weights.map(w => w / sum);
        };
        for (const [kind, title, sign] of [['weekly_high', 'Top Scorer', 1], ['weekly_low', 'Lowest Scorer', -1]]) {
            const weights = extremeProbabilities(sign);
            teams.forEach((t, i) => add(kind, title, t.id, null, weights[i], `${t.name} · ${title}`, t.id));
        }
        for (const [kind, title, line, below] of [['weekly_any_below_100', 'Any Team Below 100', 100, true], ['weekly_any_200', 'Any Team Scoring 200+', 200, false]]) {
            const no = projections.reduce((chance, p) => chance * (below ? above(p, line) : 1 - above(p, line)), 1);
            add(kind, title, 'yes', null, 1 - no, `Yes · ${title}`);
            add(kind, title, 'no', null, no, `No · ${title}`);
        }
        for (const [kind, title, mean] of [['weekly_average', 'League Average', projections.reduce((a, b) => a + b, 0) / teams.length], ['weekly_highest_score', 'Highest Score', Math.max(...projections)]]) {
            const averageDeviation = Math.hypot(...projections.map(teamDeviation)) / projections.length;
            // Use the median of the maximum distribution for a competitive highest-score line.
            let target = mean;
            if (kind === 'weekly_highest_score') {
                let low = Math.min(...projections), high = mean + 6 * Math.max(...projections.map(teamDeviation));
                for (let i = 0; i < 32; i++) {
                    const mid = (low + high) / 2;
                    const under = projections.reduce((chance, p) => chance * (1 - above(p, mid)), 1);
                    if (under < .5)
                        low = mid;
                    else
                        high = mid;
                }
                target = (low + high) / 2;
            }
            const line = half(target);
            const under = kind === 'weekly_average' ? normal((line - mean) / averageDeviation) : projections.reduce((chance, p) => chance * (1 - above(p, line)), 1);
            add(kind, title, 'over', line, 1 - under, `Over ${line} · ${title}`);
            add(kind, title, 'under', line, under, `Under ${line} · ${title}`);
        }
        for (const [kind, title] of [['weekly_count_150', 'Teams Scoring 150+'], ['weekly_count_projection', 'Teams Beating Projection']]) {
            const counts = [1, ...teams.map(() => 0)];
            projections.forEach((p, i) => {
                const chance = above(p, kind === 'weekly_count_150' ? 150 : targets[teams[i].id]);
                for (let j = i + 1; j >= 0; j--)
                    counts[j] = counts[j] * (1 - chance) + (counts[j - 1] ?? 0) * chance;
            });
            for (let n = kind === 'weekly_count_150' ? 1 : 0; n <= teams.length; n++) {
                add(kind, title, String(n), n, counts[n], `Exactly ${n} Teams · ${title}`, null, `exact-${n}`);
                if (n > 0)
                    add(kind, title, `${n}+`, n, counts.slice(n).reduce((a, b) => a + b, 0), `At Least ${n} Teams · ${title}`, null, `atleast-${n}`);
            }
        }
    }
    return { week, season, observed_at: new Date().toISOString(), valid_until: new Date(Date.now() + (minutes + 5) * 60000).toISOString(), closes_at: close.toISOString(), quotes, payload: { week, season, leagueName: league.name, leagueAvatar: league.avatar, teams, players, regularSeasonWeeks: league.settings.playoff_week_start - 1, scoring: settings, positions: league.roster_positions, firstGame: first, cadenceMinutes: minutes, pricingModel: 'Dev Projection Pricing', openingTargets: openingTargets ?? Object.fromEntries(teams.map(t => [t.id, t.projection])), gamesActive: active } };
}

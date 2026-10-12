export type EmailKind =
  | "opening"
  | "reminder"
  | "confirmation"
  | "recap"
  | "attention"
  | "signin"
  | "monday_watch";
export const emailLabels: Record<EmailKind, string> = {
  opening: "Opening Email",
  reminder: "Betting Reminder",
  confirmation: "Bet Confirmation",
  recap: "Weekly Recap",
  attention: "Admin Attention",
  signin: "Sign-In Link",
  monday_watch: "Monday Night Ticket Watch",
};
// Scheduled templates follow the betting week; event-triggered messages have no fixed time.
export const emailTemplateGroups: { label: string; kinds: EmailKind[] }[] = [
  {
    label: "Weekly Schedule · Eastern",
    kinds: ["opening", "reminder", "monday_watch", "attention", "recap"],
  },
  {
    label: "Sent On Request / Bet Placement",
    kinds: ["signin", "confirmation"],
  },
];
export function reminderEligible(balance: number | string | null) {
  return (
    balance !== null && Number.isFinite(Number(balance)) && Number(balance) > 0
  );
}
export interface EmailContent {
  brand?: string;
  subject: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  details: [string, string][];
  legs?: { matchup: string; selection: string; type: string }[];
  featured?: {
    title: string;
    teams: {
      name: string;
      record?: string;
      avatarUrl?: string;
      spread: string;
      originalOdds: string;
      boostedOdds: string;
    }[];
    total: string;
    boostedOver?: string;
  }[];
  stories?: { title: string; text: string }[];
  tickets?: {
    id: string;
    status: string;
    tone: "watch" | "won" | "lost" | "neutral";
    summary: string;
    legs: { selection: string; detail: string; teams?: EmailTeamWatch[] }[];
  }[];
  compactDetails?: boolean;
  button: string;
  url: string;
  sample?: boolean;
}
export interface EmailTeamWatch {
  name: string;
  current: number;
  projected: number | null;
  remaining: string[];
  finished: boolean;
  leader: boolean;
  selected: boolean;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function teamWatchText(t: EmailTeamWatch) {
  return `${t.name}${t.leader ? " · Current Leader" : ""}${t.selected ? " · Your Pick" : ""}\n${t.finished ? `Likely final: ${t.current.toFixed(1)} points` : `Current: ${t.current.toFixed(1)} · Projected finish: ${t.projected === null ? "Unavailable" : t.projected.toFixed(1)}`}${!t.finished && t.remaining.length ? `\nRemaining starters: ${t.remaining.join(", ")}` : ""}`;
}
function renderTeamWatch(teams: EmailTeamWatch[] = []) {
  return teams
    .map(
      (t) =>
        `<div style="margin:9px 0;padding:10px 12px;background:${t.leader ? "#fff7df" : "#f3f6fb"};border-left:3px solid ${t.leader ? "#e5b73e" : "#dce3ed"};border-radius:6px;font-size:13px;line-height:1.6"><strong style="color:#182640">${escape(t.name)}</strong>${t.leader || t.selected ? `<div style="font-size:11px;color:#745100;font-weight:bold">${[t.leader ? "Current Leader" : "", t.selected ? "Your Pick" : ""].filter(Boolean).join(" · ")}</div>` : ""}<div style="color:#42516a">${t.finished ? `<strong>Likely final: ${t.current.toFixed(1)} points</strong>` : `Current: <strong>${t.current.toFixed(1)}</strong> · Projected finish: <strong>${t.projected === null ? "Unavailable" : t.projected.toFixed(1)}</strong>`}</div>${!t.finished && t.remaining.length ? `<div style="color:#52617a;font-size:12px;margin-top:4px">Remaining starters: ${escape(t.remaining.join(", "))}</div>` : ""}</div>`,
    )
    .join("");
}
export function renderEmail(content: EmailContent) {
  const safeUrl = /^https:\/\//.test(content.url) ? content.url : "";
  const stories =
    content.stories
      ?.map(
        (s) =>
          `<div style="margin:16px 0;padding:18px;background:#f3f6fb;border-left:4px solid #f3c85f;border-radius:10px"><h2 style="font-size:17px;margin:0 0 9px">${escape(s.title)}</h2><p style="font-size:14px;line-height:1.6;color:#42516a;margin:0">${escape(s.text).replace(/\n/g, "<br>")}</p></div>`,
      )
      .join("") ?? "";
  const featured =
    content.featured
      ?.map(
        (f) =>
          `<table role="presentation" style="width:100%;margin-top:14px;border-spacing:0;border:1px solid #e5be53;border-radius:12px;overflow:hidden;background:#102038;color:#fff"><tr><td colspan="2" style="padding:10px 12px;background:#f3c85f;color:#14233c"><strong style="font-size:17px">${f.title === "Game of the Week" ? "★" : ""} ${escape(f.title)}</strong><div style="font-weight:800;font-size:12px;letter-spacing:1px;margin-top:4px">25% PROFIT BOOST</div></td></tr><tr>${f.teams
            .map((t) => {
              const avatar =
                t.avatarUrl &&
                /^https:\/\/sleepercdn\.com\/avatars\/[a-zA-Z0-9]+$/.test(
                  t.avatarUrl,
                )
                  ? `<img src="${escape(t.avatarUrl)}" alt="${escape(t.name)} profile picture" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:50%;margin:0 auto 6px;border:2px solid #f3c85f">`
                  : `<div style="width:36px;height:36px;line-height:36px;background:#263b58;border-radius:50%;margin:0 auto 6px;font-weight:bold">${escape(t.name.slice(0, 1))}</div>`;
              return `<td style="width:50%;padding:12px 10px 10px;text-align:center;vertical-align:top">${avatar}<div style="font-size:14px;font-weight:bold;line-height:1.3">${escape(t.name)}</div>${t.record ? `<div style="font-size:12px;color:#cbd6e9;margin-top:5px">${escape(t.record)}</div>` : ""}<p style="color:#cbd6e9;font-size:12px;margin:7px 0">Spread <strong style="color:#fff">${escape(t.spread)}</strong></p><div style="border:1px solid #f3c85f;border-radius:9px;padding:8px 6px;background:#20314b"><div style="font-size:11px;color:#f3d477;margin-bottom:4px">Boosted Moneyline</div><span style="font-size:13px;color:#b8c3d6;text-decoration:line-through;margin-right:8px">${escape(t.originalOdds)}</span><strong style="color:#ffe08a;font-size:20px">${escape(t.boostedOdds)}</strong></div></td>`;
            })
            .join(
              "",
            )}</tr><tr><td colspan="2" style="padding:0 12px 10px;text-align:center"><div style="padding:8px;border-radius:9px;background:#263b58;font-size:13px">Match Total <strong>${escape(f.total)}</strong>${f.boostedOver ? `<div style="margin-top:5px;color:#ffe08a;font-weight:bold;font-size:15px">⚡ Boosted Over ${escape(f.total)} · ${escape(f.boostedOver)}</div>` : ""}</div></td></tr></table>`,
      )
      .join("") ?? "";
  const groups = new Map<string, NonNullable<EmailContent["legs"]>>();
  const tickets = (content.tickets ?? [])
    .map((t, index, all) => {
      const color = {
        watch: "#926000",
        won: "#087248",
        lost: "#ad3030",
        neutral: "#52617a",
      }[t.tone];
      const section =
        index === 0 || all[index - 1].tone !== t.tone
          ? `<h2 style="font-size:17px;margin:24px 0 10px;color:#182640">${{ watch: "Tonight’s Watch", won: "Wins &amp; Likely Wins", lost: "Losses &amp; Eliminated Tickets", neutral: "Pushes, Voids &amp; Review" }[t.tone]}</h2>`
          : "";
      return `${section}<table role="presentation" style="width:100%;margin:18px 0;border-collapse:collapse;border:1px solid #dce3ed"><tr><td style="padding:14px;background:#f3f6fb"><strong style="color:${color};font-size:15px">${escape(t.status)}</strong><div style="font-size:12px;color:#52617a;margin-top:6px">Ticket ${escape(t.id)} · ${escape(t.summary)}</div></td></tr><tr><td style="padding:14px"><div style="font-weight:bold;font-size:14px;margin-bottom:12px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:50%;background:#f3c85f;text-align:center;margin-right:7px">${t.legs.length}</span>${t.legs.length === 1 ? "Single" : "Leg Parlay"}</div>${t.legs.map((l) => `<div style="margin:12px 0 12px 12px;border-left:2px solid #dce3ed;padding-left:10px"><strong style="font-size:14px">${escape(l.selection)}</strong><p style="font-size:12px;line-height:1.6;color:#52617a;margin:5px 0">${escape(l.detail).replace(/\n/g, "<br>")}</p>${renderTeamWatch(l.teams)}</div>`).join("")}</td></tr></table>`;
    })
    .join("");
  for (const leg of content.legs ?? [])
    groups.set(leg.matchup, [...(groups.get(leg.matchup) ?? []), leg]);
  const legs = content.legs?.length
    ? `<h2 style="font-size:16px;margin:24px 0 16px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:50%;background:#f3c85f;color:#14233c;margin-right:8px">${content.legs.length}</span> Bet Slip</h2>${[...groups].map(([matchup, picks]) => `<p style="font-size:14px;font-weight:bold;margin:16px 0 8px">${escape(matchup)}</p>${picks.map((p) => `<div style="margin:8px 0 12px 16px;padding-left:10px"><strong style="font-size:14px">${escape(p.selection)}</strong><p style="font-size:12px;color:#52617a;margin:4px 0">${escape(p.type)} · Open</p></div>`).join("")}`).join("")}`
    : "";
  return `<!doctype html><html lang="en"><head><style>@media only screen and (max-width:480px){.email-body{padding:18px!important}.email-header{padding:20px 18px!important}}td,p,div{overflow-wrap:anywhere}</style><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:24px 12px;background:#edf1f7;color:#182640;font-family:Arial,sans-serif"><table role="presentation" style="max-width:580px;width:100%;margin:auto;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden"><tr><td class="email-header" style="background:#102038;color:#fff;padding:26px 28px"><div style="color:#f4cb63;font-size:24px;font-weight:800">${escape((content.brand ?? "Fantasy Sportsbook").slice(0, 1))}</div><p style="margin:12px 0 4px;font-weight:bold;font-size:18px">${escape(content.brand ?? "Fantasy Sportsbook")}</p><p style="margin:0;color:#d1dbee;font-size:13px">Fake Football. Fake Betting.</p></td></tr><tr><td class="email-body" style="padding:28px"><h1 style="font-size:25px;line-height:1.25;margin:0 0 20px">${escape(content.heading)}</h1><p style="line-height:1.6">${escape(content.greeting)}</p>${content.paragraphs.map((p) => `<p style="line-height:1.6;color:#42516a">${escape(p)}</p>`).join("")}${stories}${content.compactDetails ? '<h2 style="font-size:16px;margin:26px 0 12px">Your Week</h2>' : ""}<table role="presentation" style="width:100%;border-collapse:collapse;background:#f3f6fb;border-radius:10px">${content.details.map(([k, v]) => `<tr><td style="padding:${content.compactDetails ? "7px 12px" : "12px 14px"};color:#52617a;font-size:13px">${escape(k)}</td><td style="padding:${content.compactDetails ? "7px 12px" : "12px 14px"};font-weight:bold;text-align:right;font-size:13px">${escape(v)}</td></tr>`).join("")}</table>${featured}${legs}${tickets}<p style="margin:26px 0 18px"><a href="${escape(safeUrl)}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#f3c85f;color:#14233c;font-weight:bold;text-decoration:none">${escape(content.button)}</a></p><p style="font-size:12px;line-height:1.5;color:#65748c">All times Eastern. This league uses pretend money.</p>${content.sample ? '<p style="font-size:12px;color:#65748c">Sample preview — figures, picks, and results are illustrative. No email has been sent.</p>' : ""}</td></tr></table></body></html>`;
}
// Use the published board snapshot so email highlights agree with accepted markets.
export function openingWeekStories(
  teams: { id: string; name: string; projected: number }[],
  championshipFavorites: { owner: string; team: string; odds: number }[] = [],
): NonNullable<EmailContent["stories"]> {
  const ranked = teams
    .filter((t) => Number.isFinite(t.projected))
    .sort((a, b) => b.projected - a.projected || a.name.localeCompare(b.name));
  const list = (rows: typeof ranked) =>
    rows
      .map(
        (t, i) =>
          `${i + 1}. ${t.name} — ${t.projected.toFixed(1)} projected points`,
      )
      .join("\n");
  return [
    ...(championshipFavorites.length
      ? [
          {
            title: "🏆 FUTURE BETS ARE LIVE",
            text:
              "The championship favorites. Who’s bringing home the trophy?\n\n" +
              championshipFavorites
                .slice(0, 4)
                .map(
                  (t, i) =>
                    `${i + 1}. ${t.owner} · ${t.team} · ${t.odds > 0 ? "+" : ""}${t.odds}`,
                )
                .join("\n"),
          },
        ]
      : []),
    ...(ranked.length
      ? [
          {
            title: "🔥 Top 3 Projected Scorers · Bring The Firepower",
            text:
              list(ranked.slice(0, 3)) +
              "\n\nBig projections, bigger expectations. Let's see who actually delivers.",
          },
          {
            title: "🧊 Bottom 3 Projected Scorers · Bulletin Board Material",
            text:
              list([...ranked].reverse().slice(0, 3)) +
              "\n\nThe projections have spoken. A breakout week would make this email age beautifully.",
          },
        ]
      : []),
  ];
}
export function sampleEmail(kind: EmailKind): EmailContent {
  const common = {
    greeting: "Hi Cooper,",
    url: "https://sportsbook.coopergurrie.com/",
    sample: true,
  };
  switch (kind) {
    case "monday_watch":
      return {
        ...common,
        subject: "Your Monday Night Ticket Watch · Week 5",
        heading: "Monday Night. Your Tickets. 🏈",
        paragraphs: [
          "One more game, one more chance. Here’s what to watch in your weekly tickets.",
          "Apparent results await official settlement and may change with stat corrections.",
        ],
        details: [
          ["Week", "Season 3 • Week 5"],
          ["Tonight", "BUF at LAR · Mon, 8:15 PM Eastern"],
          ["Scores checked", "Mon, 5:00 PM Eastern"],
        ],
        tickets: [
          {
            id: "53b91843",
            status: "🏈 Monday Watch",
            tone: "watch",
            summary: "$20.00 wager · $72.40 original potential payout",
            legs: [
              {
                selection: "Highest Score Under 195.5",
                detail: "Still Open · Accepted total: Under 195.5",
                teams: [
                  {
                    name: "Diabloo",
                    current: 190.5,
                    projected: 190.5,
                    remaining: [],
                    finished: true,
                    leader: true,
                    selected: false,
                  },
                  {
                    name: "Thank you josh allen",
                    current: 155.6,
                    projected: 194.0,
                    remaining: ["Josh Allen", "DJ Moore"],
                    finished: false,
                    leader: false,
                    selected: false,
                  },
                  {
                    name: "Hellbean",
                    current: 137.3,
                    projected: 172.0,
                    remaining: ["Matthew Stafford", "Dalton Kincaid"],
                    finished: false,
                    leader: false,
                    selected: false,
                  },
                ],
              },
              {
                selection: "Any Team Below 100 · Yes",
                detail: "Still Open · Accepted outcome: Yes",
                teams: [
                  {
                    name: "Team ‘the boy n shit’",
                    current: 84.9,
                    projected: 92.0,
                    remaining: ["Blake Corum"],
                    finished: false,
                    leader: true,
                    selected: false,
                  },
                  {
                    name: "Kis Emeka",
                    current: 85.8,
                    projected: 104.0,
                    remaining: ["James Cook"],
                    finished: false,
                    leader: false,
                    selected: false,
                  },
                ],
              },
            ],
          },
          {
            id: "07f6c069",
            status: "✅ Appears Won · Awaiting Settlement",
            tone: "won",
            summary: "$10.00 wager · $28.00 original potential payout",
            legs: [
              {
                selection: "Team A Moneyline",
                detail: "Both lineups finished. Final score: 128.0–118.3.",
              },
            ],
          },
          {
            id: "c05b36a2",
            status: "❌ Already Lost · Awaiting Settlement",
            tone: "lost",
            summary: "$10.00 wager",
            legs: [
              {
                selection: "Bijan Robinson Over 23",
                detail: "NFL game finished. Actual player points: 15.8.",
              },
            ],
          },
        ],
        button: "Follow Your Tickets",
      };
    case "opening":
      return {
        ...common,
        subject: "Week 5 Is Open · Goldy Fantasy Sportsbook",
        heading: "Season 3 • Week 5 Is Open",
        paragraphs: [
          "This week's markets are ready. Build your parlay from Matchups, Player Points, and Weekly Specials.",
          "Game of the Week and Tank Bowl selections include a 25% profit boost. Check the board for the featured matchups.",
        ],
        details: [
          ["Betting opens", "Wed, Oct 7 • 8 AM"],
          ["Betting closes", "Thu, Oct 8 • 8 PM"],
          ["Your balance", "$100.00"],
        ],
        stories: openingWeekStories(
          [
            { id: "a", name: "Example Team A", projected: 149.5 },
            { id: "b", name: "Example Team B", projected: 142 },
            { id: "c", name: "Example Team C", projected: 138.5 },
            { id: "d", name: "Example Team D", projected: 117 },
            { id: "e", name: "Example Team E", projected: 109.5 },
            { id: "f", name: "Example Team F", projected: 101 },
          ],
          [
            { owner: "Phillip Woodings", team: "Hellbean", odds: 300 },
            { owner: "Ben King", team: "Thank you josh allen", odds: 350 },
            { owner: "Nelson Barboza", team: "Diabloo", odds: 400 },
            { owner: "RJ McCandless", team: "Malik’s Magic Magnum", odds: 450 },
          ],
        ),
        featured: [
          {
            title: "Game of the Week",
            teams: [
              {
                name: "Kis Emeka",
                record: "2–1",
                avatarUrl:
                  "https://sleepercdn.com/avatars/b3338675f635c2c1f42b469621d38ec6",
                spread: "+3.5",
                originalOdds: "+140",
                boostedOdds: "+175",
              },
              {
                name: "Team ‘the boy n shit’",
                record: "2–1",
                avatarUrl:
                  "https://sleepercdn.com/avatars/81a7aefdb286765459b31f06c75536f6",
                spread: "-3.5",
                originalOdds: "-160",
                boostedOdds: "-128",
              },
            ],
            total: "270.5",
          },
          {
            title: "Tank Bowl",
            teams: [
              {
                name: "Hellbean",
                record: "0–3",
                avatarUrl:
                  "https://sleepercdn.com/avatars/b3338675f635c2c1f42b469621d38ec6",
                spread: "+6.5",
                originalOdds: "+200",
                boostedOdds: "+250",
              },
              {
                name: "earkin",
                record: "0–3",
                avatarUrl:
                  "https://sleepercdn.com/avatars/e7af4deab0289b4f5505646424895246",
                spread: "-6.5",
                originalOdds: "-200",
                boostedOdds: "-160",
              },
            ],
            total: "245.5",
            boostedOver: "+114",
          },
        ],
        button: "View This Week's Markets",
      };
    case "reminder":
      return {
        ...common,
        subject: "Betting Closes At 8 PM · Week 5",
        heading: "One Hour Until Betting Closes",
        paragraphs: [
          "Week 5 betting closes tonight at 8 PM Eastern. Finish your picks before the cutoff.",
          "Already placed your bets? You can review your tickets in My Bets.",
        ],
        details: [
          ["Cutoff", "Thu, Oct 8 • 8 PM"],
          ["Your available balance", "$100.00"],
          ["Your open tickets", "2"],
        ],
        button: "Finish Your Picks",
      };
    case "confirmation":
      return {
        ...common,
        subject: "Bet Confirmed · Week 5 · EXAMPLE-01",
        heading: "Your Bet Is Confirmed",
        paragraphs: [
          "Your picks and odds are locked in. Track each leg and its final result in My Bets.",
        ],
        details: [
          ["Ticket", "EXAMPLE-01"],
          ["Season / Week", "Season 3 • Week 5"],
          ["Placed", "Thu, Oct 8 • 6:42 PM"],
          ["Wager", "$10.00"],
          ["Odds", "+300"],
          ["Total payout if won", "$40.00"],
          ["Balance remaining", "$90.00"],
        ],
        legs: [
          {
            matchup: "Example Team A vs. Example Team B",
            selection: "Team A -3.5",
            type: "Spread",
          },
          {
            matchup: "Example Team A vs. Example Team B",
            selection: "Over 275.5",
            type: "Match Total",
          },
        ],
        button: "View Your Bet",
      };
    case "recap":
      return {
        ...common,
        subject: "Week 5 League Roundup · Goldy Fantasy Sportsbook",
        heading: "Week 5: The League Roundup",
        paragraphs: [
          "The scores are final. The receipts are ready. 🍿 Here's your league roundup — bragging rights first, your personal results below.",
        ],
        stories: [
          {
            title: "💔 Worst Beat · Half A Point Hurts",
            text: "Example Team A's -3.5 spread missed by just 0.5 points. Four tickets had that pick. Half a point. A whole lot of pain. Somewhere, someone is still refreshing Sleeper.",
          },
          {
            title: "🚨 Biggest Upset · The Underdog Delivered",
            text: "Example Team C won outright as a +200 underdog. Three bettors called it; the underdog believers get the receipts and the bragging rights.",
          },
          {
            title: "🧲 Most Bet Line · Everyone Had An Opinion",
            text: "Over 275.5 in Example Team A vs. Example Team B appeared on seven tickets, with $90 in total ticket stakes behind it. Apparently the group chat agreed on something for once.",
          },
          {
            title: "👑 Biggest Winner · A Week To Remember",
            text: "Example Member led the league with +$85 in net betting profit, finishing with two winning tickets. Fake money, very real permission to be insufferable this week.",
          },
        ],
        compactDetails: true,
        details: [
          ["Results", "1 Won • 1 Lost • 1 Push"],
          ["Total wagered", "$30.00"],
          ["Total paid out", "$45.00"],
          ["Net betting profit", "+$15.00"],
          ["Weekly replenishment", "$0.00"],
          ["Current balance", "$115.00"],
          ["League standing", "3rd of 12"],
        ],
        button: "View Results & Leaderboard",
      };
    case "attention":
      return {
        ...common,
        subject: "Admin Review Needed · Week 5",
        heading: "One Ticket Needs Your Review",
        paragraphs: [
          "An unresolved weekly ticket remains after the Tuesday 7 AM recheck.",
          "This user's replenishment is waiting. Review the missing result, then rerun settlement and replenishment.",
        ],
        details: [
          ["Week", "Season 3 • Week 5"],
          ["Unresolved ticket", "EXAMPLE-02"],
          ["Owner", "Example Member"],
          ["Reason", "Player participation unconfirmed"],
          ["Replenishment", "On hold for this user"],
        ],
        button: "Review Weekly Execution",
      };
    case "signin":
      return {
        ...common,
        subject: "Your Sign-In Link · Goldy Fantasy Sportsbook",
        heading: "Welcome To Your Fantasy Sportsbook",
        paragraphs: [
          "Use the link below to sign in to your approved league account. No password is needed. This link can only be used once.",
          "After you use the link, this browser normally keeps you signed in. You'll need another link if you sign out, clear browser data, use a private window or different browser, or your session expires.",
          "If you didn't request this email, you can safely ignore it. Never forward your sign-in link to anyone else.",
        ],
        details: [["Account", "Your approved league email"]],
        button: "Sign In",
      };
  }
}

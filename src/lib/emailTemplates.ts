export type EmailKind =
  "opening" | "reminder" | "confirmation" | "recap" | "attention" | "signin";
export const emailLabels: Record<EmailKind, string> = {
  opening: "Opening Email",
  reminder: "Betting Reminder",
  confirmation: "Bet Confirmation",
  recap: "Weekly Recap",
  attention: "Admin Attention",
  signin: "Sign-In Link",
};
export function reminderEligible(balance: number | string | null) {
  return (
    balance !== null && Number.isFinite(Number(balance)) && Number(balance) > 0
  );
}
export interface EmailContent {
  subject: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  details: [string, string][];
  legs?: { matchup: string; selection: string; type: string }[];
  featured?: { title: string; matchup: string; lines: string[] }[];
  stories?: { title: string; text: string }[];
  compactDetails?: boolean;
  button: string;
  url: string;
  sample?: boolean;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderEmail(content: EmailContent) {
  const safeUrl = /^https:\/\//.test(content.url)
    ? content.url
    : "https://sportsbook.coopergurrie.com/";
  const stories =
    content.stories
      ?.map(
        (s) =>
          `<h2 style="font-size:17px;margin:24px 0 8px">${escape(s.title)}</h2><p style="font-size:14px;line-height:1.6;color:#42516a;margin:0">${escape(s.text)}</p>`,
      )
      .join("") ?? "";
  const featured =
    content.featured
      ?.map(
        (f) =>
          `<div style="margin-top:20px;padding:18px;background:#f3f6fb;border-radius:10px"><p style="font-size:13px;font-weight:bold;color:#775600;margin:0 0 8px">${escape(f.title)} · 25% PROFIT BOOST</p><h2 style="font-size:16px;margin:0 0 12px">${escape(f.matchup)}</h2>${f.lines.map((l) => `<p style="font-size:13px;margin:7px 0">${escape(l)}</p>`).join("")}</div>`,
      )
      .join("") ?? "";
  const groups = new Map<string, NonNullable<EmailContent["legs"]>>();
  for (const leg of content.legs ?? [])
    groups.set(leg.matchup, [...(groups.get(leg.matchup) ?? []), leg]);
  const legs = content.legs?.length
    ? `<h2 style="font-size:16px;margin:24px 0 16px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:50%;background:#f3c85f;color:#14233c;margin-right:8px">${content.legs.length}</span> Bet Slip</h2>${[...groups].map(([matchup, picks]) => `<p style="font-size:14px;font-weight:bold;margin:16px 0 8px">${escape(matchup)}</p>${picks.map((p) => `<div style="margin:8px 0 12px 16px;padding-left:10px"><strong style="font-size:14px">${escape(p.selection)}</strong><p style="font-size:12px;color:#52617a;margin:4px 0">${escape(p.type)} · Open</p></div>`).join("")}`).join("")}`
    : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:24px 12px;background:#edf1f7;color:#182640;font-family:Arial,sans-serif"><table role="presentation" style="max-width:580px;width:100%;margin:auto;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#102038;color:#fff;padding:26px 28px"><div style="color:#f4cb63;font-size:24px;font-weight:800">G</div><p style="margin:12px 0 4px;font-weight:bold;font-size:18px">Goldy Fantasy Sportsbook</p><p style="margin:0;color:#d1dbee;font-size:13px">Fake Football. Fake Betting.</p></td></tr><tr><td style="padding:28px"><h1 style="font-size:25px;line-height:1.25;margin:0 0 20px">${escape(content.heading)}</h1><p style="line-height:1.6">${escape(content.greeting)}</p>${content.paragraphs.map((p) => `<p style="line-height:1.6;color:#42516a">${escape(p)}</p>`).join("")}${stories}${content.compactDetails ? '<h2 style="font-size:16px;margin:26px 0 12px">Your Week</h2>' : ""}<table role="presentation" style="width:100%;border-collapse:collapse;background:#f3f6fb;border-radius:10px">${content.details.map(([k, v]) => `<tr><td style="padding:${content.compactDetails ? "7px 12px" : "12px 14px"};color:#52617a;font-size:13px">${escape(k)}</td><td style="padding:${content.compactDetails ? "7px 12px" : "12px 14px"};font-weight:bold;text-align:right;font-size:13px">${escape(v)}</td></tr>`).join("")}</table>${featured}${legs}<p style="margin:26px 0 18px"><a href="${escape(safeUrl)}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#f3c85f;color:#14233c;font-weight:bold;text-decoration:none">${escape(content.button)}</a></p><p style="font-size:12px;line-height:1.5;color:#65748c">All times Eastern. This league uses pretend money.</p>${content.sample ? '<p style="font-size:12px;color:#65748c">Sample preview — figures, picks, and results are illustrative. No email has been sent.</p>' : ""}</td></tr></table></body></html>`;
}
export function sampleEmail(kind: EmailKind): EmailContent {
  const common = {
    greeting: "Hi Cooper,",
    url: "https://sportsbook.coopergurrie.com/",
    sample: true,
  };
  switch (kind) {
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
        featured: [
          {
            title: "Game of the Week",
            matchup: "Kis Emeka vs. Team ‘the boy n shit’",
            lines: [
              "Kis Emeka +3.5 • Team ‘the boy n shit’ -3.5",
              "Match Total: 270.5",
              "Boosted Moneyline: Kis Emeka +175 • Team ‘the boy n shit’ -105",
            ],
          },
          {
            title: "Tank Bowl",
            matchup: "Example Team C vs. Example Team D",
            lines: [
              "Example Team C +6.5 • Example Team D -6.5",
              "Match Total: 245.5 • Match Over Profit Boosted",
              "Boosted Moneyline: Example Team C +250 • Example Team D -160",
            ],
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
          "Close calls, underdog wins, and one very popular line. Here's what happened across the league, followed by your personal results.",
        ],
        stories: [
          {
            title: "Worst Beat · Half A Point Hurts",
            text: "Example Team A's -3.5 spread missed by just 0.5 points. Four tickets had that pick — a tough finish for everyone who backed it.",
          },
          {
            title: "Biggest Upset · The Underdog Delivered",
            text: "Example Team C won outright as a +200 underdog. Three bettors called it; the favorite never pulled away.",
          },
          {
            title: "Most Bet Line · Everyone Had An Opinion",
            text: "Over 275.5 in Example Team A vs. Example Team B appeared on seven tickets, with $90 in total ticket stakes behind it.",
          },
          {
            title: "Biggest Winner · A Week To Remember",
            text: "Example Member led the league with +$85 in net betting profit, finishing with two winning tickets.",
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
          "Use the link below to sign in to your approved league account. No password is needed.",
          "After you use the link, this browser normally keeps you signed in. You'll need another link if you sign out, clear browser data, use a private window or different browser, or your session expires.",
          "If you didn't request this email, you can ignore it. The official link will be supplied by the sign-in service.",
        ],
        details: [["Account", "Your approved league email"]],
        button: "Sign In",
      };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailContent } from "./email-templates.js";
import {
  communicationIdentity,
  staffAlertContext,
} from "./league-communications.js";
const categories = ["results", "futures", "lineup", "automation"] as const;
export async function queueStaffAttention(
  db: SupabaseClient,
  job: string,
  category: (typeof categories)[number],
) {
  const r = await db.rpc("queue_staff_attention", {
    p_job: job,
    p_category: category,
  });
  if (
    r.error ||
    !Number.isInteger(r.data?.queued) ||
    r.data.queued < 0 ||
    r.data.queued > 128
  )
    throw Error("Verified staff alert could not be queued.");
  return r.data;
}
export async function buildStaffAlert(
  db: SupabaseClient,
  row: any,
): Promise<EmailContent> {
  const c = await staffAlertContext(db, row);
  const l = await db
    .from("leagues")
    .select("name,sportsbook_url,email_sender,nfl_season")
    .eq("id", row.league_id)
    .maybeSingle();
  if (l.error || l.data?.nfl_season !== c.nfl_season)
    throw Error("Staff alert league season changed.");
  const identity = communicationIdentity(l.data);
  const messages = {
    results:
      "Some weekly results still require review. Affected account replenishment waits for confirmed outcomes.",
    futures:
      "A final season result requires review. Check the recorded evidence before settling affected futures.",
    lineup:
      "The scheduled refresh found incomplete projected lineups. Review coverage and the affected locked selections.",
    automation:
      "A scheduled operation needs review. Open Weekly Execution for its current status and details.",
  };
  const url = new URL(identity.url);
  url.hash = "/admin/schedule";
  return {
    brand: identity.brand,
    url: url.href,
    subject: `Staff Review Needed · Week ${c.market_week}`,
    heading: "A Scheduled Step Needs Review",
    greeting: "Hi sportsbook operator,",
    paragraphs: [
      messages[c.category as keyof typeof messages],
      "This alert records a review request; check the application for the latest state.",
    ],
    details: [
      ["Operation", c.operation.replaceAll("_", " ")],
      ["NFL season / week", `${c.nfl_season} / ${c.market_week}`],
      ["Review requested", new Date(c.queued_at).toISOString()],
    ],
    button: "Review Weekly Execution",
  };
}

import { supabase } from "./supabase";
import { canPlacePicks, isFuture } from "./markets";
import type { Market } from "./markets";
export const criteria = {
  points_min: "At least N Player Points selections",
  points_exact: "Exactly N Player Points selections",
  spreads_min: "At least N distinct-matchup spreads",
  parlay_min: "Compatible standard parlay, N+ legs",
  category: "Approved market category",
  featured: "Designated matchup",
} as const;
export interface PromoTerms {
  criterion?: keyof typeof criteria;
  count?: number;
  percent?: number;
  max_stake?: number;
  category?: string;
  matchup?: string;
  code?: string;
  legs?: Market[];
  fixed_stake?: number | null;
}
export interface PromoOffer {
  id: string;
  league_id: string;
  nfl_season: number;
  market_week: number;
  slot: number;
  kind: "boost" | "fixed";
  title: string;
  description: string;
  image_id: string;
  expires_at: string;
  status: "draft" | "scheduled" | "disabled";
  activated_at: string | null;
  version: number;
  terms: PromoTerms;
  claimed?: boolean;
  used?: boolean;
}
export function eligible(offer: PromoOffer, picks: Market[], now = Date.now()) {
  if (
    offer.kind !== "boost" ||
    !offer.claimed ||
    offer.used ||
    Date.parse(offer.expires_at) <= now ||
    !picks.length ||
    !canPlacePicks(picks) ||
    picks.some((p) => isFuture(p) || p.boost_pct > 0)
  )
    return false;
  const t = offer.terms,
    n = t.count ?? 1;
  if (picks.length < n) return false;
  switch (t.criterion) {
    case "points_min":
    case "points_exact":
      return (
        (t.criterion !== "points_exact" || picks.length === n) &&
        picks.every(
          (p) => p.kind === "player_points" && p.metadata.player_id,
        ) &&
        new Set(picks.map((p) => p.metadata.player_id)).size === picks.length
      );
    case "spreads_min":
      return (
        picks.every((p) => p.kind === "spread" && p.matchup_key) &&
        new Set(picks.map((p) => p.matchup_key)).size === picks.length
      );
    case "parlay_min":
      return picks.length >= 2;
    case "category":
      return picks.every((p) =>
        t.category === "weekly"
          ? p.kind.startsWith("weekly_")
          : p.kind === t.category,
      );
    case "featured":
      return picks.some((p) => p.matchup_key === t.matchup);
    default:
      return false;
  }
}
export function profitPrice(decimal: number, percent: number) {
  return 1 + (decimal - 1) * (1 + percent / 100);
}
export const claimBy = (expiry: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(expiry)) + " Eastern";
export function easternInput(instant: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const f = (k: string) => p.find((x) => x.type === k)?.value;
  return `${f("year")}-${f("month")}-${f("day")}T${f("hour")}:${f("minute")}`;
}
export function easternInstant(wall: string) {
  const base = Date.parse(wall + "Z");
  if (!Number.isFinite(base)) throw Error("Choose an expiry date and time.");
  const matches = [4, 5]
    .map((offset) => new Date(base + offset * 3600000).toISOString())
    .filter((iso) => easternInput(iso) === wall);
  if (matches.length !== 1)
    throw Error(
      "Choose an unambiguous Eastern time outside the daylight-saving clock change.",
    );
  return matches[0];
}
export async function promoRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw Error("Account service unavailable.");
  const r = await supabase.rpc(name, args);
  if (r.error) throw r.error;
  return r.data as T;
}
export const loadPromos = (league: string) =>
  promoRpc<PromoOffer[]>("list_promos", { p_league: league });
export const claimPromo = (offer: string) =>
  promoRpc<void>("claim_promo", { p_offer: offer });
export async function imageData(id: string) {
  const png = await promoRpc<string>("read_promo_image", { p_image: id });
  return "data:image/png;base64," + png;
}
export async function uploadPromoImage(
  league: string,
  file: File,
  x = 50,
  y = 50,
) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw Error("Choose PNG, JPG or WebP up to 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 522;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Image editor unavailable.");
    const scale = Math.max(
        canvas.width / bitmap.width,
        canvas.height / bitmap.height,
      ),
      w = canvas.width / scale,
      h = canvas.height / scale;
    ctx.drawImage(
      bitmap,
      ((bitmap.width - w) * x) / 100,
      ((bitmap.height - h) * y) / 100,
      w,
      h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const png = canvas.toDataURL("image/png").split(",")[1];
    if (png.length > 4 * 1024 * 1024)
      throw Error("Image is too detailed. Choose a simpler or smaller image.");
    const session = (await supabase?.auth.getSession())?.data.session;
    if (!session) throw Error("Sign in before uploading.");
    const r = await fetch("/api/promo-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ league_id: league, png }),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error ?? "Image upload failed.");
    return { id: result.id as string, src: "data:image/png;base64," + png };
  } finally {
    bitmap.close();
  }
}

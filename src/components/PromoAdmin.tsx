import { useCallback, useEffect, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { errorMessage } from "../lib/accounts";
import { supabase } from "../lib/supabase";
import type { Market } from "../lib/markets";
import { formatOdds, marketType } from "../lib/markets";
import type { PromoOffer, PromoTerms } from "../lib/promotions";
import {
  criteria,
  easternInput,
  easternInstant,
  promoRpc,
  uploadPromoImage,
} from "../lib/promotions";
import { OfferCard } from "./OfferCards";
type FixedLeg = {
  id: string;
  line: number | null;
  odds: number;
  label: string;
};
const selectionCategories = [
  {
    label: "Matchups",
    kinds: ["moneyline", "spread", "match_total", "team_total"],
  },
  { label: "Player Projections", kinds: ["player_points"] },
  {
    label: "Weekly Specials",
    kinds: [
      "weekly_high",
      "weekly_low",
      "weekly_count_150",
      "weekly_count_projection",
      "weekly_average",
      "weekly_highest_score",
      "weekly_any_below_100",
      "weekly_any_200",
    ],
  },
] as const;
export function PromoAdmin({
  data,
  leagueId,
  reviewMode = false,
}: {
  data: AccountData;
  leagueId: string;
  reviewMode?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const [usage, setUsage] = useState<
    {
      offer_id: string;
      claims: number;
      redemptions: number;
      extra_paid: number;
      extra_liability: number;
    }[]
  >([]);
  const [offers, setOffers] = useState<PromoOffer[]>([]),
    [events, setEvents] = useState<Record<string, unknown>[]>([]),
    [markets, setMarkets] = useState<Market[]>([]),
    [week, setWeek] = useState(0),
    [slot, setSlot] = useState(1),
    [kind, setKind] = useState<"boost" | "fixed">("boost"),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [expiry, setExpiry] = useState(() =>
      easternInput(new Date(Date.now() + 7 * 86400000).toISOString()),
    ),
    [imageId, setImageId] = useState(""),
    [src, setSrc] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [x, setX] = useState(50),
    [y, setY] = useState(50),
    [criterion, setCriterion] = useState<keyof typeof criteria>("points_min"),
    [count, setCount] = useState(5),
    [percent, setPercent] = useState(50),
    [maxStake, setMaxStake] = useState(20),
    [code, setCode] = useState(""),
    [category, setCategory] = useState("player_points"),
    [matchup, setMatchup] = useState(""),
    [fixedStake, setFixedStake] = useState(""),
    [legs, setLegs] = useState<FixedLeg[]>([]),
    [selected, setSelected] = useState(""),
    [selectionCategory, setSelectionCategory] = useState(""),
    [selectionMatchup, setSelectionMatchup] = useState(""),
    [edit, setEdit] = useState<PromoOffer | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false);
  const league = data.leagues.find((l) => l.id === leagueId);
  const teamName = (id: string | null) =>
    data.teams.find((t) => t.id === id && t.league_id === leagueId)?.team_name;
  const matchupId = (m: Market) =>
    m.matchup_key ||
    (m.home_team_id && m.away_team_id
      ? `${m.home_team_id}:${m.away_team_id}`
      : "unmapped-matchup");
  const matchupLabel = (m: Market) => {
    const home = teamName(m.home_team_id),
      away = teamName(m.away_team_id);
    return home && away
      ? `${home} vs. ${away}`
      : m.subject || "Matchup unavailable";
  };
  const selectionLabel = (m: Market) => {
    if (m.kind !== "moneyline") return m.label;
    const id =
      m.team_id ||
      (m.side === "home"
        ? m.home_team_id
        : m.side === "away"
          ? m.away_team_id
          : null);
    const opponent =
      id === m.home_team_id
        ? m.away_team_id
        : id === m.away_team_id
          ? m.home_team_id
          : null;
    return `${teamName(id) || m.label.replace(/^Win\s*[·:—-]\s*/i, "")} vs. ${teamName(opponent) || "Opponent unavailable"}`;
  };
  const playerMatchups = [
    ...new Map(
      markets
        .filter((m) => m.kind === "player_points" && !m.boost_pct)
        .map((m) => [matchupId(m), matchupLabel(m)] as const),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  const availableSelections = markets.filter(
    (m) => !m.boost_pct && !legs.some((l) => l.id === m.id),
  );
  const categorySelections = availableSelections
    .filter(
      (m) =>
        m.kind === selectionCategory &&
        (selectionCategory !== "player_points" ||
          matchupId(m) === selectionMatchup),
    )
    .sort((a, b) =>
      selectionLabel(a).localeCompare(selectionLabel(b), undefined, {
        numeric: true,
      }),
    );
  const reload = useCallback(async () => {
    if (reviewMode || !supabase) return;
    const [o, e, u] = await Promise.all([
      supabase
        .from("promo_offers")
        .select("*")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false }),
      supabase
        .from("promo_events")
        .select("*")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(100),
      promoRpc<typeof usage>("promo_usage", { p_league: leagueId }),
    ]);
    if (o.error || e.error) throw o.error ?? e.error;
    setOffers(o.data ?? []);
    setEvents(e.data ?? []);
    setUsage(u);
  }, [leagueId, reviewMode]);
  useEffect(() => {
    let active = true;
    if (!supabase || reviewMode) return;
    void Promise.all([
      promoRpc<{ week: number }[]>("sportsbook_period", { p_league: leagueId }),
      reload(),
    ])
      .then(([p]) => {
        if (active) setWeek(p[0]?.week ?? 1);
      })
      .catch((e) => {
        if (active) setNotice(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [leagueId, reviewMode, reload]);
  useEffect(() => {
    let active = true;
    if (!supabase || !week || reviewMode) return;
    void Promise.resolve(
      supabase
        .from("sportsbook_boards")
        .select("id")
        .eq("league_id", leagueId)
        .eq("nfl_season", league?.nfl_season ?? 0)
        .eq("market_week", week)
        .eq("board_type", "weekly")
        .maybeSingle(),
    )
      .then(async (b) => {
        if (b.error) throw b.error;
        const r = b.data
          ? await supabase!
              .from("sportsbook_markets")
              .select("*")
              .eq("board_id", b.data.id)
          : { data: [], error: null };
        if (r.error) throw r.error;
        if (active) setMarkets(r.data ?? []);
      })
      .catch((e) => {
        if (active) setNotice(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [leagueId, week, league?.nfl_season, reviewMode]);
  const terms: PromoTerms =
    kind === "boost"
      ? {
          criterion,
          count,
          percent,
          max_stake: maxStake,
          code,
          category,
          matchup,
        }
      : { fixed_stake: fixedStake ? Number(fixedStake) : null };
  let expires = "";
  try {
    expires = easternInstant(expiry);
  } catch {
    /* form validation explains on save */
  }
  const preview: PromoOffer = {
    id: edit?.id ?? "preview",
    league_id: leagueId,
    nfl_season: league?.nfl_season ?? 0,
    market_week: week,
    slot,
    kind,
    title: title || "Your offer title",
    description: description || "Add readable eligibility and offer terms.",
    image_id: imageId,
    expires_at: expires || new Date(now).toISOString(),
    status: "draft",
    activated_at: null,
    version: edit?.version ?? 1,
    terms,
  };
  async function save(status: "draft" | "scheduled") {
    setBusy(true);
    setNotice("");
    try {
      if (reviewMode) throw Error("Review only. No offer saved.");
      if (!title.trim() || !description.trim())
        throw Error("Add a title and readable offer terms.");
      const at = easternInstant(expiry);
      let id = imageId;
      if (file) {
        const uploaded = await uploadPromoImage(leagueId, file, x, y);
        id = uploaded.id;
        setImageId(id);
        setSrc(uploaded.src);
        setFile(null);
      }
      if (!id) throw Error("Choose an image.");
      await promoRpc("save_promo", {
        p_league: leagueId,
        p_id: edit?.id ?? null,
        p_version: edit?.version ?? null,
        p_offer: {
          week,
          slot,
          kind,
          title,
          description,
          image_id: id,
          expires_at: at,
          status,
          terms: kind === "fixed" ? { ...terms, legs } : terms,
        },
      });
      setEdit(null);
      await reload();
      setNotice(
        status === "draft"
          ? "Draft saved. It is not public."
          : "Offer scheduled. It appears during the selected week once its board is published and open. For the current week, an already-open board makes it appear immediately.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function newDraft() {
    setSelectionMatchup("");
    setSelected("");
    setSelectionCategory("");
    setEdit(null);
    setTitle("");
    setDescription("");
    setImageId("");
    setSrc("");
    setFile(null);
    setLegs([]);
    setNotice("");
  }
  function editDraft(o: PromoOffer) {
    setSelectionMatchup("");
    setSelected("");
    setSelectionCategory("");
    setEdit(o);
    setWeek(o.market_week);
    setSlot(o.slot);
    setKind(o.kind);
    setTitle(o.title);
    setDescription(o.description);
    setExpiry(easternInput(o.expires_at));
    setImageId(o.image_id);
    setSrc("");
    setFile(null);
    setCriterion(o.terms.criterion ?? "points_min");
    setCount(o.terms.count ?? 5);
    setPercent(o.terms.percent ?? 50);
    setMaxStake(o.terms.max_stake ?? 20);
    setCode(o.terms.code ?? "");
    setCategory(o.terms.category ?? "player_points");
    setMatchup(o.terms.matchup ?? "");
    setFixedStake(o.terms.fixed_stake ? String(o.terms.fixed_stake) : "");
    setLegs(
      (o.terms.legs ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        line: p.line,
        odds: p.odds,
      })),
    );
  }
  return (
    <>
      <div className="promo-actions">
        <button className="secondary" onClick={newDraft}>
          New offer
        </button>
        <span className="promo-status">Draft → review → schedule</span>
      </div>
      <div className="promo-admin-layout">
        <section className="promo-panel">
          <h2>Offer details</h2>
          <div className="promo-form">
            <label>
              Week
              <input
                type="number"
                min="1"
                max="18"
                value={week || ""}
                onChange={(e) => {
                  setWeek(Number(e.target.value));
                  setLegs([]);
                  setSelected("");
                  setSelectionCategory("");
                  setSelectionMatchup("");
                }}
              />
            </label>
            <label>
              Home slot
              <select
                value={slot}
                onChange={(e) => setSlot(Number(e.target.value))}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    Slot {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="promo-full">
              Offer type
              <select
                aria-label="Offer type"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="boost">Profit boost</option>
                <option value="fixed">Preset ticket</option>
              </select>
            </label>
            <label className="promo-full">
              Expires and disappears (Eastern)
              <input
                type="datetime-local"
                required
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
              <small>
                Shown as “Claim by”. Accepted tickets remain in history.
              </small>
            </label>
            <label className="promo-full">
              Title
              <input
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="promo-full">
              Readable offer terms
              <textarea
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="At least five distinct players. All selections must be Player Points."
              />
            </label>
            <label className="promo-full promo-upload">
              Image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFile(f);
                  if (src.startsWith("blob:")) URL.revokeObjectURL(src);
                  const url = URL.createObjectURL(f);
                  setSrc(url);
                }}
              />
              <small>PNG, JPG or WebP · up to 5 MB · landscape crop</small>
            </label>
            {file && (
              <div className="promo-full promo-crop">
                <label>
                  Horizontal focal point
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={x}
                    onChange={(e) => setX(Number(e.target.value))}
                  />
                </label>
                <label>
                  Vertical focal point
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={y}
                    onChange={(e) => setY(Number(e.target.value))}
                  />
                </label>
                <small className="promo-full">
                  Crop position: {x}% / {y}%
                </small>
              </div>
            )}
            {kind === "boost" ? (
              <>
                <label className="promo-full">
                  Eligibility criterion
                  <select
                    value={criterion}
                    onChange={(e) =>
                      setCriterion(e.target.value as typeof criterion)
                    }
                  >
                    {Object.entries(criteria).map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Required selections
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </label>
                <label>
                  Profit boost (%)
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={percent}
                    onChange={(e) => setPercent(Number(e.target.value))}
                  />
                </label>
                <label>
                  Maximum wager ($)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={maxStake}
                    onChange={(e) => setMaxStake(Number(e.target.value))}
                  />
                </label>
                <label>
                  Advertised code (optional)
                  <input
                    maxLength={40}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                </label>
                {criterion === "category" && (
                  <label className="promo-full">
                    Approved category
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {[
                        "player_points",
                        "spread",
                        "moneyline",
                        "match_total",
                        "team_total",
                        "weekly",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                )}
                {criterion === "featured" && (
                  <label className="promo-full">
                    Designated matchup
                    <select
                      value={matchup}
                      onChange={(e) => setMatchup(e.target.value)}
                    >
                      <option value="">Choose matchup</option>
                      {[
                        ...new Set(
                          markets.map((m) => m.matchup_key).filter(Boolean),
                        ),
                      ].map((m) => (
                        <option key={m} value={m!}>
                          {markets.find((p) => p.matchup_key === m)?.subject ||
                            m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <small className="promo-full">
                  One use per user. No stacking with featured boosts, preset
                  tickets or teasers. Point selections must be distinct players;
                  spread selections must be distinct matchups.
                </small>
              </>
            ) : (
              <>
                <div className="promo-full">
                  <label>
                    Selection category
                    <select
                      aria-label="Selection category"
                      value={selectionCategory}
                      onChange={(e) => {
                        setSelectionCategory(e.target.value);
                        setSelected("");
                        setSelectionMatchup("");
                      }}
                    >
                      <option value="">Choose category</option>
                      {selectionCategories.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.kinds.map((kind) => (
                            <option key={kind} value={kind}>
                              {marketType[kind]}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {selectionCategory === "player_points" && (
                    <label className="promo-selection-picker">
                      Player Points matchup
                      <select
                        aria-label="Player Points matchup"
                        value={selectionMatchup}
                        onChange={(e) => {
                          setSelectionMatchup(e.target.value);
                          setSelected("");
                        }}
                        disabled={!playerMatchups.length}
                      >
                        <option value="">
                          {playerMatchups.length
                            ? "Choose matchup"
                            : "No Player Points matchups available"}
                        </option>
                        {playerMatchups.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selectionCategory &&
                    (selectionCategory !== "player_points" ||
                      selectionMatchup) && (
                      <label className="promo-selection-picker">
                        Add an existing selection
                        <select
                          aria-label="Add an existing selection"
                          value={selected}
                          onChange={(e) => setSelected(e.target.value)}
                          disabled={!categorySelections.length}
                        >
                          <option value="">
                            {categorySelections.length
                              ? "Choose selection"
                              : "No available selections in this category"}
                          </option>
                          {categorySelections.map((m) => (
                            <option key={m.id} value={m.id}>
                              {selectionLabel(m)} ({formatOdds(m.odds)})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  <button
                    className="secondary"
                    disabled={
                      !categorySelections.some((m) => m.id === selected)
                    }
                    onClick={() => {
                      const m = categorySelections.find(
                        (p) => p.id === selected,
                      );
                      if (m)
                        setLegs([
                          ...legs,
                          {
                            id: m.id,
                            label: selectionLabel(m),
                            line: m.line,
                            odds: m.odds,
                          },
                        ]);
                      setSelected("");
                    }}
                  >
                    Add selection
                  </button>
                  {!markets.length && (
                    <p>
                      Generate this week's board before choosing mapped
                      selections.
                    </p>
                  )}
                  {legs.map((l, i) => (
                    <div className="promo-fixed-leg" key={l.id}>
                      <label>
                        Saved label
                        <input
                          value={l.label}
                          onChange={(e) =>
                            setLegs(
                              legs.map((p, j) =>
                                j === i ? { ...p, label: e.target.value } : p,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Saved line
                        <input
                          type="number"
                          step="0.01"
                          value={l.line ?? ""}
                          onChange={(e) =>
                            setLegs(
                              legs.map((p, j) =>
                                j === i
                                  ? {
                                      ...p,
                                      line: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                    }
                                  : p,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Saved odds
                        <input
                          type="number"
                          value={l.odds}
                          onChange={(e) =>
                            setLegs(
                              legs.map((p, j) =>
                                j === i
                                  ? { ...p, odds: Number(e.target.value) }
                                  : p,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        className="secondary"
                        aria-label={`Remove ${l.label}`}
                        onClick={() => setLegs(legs.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <label className="promo-full">
                  Fixed wager (optional)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={fixedStake}
                    onChange={(e) => setFixedStake(e.target.value)}
                  />
                  <small>Leave empty for an editable wager.</small>
                </label>
                <small className="promo-full">
                  Saved terms stay locked through quote refreshes. One ticket
                  per user; a void does not reopen this preset offer.
                </small>
              </>
            )}
          </div>
          <div className="promo-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save("draft")}
            >
              {busy ? "Saving…" : "Save draft"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void save("scheduled")}
            >
              Schedule offer
            </button>
          </div>
          <p className="promo-status">
            Schedule offer appears on Home during the selected week, once its
            board is published and open. For the current week, an already-open
            board makes the offer appear immediately.
          </p>
          {notice && (
            <p className="promo-errors" role="status">
              {notice}
            </p>
          )}
        </section>
        <aside>
          <section className="promo-panel">
            <h2>Home card preview</h2>
            <div className="promo-preview-controls">
              <button
                className="secondary"
                aria-pressed={!mobile}
                onClick={() => setMobile(false)}
              >
                Desktop
              </button>
              <button
                className="secondary"
                aria-pressed={mobile}
                onClick={() => setMobile(true)}
              >
                Mobile
              </button>
            </div>
            <div
              className={mobile ? "promo-preview-phone" : ""}
              style={
                {
                  "--crop-x": x + "%",
                  "--crop-y": y + "%",
                } as React.CSSProperties
              }
            >
              <OfferCard offer={preview} preview={src || undefined} />
            </div>
            <p className="promo-status">
              All active league members. One or two cards expand to use
              available space.
            </p>
          </section>
        </aside>
      </div>
      <section className="promo-panel promo-usage">
        <h2>Offers and usage</h2>
        <div className="promo-history">
          <table>
            <thead>
              <tr>
                <th>Offer</th>
                <th>Status</th>
                <th>Claims</th>
                <th>Redemptions</th>
                <th>Extra profit paid</th>
                <th>Open bonus liability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.title}
                    <br />
                    <small>
                      Week {o.market_week} · slot {o.slot}
                    </small>
                  </td>
                  <td>
                    {Date.parse(o.expires_at) <= now
                      ? "Expired"
                      : o.status === "scheduled"
                        ? o.activated_at && Date.parse(o.activated_at) <= now
                          ? "Active"
                          : "Scheduled"
                        : o.status}
                  </td>
                  <td>{usage.find((u) => u.offer_id === o.id)?.claims ?? 0}</td>
                  <td>
                    {usage.find((u) => u.offer_id === o.id)?.redemptions ?? 0}
                  </td>
                  <td>
                    $
                    {Number(
                      usage.find((u) => u.offer_id === o.id)?.extra_paid ?? 0,
                    ).toFixed(2)}
                  </td>
                  <td>
                    $
                    {Number(
                      usage.find((u) => u.offer_id === o.id)?.extra_liability ??
                        0,
                    ).toFixed(2)}
                  </td>
                  <td>
                    {o.status === "draft" ? (
                      <button
                        className="secondary"
                        onClick={() => editDraft(o)}
                      >
                        Edit draft
                      </button>
                    ) : o.status === "scheduled" ? (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void promoRpc("pause_promo", { p_offer: o.id })
                            .then(reload)
                            .catch((e) => setNotice(errorMessage(e)))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Disable
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!offers.length && <p>No offers yet. Create a draft to begin.</p>}
        <h3>Recent history</h3>
        <div className="promo-history">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Offer</th>
                <th>Event</th>
                <th>Ticket</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={String(e.id)}>
                  <td>
                    {new Date(String(e.created_at)).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                    })}{" "}
                    Eastern
                  </td>
                  <td>
                    {offers.find((o) => o.id === e.offer_id)?.title ?? "Offer"}
                  </td>
                  <td>{String(e.event)}</td>
                  <td>{e.ticket_id ? String(e.ticket_id).slice(0, 8) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

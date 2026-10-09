import { useEffect, useRef, useState } from "react";
import type { PromoOffer } from "../lib/promotions";
import { claimBy, imageData } from "../lib/promotions";
import "./Promotions.css";
export function OfferImage({
  offer,
  preview,
}: {
  offer: PromoOffer;
  preview?: string;
}) {
  const [src, setSrc] = useState(preview ?? "");
  useEffect(() => {
    let active = true;
    if (preview) return;
    void imageData(offer.image_id)
      .then((s) => {
        if (active) setSrc(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [offer.image_id, preview]);
  const visibleSrc = preview ?? src;
  return visibleSrc ? (
    <img src={visibleSrc} alt="" className="promo-art" />
  ) : (
    <div className="promo-art promo-image-empty">Offer artwork</div>
  );
}
export function OfferCard({
  offer,
  onClaim,
  preview,
  busy,
}: {
  offer: PromoOffer;
  onClaim?: () => void;
  preview?: string;
  busy?: boolean;
}) {
  return (
    <article className="promo-card">
      <div className="promo-image">
        <OfferImage key={offer.image_id} offer={offer} preview={preview} />
        <button
          className="promo-claim"
          disabled={busy || offer.used}
          onClick={onClaim}
          aria-label={`Claim ${offer.title}`}
        >
          Claim
        </button>
      </div>
      <div className="promo-body">
        <h3>{offer.title}</h3>
        <p>{offer.description}</p>
        <small>
          {offer.kind === "boost"
            ? `Max wager $${Number(offer.terms.max_stake).toFixed(2)}`
            : "One ticket per user"}
          <br />
          Claim by {claimBy(offer.expires_at)}
          {offer.used ? " · Used" : offer.claimed ? " · Claimed" : ""}
        </small>
      </div>
    </article>
  );
}
export function OfferCards({
  offers,
  onClaim,
  busy,
}: {
  offers: PromoOffer[];
  onClaim: (o: PromoOffer) => void;
  busy?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const key = offers.map((o) => o.id).join(",");
  useEffect(() => {
    rail.current?.scrollTo({ left: 0 });
  }, [key]);
  if (!offers.length) return null;
  return (
    <section className="promo-section" aria-label="Weekly offers">
      <div
        className="promo-offers"
        ref={rail}
        style={{
          gridTemplateColumns: `repeat(${offers.length},minmax(0,1fr))`,
        }}
        onScroll={() => {
          const r = rail.current,
            child = r?.firstElementChild;
          if (r && child)
            setPosition(
              Math.round(
                r.scrollLeft / (child.getBoundingClientRect().width + 12),
              ),
            );
        }}
      >
        {offers.map((o) => (
          <OfferCard
            key={o.id}
            offer={o}
            onClaim={() => onClaim(o)}
            busy={busy}
          />
        ))}
      </div>
      {offers.length > 1 && (
        <div className="promo-pagination" aria-label="Choose an offer">
          {offers.map((o, i) => (
            <button
              key={o.id}
              aria-label={`Show offer ${i + 1}: ${o.title}`}
              aria-current={position === i}
              onClick={() => {
                const r = rail.current,
                  child = r?.children[i];
                if (r && child)
                  r.scrollTo({
                    left:
                      (child as HTMLElement).offsetLeft -
                      (r.firstElementChild as HTMLElement).offsetLeft,
                    behavior: "instant",
                  });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

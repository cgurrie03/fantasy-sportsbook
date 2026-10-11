import { useEffect, useRef, useState } from "react";
import type { AccountData, Ticket } from "../lib/accounts";
import { money } from "../lib/accounts";
import { ticketReceipt } from "../lib/ticket-receipt";
import "./TicketShare.css";

function ShareIcon({
  type = "share",
}: {
  type?: "share" | "message" | "copy" | "save";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={
          type === "message"
            ? "M4 4h16v12H9l-5 4V4Z"
            : type === "copy"
              ? "M9 9h11v11H9V9ZM15 9V4H4v11h5"
              : type === "save"
                ? "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"
                : "M12 16V3m-5 5 5-5 5 5M5 12v9h14v-9"
        }
      />
    </svg>
  );
}

export function TicketShare({
  data,
  ticket,
  owner,
}: {
  data: AccountData;
  ticket: Ticket;
  owner: string;
}) {
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState(() =>
    ticketReceipt(data, ticket, owner),
  );
  const dialog = useRef<HTMLDialogElement>(null),
    receipt = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const model = snapshot;
  const shown = model.ticket;
  const heading = `share-ticket-${ticket.id}`;
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      let holder: HTMLDivElement | undefined;
      try {
        await document.fonts.ready;
        const { toBlob } = await import("html-to-image");
        if (cancelled || !receipt.current) return;
        const clone = receipt.current.cloneNode(true) as HTMLDivElement;
        holder = document.createElement("div");
        holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${receipt.current.getBoundingClientRect().width}px;`;
        holder.append(clone);
        document.body.append(holder);
        await Promise.all(
          [...clone.querySelectorAll("img")].map(async (img) => {
            try {
              const source = new URL(img.src);
              if (source.hostname !== "sleepercdn.com" || import.meta.env.DEV)
                throw new Error("Avatar unavailable");
              const response = await fetch(
                `/api/report-avatar?path=${encodeURIComponent(source.pathname)}`,
                { signal: AbortSignal.timeout(8000) },
              );
              if (
                !response.ok ||
                !response.headers.get("content-type")?.startsWith("image/")
              )
                throw new Error("Avatar unavailable");
              const avatar = await response.blob();
              img.src = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = reject;
                reader.readAsDataURL(avatar);
              });
            } catch {
              img.remove();
            }
          }),
        );
        if (cancelled) return;
        const blob = await toBlob(clone, {
          pixelRatio: 2,
          backgroundColor: "#101c30",
          cacheBust: false,
          imagePlaceholder:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
        });
        if (!blob) throw new Error("Image unavailable");
        if (!cancelled)
          setFile(
            new File(
              [blob],
              `ticket-${model.id.replace(/[^a-z0-9_-]/gi, "-")}.png`,
              { type: "image/png" },
            ),
          );
      } catch {
        if (!cancelled)
          setNotice(
            "Receipt image could not be prepared. You can still copy the text.",
          );
      } finally {
        holder?.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, model]);
  async function message() {
    if (!file || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        setNotice("Receipt handed to your sharing app.");
      } else {
        setNotice(
          "Image messaging is unavailable in this browser. Save the image to attach it to a message, or copy the text.",
        );
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setNotice(
          "Sharing did not open. Try saving the image or copying the text.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(model.text);
      setNotice("Ticket text copied. Paste it into your message.");
    } catch {
      setNotice("Copy is unavailable. Select and copy the text below.");
    }
  }
  function save() {
    if (!file) return;
    const url = URL.createObjectURL(file),
      link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice("Image download started. You can attach it to a message.");
  }
  return (
    <>
      <button
        type="button"
        className="ticket-share-trigger"
        ref={trigger}
        onClick={() => {
          setSnapshot(ticketReceipt(data, ticket, owner));
          setFile(null);
          setNotice("");
          setOpen(true);
        }}
      >
        <ShareIcon />
        Share Ticket
      </button>
      {open && (
        <dialog
          className="ticket-share-dialog"
          ref={dialog}
          aria-labelledby={heading}
          onCancel={() => setOpen(false)}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        >
          <header className="ticket-share-heading">
            <h2 id={heading}>Share Ticket</h2>
            <button
              type="button"
              aria-label="Close sharing"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="ticket-share-preview">
            <div className="share-receipt" ref={receipt}>
              <div className="receipt-brand">
                {model.league?.name ?? "Fantasy Sportsbook"}
                <small>Fantasy Sportsbook</small>
              </div>
              <div className="receipt-owner">
                <span className="receipt-avatar">
                  {owner.slice(0, 1)}
                  {model.team?.avatar_url && (
                    <img
                      src={model.team.avatar_url}
                      alt=""
                      width="46"
                      height="46"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </span>
                <div>
                  <strong>{owner}</strong>
                  <small>{model.team?.team_name}</small>
                </div>
                <span
                  className={`receipt-status ${shown.status.toLowerCase()}`}
                >
                  {model.status}
                </span>
              </div>
              <p className="receipt-title">{model.title}</p>
              <div className="receipt-values">
                <div>
                  <small>Wager</small>
                  <strong>{money(shown.stake)}</strong>
                </div>
                <div>
                  <small>Odds</small>
                  <strong>{model.price}</strong>
                </div>
                <div>
                  <small>{model.payoutLabel}</small>
                  <strong>{model.payout}</strong>
                </div>
              </div>
              {model.boost && <p className="receipt-boost">{model.boost}</p>}
              <div className="receipt-legs">
                {model.legs.map((l) => (
                  <div className="receipt-leg" key={l.id}>
                    <span
                      className={`receipt-leg-number ${l.status.toLowerCase()}`}
                    >
                      {l.status === "WON"
                        ? "✓"
                        : l.status === "LOST"
                          ? "×"
                          : l.leg_number}
                    </span>
                    <div>
                      <strong>{l.selection}</strong>
                      {l.matchup && <small>{l.matchup}</small>}
                      <small>
                        {l.market_type} ·{" "}
                        {l.status[0] + l.status.slice(1).toLowerCase()}
                      </small>
                      {l.actual_value != null && (
                        <small>
                          Final result:{" "}
                          {Number(l.actual_value).toLocaleString("en-US", {
                            maximumFractionDigits: 2,
                          })}
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {shown.status !== "OPEN" && (
                <p className="receipt-profit">
                  Net profit{" "}
                  <strong>
                    {money(Number(shown.actual_payout) - Number(shown.stake))}
                  </strong>
                </p>
              )}
              <footer>
                {model.placed} ET <span>Bet {model.id}</span>
              </footer>
            </div>
          </div>
          <div className="ticket-share-actions">
            <button
              type="button"
              className="primary"
              disabled={!file || busy}
              onClick={() => void message()}
            >
              <ShareIcon type="message" />
              {busy ? "Opening sharing…" : "Message receipt"}
            </button>
            <button type="button" disabled={busy} onClick={() => void copy()}>
              <ShareIcon type="copy" />
              Copy text
            </button>
            <button type="button" disabled={!file || busy} onClick={save}>
              <ShareIcon type="save" />
              Save image
            </button>
          </div>
          <p className="ticket-share-help">
            Choose Messages in your phone's sharing menu. Available apps depend
            on your device.
          </p>
          <p role="status" aria-live="polite">
            {notice ||
              (!file ? "Preparing receipt image…" : "Receipt ready to share.")}
          </p>
          <details className="receipt-text">
            <summary>View text receipt</summary>
            <pre>{model.text}</pre>
          </details>
        </dialog>
      )}
    </>
  );
}

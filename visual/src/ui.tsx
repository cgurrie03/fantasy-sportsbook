import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

const shapes: Record<string, ReactNode> = {
  crown: (
    <>
      <path d="m3 6 4 4 5-7 5 7 4-4-2 12H5Z" />
      <path d="M5 21h14" />
    </>
  ),
  revenge: (
    <>
      <path d="M4 10a8 8 0 1 1 2 8" />
      <path d="M4 4v6h6" />
    </>
  ),
  target: (
    <>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="4" />
      <path d="m11 13 9-9m-5 0h5v5" />
    </>
  ),
  "broken-chain": (
    <>
      <path d="M9 14 7 16a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m4 3 2-2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0M9 10l6 4M12 3v3m0 12v3" />
    </>
  ),
  help: (
    <>
      <path d="M8 7a4 4 0 0 1 8 0c0 3-4 3-4 6m0 5h.01" />
    </>
  ),
  flag: <path d="M5 21V3m0 1c4-3 8 3 14 0v9c-6 3-10-3-14 0" />,
  rivalry: <path d="m4 5 6 7-6 7m16-14-6 7 6 7M8 12h8" />,
  bolt: <path d="m13 2-8 12h6l-1 8 9-12h-6Z" />,
  message: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5a10 10 0 1 1 20 0Z" />
      <path d="M6 10h10M6 14h7" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  bug: (
    <>
      <rect x="7" y="7" width="10" height="14" rx="5" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2M3 10h4m10 0h4M2 15h5m10 0h5M4 21l4-3m8 0 4 3M12 8v12" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  ball: (
    <>
      <path d="M5 19c-4-4-1-12 3-14s8-3 11 0 1 11-3 14-8 3-11 0Z" />
      <path d="m9 15 6-6m-5 1 4 4m-2-6 4 4m-8 0 4 4" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 14v5m-5 2h10m-8-2h6" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V7Z" />
      <path d="M15 8v2m0 3v2m0 2v1M7 11h4m-4 4h4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 20v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  back: <path d="M19 12H5m5-5-5 5 5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />
    </>
  ),
  settings: (
    <>
      <path d="M9.5 3h5l.6 2.4 1.3.8 2.4-.7 2.5 4.3-1.8 1.7v1.6l1.8 1.7-2.5 4.3-2.4-.7-1.3.8-.6 2.4h-5l-.6-2.4-1.3-.8-2.4.7-2.5-4.3L4.5 13v-1.6L2.7 9.7l2.5-4.3 2.4.7 1.3-.8Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  bell: (
    <>
      <path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4Zm5 3h4" />
    </>
  ),
  share: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M5 12H3v9h18v-9h-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  logout: (
    <>
      <path d="M10 3H4v18h6m4-14 5 5-5 5m-6-5h11" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name] || shapes.grid}
    </svg>
  );
}
export function Mark({ size = 36 }: { size?: number }) {
  return <img src="/boff-mark.svg" width={size} height={size} alt="" />;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  animateClose = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  animateClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  function close() {
    if (!animateClose || matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
    else setClosing(true);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 200);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  useEffect(() => {
    const d = ref.current;
    const prior = document.activeElement as HTMLElement;
    d?.showModal();
    return () => {
      d?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${className}`}
      aria-labelledby="modal-title"
      data-closing={closing || undefined}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
  action,
  kind="empty",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  kind?: "empty"|"access";
}) {
  return (
    <div className={"empty boff-state boff-state-"+kind}>
      <span className="boff-state-icon">
        <Icon name={kind==="access"?"info":"ticket"} size={24} />
      </span>
      <h3>{title}</h3>
      {children&&<div className="boff-state-copy">{children}</div>}
      {action&&<div className="boff-state-actions">{action}</div>}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  note,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  note?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {note && <small>{note}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  const outcome =
    typeof children === "string" &&
    ["Won", "Lost", "Open", "Push"].includes(children)
      ? " outcome-" + children.toLowerCase()
      : "";
  return <span className={`badge ${tone}${outcome}`}>{children}</span>;
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function InfoPopover({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const position = () => {
      const button = trigger.current;
      const popup = panel.current;
      if (!button || !popup?.matches(":popover-open")) return;
      const anchor = button.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
        popup.hidePopover();
        return;
      }
      const below = window.innerHeight - anchor.bottom - 18;
      const above = anchor.top - 18;
      const placeAbove = below < popup.scrollHeight && above > below;
      popup.style.maxHeight = `${Math.max(0, placeAbove ? above : below)}px`;
      const left = Math.max(12, Math.min(anchor.left, document.documentElement.clientWidth - popup.offsetWidth - 12));
      popup.style.left = `${left}px`;
      popup.style.top = `${placeAbove ? anchor.top - popup.offsetHeight - 6 : anchor.bottom + 6}px`;
    };
    const popup = panel.current;
    popup?.addEventListener("toggle", position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      popup?.removeEventListener("toggle", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, []);
  return <>
    <button ref={trigger} className={label?"button secondary compact-button":"icon-button futures-rule-info"} type="button" popoverTarget={id}
      aria-label={`About ${title}`}>{label ?? <Icon name="info" size={16} />}</button>
    <div ref={panel} id={id} popover="auto" className="futures-rule-help" role="region" aria-label={title}>
      <strong>{title}</strong>
      {children}
    </div>
  </>;
}


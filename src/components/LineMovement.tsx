import { useEffect, useRef, useState } from "react";
export function LineMovement({
  value,
  scope,
  live,
}: {
  value: number;
  scope: string;
  live: boolean;
}) {
  const previous = useRef({ value, scope });
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { value, scope };
    if (
      !live ||
      before.scope !== scope ||
      !Number.isFinite(value) ||
      !Number.isFinite(before.value) ||
      before.value === value
    ) {
      setDirection(null);
      return;
    }
    setDirection(value > before.value ? "up" : "down");
    const timer = setTimeout(() => setDirection(null), 5000);
    return () => clearTimeout(timer);
  }, [value, scope, live]);
  if (!direction) return null;
  return (
    <span
      className={`line-movement line-movement-${direction}`}
      role="img"
      aria-label={`Line moved ${direction} from its previous value`}
    >
      <span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span>
    </span>
  );
}

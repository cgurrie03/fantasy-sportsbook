import { Icon } from "./ui";
export function LegState({
  status = "Open",
  small = false,
}: {
  status?: string;
  small?: boolean;
}) {
  return (
    <span
      className={
        "leg-circle state-" + status.toLowerCase() + (small ? " small" : "")
      }
      title={status}
      role="img"
      aria-label={status + " Leg"}
    >
      <Icon
        name={
          status === "Won"
            ? "check"
            : status === "Lost"
              ? "close"
              : ["Push", "Voided"].includes(status)
                ? "minus"
                : "clock"
        }
        size={small ? 12 : 14}
      />
    </span>
  );
}

import type { ReactNode } from "react";

export function MarketTitle({
  children,
  eligibility,
}: {
  children: ReactNode;
  eligibility: string;
}) {
  return (
    <div className="market-title">
      <h2>{children}</h2>
      <span className="market-eligibility">{eligibility}</span>
    </div>
  );
}

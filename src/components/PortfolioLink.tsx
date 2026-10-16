// Configure only after the portfolio owner verifies the destination.
export function PortfolioLink() {
  const configured = import.meta.env.VITE_PORTFOLIO_URL;
  try {
    const url = new URL(configured ?? "");
    if (url.protocol !== "https:") return null;
    return <a href={url.href}>Back to portfolio</a>;
  } catch {
    return null;
  }
}

// Default destination verified by the portfolio owner; deployments may override it.
export function PortfolioLink() {
  const configured =
    import.meta.env.VITE_PORTFOLIO_URL || "https://coopergurrie.com/";
  try {
    const url = new URL(configured ?? "");
    if (url.protocol !== "https:") return null;
    return <a href={url.href}>Back to portfolio</a>;
  } catch {
    return null;
  }
}

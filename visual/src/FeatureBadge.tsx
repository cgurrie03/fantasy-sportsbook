import { featureCatalog } from "./featuredOptions";
import type { FeatureKind } from "./featuredOptions";
import { Icon } from "./ui";
export function FeatureBadge({
  kind,
  label,
}: {
  kind: FeatureKind;
  label?: string;
}) {
  const c = featureCatalog[kind];
  return (
    <span
      className={"feature-badge feature-" + c.color}
      data-feature-type={kind}
    >
      <Icon name={c.icon} size={14} />
      <strong>{label || c.label}</strong>
      <small>{c.boost}% Profit Boost</small>
    </span>
  );
}

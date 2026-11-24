import { featureCatalog } from "./featuredOptions";
import type { FeatureKind } from "./featuredOptions";
import { Icon } from "./ui";
export function FeatureBadge({
  kind,
  label,
  boost,
}: {
  kind: FeatureKind;
  label?: string;
  boost?: number;
}) {
  const c = featureCatalog[kind];
  return (
    <span
      className={"feature-badge feature-" + c.color}
      data-feature-type={kind}
    >
      <Icon name={c.icon} size={14} />
      <strong>{label || c.label}</strong>
      <small>{boost ?? c.boost}% Profit Boost</small>
    </span>
  );
}

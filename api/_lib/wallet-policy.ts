export const walletPolicyDefaults = Object.freeze({
  minimum_stake: 1,
  maximum_picks: 10,
  weekly_target: 100,
  futures_cash_floor: 25,
});
export type WalletPolicyValues = typeof walletPolicyDefaults;
export interface WalletPolicy {
  contract: "wallet-ticket-policy-v1";
  defaults_version: 1;
  revision: number;
  effective_season: number | null;
  effective_week: number | null;
  values: WalletPolicyValues;
}
export const defaultWalletPolicy: WalletPolicy = {
  contract: "wallet-ticket-policy-v1",
  defaults_version: 1,
  revision: 0,
  effective_season: null,
  effective_week: null,
  values: walletPolicyDefaults,
};
export function parseWalletPolicy(value: unknown): WalletPolicy {
  const p = value as WalletPolicy;
  if (
    !p ||
    p.contract !== "wallet-ticket-policy-v1" ||
    p.defaults_version !== 1 ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 0 ||
    p.revision > 64 ||
    !p.values
  )
    throw Error("Unsupported wallet policy contract.");
  const v = p.values;
  if (
    Object.keys(v).sort().join() !==
      Object.keys(walletPolicyDefaults).sort().join() ||
    Object.values(v).some(
      (x) =>
        typeof x !== "number" ||
        !Number.isFinite(x) ||
        Math.abs(x * 100 - Math.round(x * 100)) > 1e-7,
    ) ||
    v.minimum_stake < 1 ||
    v.minimum_stake > 10000 ||
    !Number.isInteger(v.maximum_picks) ||
    v.maximum_picks < 2 ||
    v.maximum_picks > 10 ||
    v.weekly_target < 1 ||
    v.weekly_target > 10000 ||
    v.futures_cash_floor < 0 ||
    v.futures_cash_floor > v.weekly_target
  )
    throw Error("Unsupported wallet policy values.");
  if (
    p.revision === 0
      ? p.effective_season !== null || p.effective_week !== null
      : !Number.isInteger(p.effective_season) ||
        p.effective_season! < 2020 ||
        p.effective_season! > 2100 ||
        !Number.isInteger(p.effective_week) ||
        p.effective_week! < 1 ||
        p.effective_week! > 18
  )
    throw Error("Unsupported wallet policy effective period.");
  return p;
}
export function weeklyCashTarget(
  policy: WalletPolicyValues,
  openFutureStakes: number,
  current = 0,
) {
  return (
    Math.round(
      Math.max(
        policy.futures_cash_floor,
        policy.weekly_target - openFutureStakes,
        current,
      ) * 100,
    ) / 100
  );
}

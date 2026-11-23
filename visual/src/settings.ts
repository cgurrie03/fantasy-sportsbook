import { live } from "./live";
import { accountStorageKey } from "./accountState";
const settingsKey = () => live()?.user.id ? accountStorageKey("settings", live().user.id) : "boff-preview-settings";
export type ReviewSettings = {
  oddsFormat: "american" | "decimal";
  defaultStake: number;
  landingPage: string;
  playerScope: "my-team" | "my-matchup" | "all";
  density: "compact" | "comfortable";
  delivery: "both" | "email" | "in-app";
  frequency: "instant" | "daily";
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  timezone: string;
  notifications: Record<string, boolean>;
};
export const notificationOptions = [
  ["recap", "Weekly Recap"],
  ["opening", "New Weekly Markets"],
  ["offers", "Offers & Boost Reminders"],
  ["progress", "Open Ticket Updates"],
  ["settled", "Settled Ticket Results"],
  ["credits", "Weekly Credit Replenishment"],
  ["featured", "Featured Matchups"],
];
const defaults: ReviewSettings = {
  oddsFormat: "american",
  defaultStake: 25,
  landingPage: "matchups",
  playerScope: "my-team",
  density: "compact",
  delivery: "both",
  frequency: "instant",
  quietEnabled: false,
  quietFrom: "22:00",
  quietTo: "08:00",
  timezone: "America/New_York",
  notifications: {
    recap: true,
    opening: true,
    offers: false,
    progress: false,
    settled: true,
    credits: false,
    featured: false,
  },
};
let current: ReviewSettings;
try {
  const saved = JSON.parse(
    localStorage.getItem(settingsKey()) || "{}",
  );
  current = {
    ...defaults,
    ...saved,
    notifications: { ...defaults.notifications, ...saved.notifications },
  };
} catch {
  current = defaults;
}
if (current.playerScope === "my-matchup") current.playerScope = "my-team";
export const getSettings = () => current;
export function saveSettings(value: ReviewSettings) {
  current = value;
  localStorage.setItem(settingsKey(), JSON.stringify(value));
  window.dispatchEvent(new Event("boff-settings-changed"));
}
export function deadlineLabel(iso: string) {
  const zone =
    current.timezone === "device"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : current.timezone;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
  return `${date} · ${time}`;
}

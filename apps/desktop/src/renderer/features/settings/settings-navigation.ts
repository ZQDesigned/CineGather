import { update } from "../../store";

const tabs = [
  "audio",
  "notifications",
  "sharing",
  "server",
  "account",
  "devices",
  "updates",
  "overlay",
] as const;
export type SettingsTab = (typeof tabs)[number];

export function isSettingsPage() {
  const route = location.hash
    ? location.hash.slice(1).split("?")[0]
    : location.pathname.replace(/\/$/, "");
  return route === "/settings";
}
export function readSettingsTab(): SettingsTab {
  const query = location.hash.includes("?")
    ? location.hash.slice(location.hash.indexOf("?") + 1)
    : location.search.slice(1);
  const tab = new URLSearchParams(query).get("tab");
  return tabs.includes(tab as SettingsTab) ? (tab as SettingsTab) : "audio";
}
export function openSettings(tab?: SettingsTab) {
  update({ modal: null });
  if (!tab && isSettingsPage()) return;
  location.hash = tab ? `/settings?tab=${tab}` : "/settings";
}

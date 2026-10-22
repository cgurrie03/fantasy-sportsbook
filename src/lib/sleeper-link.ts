import type { MouseEvent } from "react";

export function sleeperLinks(league: string, week: number, roster: number) {
  const path = `matchup/${encodeURIComponent(league)}/${week}/${roster}`;
  const web = `https://sleeper.com/${path}`;
  return {
    web,
    app: `sleeper://${path}`,
    android: `intent://sleeper.com/${path}#Intent;scheme=https;package=com.sleeperbot;S.browser_fallback_url=${encodeURIComponent(web)};end`,
  };
}

export function openSleeperMatchup(
  event: MouseEvent<HTMLAnchorElement>,
  league: string,
  week: number,
  roster: number,
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const links = sleeperLinks(league, week, roster);
  if (/Android/i.test(navigator.userAgent)) {
    event.preventDefault();
    window.location.assign(links.android);
  } else if (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    event.preventDefault();
    // The OS handles app launch; fall back only if the browser remains visible.
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cleanup);
    };
    const hidden = () => {
      if (document.hidden) cleanup();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      if (!document.hidden) window.location.assign(links.web);
    }, 1800);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cleanup, { once: true });
    window.location.assign(links.app);
  }
}

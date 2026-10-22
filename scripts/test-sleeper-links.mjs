import assert from "node:assert/strict";
import { openSleeperMatchup, sleeperLinks } from "../src/lib/sleeper-link.ts";
const links = sleeperLinks("1312126153980391424", 7, 1);
assert.equal(links.web, "https://sleeper.com/matchup/1312126153980391424/7/1");
assert.equal(links.app, "sleeper://matchup/1312126153980391424/7/1");
assert(links.android.includes("package=com.sleeperbot;"));
assert(links.android.includes(encodeURIComponent(links.web)));
const saved = Object.fromEntries(
  ["navigator", "document", "window"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
try {
  const document = Object.assign(new EventTarget(), { hidden: false });
  const calls = [],
    timers = new Map();
  let id = 0;
  const window = Object.assign(new EventTarget(), {
    location: { assign: (url) => calls.push(url) },
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  const navigator = {
    userAgent: "Android",
    platform: "Linux",
    maxTouchPoints: 1,
  };
  for (const [key, value] of Object.entries({ navigator, document, window }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const tap = (extra = {}) => {
    let prevented = false;
    openSleeperMatchup(
      {
        button: 0,
        preventDefault: () => {
          prevented = true;
        },
        ...extra,
      },
      "1312126153980391424",
      7,
      1,
    );
    return prevented;
  };
  assert(tap());
  assert.equal(calls.pop(), links.android);
  navigator.userAgent = "iPhone";
  assert(tap());
  assert.equal(calls.pop(), links.app);
  for (const fn of [...timers.values()]) fn();
  assert.equal(calls.pop(), links.web);
  assert.equal(timers.size, 0);
  assert(tap());
  calls.length = 0;
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(timers.size, 0);
  assert.equal(calls.length, 0);
  document.hidden = false;
  assert(!tap({ ctrlKey: true }));
  navigator.userAgent = "Desktop";
  navigator.maxTouchPoints = 0;
  assert(!tap());
  assert.equal(calls.length, 0);
} finally {
  for (const [key, descriptor] of Object.entries(saved))
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
}
console.log(
  "Sleeper Android app intent, iOS app attempt/web fallback, cancellation on app switch and desktop/modifier navigation pass. Native installed-app handoff requires a phone.",
);

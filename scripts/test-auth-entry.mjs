import assert from "node:assert/strict";
import {
  AUTH_COOLDOWN_KEY,
  beginAuthCooldown,
  readAuthCooldown,
  cooldownSeconds,
  authRequestFailure,
} from "../src/lib/auth-entry.ts";
const values = new Map();
globalThis.localStorage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v),
  removeItem: (k) => values.delete(k),
};
const now = 1800000000000;
assert.equal(beginAuthCooldown(now), now + 60000);
assert.deepEqual([...values.keys()], [AUTH_COOLDOWN_KEY]);
assert.equal(readAuthCooldown(now), now + 60000);
assert.equal(cooldownSeconds(now + 60000, now + 1900), 59);
assert.equal(readAuthCooldown(now + 61000), 0);
assert.equal(values.size, 0);
for (const invalid of [
  "not-a-number",
  "Infinity",
  "-1",
  String(now + 3600000),
  "0",
]) {
  values.set(AUTH_COOLDOWN_KEY, invalid);
  assert.equal(readAuthCooldown(now), 0);
  assert.equal(values.size, 0);
}
globalThis.localStorage = {
  getItem() {
    throw Error("blocked");
  },
  setItem() {
    throw Error("blocked");
  },
  removeItem() {
    throw Error("blocked");
  },
};
assert.equal(readAuthCooldown(now), 0);
assert.equal(cooldownSeconds(beginAuthCooldown(now), now), 60);
assert.equal(authRequestFailure({ status: 429 }).limited, true);
for (const code of [
  "user_not_found",
  "user_banned",
  "signup_disabled",
  "email_not_confirmed",
])
  assert.equal(authRequestFailure({ code }).neutral, true);
assert(
  !authRequestFailure({ message: "private token or address" }).message.includes(
    "private",
  ),
);
console.log(
  "Auth entry: timestamp expiry/malformed/future/blocked storage, neutral identity codes and bounded rate-limit messaging; one timestamp and no email/token history.",
);

const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/core/update.js");

const DAY = 24 * 3600 * 1000;

test("compare orders versions by number, with or without a leading v", () => {
  assert.equal(U.compare("0.5.0", "0.4.1"), 1);
  assert.equal(U.compare("v0.4.1", "0.4.1"), 0);
  assert.equal(U.compare("0.9.0", "0.10.0"), -1, "0.10 is newer than 0.9");
  assert.equal(U.compare("1.0.0", "0.99.99"), 1);
});

test("isNewer is false for equal, older or unreadable versions", () => {
  assert.equal(U.isNewer("0.5.0", "0.4.1"), true);
  assert.equal(U.isNewer("0.4.1", "0.4.1"), false);
  assert.equal(U.isNewer("0.4.0", "0.4.1"), false);
  assert.equal(U.isNewer("0.5.0", "dev"), false, "an unstamped dev build never nags");
  assert.equal(U.isNewer(undefined, "0.4.1"), false);
});

test("versionFromRelease reads GitHub's latest-release JSON", () => {
  assert.equal(U.versionFromRelease(JSON.stringify({ tag_name: "v0.5.0", draft: false, prerelease: false })), "0.5.0");
  assert.equal(U.versionFromRelease(JSON.stringify({ tag_name: "0.6.1" })), "0.6.1");
  assert.equal(U.versionFromRelease(JSON.stringify({ tag_name: "v0.6.0-beta", prerelease: true })), null);
  assert.equal(U.versionFromRelease(JSON.stringify({ message: "Not Found" })), null);
  assert.equal(U.versionFromRelease('{"tag_name": "v0.5'), null, "a half-written file isn't read");
  assert.equal(U.versionFromRelease(""), null);
});

test("due: at most once a day, never when switched off", () => {
  const now = 1000 * DAY;
  assert.equal(U.due({}, now), true, "never checked");
  assert.equal(U.due({ updateCheckedAt: now - DAY / 2 }, now), false);
  assert.equal(U.due({ updateCheckedAt: now - DAY - 1 }, now), true);
  assert.equal(U.due({ updateCheckedAt: now + DAY }, now), true, "a clock set back doesn't block checks");
  assert.equal(U.due({ checkForUpdates: false }, now), false);
});

test("notice names both versions and the download link, only when newer", () => {
  assert.equal(U.notice("0.5.0", "0.4.1"),
    "Cavalry Geo v0.5.0 is available (you have v0.4.1). Download: https://github.com/optative-visuals/CavalryGeo/releases/latest");
  assert.equal(U.notice("0.4.1", "0.4.1"), null);
  assert.equal(U.notice(undefined, "0.4.1"), null);
});

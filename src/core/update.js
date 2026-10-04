// Update check: compares release versions and decides when to ask GitHub for the latest one.
var GeoUpdate = (function () {
  var CHECK_EVERY_MS = 24 * 3600 * 1000;
  var API_URL = "https://api.github.com/repos/optative-visuals/CavalryGeo/releases/latest";
  var RELEASES_URL = "https://github.com/optative-visuals/CavalryGeo/releases/latest";

  // "v0.4.1" / "0.4.1" -> [0, 4, 1]; anything else (e.g. "dev") -> null.
  function parts(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v === undefined || v === null ? "" : v).trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }
  function compare(a, b) {
    var x = parts(a), y = parts(b);
    if (!x || !y) return 0;
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
  }
  function isNewer(latest, current) { return !!parts(latest) && !!parts(current) && compare(latest, current) > 0; }

  // The version in GitHub's latest-release JSON, or null for anything else (an error reply,
  // a pre-release, or a file curl is still writing).
  function versionFromRelease(text) {
    var r;
    try { r = JSON.parse(text); } catch (e) { return null; }
    if (!r || r.draft || r.prerelease || !parts(r.tag_name)) return null;
    return String(r.tag_name).trim().replace(/^v/, "");
  }

  // settings: { checkForUpdates, updateCheckedAt } from settings.json.
  function due(settings, now) {
    if (settings.checkForUpdates === false) return false;
    var last = Number(settings.updateCheckedAt) || 0;
    return now < last || now - last >= CHECK_EVERY_MS;
  }

  function notice(latest, current) {
    if (!isNewer(latest, current)) return null;
    return "Cavalry Geo v" + latest + " is available (you have v" + current + "). Download: " + RELEASES_URL;
  }

  return { CHECK_EVERY_MS: CHECK_EVERY_MS, API_URL: API_URL, RELEASES_URL: RELEASES_URL, parts: parts, compare: compare, isNewer: isNewer,
    versionFromRelease: versionFromRelease, due: due, notice: notice };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoUpdate;

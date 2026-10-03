// Hashing, safety limits and formatting.
if (typeof GeoGeometry === "undefined" && typeof require !== "undefined") { var GeoGeometry = require("./geometry.js"); }
var GeoUtil = (function () {
  var LIMITS = { AREA_CONFIRM_KM2: { all: 16, main: 400 }, AREA_REFUSE_KM2: 10000, SCENE_WARN_BYTES: 5000000 };

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function hash(str) { return fnv1a(str) + fnv1a(str + "#"); }

  // bbox: one box or an array of boxes (a view split at the date line); areas add up.
  function checkArea(bbox, mode) {
    var area = 0;
    (Array.isArray(bbox) ? bbox : [bbox]).forEach(function (b) { area += GeoGeometry.bboxAreaKm2(b); });
    return {
      areaKm2: area,
      needsConfirm: area > LIMITS.AREA_CONFIRM_KM2[mode === "main" ? "main" : "all"],
      refuse: area > LIMITS.AREA_REFUSE_KM2
    };
  }

  function formatBytes(n) { return Math.round(n / 1e3) < 1000 ? Math.round(n / 1e3) + " KB" : (n / 1e6).toFixed(1) + " MB"; }

  return { LIMITS: LIMITS, hash: hash, checkArea: checkArea, formatBytes: formatBytes };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoUtil;

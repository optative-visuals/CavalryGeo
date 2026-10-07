// Day & night: the sun's position and the night-side outlines. Pure: it runs inside the night
// layers' and time label's scripts (inlined as GEO_SUN_SRC) and in node tests. cav is the
// `cavalry` module (cav.Path, optional measureText).
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
if (typeof GeoRuntime === "undefined" && typeof require !== "undefined") { var GeoRuntime = require("./runtime.js"); }
if (typeof GeoCodec === "undefined" && typeof require !== "undefined") { var GeoCodec = require("./codec.js"); }
if (typeof GeoFurniture === "undefined" && typeof require !== "undefined") { var GeoFurniture = require("./furniture.js"); }
var GeoSun = (function () {
  var D2R = Math.PI / 180, STEP = 2;
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function wrap180(l) { return ((((l + 180) % 360) + 360) % 360) - 180; }

  // Day number in a non-leap year (29 Feb counts as 60).
  function dayOfYear(day, month) {
    var m = Math.max(1, Math.min(12, Math.round(num(month, 1)))), n = 0;
    for (var k = 0; k < m - 1; k++) n += MONTH_DAYS[k];
    return n + Math.max(1, Math.round(num(day, 1)));
  }

  function subsolar(doy, utc) {
    var g = 2 * Math.PI / 365 * (num(doy, 1) - 1 + (num(utc, 12) - 12) / 24);
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    return { lat: decl / D2R, lon: wrap180(-15 * (num(utc, 12) - 12 + eot / 60)) };
  }

  // Closed lon/lat ring (not repeating its first point) of the places more than `depression`
  // degrees below the horizon. A cap holding a pole is traced along the terminator for each
  // longitude and closed along that pole's edge; any other cap is its circle, longitudes kept
  // continuous (so they can pass +-180).
  function nightRing(doy, utc, depression) {
    var s = subsolar(doy, utc), pa = -s.lat * D2R, la = wrap180(s.lon + 180);
    var r = (90 - num(depression, 0)) * D2R, ring = [], k;
    var poleN = Math.PI / 2 - pa < r, poleS = Math.PI / 2 + pa < r;
    if (poleN || poleS) {
      var A = Math.sin(pa), c = Math.cos(r);
      for (var lon = -180; lon <= 180; lon += STEP) {
        var B = Math.cos(pa) * Math.cos((lon - la) * D2R), R = Math.sqrt(A * A + B * B), d = Math.atan2(B, A);
        var q = Math.asin(Math.max(-1, Math.min(1, c / (R || 1e-12))));
        var c1 = q - d, c2 = Math.PI - q - d, best = null, cands = [c1, c2];
        for (k = 0; k < 2; k++) {
          var v = cands[k];
          while (v > Math.PI) v -= 2 * Math.PI;
          while (v < -Math.PI) v += 2 * Math.PI;
          if (Math.abs(v) <= Math.PI / 2 + 1e-9) { best = v; break; }
        }
        if (best === null) best = poleN ? -Math.PI / 2 : Math.PI / 2;
        ring.push([lon, best / D2R]);
      }
      var edge = poleN ? 90 : -90;
      ring.push([180, edge], [-180, edge]);
      return ring;
    }
    // Circle of angular radius r round the antisolar point, by bearing.
    var sp = Math.sin(pa), cp = Math.cos(pa), sr = Math.sin(r), cr = Math.cos(r);
    for (var b = 0; b < 360; b += STEP) {
      var br = b * D2R;
      var lat = Math.asin(Math.max(-1, Math.min(1, sp * cr + cp * sr * Math.cos(br))));
      var dl = Math.atan2(Math.sin(br) * sr * cp, cr - sp * Math.sin(lat)) / D2R;
      ring.push([la + dl, lat / D2R]);
    }
    return ring;
  }

  // The night side as a path on the map. The flat projections repeat the world, so a ring that
  // runs past +-180 is also drawn shifted a world over (the globe shows each place once).
  function nightPath(cam, doy, utc, depression, cav) {
    var ring = nightRing(doy, utc, depression), rings = [ring], lo = 0, hi = 0, k;
    for (k = 0; k < ring.length; k++) { if (ring[k][0] < lo) lo = ring[k][0]; if (ring[k][0] > hi) hi = ring[k][0]; }
    if (Math.round(num(cam.projection, 0)) < 2) {
      if (hi > 180) rings.push(ring.map(function (p) { return [p[0] - 360, p[1]]; }));
      if (lo < -180) rings.push(ring.map(function (p) { return [p[0] + 360, p[1]]; }));
    }
    var enc = GeoCodec.encodeLayer({ kind: "polygon", features: [{ rings: rings }] });
    return GeoRuntime.buildPath(enc, cam, 100, {}, cav.Path);
  }

  // Opacity (0-100) of one of the four stacked layers: soft splits Night into four equal steps
  // that composite to it; hard puts it all on the first.
  function stepOpacity(night, twilight, step) {
    var n = Math.max(0, Math.min(100, num(night, 55)));
    if (num(twilight, 1) >= 0.5) return (1 - Math.pow(1 - n / 100, 1 / 4)) * 100;
    return Math.round(num(step, 0)) === 0 ? n : 0;
  }

  function two(n) { return (n < 10 ? "0" : "") + n; }
  function timeText(doy, utc) {
    var d = Math.max(1, Math.min(365, Math.round(num(doy, 1)))), m = 0;
    while (m < 11 && d > MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m++; }
    var mins = Math.floor(num(utc, 0) * 60 + 1e-6) % 1440;
    if (mins < 0) mins += 1440;
    return d + " " + MONTHS[m] + " \u00b7 " + two(Math.floor(mins / 60)) + ":" + two(mins % 60) + " UTC";
  }

  function textWidth(text, size, cav) {
    if (cav && typeof cav.measureText === "function") {
      try {
        var m = cav.measureText(text, "Lato", "Regular", size);
        if (m && isFinite(Number(m.width)) && Number(m.width) > 0) return Number(m.width);
      } catch (e) { /* fall back to the estimate */ }
    }
    return text.length * size * 0.5;
  }

  function timeLabel(i, cav) {
    var p = new cav.Path(), size = num(i.size, 18), text = timeText(i.dayOfYear, i.utcTime);
    var c = GeoFurniture.cornerPoint(i.corner, num(i.compW, 1920), num(i.compH, 1080), num(i.margin, 40));
    p.addText(text, size, c.right ? c.x - textWidth(text, size, cav) : c.x, c.top ? c.y - size * 0.75 : c.y);
    return p;
  }

  return { dayOfYear: dayOfYear, subsolar: subsolar, nightRing: nightRing, nightPath: nightPath, stepOpacity: stepOpacity, timeText: timeText, timeLabel: timeLabel };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoSun;

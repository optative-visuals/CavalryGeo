// Day & night: the night shader's JavaScript mirror, for node tests only (not in the panel bundle).
// Mirrors plugin/CavalryGeo_plugin/night.sksl: change both together. The inverse projection follows
// plugin/CavalryGeo_plugin/reproject.sksl branch by branch, but returns absolute lat / lon.
if (typeof GeoSun === "undefined" && typeof require !== "undefined") { var GeoSun = require("./sun.js"); }
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
var GeoNight = (function () {
  var D2R = Math.PI / 180;
  var TAU = 5.5, BAND = 18;
  var A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, EM = Math.sqrt(3) / 2;
  var MAX_LAT = GeoProjection.MAX_LAT;

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clampZoom(z) { return clamp(num(z, 0), 0, GeoProjection.MAX_ZOOM); }
  function wrapLon(d) { return d - 360 * Math.floor((d + 180) / 360); }

  // Web Mercator y of a latitude, and its inverse (the same maths as projection.js, which does not export them).
  function mercY(lat) { var p = clamp(lat, -MAX_LAT, MAX_LAT) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
  function invMercY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R; }

  // Equal Earth's y(t) and y'(t), as reproject.sksl's eeY / eeD.
  function eeY(t) { var t2 = t * t, t6 = t2 * t2 * t2; return t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)); }
  function eeD(t) { var t2 = t * t, t6 = t2 * t2 * t2; return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2); }

  // Darkness in 0..1 at depression d (degrees below the horizon). The band is BAND * twilight wide;
  // narrower than one pixel (pxDeg degrees of arc) it is a step at d = 0, smoothed over one pixel.
  function curve(d, twilight, pxDeg) {
    var W = BAND * clamp(num(twilight, 1), 0, 1);
    var w = Math.max(num(pxDeg, 0), 1e-9);
    if (W < w) return clamp(num(d, 0) / w + 0.5, 0, 1);
    var u = clamp(num(d, 0), 0, W) * BAND / W;
    return (1 - Math.exp(-u / TAU)) / (1 - Math.exp(-BAND / TAU));
  }

  // Degrees the sun is below the horizon at lat / lon (negative = day), using GeoSun.subsolar.
  function depression(lat, lon, doy, utc) {
    var s = GeoSun.subsolar(doy, utc);
    var p = num(lat, 0) * D2R, dl = (num(lon, 0) - s.lon) * D2R, dec = s.lat * D2R;
    var sinAlt = Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(dl);
    return -Math.asin(clamp(sinAlt, -1, 1)) / D2R;
  }

  // Screen pixels (camera centre at 0, 0; north +y) to { lat, lon, edge } in degrees, or null off the Earth.
  // edge is the one-pixel soft edge (0..1) at the Earth's outline.
  function unproject(cam, X, Y) {
    var proj = Math.round(clamp(num(cam.projection, 0), 0, 2));
    var R = GeoProjection.worldScale(clampZoom(cam.zoom));
    var rot = num(cam.rotation, 0) * D2R, cr = Math.cos(rot), sr = Math.sin(rot);
    var x = (X * cr + Y * sr) / R, y = (-X * sr + Y * cr) / R;
    var lat0 = num(cam.lat, 0), lon0 = num(cam.lon, 0);
    var t, i, fp, edge;

    if (proj === 0) {
      // Web Mercator: one world, no horizontal limit (the night continues past the date line);
      // see-through only beyond the map's top and bottom.
      var my = y + mercY(lat0);
      if (Math.abs(my) > Math.PI) return null;
      return { lat: invMercY(my), lon: lon0 + x / D2R, edge: 1 };
    }

    if (proj === 1) {
      // Equal Earth: Newton's method (8 iterations) for the parametric latitude.
      var l0 = lon0 * D2R, t0 = Math.asin(EM * Math.sin(lat0 * D2R));
      var ex = x + l0 * Math.cos(t0) / (EM * eeD(t0));
      var ey = y + eeY(t0);
      t = ey / A1;
      for (i = 0; i < 8; i++) t -= (eeY(t) - ey) / eeD(t);
      if (Math.abs(t) > Math.asin(EM)) return null;
      fp = eeD(t);
      var lonRel = ex * EM * fp / Math.cos(t) / D2R;
      if (Math.abs(lonRel) > 180) return null;
      // One-pixel soft edge along the +-180 meridians, then along the pole lines.
      edge = clamp((180 - Math.abs(lonRel)) * D2R * R * Math.cos(t) / (EM * fp), 0, 1);
      edge *= clamp((Math.asin(EM) - Math.abs(t)) * R * fp, 0, 1);
      return { lat: Math.asin(clamp(Math.sin(t) / EM, -1, 1)) / D2R, lon: wrapLon(lonRel), edge: edge };
    }

    // Globe (orthographic): off the disc is see-through, with a one-pixel soft edge at the rim.
    var rho2 = x * x + y * y;
    if (rho2 > 1) return null;
    edge = clamp((1 - Math.sqrt(rho2)) * R, 0, 1);
    var z = Math.sqrt(1 - rho2), sp0 = Math.sin(lat0 * D2R), cp0 = Math.cos(lat0 * D2R);
    return {
      lat: Math.asin(clamp(z * sp0 + y * cp0, -1, 1)) / D2R,
      lon: wrapLon(lon0 + Math.atan2(x, z * cp0 - y * sp0) / D2R),
      edge: edge
    };
  }

  // Opacity (0..1) of the night at screen point (x, y) for the inputs
  // { dayOfYear, utcTime, nightOpacity (0..100), twilight, lights (0..100) }.
  function alphaAt(cam, x, y, inp) {
    var ll = unproject(cam, num(x, 0), num(y, 0));
    if (!ll) return 0;
    var pxDeg = 1 / GeoProjection.worldScale(clampZoom(cam.zoom)) / D2R;
    var d = depression(ll.lat, ll.lon, inp.dayOfYear, inp.utcTime);
    var n = clamp(num(inp.nightOpacity, 55), 0, 100) / 100, L = clamp(num(inp.lights, 0), 0, 100) / 100;
    return curve(d, inp.twilight, pxDeg) * (n + (1 - n) * L) * ll.edge;
  }

  return { TAU: TAU, BAND: BAND, curve: curve, depression: depression, unproject: unproject, alphaAt: alphaAt };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoNight;

// Bent imagery: flat Web Mercator tiles rendered into their own composition (north up,
// centred on the camera) are bent onto the globe / Equal Earth by the Cavalry Geo Reproject
// filter. This works out which part of the Earth the frame shows, the box of it the source
// composition needs, and mirrors the filter's per-pixel maths (sourcePoint) for tests.
// Pure: it also runs inside the view drivers (inlined as GEO_REPROJECT_SRC).
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
var GeoReproject = (function () {
  var D2R = Math.PI / 180;
  var SIN_MAX = 0.9962720762207499; // sin(MAX_LAT) = tanh(PI)
  var MAX_VIEW_PX = 4096;
  var GRID = 17, EDGE = 129, LIMB = 64, OUTLINE = 65, MARGIN = 0.02, WRAP_NEAR = 150;

  function maxLat() { return GeoProjection.MAX_LAT; }
  function clampLat(lat) { var m = maxLat(); return Math.max(-m, Math.min(m, lat)); }
  function mercY(lat) { var p = clampLat(lat) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
  function invMercY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R; }
  // atanh for the small arguments of the globe branch (a series, as the filter does).
  function atanhU(u) {
    if (Math.abs(u) < 0.05) { var u2 = u * u; return u * (1 + u2 / 3 + u2 * u2 / 5); }
    return 0.5 * Math.log((1 + u) / (1 - u));
  }
  // Same as the filter: into [-180, 180).
  function wrap(d) { return d - 360 * Math.floor((d + 180) / 360); }
  function scaleOf(cam) { return GeoProjection.worldScale(Math.max(0, Math.min(GeoProjection.MAX_ZOOM, cam.zoom))); }
  function projOf(cam) { return Math.max(0, Math.min(2, Math.round(cam.projection || 0))); }

  // { dlon0, dlon1, lat0, lat1 }: longitude offsets from the camera (wrapped into [-180, 180))
  // and latitudes seen through a width x height frame, or null when none of the Earth shows.
  function visibleRegion(cam, width, height) {
    var proj = projOf(cam), R = scaleOf(cam), hw = width / 2, hh = height / 2, M = maxLat();
    var dlon0 = Infinity, dlon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity, hit = false;
    var rot = (cam.rotation || 0) * D2R, cr = Math.cos(rot), sr = Math.sin(rot);
    var project = null, out = [0, 0];
    var nearEast = false, nearWest = false;

    function add(d, lat) {
      if (d > WRAP_NEAR) nearEast = true;
      if (d < -WRAP_NEAR) nearWest = true;
      if (d < dlon0) dlon0 = d;
      if (d > dlon1) dlon1 = d;
      if (lat < lat0) lat0 = lat;
      if (lat > lat1) lat1 = lat;
    }
    function sample(X, Y) {
      var p = GeoProjection.unproject(cam, X, Y);
      if (p) { hit = true; add(wrap(p.lon - cam.lon), clampLat(p.lat)); }
    }

    for (var i = 0; i < GRID; i++) {
      for (var j = 0; j < GRID; j++) sample(-hw + width * i / (GRID - 1), -hh + height * j / (GRID - 1));
    }
    // The extremes over the frame lie on its boundary: sample the four edges densely.
    for (var e = 0; e < EDGE; e++) {
      var fx = -hw + width * e / (EDGE - 1), fy = -hh + height * e / (EDGE - 1);
      sample(fx, -hh); sample(fx, hh); sample(-hw, fy); sample(hw, fy);
    }
    if (proj === 2) {
      var r = R * (1 - 1e-9);
      for (var k = 0; k < LIMB; k++) {
        var a = 2 * Math.PI * k / LIMB, X = r * Math.cos(a), Y = r * Math.sin(a);
        if (Math.abs(X) <= hw && Math.abs(Y) <= hh) sample(X, Y);
      }
    }
    if (!hit) return null;

    if (proj === 2) {
      project = GeoProjection.makeProjector(cam);
      for (var s = -1; s <= 1; s += 2) {
        if (project(0, 90 * s, out) && Math.abs(out[0]) <= hw && Math.abs(out[1]) <= hh) {
          if (s > 0) lat1 = M; else lat0 = -M;
          dlon0 = -180; dlon1 = 180;
        }
      }
    } else if (proj === 1) {
      // Equal Earth: the frame can show the map's outline. Walk the outline itself (the two
      // edge meridians and the two pole lines) and keep the parts that fall inside the frame.
      project = GeoProjection.makeProjector(cam);
      var eps = 1e-6;
      for (var q = 0; q < OUTLINE; q++) {
        var f = q / (OUTLINE - 1), la = -90 + 180 * f, lo = -180 + eps + (360 - 2 * eps) * f;
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          if (project(sgn * (180 - eps), la, out) && Math.abs(out[0]) <= hw && Math.abs(out[1]) <= hh) {
            hit = true; add(wrap(sgn * (180 - eps) - cam.lon), clampLat(la));
          }
          if (project(lo, 90 * sgn, out) && Math.abs(out[0]) <= hw && Math.abs(out[1]) <= hh) {
            hit = true; add(wrap(lo - cam.lon), sgn * M);
          }
        }
      }
      if (lat1 > M - 1) lat1 = M;
      if (lat0 < -(M - 1)) lat0 = -M;
    }
    // Places on both sides of the wrap: the region goes all the way round.
    if (nearEast && nearWest) { dlon0 = -180; dlon1 = 180; }

    var dm = (dlon1 - dlon0) * MARGIN, lm = (lat1 - lat0) * MARGIN;
    dlon0 = Math.max(-180, dlon0 - dm); dlon1 = Math.min(180, dlon1 + dm);
    lat0 = Math.max(-M, lat0 - lm); lat1 = Math.min(M, lat1 + lm);

    // The region's Mercator box is the filter's whole output area, so it must cover the frame
    // (Equal Earth is taller than Web Mercator near the equator): grow it about its centre
    // until it is at least the frame's rotated bounding box plus 8 px each side.
    var needW = Math.abs(width * cr) + Math.abs(height * sr) + 16, needH = Math.abs(width * sr) + Math.abs(height * cr) + 16;
    var span = (dlon1 - dlon0) * D2R * R;
    if (span < needW) {
      var mid = (dlon0 + dlon1) / 2, half = needW / R / D2R / 2;
      dlon0 = Math.max(-180, mid - half); dlon1 = Math.min(180, mid + half);
    }
    var ya = mercY(lat0), yb = mercY(lat1);
    if ((yb - ya) * R < needH) {
      var ym = (ya + yb) / 2, hy = needH / R / 2;
      lat0 = Math.max(-M, invMercY(ym - hy)); lat1 = Math.min(M, invMercY(ym + hy));
    }
    return { dlon0: dlon0, dlon1: dlon1, lat0: lat0, lat1: lat1 };
  }

  // The region's box in Web Mercator pixels relative to the camera, its centre and size, and
  // the scale that keeps the source composition's content within MAX_VIEW_PX.
  function viewTransform(cam, region) {
    var R = scaleOf(cam), y0 = mercY(cam.lat);
    var x0 = region.dlon0 * D2R * R, x1 = region.dlon1 * D2R * R;
    var ya = (mercY(region.lat0) - y0) * R, yb = (mercY(region.lat1) - y0) * R;
    var w = x1 - x0, h = yb - ya;
    return { scale: Math.min(1, MAX_VIEW_PX / Math.max(w, h)), cx: (x0 + x1) / 2, cy: (ya + yb) / 2, w: w, h: h };
  }

  function view(cam, width, height) {
    var region = visibleRegion(cam, width, height);
    return region ? viewTransform(cam, region) : { scale: 1, cx: 0, cy: 0, w: 0, h: 0 };
  }

  // JavaScript mirror of reproject.sksl: the source composition position sampled for the map
  // pixel (X, Y), or null off the globe's disc / outside the Equal Earth outline.
  // GeoProjection.unproject undoes the camera rotation itself.
  function sourcePoint(cam, v, X, Y) {
    var proj = projOf(cam), R = scaleOf(cam);
    var rot = (cam.rotation || 0) * D2R, cr = Math.cos(rot), sr = Math.sin(rot);
    var dlon, my;
    if (proj === 0) {
      // Web Mercator: one world, as the vector map; see-through past its top / bottom and sides.
      var x = (X * cr + Y * sr) / R, y = (-X * sr + Y * cr) / R;
      if (Math.abs(y + mercY(cam.lat)) > Math.PI || Math.abs(cam.lon + x / D2R) > 180) return null;
      dlon = wrap(x / D2R);
      my = y;
    } else if (proj === 1) {
      // Equal Earth: no cancellation-free form; exact up to about zoom 15 in the filter.
      var p = GeoProjection.unproject(cam, X, Y);
      if (!p) return null;
      dlon = wrap(p.lon - cam.lon);
      my = mercY(p.lat) - mercY(cam.lat);
    } else {
      // Globe: latitude relative to the camera's, without subtracting two large numbers.
      var gx = (X * cr + Y * sr) / R, gy = (-X * sr + Y * cr) / R, rho2 = gx * gx + gy * gy;
      if (rho2 > 1) return null;
      var z = Math.sqrt(1 - rho2), sp0 = Math.sin(cam.lat * D2R), cp0 = Math.cos(cam.lat * D2R);
      dlon = wrap(Math.atan2(gx, z * cp0 - gy * sp0) / D2R);
      var dS = gy * cp0 - sp0 * rho2 / (1 + z), sphi = sp0 + dS;
      if (Math.abs(sphi) > SIN_MAX || Math.abs(sp0) > SIN_MAX) {
        my = mercY(Math.asin(Math.max(-1, Math.min(1, sphi))) / D2R) - mercY(cam.lat);
      } else {
        my = atanhU(dS / (1 - sp0 * sphi));
      }
    }
    var mx = dlon * D2R * R;
    my = my * R;
    return [(mx - v.cx) * v.scale, (my - v.cy) * v.scale];
  }

  return { MAX_VIEW_PX: MAX_VIEW_PX, visibleRegion: visibleRegion, viewTransform: viewTransform, view: view, sourcePoint: sourcePoint };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoReproject;

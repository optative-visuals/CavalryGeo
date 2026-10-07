// Bent imagery: flat Web Mercator tiles rendered into their own composition (north up,
// centred on the camera) are bent onto the globe / Equal Earth by the Cavalry Geo Reproject
// filter. This works out which part of the Earth the frame shows, the box of it the source
// composition needs, and mirrors the filter's per-pixel maths (sourcePoint) for tests.
// Pure: it also runs inside the view drivers (inlined as GEO_REPROJECT_SRC).
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
var GeoReproject = (function () {
  var D2R = Math.PI / 180;
  var MAX_VIEW_PX = 4096;
  var GRID = 17, LIMB = 64, MARGIN = 0.02;

  function maxLat() { return GeoProjection.MAX_LAT; }
  function clampLat(lat) { var m = maxLat(); return Math.max(-m, Math.min(m, lat)); }
  function mercY(lat) { var p = clampLat(lat) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
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
    var project = null, out = [0, 0], ox = 0, oy = 0, top = 0;
    if (proj === 1) {
      // Equal Earth: map-space (unrotated) position of lon 0 / lat 0 and of the pole line.
      project = GeoProjection.makeProjector(cam);
      project(0, 0, out); ox = out[0] * cr + out[1] * sr; oy = -out[0] * sr + out[1] * cr;
      project(0, 90, out); top = Math.abs(-out[0] * sr + out[1] * cr - oy);
    }
    var offSide = 0, offPole = 0;

    function add(d, lat) {
      if (d < dlon0) dlon0 = d;
      if (d > dlon1) dlon1 = d;
      if (lat < lat0) lat0 = lat;
      if (lat > lat1) lat1 = lat;
    }
    function sample(X, Y) {
      var p = GeoProjection.unproject(cam, X, Y);
      if (p) { hit = true; add(wrap(p.lon - cam.lon), clampLat(p.lat)); return; }
      if (proj !== 1) return;
      // Off the Equal Earth outline: past the pole line, or past the 180° meridian on one side.
      var ux = X * cr + Y * sr - ox, uy = -X * sr + Y * cr - oy;
      if (Math.abs(uy) >= top) offPole |= uy > 0 ? 2 : 1;
      else offSide |= ux > 0 ? 2 : 1;
    }

    for (var i = 0; i < GRID; i++) {
      for (var j = 0; j < GRID; j++) sample(-hw + width * i / (GRID - 1), -hh + height * j / (GRID - 1));
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
      if (lat1 > M - 1 || offPole & 2) lat1 = M;
      if (lat0 < -(M - 1) || offPole & 1) lat0 = -M;
      if (offSide & 2) add(wrap(180 - 1e-9 - cam.lon), lat0);
      if (offSide & 1) add(wrap(-180 + 1e-9 - cam.lon), lat0);
    }

    var dm = (dlon1 - dlon0) * MARGIN, lm = (lat1 - lat0) * MARGIN;
    return {
      dlon0: Math.max(-180, dlon0 - dm), dlon1: Math.min(180, dlon1 + dm),
      lat0: Math.max(-M, lat0 - lm), lat1: Math.min(M, lat1 + lm)
    };
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
    var p = GeoProjection.unproject(cam, X, Y);
    if (!p) return null;
    var R = scaleOf(cam);
    var mx = wrap(p.lon - cam.lon) * D2R * R, my = (mercY(p.lat) - mercY(cam.lat)) * R;
    return [(mx - v.cx) * v.scale, (my - v.cy) * v.scale];
  }

  return { MAX_VIEW_PX: MAX_VIEW_PX, visibleRegion: visibleRegion, viewTransform: viewTransform, view: view, sourcePoint: sourcePoint };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoReproject;

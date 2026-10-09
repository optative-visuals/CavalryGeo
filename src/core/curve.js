// Bézier handles for a route leg between two stops on screen. Pure: it also runs inside the
// legs' handle helpers (inlined as GEO_CURVE_SRC). Handles are relative to their own stop, as
// Cavalry's Bézier line offsets are. Arc height keeps the old lift meaning: 100 % puts the
// middle of the curve half the leg's length away from the straight line.
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
var GeoCurve = (function () {
  function clamp(v, lo, hi) { v = Number(v) || 0; return Math.max(lo, Math.min(hi, v)); }

  // opts: { arc: 0..100, lean: -100..100 (positive = towards the end stop), flip: truthy = other side }
  function handles(p0, p1, opts) {
    opts = opts || {};
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return { start: [0, 0], end: [0, 0] };
    var nx = -dy / len, ny = dx / len; // 90° anticlockwise of travel
    if (opts.flip) { nx = -nx; ny = -ny; }
    // Both handles pushed out by c put the curve's middle 0.75 c out.
    var c = clamp(opts.arc, 0, 100) / 100 * 0.5 * len / 0.75, s = clamp(opts.lean, -100, 100) / 100;
    var a = (1 + s) / 3, b = (1 - s) / 3;
    return { start: [dx * a + nx * c, dy * a + ny * c], end: [-dx * b + nx * c, -dy * b + ny * c] };
  }

  var D2R = Math.PI / 180;
  function wrap180(x) { return ((x + 540) % 360 + 360) % 360 - 180; }
  function unit(lon, lat) {
    var p = lat * D2R, l = lon * D2R;
    return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  }
  function angleBetween(u, v) {
    var d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  // Point a fraction t along the great circle from A to B, as [lon, lat] degrees.
  function greatCirclePoint(aLon, aLat, bLon, bLat, t) {
    var u = unit(aLon, aLat), v = unit(bLon, bLat), w = angleBetween(u, v);
    if (w < 1e-9) return [aLon, aLat];
    var sw = Math.sin(w), ka = Math.sin((1 - t) * w) / sw, kb = Math.sin(t * w) / sw;
    var x = ka * u[0] + kb * v[0], y = ka * u[1] + kb * v[1], z = ka * u[2] + kb * v[2];
    return [Math.atan2(y, x) / D2R, Math.asin(Math.max(-1, Math.min(1, z))) / D2R];
  }

  // Handles that make the leg follow the great circle between two stops (as seen by gc.cam),
  // plus Arc's lift. gc: { cam, aLon, aLat, bLon, bLat, offA: [x, y], offB: [x, y] }; p0 / p1
  // are the stops on screen (drag offsets included). Identical or antipodal stops fall back to Arc.
  function greatCircleHandles(p0, p1, gc, opts) {
    opts = opts || {};
    var w = angleBetween(unit(gc.aLon, gc.aLat), unit(gc.bLon, gc.bLat));
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.sqrt(dx * dx + dy * dy);
    if (w < 1e-9 || w > Math.PI - 1e-6 || len < 1e-6) return handles(p0, p1, opts);
    var project = GeoProjection.makeProjector(gc.cam, true);
    var g1 = greatCirclePoint(gc.aLon, gc.aLat, gc.bLon, gc.bLat, 1 / 3);
    var g2 = greatCirclePoint(gc.aLon, gc.aLat, gc.bLon, gc.bLat, 2 / 3);
    // Flat maps: the samples go on the copy that continues from aLon (the stops' longitudes may be chained past 180), so
    // a leg across the date line keeps its great circle. Where b is not on that copy the plain arc is drawn instead.
    if (gc.cam && Math.round(gc.cam.projection || 0) <= 0) {
      g1[0] = gc.aLon + wrap180(g1[0] - gc.aLon);
      g2[0] = g1[0] + wrap180(g2[0] - g1[0]);
    }
    if (gc.cam && gc.cam.projection < 2 && (Math.abs(g1[0] - gc.aLon) > 180 || Math.abs(g2[0] - g1[0]) > 180 || Math.abs(gc.bLon - g2[0]) > 180)) return handles(p0, p1, opts);
    var q1 = [0, 0], q2 = [0, 0];
    project(g1[0], g1[1], q1);
    project(g2[0], g2[1], q2);
    var oa = gc.offA || [0, 0], ob = gc.offB || [0, 0];
    var nx = -dy / len, ny = dx / len;
    if (opts.flip) { nx = -nx; ny = -ny; }
    // Lifting both samples by l puts the Bézier's middle 1.125 l out, so scale to land it on d.
    var d = clamp(opts.arc, 0, 100) / 100 * 0.5 * len, s = clamp(opts.lean, -100, 100) / 100;
    var l1 = d * (1 - s) / 1.125, l2 = d * (1 + s) / 1.125;
    q1[0] += 2 / 3 * oa[0] + 1 / 3 * ob[0] + nx * l1; q1[1] += 2 / 3 * oa[1] + 1 / 3 * ob[1] + ny * l1;
    q2[0] += 1 / 3 * oa[0] + 2 / 3 * ob[0] + nx * l2; q2[1] += 1 / 3 * oa[1] + 2 / 3 * ob[1] + ny * l2;
    // Cubic through p0, q1 (t = 1/3), q2 (t = 2/3), p1: solve for the two control points.
    var out = { start: [0, 0], end: [0, 0] };
    for (var k = 0; k < 2; k++) {
      var A = 27 * q1[k] - 8 * p0[k] - p1[k], B = 27 * q2[k] - p0[k] - 8 * p1[k];
      out.start[k] = (2 * A - B) / 18 - p0[k];
      out.end[k] = (2 * B - A) / 18 - p1[k];
    }
    return out;
  }

  // Whether any of the great circle between the stops is on the visible hemisphere (the cheap
  // part of visibleSpan: sampling only). Flat maps: always.
  function anyVisible(gc) {
    var cam = gc && gc.cam;
    if (!cam || Math.round(cam.projection || 0) !== 2) return true;
    var project = GeoProjection.makeProjector(cam, true), tmp = [0, 0];
    var w = angleBetween(unit(gc.aLon, gc.aLat), unit(gc.bLon, gc.bLat));
    if (w < 1e-9 || w > Math.PI - 1e-6) return project(gc.aLon, gc.aLat, tmp) || project(gc.bLon, gc.bLat, tmp);
    for (var i = 0; i <= 64; i++) {
      var g = greatCirclePoint(gc.aLon, gc.aLat, gc.bLon, gc.bLat, i / 64);
      if (project(g[0], g[1], tmp)) return true;
    }
    return false;
  }

  // Which part of a globe leg is on the visible hemisphere, as fractions { s0, s1 } of the leg's
  // own screen length (0 = first stop, 1 = last), or null when none of it is. The leg is the cubic
  // through p0 (+ startOff), p1 (+ endOff). gc: { cam, aLon, aLat, bLon, bLat }. Flat maps show the
  // whole leg. The visible part of the great circle between the stops is one contiguous arc: its
  // limb crossings are found on the great circle and mapped onto the Bézier by nearest point.
  function visibleSpan(p0, p1, startOff, endOff, gc) {
    var cam = gc && gc.cam;
    if (!cam || Math.round(cam.projection || 0) !== 2) return { s0: 0, s1: 1 };
    var project = GeoProjection.makeProjector(cam, true), tmp = [0, 0];
    function front(g) { return project(g[0], g[1], tmp); }
    var w = angleBetween(unit(gc.aLon, gc.aLat), unit(gc.bLon, gc.bLat));
    if (w < 1e-9 || w > Math.PI - 1e-6) {
      return (front([gc.aLon, gc.aLat]) || front([gc.bLon, gc.bLat])) ? { s0: 0, s1: 1 } : null;
    }
    function at(t) { return greatCirclePoint(gc.aLon, gc.aLat, gc.bLon, gc.bLat, t); }
    var N = 64, first = -1, last = -1, i;
    for (i = 0; i <= N; i++) if (front(at(i / N))) { if (first < 0) first = i; last = i; }
    if (first < 0) return null;
    if (first === 0 && last === N) return { s0: 0, s1: 1 };
    // Limb crossing between a visible and a hidden great-circle parameter, as a screen point.
    function crossing(tIn, tOut) {
      for (var k = 0; k < 12; k++) {
        var m = (tIn + tOut) / 2;
        if (front(at(m))) tIn = m; else tOut = m;
      }
      var g = at(tIn), q = [0, 0];
      project(g[0], g[1], q);
      return q;
    }
    var c1 = [p0[0] + startOff[0], p0[1] + startOff[1]], c2 = [p1[0] + endOff[0], p1[1] + endOff[1]];
    var M = 128, pts = [], cum = [0];
    for (i = 0; i <= M; i++) {
      var t = i / M, u = 1 - t;
      pts.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]);
      if (i > 0) cum.push(cum[i - 1] + Math.sqrt(Math.pow(pts[i][0] - pts[i - 1][0], 2) + Math.pow(pts[i][1] - pts[i - 1][1], 2)));
    }
    var total = cum[M];
    if (!(total > 1e-9)) return { s0: 0, s1: 1 };
    function fractionOf(q) {
      var best = Infinity, frac = 0;
      for (var j = 0; j < M; j++) {
        var ax = pts[j][0], ay = pts[j][1], dx = pts[j + 1][0] - ax, dy = pts[j + 1][1] - ay, l2 = dx * dx + dy * dy;
        var v = l2 > 1e-12 ? Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2)) : 0;
        var ex = ax + v * dx - q[0], ey = ay + v * dy - q[1], d = ex * ex + ey * ey;
        if (d < best) { best = d; frac = (cum[j] + v * Math.sqrt(l2)) / total; }
      }
      return frac;
    }
    var s0 = first === 0 ? 0 : fractionOf(crossing(first / N, (first - 1) / N));
    var s1 = last === N ? 1 : fractionOf(crossing(last / N, (last + 1) / N));
    if (s1 < s0) { var sw = s0; s0 = s1; s1 = sw; }
    return { s0: s0, s1: s1 };
  }

  // An Arc-shaped leg on the globe: the hidden stop's end is already pushed onto the limb, so the
  // visible part runs from the visible stop along the leg's own Bézier until it first leaves the
  // globe's disc (radius worldScale(zoom), centred on the map origin), refined by bisection. If it
  // never leaves, the cut is the hidden stop's end. Both visible: whole; both hidden: as visibleSpan.
  function arcSpan(p0, p1, startOff, endOff, gc) {
    var cam = gc && gc.cam;
    if (!cam || Math.round(cam.projection || 0) !== 2) return { s0: 0, s1: 1 };
    var project = GeoProjection.makeProjector(cam, true), tmp = [0, 0];
    var aVis = project(gc.aLon, gc.aLat, tmp), bVis = project(gc.bLon, gc.bLat, tmp);
    if (aVis && bVis) return { s0: 0, s1: 1 };
    if (!aVis && !bVis) return visibleSpan(p0, p1, startOff, endOff, gc);
    var R = GeoProjection.worldScale(Math.max(0, Math.min(GeoProjection.MAX_ZOOM, Number(cam.zoom) || 0)));
    var c1 = [p0[0] + startOff[0], p0[1] + startOff[1]], c2 = [p1[0] + endOff[0], p1[1] + endOff[1]];
    function pt(t) {
      var u = 1 - t;
      return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]];
    }
    function out(t) { var q = pt(t); return Math.sqrt(q[0] * q[0] + q[1] * q[1]) > R; }
    var M = 128, i, cum = [0], prev = pt(0), cur;
    for (i = 1; i <= M; i++) { cur = pt(i / M); cum.push(cum[i - 1] + Math.sqrt(Math.pow(cur[0] - prev[0], 2) + Math.pow(cur[1] - prev[1], 2))); prev = cur; }
    var total = cum[M];
    if (!(total > 1e-9)) return { s0: 0, s1: 1 };
    // t of the first departure from the disc walking from the visible stop (dir 1: from t = 0, -1: from t = 1).
    var cut = -1;
    for (i = 1; i <= M && cut < 0; i++) {
      var ta = aVis ? (i - 1) / M : 1 - (i - 1) / M, tb = aVis ? i / M : 1 - i / M;
      if (out(tb)) {
        var lo = ta, hi = tb;
        for (var k = 0; k < 20; k++) { var m = (lo + hi) / 2; if (out(m)) hi = m; else lo = m; }
        cut = lo;
      }
    }
    if (cut < 0) return { s0: 0, s1: 1 };
    var base = Math.floor(cut * M + 1e-9), q0 = pt(base / M), q1 = pt(cut);
    var along = (cum[base] + Math.sqrt(Math.pow(q1[0] - q0[0], 2) + Math.pow(q1[1] - q0[1], 2))) / total;
    along = Math.max(0, Math.min(1, along));
    return aVis ? { s0: 0, s1: along } : { s0: along, s1: 1 };
  }
  // The span for a leg of this Shape (0 = Arc, else Great circle).
  function legSpan(p0, p1, startOff, endOff, gc, shape) {
    return Number(shape) < 0.5 ? arcSpan(p0, p1, startOff, endOff, gc) : visibleSpan(p0, p1, startOff, endOff, gc);
  }

  return { arcSpan: arcSpan, legSpan: legSpan, handles: handles, greatCirclePoint: greatCirclePoint, greatCircleHandles: greatCircleHandles, visibleSpan: visibleSpan, anyVisible: anyVisible };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoCurve;

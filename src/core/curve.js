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

  return { handles: handles, greatCirclePoint: greatCirclePoint, greatCircleHandles: greatCircleHandles };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoCurve;

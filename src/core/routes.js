// Great-circle maths for route legs. No Cavalry APIs, because it also runs inside route layer
// expressions; routeShift needs GeoProjection.nearestLon (projection.js runs alongside it there too).
// Vectors are Earth-centred unit vectors
// (x toward lon 0 / lat 0, y toward lon 90°E, z toward the north pole).
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
var GeoRoutes = (function () {
  var D2R = Math.PI / 180;

  function toVec(lon, lat) {
    var p = lat * D2R, l = lon * D2R, c = Math.cos(p);
    return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
  }

  function toLonLat(v) {
    return [Math.atan2(v[1], v[0]) / D2R, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R];
  }

  function stepsFor(angleDeg) { return Math.max(16, Math.min(128, Math.ceil(angleDeg / 2))); }

  // Unit direction of travel at a, in the plane through a and b. For antipodal stops that
  // plane is undefined, so head toward the north pole (or along +x when a is a pole).
  function travelDir(a, b, angle) {
    var s = Math.sin(angle), w;
    if (s > 1e-6) {
      var c = Math.cos(angle);
      w = [(b[0] - a[0] * c) / s, (b[1] - a[1] * c) / s, (b[2] - a[2] * c) / s];
    } else {
      var ref = Math.abs(a[2]) > 0.999999 ? [1, 0, 0] : [0, 0, 1];
      var d = ref[0] * a[0] + ref[1] * a[1] + ref[2] * a[2];
      w = [ref[0] - d * a[0], ref[1] - d * a[1], ref[2] - d * a[2]];
    }
    var len = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
    return [w[0] / len, w[1] / len, w[2] / len];
  }

  function greatCircle(lonA, latA, lonB, latB) {
    var a = toVec(lonA, latA), b = toVec(lonB, latB);
    var dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    var angle = Math.acos(dot);
    if (angle < 1e-9) return { angle: 0, points: [], ts: [] };
    var w = travelDir(a, b, angle), n = stepsFor(angle / D2R), points = [], ts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, c = Math.cos(t * angle), s = Math.sin(t * angle);
      points.push([a[0] * c + w[0] * s, a[1] * c + w[1] * s, a[2] * c + w[2] * s]);
      ts.push(t);
    }
    return { angle: angle, points: points, ts: ts };
  }

  // Height of the arc at t, as a fraction of the leg's chord length: 0 at both ends,
  // lift/100 * 0.5 at the middle.
  function liftFactor(t, lift) {
    var l = Math.max(0, Math.min(100, Number(lift) || 0));
    return l / 100 * 0.5 * Math.sin(Math.PI * t);
  }

  // Adjusts each longitude by ±360 so consecutive steps never exceed 180°.
  function unwrapLons(lons) {
    var out = [], prev = 0;
    for (var i = 0; i < lons.length; i++) {
      var l = lons[i];
      if (i > 0) { while (l - prev > 180) l -= 360; while (l - prev < -180) l += 360; }
      out.push(l);
      prev = l;
    }
    return out;
  }

  // The route's stop longitudes as drawn: each leg takes the short way across the date line.
  function chainLons(lons) { return unwrapLons(lons); }

  // The whole-turn shift that puts a route's longitude midpoint (mean of its first and last chained
  // longitudes) on the copy nearest the camera. Flat maps only.
  function routeShift(chained, camLon) {
    var mean = (chained[0] + chained[chained.length - 1]) / 2;
    return GeoProjection.nearestLon(mean, camLon) - mean;
  }

  return { toVec: toVec, toLonLat: toLonLat, stepsFor: stepsFor, greatCircle: greatCircle, liftFactor: liftFactor, unwrapLons: unwrapLons,
    chainLons: chainLons, routeShift: routeShift };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoRoutes;

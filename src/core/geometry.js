// Small-scale planar geometry on lon/lat rings (good enough for ranking and limits).
var GeoGeometry = (function () {
  var D2R = Math.PI / 180, KM_PER_DEG = 111.32;

  function ringAreaKm2(ring) {
    var n = ring.length;
    if (n < 3) return 0;
    var meanLat = 0;
    for (var i = 0; i < n; i++) meanLat += ring[i][1];
    var k = Math.cos(meanLat / n * D2R) * KM_PER_DEG;
    var sum = 0;
    for (var j = 0; j < n; j++) {
      var p = ring[j], q = ring[(j + 1) % n];
      sum += (p[0] * k) * (q[1] * KM_PER_DEG) - (q[0] * k) * (p[1] * KM_PER_DEG);
    }
    return Math.abs(sum) / 2;
  }

  function ringLengthKm(ring) {
    var total = 0;
    for (var i = 1; i < ring.length; i++) {
      var a = ring[i - 1], b = ring[i];
      var k = Math.cos((a[1] + b[1]) / 2 * D2R);
      var dx = (b[0] - a[0]) * k * KM_PER_DEG, dy = (b[1] - a[1]) * KM_PER_DEG;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }

  // Shoelace formula in lon/lat (y-up): positive means counter-clockwise.
  function signedArea(ring) {
    var n = ring.length, sum = 0;
    for (var i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      sum += p[0] * q[1] - q[0] * p[1];
    }
    return sum / 2;
  }

  // Returns ring as-is if its winding already matches `ccw`, otherwise a reversed copy.
  function orientRing(ring, ccw) {
    var isCcw = signedArea(ring) > 0;
    if (isCcw === !!ccw) return ring;
    return ring.slice().reverse();
  }

  function same(a, b) { return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9; }
  function isClosed(ring) { return ring.length > 2 && same(ring[0], ring[ring.length - 1]); }

  // Joins open way fragments (OSM multipolygon members) into closed rings.
  function joinRings(segments) {
    var pool = segments.filter(function (s) { return s.length > 1; }).map(function (s) { return s.slice(); });
    var rings = [];
    while (pool.length) {
      var ring = pool.shift();
      while (!isClosed(ring)) {
        var end = ring[ring.length - 1], found = -1, reverse = false;
        for (var i = 0; i < pool.length; i++) {
          if (same(pool[i][0], end)) { found = i; break; }
          if (same(pool[i][pool[i].length - 1], end)) { found = i; reverse = true; break; }
        }
        if (found < 0) break;
        var seg = pool.splice(found, 1)[0];
        if (reverse) seg.reverse();
        ring = ring.concat(seg.slice(1));
      }
      if (isClosed(ring) && ring.length >= 4) rings.push(ring);
    }
    return rings;
  }

  function bboxAreaKm2(b) {
    var k = Math.cos((b.south + b.north) / 2 * D2R);
    return Math.abs(b.east - b.west) * k * KM_PER_DEG * Math.abs(b.north - b.south) * KM_PER_DEG;
  }

  function totalLengthKm(rings) {
    var total = 0;
    for (var i = 0; i < rings.length; i++) {
      total += ringLengthKm(rings[i]);
    }
    return total;
  }

  function totalAreaKm2(rings) {
    var total = 0;
    for (var i = 0; i < rings.length; i++) {
      total += ringAreaKm2(rings[i]);
    }
    return total;
  }

  return {
    ringAreaKm2: ringAreaKm2, ringLengthKm: ringLengthKm, isClosed: isClosed, joinRings: joinRings,
    bboxAreaKm2: bboxAreaKm2, totalLengthKm: totalLengthKm, totalAreaKm2: totalAreaKm2,
    signedArea: signedArea, orientRing: orientRing
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoGeometry;

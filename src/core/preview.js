// Map preview maths: a flat Web Mercator view in preview pixels (origin top-left, y down),
// the fixed frame in the middle and its camera, detail levels, culling, simplification and
// hit-testing. Preview zoom z means the world is 256 * 2^z px wide (like GeoProjection).
if (typeof GeoCurve === "undefined" && typeof require !== "undefined") { var GeoCurve = require("./curve.js"); }
var GeoPreview = (function () {
  var D2R = Math.PI / 180, MAX_LAT = 85.0511287798;
  var FRAME_FRACTION = 0.6, CAMERA_MIN_ZOOM = 0, CAMERA_MAX_ZOOM = 18, MIN_FEATURE_PX = 2;
  // Tolerances are in zoom-0 world units: 1 px at zoom z is 1 / 2^z.
  // Cavalry draws ~6 ms per 1000 points (probe, 2026-10-04), so each level keeps a view to a few thousand.
  var LEVELS = [
    { data: "110m", tolerance: 1, lakes: false },
    { data: "110m", tolerance: 1 / 2, lakes: false },
    { data: "50m", tolerance: 1 / Math.pow(2, 2.5), lakes: false },
    { data: "50m", tolerance: 1 / Math.pow(2, 4), lakes: false },
    { data: "50m", tolerance: 0, lakes: true }
  ];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clampLat(lat) { return clamp(lat, -MAX_LAT, MAX_LAT); }
  function wrapLon(lon) { return ((lon + 540) % 360 + 360) % 360 - 180; }
  function worldX(lon) { return (lon + 180) / 360 * 256; }
  function worldY(lat) { var p = clampLat(lat) * D2R; return (1 - Math.log(Math.tan(Math.PI / 4 + p / 2)) / Math.PI) / 2 * 256; }
  function lonOf(x) { return x / 256 * 360 - 180; }
  function latOf(y) { var n = Math.PI * (1 - 2 * y / 256); return Math.atan((Math.exp(n) - Math.exp(-n)) / 2) / D2R; }
  function scale(view) { return Math.pow(2, view.zoom); }

  function toPx(view, lon, lat) {
    var s = scale(view);
    return [(worldX(lon) - worldX(view.lon)) * s + view.width / 2, (worldY(lat) - worldY(view.lat)) * s + view.height / 2];
  }
  function fromPx(view, x, y) {
    var s = scale(view);
    return { lon: lonOf(worldX(view.lon) + (x - view.width / 2) / s), lat: latOf(worldY(view.lat) + (y - view.height / 2) / s) };
  }
  function centred(view, lon, lat, zoom) { return { lat: clampLat(lat), lon: wrapLon(lon), zoom: zoom, width: view.width, height: view.height }; }
  // The map follows the mouse: moving it by (dx, dy) moves the centre the other way.
  function pan(view, dx, dy) {
    var c = fromPx(view, view.width / 2 - dx, view.height / 2 - dy);
    return centred(view, c.lon, c.lat, view.zoom);
  }

  function frameRect(view, compW, compH) {
    var aspect = compW / compH, w = Math.min(FRAME_FRACTION * view.width, FRAME_FRACTION * view.height * aspect), h = w / aspect;
    return { x: (view.width - w) / 2, y: (view.height - h) / 2, w: w, h: h };
  }
  function cameraOffset(view, compW, compH) { return Math.log(compW / frameRect(view, compW, compH).w) / Math.LN2; }
  function frameCamera(view, compW, compH) { return { lat: view.lat, lon: view.lon, zoom: view.zoom + cameraOffset(view, compW, compH) }; }
  function viewForCamera(cam, compW, compH, width, height) {
    var v = { lat: clampLat(cam.lat), lon: wrapLon(cam.lon), zoom: 0, width: width, height: height };
    v.zoom = cam.zoom - cameraOffset(v, compW, compH);
    return v;
  }
  function cameraRect(view, cam, compW, compH) {
    var c = toPx(view, cam.lon, cam.lat), k = Math.pow(2, view.zoom - cam.zoom), w = compW * k, h = compH * k;
    return { x: c[0] - w / 2, y: c[1] - h / 2, w: w, h: h };
  }
  // Zooms by `steps` levels keeping the point under (x, y) still; the frame's camera zoom stays in 0–18.
  function zoomAt(view, steps, x, y, compW, compH) {
    var off = cameraOffset(view, compW, compH);
    var z = clamp(view.zoom + steps, CAMERA_MIN_ZOOM - off, CAMERA_MAX_ZOOM - off);
    if (z === view.zoom) return view;
    var anchor = fromPx(view, x, y), v = centred(view, view.lon, view.lat, z), p = toPx(v, anchor.lon, anchor.lat);
    return pan(v, x - p[0], y - p[1]);
  }

  function detailFor(zoom, dragging) {
    var level = zoom < 1 ? 0 : zoom < 2.5 ? 1 : zoom < 4 ? 2 : zoom < 6 ? 3 : 4;
    return dragging ? Math.max(0, level - 1) : level;
  }

  function ringBox(r) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < r.length; i += 2) {
      if (r[i] < b.x0) b.x0 = r[i]; if (r[i] > b.x1) b.x1 = r[i];
      if (r[i + 1] < b.y0) b.y0 = r[i + 1]; if (r[i + 1] > b.y1) b.y1 = r[i + 1];
    }
    return b;
  }
  function unionBox(boxes) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    boxes.forEach(function (r) { b.x0 = Math.min(b.x0, r.x0); b.y0 = Math.min(b.y0, r.y0); b.x1 = Math.max(b.x1, r.x1); b.y1 = Math.max(b.y1, r.y1); });
    return b;
  }
  // Projects every point once, to flat [x0, y0, x1, y1, ...] rings in zoom-0 world units.
  // Each feature keeps its bbox (the coarse cull) and one per ring (ringBoxes[i] for rings[i]),
  // so a big country with one island on screen draws only that island.
  function prepare(layer) {
    return { features: layer.features.map(function (f) {
      var rings = f.rings.map(function (ring) {
        var a = new Array(ring.length * 2);
        for (var i = 0; i < ring.length; i++) { a[2 * i] = worldX(ring[i][0]); a[2 * i + 1] = worldY(ring[i][1]); }
        return a;
      });
      var boxes = rings.map(ringBox);
      return { name: f.name, rings: rings, bbox: unionBox(boxes), ringBoxes: boxes };
    }) };
  }

  // Douglas-Peucker on a flat ring; the first and last points are always kept.
  function simplifyRing(a, tol) {
    var n = a.length / 2;
    if (n < 3) return a.slice();
    var keep = new Array(n), stack = [[0, n - 1]], t2 = tol * tol;
    keep[0] = keep[n - 1] = true;
    while (stack.length) {
      var seg = stack.pop(), i0 = seg[0], i1 = seg[1];
      var x0 = a[2 * i0], y0 = a[2 * i0 + 1], dx = a[2 * i1] - x0, dy = a[2 * i1 + 1] - y0, len2 = dx * dx + dy * dy;
      var worst = -1, worstD = t2;
      for (var i = i0 + 1; i < i1; i++) {
        var px = a[2 * i] - x0, py = a[2 * i + 1] - y0, d;
        if (len2 === 0) d = px * px + py * py;
        else { var t = (px * dx + py * dy) / len2, cx = px - t * dx, cy = py - t * dy; d = cx * cx + cy * cy; }
        if (d > worstD) { worstD = d; worst = i; }
      }
      if (worst > 0) { keep[worst] = true; stack.push([i0, worst], [worst, i1]); }
    }
    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(a[2 * k], a[2 * k + 1]);
    return out;
  }
  function simplify(prepared, tolerance) {
    if (!tolerance) return prepared;
    var features = [];
    prepared.features.forEach(function (f) {
      // A simplified ring stays inside its original bbox, so the surviving rings keep theirs.
      var rings = [], boxes = [];
      f.rings.forEach(function (r, i) {
        var s = simplifyRing(r, tolerance);
        if (s.length >= 8) { rings.push(s); boxes.push(f.ringBoxes[i]); }
      });
      if (rings.length) features.push({ name: f.name, rings: rings, bbox: f.bbox, ringBoxes: boxes });
    });
    return { features: features };
  }

  // A test for boxes in world units: on the view and at least 2 px wide or tall.
  function shows(view) {
    var s = scale(view), cx = worldX(view.lon), cy = worldY(view.lat);
    var x0 = cx - view.width / 2 / s, x1 = cx + view.width / 2 / s, y0 = cy - view.height / 2 / s, y1 = cy + view.height / 2 / s;
    return function (b) {
      if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) return false;
      return (b.x1 - b.x0) * s >= MIN_FEATURE_PX || (b.y1 - b.y0) * s >= MIN_FEATURE_PX;
    };
  }
  // The coarse cull: features with any part on screen. project() then culls their rings.
  function visible(prepared, view) {
    var ok = shows(view);
    return prepared.features.filter(function (f) { return ok(f.bbox); });
  }
  function project(features, view) {
    var s = scale(view), ox = worldX(view.lon) - view.width / 2 / s, oy = worldY(view.lat) - view.height / 2 / s, out = [], ok = shows(view);
    features.forEach(function (f) {
      f.rings.forEach(function (r, k) {
        if (f.ringBoxes && !ok(f.ringBoxes[k])) return;
        var p = new Array(r.length);
        for (var i = 0; i < r.length; i += 2) { p[i] = (r[i] - ox) * s; p[i + 1] = (r[i + 1] - oy) * s; }
        out.push(p);
      });
    });
    return out;
  }

  function hitDot(view, places, x, y, radius) {
    var best = -1, bestD = radius * radius;
    places.forEach(function (pl, i) {
      var p = toPx(view, pl.lon, pl.lat), d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
      if (d <= bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // Which places to draw: nominatim often lists a city and its administrative area a km or two
  // apart. The picked place is considered first, then the rest in order; one is kept only if it
  // is more than `km` kilometres (great circle) from every place kept so far. Returns the kept
  // places' original indices, ascending.
  function distinctPlaces(places, picked, km) {
    function dist(a, b) {
      var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
      var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
      return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    var order = [], kept = [];
    if (picked >= 0 && picked < places.length) order.push(picked);
    for (var i = 0; i < places.length; i++) if (i !== picked) order.push(i);
    order.forEach(function (i) {
      for (var k = 0; k < kept.length; k++) if (!(dist(places[i], places[kept[k]]) > km)) return;
      kept.push(i);
    });
    return kept.sort(function (a, b) { return a - b; });
  }

  var CLICK_PX = 4;
  // A press and release that moved less than CLICK_PX is a click; more is a drag.
  function isClick(a, b) { var dx = b.x - a.x, dy = b.y - a.y; return dx * dx + dy * dy < CLICK_PX * CLICK_PX; }

  // A route leg on the preview: the same Bézier the real leg uses. GeoCurve works y-up (like
  // Cavalry), the preview y-down, so y is flipped in and out. Arc height is a share of the leg's
  // own length, so no scaling is needed. 17 points (16 steps).
  function legCurve(view, from, to, opts) {
    var p0 = toPx(view, from.lon, from.lat), p1 = toPx(view, to.lon, to.lat);
    var h = GeoCurve.handles([p0[0], -p0[1]], [p1[0], -p1[1]], opts || {});
    var c0 = [p0[0] + h.start[0], p0[1] - h.start[1]], c1 = [p1[0] + h.end[0], p1[1] - h.end[1]], out = [];
    for (var i = 0; i <= 16; i++) {
      var t = i / 16, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + b * c0[0] + c * c1[0] + d * p1[0], a * p0[1] + b * c0[1] + c * c1[1] + d * p1[1]]);
    }
    return out;
  }

  // Dash segments along a polyline ([[x, y], ...]), the pattern carrying on round corners.
  function dashPolyline(pts, dash, gap) {
    var segs = [], phase = 0;
    for (var e = 0; e + 1 < pts.length; e++) {
      var ax = pts[e][0], ay = pts[e][1], bx = pts[e + 1][0], by = pts[e + 1][1];
      var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), pos = 0;
      while (pos < len) {
        var inDash = phase < dash, step = Math.min(len - pos, inDash ? dash - phase : dash + gap - phase);
        if (inDash) {
          var t0 = pos / len, t1 = (pos + step) / len;
          segs.push([ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1]);
        }
        pos += step; phase = (phase + step) % (dash + gap);
      }
    }
    return segs;
  }

  // Which street features to draw: those on view, largest first, until maxPoints points are used
  // (a feature that doesn't fit is skipped so smaller ones can still be drawn). Keeps layer order.
  function budget(layers, view, maxPoints) {
    var ok = shows(view), all = [], used = 0, keep = layers.map(function () { return []; });
    layers.forEach(function (l, li) {
      l.prepared.features.forEach(function (f) {
        if (!ok(f.bbox)) return;
        var n = 0;
        f.rings.forEach(function (r) { n += r.length / 2; });
        all.push({ li: li, f: f, n: n, size: Math.max(f.bbox.x1 - f.bbox.x0, f.bbox.y1 - f.bbox.y0) });
      });
    });
    all.sort(function (a, b) { return b.size - a.size; });
    all.forEach(function (e) { if (used + e.n > maxPoints) return; used += e.n; keep[e.li].push(e.f); });
    var out = [];
    layers.forEach(function (l, i) { if (keep[i].length) out.push({ kind: l.kind, color: l.color, features: keep[i] }); });
    return out;
  }

  // Dash segments along a rectangle's outline (clockwise from the top-left corner).
  function dashes(rect, dash, gap) {
    return dashPolyline([[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h], [rect.x, rect.y]], dash, gap);
  }

  return { FRAME_FRACTION: FRAME_FRACTION, CAMERA_MIN_ZOOM: CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM: CAMERA_MAX_ZOOM, LEVELS: LEVELS,
    worldX: worldX, worldY: worldY, lonOf: lonOf, latOf: latOf, toPx: toPx, fromPx: fromPx, pan: pan, zoomAt: zoomAt,
    frameRect: frameRect, frameCamera: frameCamera, viewForCamera: viewForCamera, cameraRect: cameraRect, detailFor: detailFor,
    prepare: prepare, simplify: simplify, visible: visible, project: project, hitDot: hitDot, distinctPlaces: distinctPlaces, dashes: dashes,
    budget: budget, isClick: isClick, legCurve: legCurve, dashPolyline: dashPolyline, wrapLon: wrapLon };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoPreview;

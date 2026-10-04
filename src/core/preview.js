// Map preview maths: a flat Web Mercator view in preview pixels (origin top-left, y down),
// the fixed frame in the middle and its camera, detail levels, culling, simplification and
// hit-testing. Preview zoom z means the world is 256 * 2^z px wide (like GeoProjection).
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

  function bboxOf(rings) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    rings.forEach(function (r) {
      for (var i = 0; i < r.length; i += 2) {
        if (r[i] < b.x0) b.x0 = r[i]; if (r[i] > b.x1) b.x1 = r[i];
        if (r[i + 1] < b.y0) b.y0 = r[i + 1]; if (r[i + 1] > b.y1) b.y1 = r[i + 1];
      }
    });
    return b;
  }
  // Projects every point once, to flat [x0, y0, x1, y1, ...] rings in zoom-0 world units.
  function prepare(layer) {
    return { features: layer.features.map(function (f) {
      var rings = f.rings.map(function (ring) {
        var a = new Array(ring.length * 2);
        for (var i = 0; i < ring.length; i++) { a[2 * i] = worldX(ring[i][0]); a[2 * i + 1] = worldY(ring[i][1]); }
        return a;
      });
      return { name: f.name, rings: rings, bbox: bboxOf(rings) };
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
      var rings = f.rings.map(function (r) { return simplifyRing(r, tolerance); }).filter(function (r) { return r.length >= 8; });
      if (rings.length) features.push({ name: f.name, rings: rings, bbox: f.bbox });
    });
    return { features: features };
  }

  function visible(prepared, view) {
    var s = scale(view), cx = worldX(view.lon), cy = worldY(view.lat);
    var x0 = cx - view.width / 2 / s, x1 = cx + view.width / 2 / s, y0 = cy - view.height / 2 / s, y1 = cy + view.height / 2 / s;
    return prepared.features.filter(function (f) {
      var b = f.bbox;
      if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) return false;
      return (b.x1 - b.x0) * s >= MIN_FEATURE_PX || (b.y1 - b.y0) * s >= MIN_FEATURE_PX;
    });
  }
  function project(features, view) {
    var s = scale(view), ox = worldX(view.lon) - view.width / 2 / s, oy = worldY(view.lat) - view.height / 2 / s, out = [];
    features.forEach(function (f) {
      f.rings.forEach(function (r) {
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

  // Dash segments along a rectangle's outline (clockwise from the top-left corner).
  function dashes(rect, dash, gap) {
    var pts = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h], [rect.x, rect.y]];
    var segs = [], phase = 0;
    for (var e = 0; e < 4; e++) {
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

  return { FRAME_FRACTION: FRAME_FRACTION, CAMERA_MIN_ZOOM: CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM: CAMERA_MAX_ZOOM, LEVELS: LEVELS,
    worldX: worldX, worldY: worldY, lonOf: lonOf, latOf: latOf, toPx: toPx, fromPx: fromPx, pan: pan, zoomAt: zoomAt,
    frameRect: frameRect, frameCamera: frameCamera, viewForCamera: viewForCamera, cameraRect: cameraRect, detailFor: detailFor,
    prepare: prepare, simplify: simplify, visible: visible, project: project, hitDot: hitDot, dashes: dashes };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoPreview;

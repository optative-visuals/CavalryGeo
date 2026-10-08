// Draws an encoded layer into a cavalry.Path. Runs inside map layer expressions,
// so it may only use GeoProjection, GeoRoutes and the Path constructor it is given.
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
if (typeof GeoRoutes === "undefined" && typeof require !== "undefined") { var GeoRoutes = require("./routes.js"); }
var GeoRuntime = (function () {
  var Q = 1e6; // must match GeoCodec.Q

  function buildPath(enc, cam, detail, opts, PathCtor) {
    var path = new PathCtor();
    // opts.nearest folds each point separately, so it is only for point and text layers (single things).
    var project = (opts && opts.nearest) ? nearestProjector(cam) : GeoProjection.makeProjector(cam);
    var d = Math.max(0, Math.min(100, Number(detail) || 0));
    var count = Math.ceil(d / 100 * enc.f.length);
    var kind = enc.kind;
    if (kind === "route") {
      for (var r = 0; r < count; r++) drawRoute(path, enc.f[r], cam, opts, project);
      return path;
    }
    var radius = opts && opts.pointRadius != null ? opts.pointRadius : 4;
    var scale = opts && opts.ellipseScale != null ? opts.ellipseScale : 1;
    // opts.whole (highlights) on a flat map: the layer is one shape, drawn once, in one piece.
    if (opts && opts.whole === true && isFlat(cam)) return drawWhole(path, enc, count, cam, project, radius, scale);
    // opts.frame (the comp size) on a flat map: each shape is projected once above, then also drawn on every
    // copy of the world that reaches the frame. Without a frame, or for single things, it is drawn once.
    var frame = opts && opts.frame && !opts.nearest && isFlat(cam) ? opts.frame : null;
    var out = [0, 0], pts = [], vis = [];
    for (var i = 0; i < count; i++) {
      var row = enc.f[i];
      for (var k = 1; k < row.length; k++) {
        var ints = row[k], x = 0, y = 0, visible = false;
        pts.length = 0; vis.length = 0;
        for (var j = 0; j < ints.length; j += 2) {
          x += ints[j]; y += ints[j + 1];
          var v = project(x / Q, y / Q, out);
          if (v) visible = true;
          vis.push(v);
          pts.push(out[0], out[1]);
        }
        if (!visible || pts.length < 2) continue;
        // A text's box is over-estimated (a full character per size unit, either side): that only ever adds copies that are off the frame.
        var copies = frame ? worldCopies(cam, shapeBox(pts, kind === "point" ? radius * scale : kind === "text" ? radius * (String(row[0]).length + 1) : 0), frame) : [0];
        for (var c = 0; c < copies.length; c++) {
          if (copies[c] === 0) drawShape(path, kind, row, pts, vis, radius, scale);
          else drawShape(path, kind, row, shiftPoints(pts, copyOffset(cam, copies[c])), vis, radius, scale);
        }
      }
    }
    return path;
  }

  // Draws one projected shape (pts: x, y pairs; vis: visible per point, used by lines on the globe).
  function drawShape(path, kind, row, pts, vis, radius, scale) {
    if (kind === "point") { path.addEllipse(pts[0], pts[1], radius * scale, radius * scale); return; }
    if (kind === "text") { path.addText(String(row[0]), radius, pts[0], pts[1]); return; }
    if (kind === "line") { drawVisibleRuns(path, pts, vis); return; }
    path.moveTo(pts[0], pts[1]);
    for (var m = 2; m < pts.length; m += 2) path.lineTo(pts[m], pts[m + 1]);
    if (kind === "polygon") path.close();
  }

  // Whole shapes (highlights, flat maps): every point of the layer moves by the same whole turn, chosen so the
  // middle of the layer's longitude extent is on the copy nearest the camera. Rings are unwrapped first (see
  // wholeRings), so a shape that crosses the date line keeps its pieces together. A multi-feature highlight shares
  // one shift, so features spread over more than 180 degrees cannot all sit on their nearest copy.
  function drawWhole(path, enc, count, cam, project, radius, scale) {
    var rows = [], lo = Infinity, hi = -Infinity, i, j;
    for (i = 0; i < count; i++) {
      var rings = wholeRings(enc.f[i]);
      rows.push(rings);
      for (var a = 0; a < rings.length; a++) for (j = 0; j < rings[a].length; j++) {
        lo = Math.min(lo, rings[a][j][0]); hi = Math.max(hi, rings[a][j][0]);
      }
    }
    // The shape's longitude centre (its extent's middle) decides the copy: the one nearest the camera.
    var mid = lo === Infinity ? 0 : (lo + hi) / 2;
    var shift = GeoProjection.nearestLon(mid, cam.lon) - mid;
    var out = [0, 0];
    for (i = 0; i < rows.length; i++) {
      for (var r = 0; r < rows[i].length; r++) {
        var pts = [], vis = [], ring = rows[i][r];
        for (j = 0; j < ring.length; j++) {
          vis.push(!!project(ring[j][0] + shift, ring[j][1], out));
          pts.push(out[0], out[1]);
        }
        if (pts.length < 2) continue;
        drawShape(path, enc.kind, enc.f[i], pts, vis, radius, scale);
      }
    }
    return path;
  }

  // A feature's rings as [lon, lat] lists. Each ring is unwrapped so its steps stay under 180 degrees, then every
  // ring after the first is moved by whole turns so the middle of its longitude extent is nearest the middle of
  // the feature's first ring. Natural Earth splits shapes at the date line (Russia's Chukotka and Fiji's far
  // islands sit at -180 in their own rings).
  function wholeRings(row) {
    var decoded = [];
    for (var k = 1; k < row.length; k++) {
      var ints = row[k], x = 0, y = 0, lons = [], lats = [];
      for (var j = 0; j < ints.length; j += 2) { x += ints[j]; y += ints[j + 1]; lons.push(x / Q); lats.push(y / Q); }
      if (!lons.length) continue;
      // A ring with a raw jump across 180 (Antarctica runs along the pole) starts after the jump, so the jump is
      // its closing edge and no other step crosses the map (the same edge the raw ring already drew).
      for (j = 1; j < lons.length; j++) if (Math.abs(lons[j] - lons[j - 1]) > 180) break;
      if (j < lons.length) { lons = lons.slice(j).concat(lons.slice(0, j)); lats = lats.slice(j).concat(lats.slice(0, j)); }
      lons = GeoRoutes.unwrapLons(lons);
      var lo = lons[0], hi = lons[0];
      for (j = 1; j < lons.length; j++) { if (lons[j] < lo) lo = lons[j]; if (lons[j] > hi) hi = lons[j]; }
      decoded.push({ lons: lons, lats: lats, lo: lo, hi: hi });
    }
    if (!decoded.length) return [];
    // The join reference is the widest ring (ties: most points), so a small island never sets the frame.
    var ref = decoded[0];
    for (var r = 1; r < decoded.length; r++) {
      var d = decoded[r].hi - decoded[r].lo, e = ref.hi - ref.lo;
      if (d > e || (d === e && decoded[r].lons.length > ref.lons.length)) ref = decoded[r];
    }
    // A reference spanning about a whole turn (a pole ring) has no single copy to join to: other rings keep
    // the copy nearest 0, within [-180, 180], instead.
    var refMid = (ref.lo + ref.hi) / 2, target = ref.hi - ref.lo >= 300 ? 0 : refMid;
    var rings = [];
    for (var s = 0; s < decoded.length; s++) {
      var ring = decoded[s], turn = 0;
      if (ring !== ref) turn = GeoProjection.nearestLon((ring.lo + ring.hi) / 2, target) - (ring.lo + ring.hi) / 2;
      var out = [];
      for (var m = 0; m < ring.lons.length; m++) out.push([ring.lons[m] + turn, ring.lats[m]]);
      rings.push(out);
    }
    return rings;
  }

  function shiftPoints(pts, off) {
    var out = [];
    for (var i = 0; i < pts.length; i += 2) out.push(pts[i] + off[0], pts[i + 1] + off[1]);
    return out;
  }

  // Bounding box of projected x, y pairs, grown by pad on every side.
  function shapeBox(pts, pad) {
    var box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (var i = 0; i < pts.length; i += 2) {
      box.minX = Math.min(box.minX, pts[i]); box.maxX = Math.max(box.maxX, pts[i]);
      box.minY = Math.min(box.minY, pts[i + 1]); box.maxY = Math.max(box.maxY, pts[i + 1]);
    }
    return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
  }

  // Same clamps as GeoProjection.makeProjector, so a copy's offset matches the projection it repeats.
  var D2R = Math.PI / 180, MAX_ZOOM = 22;
  function isFlat(cam) { return Math.max(0, Math.min(2, Math.round(cam.projection || 0))) === 0; }
  function zoomOf(cam) { return Math.max(0, Math.min(MAX_ZOOM, cam.zoom)); }
  function rotationOf(cam) { return (cam.rotation || 0) * D2R; }
  // One world-width in Cavalry pixels (360 degrees of longitude at the camera's zoom).
  function worldWidth(cam) { return 2 * Math.PI * GeoProjection.worldScale(zoomOf(cam)); }

  // Screen offset of copy k: k world-widths along the camera's rotated x axis.
  function copyOffset(cam, k) {
    if (k === 0) return [0, 0];
    var W = k * worldWidth(cam), r = rotationOf(cam);
    return [W * Math.cos(r), W * Math.sin(r)];
  }

  // The whole-world shifts k (ascending) whose copy of bbox ({minX, minY, maxX, maxY}, screen space) meets
  // the frame, a w x h rectangle centred on the camera. Always includes 0, the original, even when it is off the
  // frame (so the original is drawn as before); [0] when not flat or without a frame.
  function worldCopies(cam, bbox, frame) {
    if (!frame || !isFlat(cam) || !(frame.w > 0) || !(frame.h > 0)) return [0];
    var W = worldWidth(cam), r = rotationOf(cam), lo = -Infinity, hi = Infinity;
    // Along one screen axis the copy k sits at a0 + k s .. a1 + k s; it meets [-half, half] for k between two bounds.
    function axis(a0, a1, s, half) {
      if (Math.abs(s) < 1e-9 * W) { if (a0 > half || a1 < -half) { lo = 1; hi = 0; } return; }
      var p = (half - a0) / s, q = (-half - a1) / s;
      lo = Math.max(lo, Math.min(p, q));
      hi = Math.min(hi, Math.max(p, q));
    }
    axis(bbox.minX, bbox.maxX, W * Math.cos(r), frame.w / 2);
    axis(bbox.minY, bbox.maxY, W * Math.sin(r), frame.h / 2);
    if (!isFinite(lo) || !isFinite(hi)) return [0];
    var ks = [];
    for (var k = Math.ceil(lo); k <= Math.floor(hi); k++) ks.push(k);
    if (ks.indexOf(0) < 0) { ks.push(0); ks.sort(function (a, b) { return a - b; }); }
    return ks;
  }

  function decodePoints(ints) {
    var pts = [], x = 0, y = 0;
    for (var j = 0; j < ints.length; j += 2) { x += ints[j]; y += ints[j + 1]; pts.push([x / Q, y / Q]); }
    return pts;
  }

  // One route leg: great circle between its two stops, raised by lift. On the globe the
  // arc rises off the surface in 3D; on flat maps it bows towards screen-up.
  function drawRoute(path, row, cam, opts, project) {
    var ends = decodePoints(row[1] || []);
    if (ends.length < 2) return;
    var gc = GeoRoutes.greatCircle(ends[0][0], ends[0][1], ends[1][0], ends[1][1]);
    if (!gc.points.length) return;
    var lift = opts && opts.lift != null ? opts.lift : 30;
    var pts = [], vis = [], out = [0, 0], i, n = gc.points.length;
    if (Math.round(cam.projection || 0) >= 2) {
      var p3 = GeoProjection.makeGlobeProjector3(cam), chord = 2 * Math.sin(gc.angle / 2);
      for (i = 0; i < n; i++) {
        var v = gc.points[i], s = 1 + GeoRoutes.liftFactor(gc.ts[i], lift) * chord;
        vis.push(p3(v[0] * s, v[1] * s, v[2] * s, out));
        pts.push(out[0], out[1]);
      }
      drawVisibleRuns(path, pts, vis);
      return;
    }
    // Compute the bow in unrotated map space (a projector built from the same camera
    // with rotation forced to 0), so the chord-normal rule ("points screen-up"; vertical
    // chord -> left) always resolves the same way regardless of the camera's rotation.
    // The whole lifted point is then turned by the camera rotation at the end, the same
    // convention as makeProjector's `finish` (x' = x*cos r - y*sin r, y' = x*sin r + y*cos r).
    var cam0 = {}, key;
    for (key in cam) { if (Object.prototype.hasOwnProperty.call(cam, key)) cam0[key] = cam[key]; }
    cam0.rotation = 0;
    var project0 = GeoProjection.makeProjector(cam0);
    var lons = [], lats = [];
    for (i = 0; i < n; i++) { var ll = GeoRoutes.toLonLat(gc.points[i]); lons.push(ll[0]); lats.push(ll[1]); }
    lons = GeoRoutes.unwrapLons(lons);
    var pts0 = [];
    for (i = 0; i < n; i++) { project0(lons[i], lats[i], out); pts0.push(out[0], out[1]); }
    var dx = pts0[2 * (n - 1)] - pts0[0], dy = pts0[2 * (n - 1) + 1] - pts0[1], L = Math.sqrt(dx * dx + dy * dy);
    var nx = 0, ny = 0;
    if (L > 0) {
      nx = -dy / L; ny = dx / L;
      if (ny < 0 || (Math.abs(ny) < 1e-9 && nx > 0)) { nx = -nx; ny = -ny; }
    }
    for (i = 0; i < n; i++) {
      var h = GeoRoutes.liftFactor(gc.ts[i], lift) * L;
      pts0[2 * i] += nx * h; pts0[2 * i + 1] += ny * h;
    }
    var rot = (cam.rotation || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    for (i = 0; i < n; i++) {
      var x = pts0[2 * i], y = pts0[2 * i + 1];
      pts.push(x * cr - y * sr, x * sr + y * cr);
    }
    path.moveTo(pts[0], pts[1]);
    for (i = 1; i < n; i++) path.lineTo(pts[2 * i], pts[2 * i + 1]);
  }

  // Lines draw only their visible stretches. Each stretch reaches one point onto the
  // globe's edge (hidden points are clamped there) so it ends at the edge rather than
  // stopping short, but never runs along the edge round the back.
  function drawVisibleRuns(path, pts, vis) {
    var n = vis.length, open = false;
    for (var p = 0; p < n; p++) {
      var draw = vis[p] || (p > 0 && vis[p - 1]) || (p < n - 1 && vis[p + 1]);
      if (!draw) { open = false; continue; }
      if (!open) { path.moveTo(pts[2 * p], pts[2 * p + 1]); open = true; }
      else path.lineTo(pts[2 * p], pts[2 * p + 1]);
      if (!vis[p] && p > 0 && vis[p - 1]) open = false; // stepped onto the edge: end this stretch
    }
  }

  function projectPoint(lon, lat, cam) {
    var out = [0, 0];
    GeoProjection.makeProjector(cam)(lon, lat, out);
    return out;
  }

  // A projector that, on flat maps, folds each longitude onto the copy nearest the camera first.
  function nearestProjector(cam) {
    var project = GeoProjection.makeProjector(cam), flat = Math.max(0, Math.min(2, Math.round(cam.projection || 0))) === 0;
    return function (lon, lat, out) { return project(flat ? GeoProjection.nearestLon(lon, cam.lon) : lon, lat, out); };
  }

  // Single things (pins, place labels, callouts): on flat maps the copy nearest the camera; globe and Equal Earth as projectPoint.
  function projectNearest(lon, lat, cam) {
    var out = [0, 0];
    nearestProjector(cam)(lon, lat, out);
    return out;
  }

  // False only when the point is on the far side of an orthographic globe.
  function pointVisible(lon, lat, cam) {
    return GeoProjection.makeProjector(cam)(lon, lat, [0, 0]);
  }

  return { Q: Q, buildPath: buildPath, projectPoint: projectPoint, projectNearest: projectNearest, pointVisible: pointVisible,
    worldCopies: worldCopies, copyOffset: copyOffset };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoRuntime;

// Day & night: the sun's position and the night-side outlines. Pure: it runs inside the night
// layers' and time label's scripts (inlined as GEO_SUN_SRC) and in node tests. cav is the
// `cavalry` module (cav.Path, optional measureText).
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
if (typeof GeoFurniture === "undefined" && typeof require !== "undefined") { var GeoFurniture = require("./furniture.js"); }
var GeoSun = (function () {
  var D2R = Math.PI / 180, STEP = 2;
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function wrap180(l) { return ((((l + 180) % 360) + 360) % 360) - 180; }

  // Day number in a non-leap year (29 Feb counts as 60).
  function dayOfYear(day, month) {
    var m = Math.max(1, Math.min(12, Math.round(num(month, 1)))), n = 0;
    for (var k = 0; k < m - 1; k++) n += MONTH_DAYS[k];
    var len = m === 2 ? 29 : MONTH_DAYS[m - 1]; // 29 Feb is day 60
    return n + Math.max(1, Math.min(len, Math.round(num(day, 1))));
  }

  function subsolar(doy, utc) {
    var g = 2 * Math.PI / 365 * (num(doy, 1) - 1 + (num(utc, 12) - 12) / 24);
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    return { lat: decl / D2R, lon: wrap180(-15 * (num(utc, 12) - 12 + eot / 60)) };
  }

  // Closed lon/lat ring (not repeating its first point) of the places more than `depression`
  // degrees below the horizon. A cap holding a pole is traced along the terminator for each
  // longitude and closed along that pole's edge; any other cap is its circle, longitudes kept
  // continuous (so they can pass +-180).
  function nightRing(doy, utc, depression) {
    var s = subsolar(doy, utc), pa = -s.lat * D2R, la = wrap180(s.lon + 180);
    var r = (90 - num(depression, 0)) * D2R, ring = [], k;
    var poleN = Math.PI / 2 - pa < r, poleS = Math.PI / 2 + pa < r;
    if (poleN || poleS) {
      var A = Math.sin(pa), c = Math.cos(r);
      for (var lon = -180; lon <= 180; lon += STEP) {
        var B = Math.cos(pa) * Math.cos((lon - la) * D2R), R = Math.sqrt(A * A + B * B), d = Math.atan2(B, A);
        var q = Math.asin(Math.max(-1, Math.min(1, c / (R || 1e-12))));
        var c1 = q - d, c2 = Math.PI - q - d, best = null, cands = [c1, c2];
        for (k = 0; k < 2; k++) {
          var v = cands[k];
          while (v > Math.PI) v -= 2 * Math.PI;
          while (v < -Math.PI) v += 2 * Math.PI;
          if (Math.abs(v) <= Math.PI / 2 + 1e-9) { best = v; break; }
        }
        if (best === null) best = poleN ? -Math.PI / 2 : Math.PI / 2;
        ring.push([lon, best / D2R]);
      }
      var edge = poleN ? 90 : -90;
      ring.push([180, edge], [-180, edge]);
      return ring;
    }
    // Circle of angular radius r round the antisolar point, by bearing.
    var sp = Math.sin(pa), cp = Math.cos(pa), sr = Math.sin(r), cr = Math.cos(r);
    for (var b = 0; b < 360; b += STEP) {
      var br = b * D2R;
      var lat = Math.asin(Math.max(-1, Math.min(1, sp * cr + cp * sr * Math.cos(br))));
      var dl = Math.atan2(Math.sin(br) * sr * cp, cr - sp * Math.sin(lat)) / D2R;
      ring.push([la + dl, lat / D2R]);
    }
    return ring;
  }

  function shiftRing(ring, sh) {
    var res = [];
    for (var i = 0; i < ring.length; i++) res.push([ring[i][0] + sh, ring[i][1]]);
    return res;
  }

  // The part of a closed ring on one side of the meridian x (side 1: lon >= x; -1: lon <= x),
  // closed along that meridian.
  function clipLon(ring, x, side) {
    var res = [], n = ring.length;
    for (var i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      var pin = (p[0] - x) * side >= 0, qin = (q[0] - x) * side >= 0;
      if (pin) res.push(p);
      if (pin !== qin) res.push([x, p[1] + (x - p[0]) / (q[0] - p[0]) * (q[1] - p[1])]);
    }
    return res;
  }

  // Extra points so no edge of the ring jumps more than STEP degrees of lon or lat (the
  // +-180 edges then follow Equal Earth's curved outline).
  function densify(ring) {
    var res = [], n = ring.length;
    for (var i = 0; i < n; i++) {
      var p = ring[i], q = ring[(i + 1) % n];
      var m = Math.max(1, Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / STEP));
      for (var j = 0; j < m; j++) res.push([p[0] + (q[0] - p[0]) * j / m, p[1] + (q[1] - p[1]) * j / m]);
    }
    return res;
  }

  // How far (screen px) the night is drawn past the Earth's edge, so the night layers' blur fades out
  // there, where the Night mask cuts it away, and not inside the Earth.
  function overscan(cam) { return 2 * blurAmount(cam.zoom, 1) + 2; }

  // Equal Earth: how many degrees of lon to draw past +-180 so the extra width is at least 2 M px, measured
  // at the ring's highest latitude (where a degree of lon is narrowest), at most 30.
  function overscanLon(ring, cam, M) {
    var top = 0, i;
    for (i = 0; i < ring.length; i++) top = Math.max(top, Math.abs(ring[i][1]));
    var pr = GeoProjection.makeProjector({ lat: 0, lon: 0, zoom: cam.zoom, rotation: 0, projection: 1 }), a = [0, 0], b = [0, 0];
    pr(0, top, a); pr(1, top, b);
    var w = Math.abs(b[0] - a[0]);
    return w < 1e-9 ? 30 : Math.min(30, 2 * M / w);
  }

  // push: { m, lim, ux, uy } moves a point whose |lat| >= lim (on the map's top or bottom edge) m px
  // outward along the screen's up direction (ux, uy).
  function drawRings(path, rings, project, push) {
    var out = [0, 0];
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (r.length < 3) continue;
      for (var k = 0; k < r.length; k++) {
        project(r[k][0], r[k][1], out);
        if (push && Math.abs(r[k][1]) >= push.lim) {
          var sg = r[k][1] > 0 ? 1 : -1;
          out[0] += sg * push.m * push.ux; out[1] += sg * push.m * push.uy;
        }
        if (k === 0) path.moveTo(out[0], out[1]); else path.lineTo(out[0], out[1]);
      }
      path.close();
    }
  }

  // The globe: the night side seen on the disc, built in screen space. In the camera's frame
  // (x right, y up, z toward the viewer) night is the part of the sphere beyond the plane
  // p . n = h (n the antisolar direction, h = sin(depression)); on the disc that is the front
  // arc of the terminator circle closed by the limb on the night side.
  function globeNight(path, cam, doy, utc, depression) {
    var s = subsolar(doy, utc), N = 180, k, m;
    var R = GeoProjection.worldScale(Math.max(0, Math.min(GeoProjection.MAX_ZOOM, num(cam.zoom, 0))));
    var rot = num(cam.rotation, 0) * D2R, cr = Math.cos(rot), sr = Math.sin(rot);
    var sl = Math.sin(num(cam.lat, 0) * D2R), cl = Math.cos(num(cam.lat, 0) * D2R);
    var p = -s.lat * D2R, dl = (s.lon + 180 - num(cam.lon, 0)) * D2R;
    var nx = Math.cos(p) * Math.sin(dl), ny = cl * Math.sin(p) - sl * Math.cos(p) * Math.cos(dl);
    var nz = sl * Math.sin(p) + cl * Math.cos(p) * Math.cos(dl);
    var h = Math.sin(num(depression, 0) * D2R), rho = Math.sqrt(1 - h * h), sxy = Math.sqrt(nx * nx + ny * ny);
    var first = true;
    var over = 1 + overscan(cam) / R; // the limb is drawn this much further out
    function put(x, y) {
      x *= R; y *= R;
      var X = x * cr - y * sr, Y = x * sr + y * cr;
      if (first) { path.moveTo(X, Y); first = false; } else path.lineTo(X, Y);
    }
    if (sxy < 1e-9) { // the antisolar point faces the camera (night in the middle) or the back
      if (nz > 0) { for (k = 0; k < N; k++) put(rho * Math.cos(2 * Math.PI * k / N), rho * Math.sin(2 * Math.PI * k / N)); path.close(); }
      return path;
    }
    // Terminator circle: h n + rho (cos t u + sin t v), u level with the screen (uz = 0).
    var ux = ny / sxy, uy = -nx / sxy, vx = nz * nx / sxy, vy = nz * ny / sxy;
    function tx(t) { return h * nx + rho * (Math.cos(t) * ux + Math.sin(t) * vx); }
    function ty(t) { return h * ny + rho * (Math.cos(t) * uy + Math.sin(t) * vy); }
    var kk = h * nz / (rho * sxy); // the circle's depth is h nz - rho sxy sin t
    if (kk <= -1) return path; // all of the night is round the back
    if (kk >= 1) { // the whole terminator is in front: night is its ellipse
      for (k = 0; k < N; k++) put(tx(2 * Math.PI * k / N), ty(2 * Math.PI * k / N));
      path.close();
      return path;
    }
    var t0 = Math.asin(kk), a0 = Math.PI - t0, a1 = 2 * Math.PI + t0;
    m = Math.max(2, Math.ceil((a1 - a0) / (2 * Math.PI) * N));
    for (k = 0; k <= m; k++) put(tx(a0 + (a1 - a0) * k / m), ty(a0 + (a1 - a0) * k / m));
    // Back along the limb, through the point nearest the antisolar direction.
    var fn = Math.atan2(ny, nx);
    function rel(f) { f -= fn; while (f > Math.PI) f -= 2 * Math.PI; while (f < -Math.PI) f += 2 * Math.PI; return f; }
    var d1 = rel(Math.atan2(ty(a1), tx(a1))), d0 = rel(Math.atan2(ty(a0), tx(a0)));
    m = Math.max(1, Math.ceil(Math.abs(d0 - d1) / (2 * Math.PI) * N));
    for (k = 0; k <= m; k++) { var f = fn + d1 + (d0 - d1) * k / m; put(over * Math.cos(f), over * Math.sin(f)); } // both ends go straight out from the terminator
    path.close();
    return path;
  }

  // The night side as a path on the map.
  // - Web Mercator: the base map draws the real world (lon -180..180) and the camera shows
  //   cam.lon +- 180, so the ring is drawn once for every world-width shift that reaches
  //   either span.
  // - Equal Earth: one bounded oval, so the ring is cut to -180..180 (a piece past the edge
  //   comes back in on the other side) and densified so its edges follow the outline.
  // - Globe: built in screen space (globeNight).
  function nightPath(cam, doy, utc, depression, cav) {
    var path = new cav.Path(), proj = Math.round(num(cam.projection, 0));
    if (proj >= 2) return globeNight(path, cam, doy, utc, depression);
    var ring = nightRing(doy, utc, depression), rings = [], lo = Infinity, hi = -Infinity, k;
    for (k = 0; k < ring.length; k++) { if (ring[k][0] < lo) lo = ring[k][0]; if (ring[k][0] > hi) hi = ring[k][0]; }
    var M = overscan(cam), rot = num(cam.rotation, 0) * D2R;
    var push = { m: M, lim: proj === 1 ? 90 - 1e-9 : GeoProjection.MAX_LAT - 1e-9, ux: -Math.sin(rot), uy: Math.cos(rot) };
    if (proj === 1) {
      // Cut at +-(180 + d), not at the oval: the copy of the ring a world to the left or right fills the
      // strip past each edge, and the mask cuts it off.
      var X = 180 + overscanLon(ring, cam, M);
      [0, -360, 360].forEach(function (sh) {
        var piece = clipLon(clipLon(sh === 0 ? ring : shiftRing(ring, sh), -X, 1), X, -1);
        if (piece.length >= 3) rings.push(densify(piece));
      });
    } else {
      var c = num(cam.lon, 0), pad = M / GeoProjection.worldScale(Math.max(0, Math.min(GeoProjection.MAX_ZOOM, num(cam.zoom, 0)))) / D2R;
      var from = Math.min(-180, c - 180) - pad, to = Math.max(180, c + 180) + pad; // a little further, so the blur fades off the edge
      var k0 = Math.floor((from - hi) / 360), k1 = Math.ceil((to - lo) / 360);
      for (k = k0; k <= k1; k++) {
        var sh = k * 360;
        if (hi + sh > from + 1e-9 && lo + sh < to - 1e-9) rings.push(sh === 0 ? ring : shiftRing(ring, sh));
      }
    }
    drawRings(path, rings, GeoProjection.makeProjector(cam), push);
    return path;
  }

  // Opacity (0-100) of one of the four stacked layers: soft splits Night into four equal steps
  // that composite to it; hard puts it all on the first.
  function stepOpacity(night, twilight, step) {
    var n = Math.max(0, Math.min(100, num(night, 55)));
    if (num(twilight, 1) >= 0.5) return (1 - Math.pow(1 - n / 100, 1 / 4)) * 100;
    return Math.round(num(step, 0)) === 0 ? n : 0;
  }

  // Fast Blur amount (pixels, both axes) that smooths the four stacked steps into one gradient:
  // half a twilight step (6 degrees of arc) on the screen at this zoom, at most 200; none for a
  // hard edge (twilight under 0.5).
  function blurAmount(zoom, twilight) {
    if (num(twilight, 1) < 0.5) return 0;
    var z = Math.max(0, Math.min(GeoProjection.MAX_ZOOM, num(zoom, 2)));
    return Math.min(200, 0.5 * 6 * Math.PI / 180 * GeoProjection.worldScale(z));
  }

  // The Earth's outline on screen for the camera, as one closed path: the globe's disc, the Equal Earth oval
  // (its two meridians at -180 / +180 and its two pole lines), or the Web Mercator rectangle over the longitudes the night is drawn on (the world plus the copies past the date line). The night
  // layers are masked to it, so their blur doesn't spill past the edge.
  function earthOutline(cam, cav) {
    var path = new cav.Path(), proj = Math.round(num(cam.projection, 0)), k, N = 180, first = true;
    function put(x, y) { if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y); }
    if (proj >= 2) {
      var R = GeoProjection.worldScale(Math.max(0, Math.min(GeoProjection.MAX_ZOOM, num(cam.zoom, 2))));
      for (k = 0; k < N; k++) put(R * Math.cos(2 * Math.PI * k / N), R * Math.sin(2 * Math.PI * k / N));
      path.close();
      return path;
    }
    var project = GeoProjection.makeProjector(cam), out = [0, 0], M = 90;
    function at(lon, lat) { project(lon, lat, out); put(out[0], out[1]); }
    if (proj === 1) {
      for (k = 0; k <= M; k++) at(-180, -90 + 180 * k / M);   // -180 meridian, south to north
      for (k = 1; k <= 10; k++) at(-180 + 36 * k, 90);          // north pole line
      for (k = 1; k <= M; k++) at(180, 90 - 180 * k / M);     // +180 meridian, north to south
      for (k = 1; k < 10; k++) at(180 - 36 * k, -90);           // south pole line
    } else {
      var lat = GeoProjection.MAX_LAT, c = num(cam.lon, 0), from = Math.min(-180, c - 180), to = Math.max(180, c + 180); // nightPath's span
      at(from, lat); at(to, lat); at(to, -lat); at(from, -lat);
    }
    path.close();
    return path;
  }

  function two(n) { return (n < 10 ? "0" : "") + n; }
  function timeText(doy, utc) {
    var d = Math.max(1, Math.min(365, Math.round(num(doy, 1)))), m = 0;
    while (m < 11 && d > MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m++; }
    var mins = Math.floor(num(utc, 0) * 60 + 1e-6) % 1440;
    if (mins < 0) mins += 1440;
    return d + " " + MONTHS[m] + " \u00b7 " + two(Math.floor(mins / 60)) + ":" + two(mins % 60) + " UTC";
  }

  function textWidth(text, size, cav) {
    if (cav && typeof cav.measureText === "function") {
      try {
        var m = cav.measureText(text, "Lato", "Regular", size);
        if (m && isFinite(Number(m.width)) && Number(m.width) > 0) return Number(m.width);
      } catch (e) { /* fall back to the estimate */ }
    }
    return text.length * size * 0.5;
  }

  function timeLabel(i, cav) {
    var p = new cav.Path(), size = num(i.size, 18), text = timeText(i.dayOfYear, i.utcTime);
    var c = GeoFurniture.cornerPoint(i.corner, num(i.compW, 1920), num(i.compH, 1080), num(i.margin, 40));
    p.addText(text, size, c.right ? c.x - textWidth(text, size, cav) : c.x, c.top ? c.y - size * 0.75 : c.y);
    return p;
  }

  return { dayOfYear: dayOfYear, subsolar: subsolar, nightRing: nightRing, nightPath: nightPath, earthOutline: earthOutline, stepOpacity: stepOpacity, blurAmount: blurAmount, timeText: timeText, timeLabel: timeLabel };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoSun;

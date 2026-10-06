// Scale bar and north arrow: the maths and the drawing. Pure: it runs inside the two layers'
// scripts (inlined with GeoProjection as GEO_FURNITURE_SRC) and in node tests. Comp pixels,
// camera centre at (0, 0), y up. cav is the `cavalry` module (cav.Path, optional measureText).
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
var GeoFurniture = (function () {
  var D2R = Math.PI / 180, EARTH_M = 6371008.8, FT = 0.3048, MILE_FT = 5280;
  var TICK = 10, LINE = 2, GAP = 4, SEG_H = 7, SEG_GAP = 6, CAP = 0.75;

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function camOf(i) { return { lat: num(i.lat, 0), lon: num(i.lon, 0), zoom: num(i.zoom, 2), rotation: num(i.rotation, 0), projection: num(i.projection, 0) }; }
  function haversine(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Ground metres per comp pixel at the frame centre: 100 px across the screen, else 100 px up it.
  function metresPerPixel(cam) {
    var pairs = [[-50, 0, 50, 0], [0, -50, 0, 50]];
    for (var k = 0; k < pairs.length; k++) {
      var q = pairs[k], a = GeoProjection.unproject(cam, q[0], q[1]), b = GeoProjection.unproject(cam, q[2], q[3]);
      if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) continue;
      var d = haversine(a, b) / 100;
      if (d > 0 && isFinite(d)) return d;
    }
    return null;
  }

  function commas(v) {
    var parts = String(Math.round(v * 100) / 100).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }
  // The largest 1 / 2 / 5 × 10^n not above max; 0 when max < 1.
  function nice(max) {
    if (!(max >= 1)) return 0;
    var p = Math.pow(10, Math.floor(Math.log(max) / Math.LN10)), best = 0;
    [1, 2, 5, 10].forEach(function (m) { if (m * p <= max * (1 + 1e-9)) best = m * p; });
    return best;
  }
  function distance(value, unit, metresPerUnit) { return value ? { metres: value * metresPerUnit, value: value, unit: unit, label: commas(value) + " " + unit } : null; }
  function niceDistance(maxMetres, system) {
    if (!(maxMetres > 0)) return null;
    if (system === "imperial") {
      var maxFt = maxMetres / FT;
      return maxFt < MILE_FT ? distance(nice(maxFt), "ft", FT) : distance(nice(maxFt / MILE_FT), "mi", MILE_FT * FT);
    }
    return maxMetres < 1000 ? distance(nice(maxMetres), "m", 1) : distance(nice(maxMetres / 1000), "km", 1000);
  }

  // 0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right (anything else: bottom-left).
  function cornerPoint(corner, compW, compH, margin) {
    var c = Math.round(num(corner, 2));
    if (c < 0 || c > 3) c = 2;
    var right = c === 1 || c === 3, top = c === 0 || c === 1;
    return { x: right ? compW / 2 - margin : -compW / 2 + margin, y: top ? compH / 2 - margin : -compH / 2 + margin, right: right, top: top };
  }

  // Which way north is at the frame centre (a unit vector): toward a point a little north of it.
  function northDirection(cam) {
    var p = [0, 0], q = [0, 0], proj = GeoProjection.makeProjector(cam);
    var r = num(cam.rotation, 0) * Math.PI / 180, up = [0 - Math.sin(r), Math.cos(r)];
    if (!(cam.lat < 89.99)) return up;
    proj(cam.lon, cam.lat, p);
    proj(cam.lon, Math.min(89.999, cam.lat + 0.01), q);
    var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.sqrt(dx * dx + dy * dy);
    return len > 1e-9 && isFinite(len) ? [dx / len, dy / len] : up;
  }

  // Opacity 0–100: gone below hideBelow, fully shown half a zoom level above it.
  function fade(zoom, hideBelow) { return Math.max(0, Math.min(1, (num(zoom, 0) - (num(hideBelow, 0) - 0.5)) / 0.5)) * 100; }

  function textWidth(text, size, cav) {
    if (cav && typeof cav.measureText === "function") {
      try {
        var m = cav.measureText(text, "Lato", "Regular", size);
        if (m && isFinite(Number(m.width)) && Number(m.width) > 0) return Number(m.width);
      } catch (e) { /* fall back to the estimate */ }
    }
    return text.length * size * 0.5;
  }
  function box(p, x, y, w, h) { p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.close(); }
  function centred(p, cav, text, size, x, y) { p.addText(text, size, x - textWidth(text, size, cav) / 2, y); }
  function blockHeight(style, size) { return (style === 1 ? SEG_H + SEG_GAP : TICK + GAP) + CAP * size; }

  // One bar from x0 along the baseline yb; `down` draws it below the baseline (the second unit of Both).
  function drawBar(p, cav, x0, yb, len, d, style, size, down) {
    if (style === 1) {
      var w = len / 4, by = down ? yb - SEG_H : yb;
      for (var k = 0; k < 4; k++) {
        var bx = x0 + k * w;
        if (k % 2 === 0) box(p, bx, by, w, SEG_H);
        else { box(p, bx, by, w, 1); box(p, bx, by + SEG_H - 1, w, 1); }
      }
      box(p, x0 + len - 1, by, 1, SEG_H); // closes the right end of the last (outlined) block
      var ly = down ? yb - SEG_H - SEG_GAP - CAP * size : yb + SEG_H + SEG_GAP;
      centred(p, cav, "0", size, x0, ly);
      centred(p, cav, commas(d.value / 2), size, x0 + len / 2, ly);
      centred(p, cav, d.label, size, x0 + len, ly);
      return;
    }
    var ty = down ? yb - TICK : yb;
    box(p, x0, down ? yb - LINE : yb, len, LINE);
    box(p, x0, ty, LINE, TICK);
    box(p, x0 + len - LINE, ty, LINE, TICK);
    centred(p, cav, d.label, size, x0 + len / 2, down ? yb - TICK - GAP - CAP * size : yb + TICK + GAP);
  }

  function scaleBar(i, cav) {
    var p = new cav.Path(), mpp = metresPerPixel(camOf(i));
    if (!mpp) return p;
    var size = num(i.textSize, 16), style = Math.round(num(i.style, 0)) === 1 ? 1 : 0, units = Math.round(num(i.units, 0));
    var systems = units === 1 ? ["imperial"] : units === 2 ? ["metric", "imperial"] : ["metric"], bars = [];
    systems.forEach(function (sys) { var d = niceDistance(num(i.maxWidth, 200) * mpp, sys); if (d) bars.push({ d: d, len: d.metres / mpp }); });
    if (!bars.length) return p;
    var c = cornerPoint(i.corner, num(i.compW, 1920), num(i.compH, 1080), num(i.margin, 40)), H = blockHeight(style, size);
    var yb = c.top ? c.y - H : c.y + num(i.raise, 0) + (bars.length === 2 ? H : 0);
    bars.forEach(function (b, k) { drawBar(p, cav, c.right ? c.x - b.len : c.x, yb, b.len, b.d, style, size, k === 1); });
    return p;
  }

  // 0 arrow + N · 1 compass rose (four-point star) · 2 N with tick. Drawn pointing up (+y) round
  // the corner point, turned so up becomes north; the N stays upright (text can't turn).
  function northArrow(i, cav) {
    var p = new cav.Path(), s = num(i.size, 40), h = s / 2;
    var c = cornerPoint(i.corner, num(i.compW, 1920), num(i.compH, 1080), num(i.margin, 40) + h);
    var dir = northDirection(camOf(i)), ct = dir[1], st = -dir[0], style = Math.round(num(i.style, 0));
    function pt(x, y) { return [c.x + x * ct - y * st, c.y + x * st + y * ct]; }
    function poly(list) { list.forEach(function (q, k) { var r = pt(q[0], q[1]); if (k === 0) p.moveTo(r[0], r[1]); else p.lineTo(r[0], r[1]); }); p.close(); }
    var nSize = Math.max(10, s * 0.35), at;
    if (style === 1) {
      var a = s * 0.12;
      poly([[0, h], [a, a], [h, 0], [a, -a], [0, -h], [-a, -a], [-h, 0], [-a, a]]);
      at = pt(0, h + GAP + CAP * nSize / 2);
    } else if (style === 2) {
      poly([[0, h], [s * 0.15, h - s * 0.25], [-s * 0.15, h - s * 0.25]]);
      nSize = s * 0.6;
      at = [c.x, c.y - s * 0.1];
    } else {
      poly([[0, h], [s * 0.3, -h], [0, -h * 0.5], [-s * 0.3, -h]]);
      at = pt(0, h + GAP + CAP * nSize / 2);
    }
    p.addText("N", nSize, at[0] - textWidth("N", nSize, cav) / 2, at[1] - CAP * nSize / 2);
    return p;
  }

  return { metresPerPixel: metresPerPixel, niceDistance: niceDistance, cornerPoint: cornerPoint, northDirection: northDirection, fade: fade, scaleBar: scaleBar, northArrow: northArrow };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoFurniture;

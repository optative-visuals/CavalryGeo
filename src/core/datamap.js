// Draws data layers (coloured regions, bubbles, value labels, legends) from a payload and a
// year. Runs inside Cavalry layer expressions: only GeoProjection, GeoRuntime and the
// cavalry classes passed in may be used.
if (typeof GeoProjection === "undefined" && typeof require !== "undefined") { var GeoProjection = require("./projection.js"); }
if (typeof GeoRuntime === "undefined" && typeof require !== "undefined") { var GeoRuntime = require("./runtime.js"); }
var GeoData = (function () {
  var LEGEND_W = 300, LEGEND_H = 14, LEGEND_STRIPS = 48, LEGEND_TEXT = 14;

  function valueAt(series, year) {
    if (!series || !series.length) return null;
    var y = Number(year) || 0, last = series[series.length - 1];
    if (series.length === 1 || y <= series[0][0]) return series[0][1];
    if (y >= last[0]) return last[1];
    for (var i = 1; i < series.length; i++) {
      var a = series[i - 1], b = series[i];
      if (y <= b[0]) return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]);
    }
    return last[1];
  }

  function toRgb(c) {
    if (typeof c === "string") {
      var h = c.replace("#", "");
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h.slice(0, 6), 16);
      return isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
    }
    if (c && typeof c === "object") {
      if (c.length >= 3) return [Number(c[0]), Number(c[1]), Number(c[2])];
      if (c.r !== undefined) return [Number(c.r), Number(c.g), Number(c.b)];
    }
    return [0, 0, 0];
  }
  function hex(rgb) {
    var s = "#";
    for (var i = 0; i < 3; i++) s += ("0" + Math.round(Math.max(0, Math.min(255, rgb[i]))).toString(16)).slice(-2);
    return s;
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function effectiveRange(o, range) {
    var lo = Number(o.min), hi = Number(o.max);
    return lo < hi ? [lo, hi] : [range.min, range.max];
  }

  function colorAt(v, o, range) {
    if (v === null || v === undefined) return hex(toRgb(o.noData));
    var r = effectiveRange(o, range), lo = r[0], hi = r[1];
    var t = hi > lo ? clamp01((v - lo) / (hi - lo)) : 0.5;
    var low = toRgb(o.low), high = toRgb(o.high);
    if (Number(o.useMiddle)) {
      var mid = toRgb(o.middle), tm = hi > lo ? clamp01((Number(o.middleValue) - lo) / (hi - lo)) : 0.5;
      if (t <= tm) return hex(tm > 0 ? mix(low, mid, t / tm) : mid);
      return hex(tm < 1 ? mix(mid, high, (t - tm) / (1 - tm)) : mid);
    }
    return hex(mix(low, high, t));
  }

  function bubbleRadius(v, maxAbs, maxRadius) {
    if (v === null || v === undefined || !maxAbs) return 0;
    return Number(maxRadius) * Math.sqrt(Math.abs(v) / maxAbs);
  }

  function groupThousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function formatValue(v, format, decimals, prefix, suffix) {
    if (v === null || v === undefined) return "";
    var d = Math.max(0, Math.min(6, Math.round(Number(decimals) || 0))), f = Math.round(Number(format) || 0);
    var a = Math.abs(v), s = null;
    if (f === 0) {
      var units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]];
      for (var i = 0; i < units.length && s === null; i++) if (a >= units[i][0]) s = (a / units[i][0]).toFixed(d) + units[i][1];
      if (s === null) s = a.toFixed(d);
    } else if (f === 1) {
      s = groupThousands(Math.round(a));
    } else {
      s = a.toFixed(d);
    }
    return (v < 0 ? "-" : "") + (prefix || "") + s + (suffix || "");
  }

  function fmtOf(data) { return data.fmt || {}; }

  function choropleth(data, cam, o, cav) {
    var mesh = new cav.Mesh();
    mesh.addPath(new cav.Path(), new cav.Material()); // the first path takes the layer's own colour (check 8)
    var geo = data.geo;
    for (var i = 0; i < geo.f.length; i++) {
      var mat = new cav.Material();
      mat.fill = true;
      mat.fillColor = colorAt(valueAt(data.series[i], o.year), o, data.range);
      mesh.addPath(GeoRuntime.buildPath({ v: 1, kind: geo.kind, f: [geo.f[i]] }, cam, 100, {}, cav.Path), mat);
    }
    return mesh;
  }

  function bubbles(data, cam, o, PathCtor) {
    var path = new PathCtor(), project = GeoProjection.makeProjector(cam), out = [0, 0];
    var scale = o.ellipseScale != null ? Number(o.ellipseScale) : 1;
    for (var i = 0; i < data.pts.length; i++) {
      var r = bubbleRadius(valueAt(data.series[i], o.year), data.range.maxAbs, o.maxRadius);
      if (r <= 0 || !project(data.pts[i][0], data.pts[i][1], out)) continue;
      path.addEllipse(out[0], out[1], r * scale, r * scale);
    }
    return path;
  }

  // Text width: cavalry.measureText when available (call shape from check 9), else ~0.5 em per character.
  function textWidth(text, size, cav) {
    if (cav && typeof cav.measureText === "function") {
      try {
        var m = cav.measureText(text, "Lato", "Regular", size);
        if (m && isFinite(Number(m.width)) && Number(m.width) > 0) return Number(m.width);
      } catch (e) { /* fall back to the estimate */ }
    }
    return text.length * size * 0.5;
  }

  function valueLabels(data, cam, o, cav) {
    var path = new cav.Path(), project = GeoProjection.makeProjector(cam), out = [0, 0], f = fmtOf(data);
    var size = Number(o.textSize) || 16;
    for (var i = 0; i < data.pts.length; i++) {
      var text = formatValue(valueAt(data.series[i], o.year), o.format, o.decimals, f.prefix, f.suffix);
      if (!text || !project(data.pts[i][0], data.pts[i][1], out)) continue;
      path.addText(text, size, out[0] - textWidth(text, size, cav) / 2, out[1] - size * 0.35);
    }
    return path;
  }

  function textMaterial(cav) { var m = new cav.Material(); m.fill = true; m.fillColor = "#222222"; return m; }

  function legend(data, o, cav) {
    var mesh = new cav.Mesh(), f = fmtOf(data), r = effectiveRange(o, data.range);
    mesh.addPath(new cav.Path(), new cav.Material());
    for (var k = 0; k < LEGEND_STRIPS; k++) {
      var p = new cav.Path(), x0 = LEGEND_W * k / LEGEND_STRIPS, x1 = LEGEND_W * (k + 1) / LEGEND_STRIPS;
      p.moveTo(x0, 0); p.lineTo(x1 + 0.5, 0); p.lineTo(x1 + 0.5, LEGEND_H); p.lineTo(x0, LEGEND_H); p.close();
      var mat = new cav.Material();
      mat.fill = true;
      mat.fillColor = colorAt(r[0] + (r[1] - r[0]) * (k + 0.5) / LEGEND_STRIPS, o, data.range);
      mesh.addPath(p, mat);
    }
    var t = new cav.Path(), lo = formatValue(r[0], f.format, f.decimals, f.prefix, f.suffix), hi = formatValue(r[1], f.format, f.decimals, f.prefix, f.suffix);
    t.addText(String(data.title || ""), LEGEND_TEXT, 0, LEGEND_H + 8);
    t.addText(lo, LEGEND_TEXT, 0, -LEGEND_TEXT - 4);
    t.addText(hi, LEGEND_TEXT, LEGEND_W - textWidth(hi, LEGEND_TEXT, cav), -LEGEND_TEXT - 4);
    mesh.addPath(t, textMaterial(cav));
    return mesh;
  }

  function bubbleLegend(data, o, cav) {
    var mesh = new cav.Mesh(), f = fmtOf(data), R = Number(o.maxRadius) || 40, r2 = R * Math.sqrt(0.5);
    mesh.addPath(new cav.Path(), new cav.Material());
    var circles = new cav.Path();
    circles.addEllipse(R, R, R, R);
    circles.addEllipse(R, r2, r2, r2);
    var ring = new cav.Material(); ring.fill = false; ring.stroke = true; ring.strokeColor = "#222222"; ring.strokeWidth = 1;
    mesh.addPath(circles, ring);
    var t = new cav.Path();
    t.addText(String(data.title || ""), LEGEND_TEXT, 0, 2 * R + 8);
    t.addText(formatValue(data.range.maxAbs, f.format, f.decimals, f.prefix, f.suffix), LEGEND_TEXT, 2 * R + 8, 2 * R - LEGEND_TEXT);
    t.addText(formatValue(data.range.maxAbs / 2, f.format, f.decimals, f.prefix, f.suffix), LEGEND_TEXT, 2 * R + 8, 2 * r2 - LEGEND_TEXT);
    mesh.addPath(t, textMaterial(cav));
    return mesh;
  }

  return { valueAt: valueAt, toRgb: toRgb, colorAt: colorAt, bubbleRadius: bubbleRadius, formatValue: formatValue,
    choropleth: choropleth, bubbles: bubbles, valueLabels: valueLabels, legend: legend, bubbleLegend: bubbleLegend };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoData;

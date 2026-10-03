// Smooth camera flights: zoom out, travel, zoom in (van Wijk & Nuij, "Smooth and
// efficient zooming and panning", as in d3.interpolateZoom) in Web Mercator space. Pure.
var GeoFly = (function () {
  var D2R = Math.PI / 180, RHO = Math.SQRT2, RHO2 = 2, RHO4 = 4, EPS = 1e-12, MAX_LAT = 85.0511287798, MAX_ZOOM = 22;

  function cosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }
  function sinh(x) { return (Math.exp(x) - Math.exp(-x)) / 2; }
  function tanh(x) { var e = Math.exp(2 * x); return (e - 1) / (e + 1); }
  function mercY(lat) { var p = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
  function latFromY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R; }
  function viewWidth(zoom, width) { return width * 2 * Math.PI / (256 * Math.pow(2, zoom)); }
  function zoomFor(w, width) { return Math.log(width * 2 * Math.PI / (256 * w)) / Math.LN2; }
  function wrapLon(lon) { return ((lon + 180) % 360 + 360) % 360 - 180; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function interpolator(p0, p1) {
    var ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2];
    var dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    if (d2 < EPS) {
      var S0 = Math.log(w1 / w0) / RHO;
      return function (t) { return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S0)]; };
    }
    var d1 = Math.sqrt(d2);
    var b0 = (w1 * w1 - w0 * w0 + RHO4 * d2) / (2 * w0 * RHO2 * d1);
    var b1 = (w1 * w1 - w0 * w0 - RHO4 * d2) / (2 * w1 * RHO2 * d1);
    var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    var S = (r1 - r0) / RHO, coshr0 = cosh(r0);
    return function (t) {
      var s = t * S, u = w0 / (RHO2 * d1) * (coshr0 * tanh(RHO * s + r0) - sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, w0 * coshr0 / cosh(RHO * s + r0)];
    };
  }

  function path(start, end, frames, width) {
    frames = Math.round(Number(frames) || 0);
    if (frames < 2) throw new Error("Use at least 2 frames.");
    var x0 = wrapLon(start.lon) * D2R, x1 = end.lon * D2R;
    if (x1 - x0 > Math.PI) x1 -= 2 * Math.PI; else if (x0 - x1 > Math.PI) x1 += 2 * Math.PI;
    var f = interpolator([x0, mercY(start.lat), viewWidth(start.zoom, width)], [x1, mercY(end.lat), viewWidth(end.zoom, width)]);
    var out = [];
    for (var k = 0; k < frames; k++) {
      var v = f(ease(k / (frames - 1)));
      out.push({ lat: latFromY(v[1]), lon: wrapLon(v[0] / D2R), zoom: Math.max(0, Math.min(MAX_ZOOM, zoomFor(v[2], width))) });
    }
    out[0] = { lat: start.lat, lon: start.lon, zoom: start.zoom };
    out[frames - 1] = { lat: end.lat, lon: wrapLon(end.lon), zoom: end.zoom };
    return out;
  }

  return { path: path, ease: ease };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoFly;

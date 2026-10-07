// Smooth camera flights: zoom out, travel, zoom in (van Wijk & Nuij, "Smooth and
// efficient zooming and panning", as in d3.interpolateZoom) in Web Mercator space. Pure.
var GeoFly = (function () {
  var D2R = Math.PI / 180, RHO = Math.SQRT2, EPS = 1e-12, MAX_LAT = 85.0511287798, MAX_ZOOM = 22;

  function cosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }
  function sinh(x) { return (Math.exp(x) - Math.exp(-x)) / 2; }
  function tanh(x) { var e = Math.exp(2 * x); return (e - 1) / (e + 1); }
  function mercY(lat) { var p = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
  function latFromY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R; }
  function viewWidth(zoom, width) { return width * 2 * Math.PI / (256 * Math.pow(2, zoom)); }
  function zoomFor(w, width) { return Math.log(width * 2 * Math.PI / (256 * w)) / Math.LN2; }
  function wrapLon(lon) { return ((lon + 180) % 360 + 360) % 360 - 180; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function gentle(t) { return 0.5 - Math.cos(Math.PI * t) / 2; }
  function snappy(t) { return t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2; }

  var EASINGS = [{ id: "smooth", name: "Smooth" }, { id: "gentle", name: "Gentle" }, { id: "snappy", name: "Snappy" }, { id: "overshoot", name: "Overshoot" }];
  var ARCS = [{ id: "low", name: "Low", rho: 1.0 }, { id: "normal", name: "Normal", rho: RHO }, { id: "high", name: "High", rho: 2.0 }];
  var DRIFTS = [{ id: "in", name: "Push in" }, { id: "out", name: "Pull out" }, { id: "left", name: "Pan left" },
    { id: "right", name: "Pan right" }, { id: "up", name: "Pan up" }, { id: "down", name: "Pan down" }];
  var OVERSHOOT_AT = 0.85, OVERSHOOT_ZOOM = 0.3, DRIFT_ZOOM = 0.15, DRIFT_PAN = 0.05;

  // The overshoot easing's own curve is the smooth one (path() adds the settle phase).
  function easing(id) { return id === "gentle" ? gentle : id === "snappy" ? snappy : ease; }
  function arcRho(id) { for (var i = 0; i < ARCS.length; i++) if (ARCS[i].id === id) return ARCS[i].rho; return RHO; }
  function clampZoom(z) { return Math.max(0, Math.min(MAX_ZOOM, z)); }

  function interpolator(p0, p1, rho) {
    rho = rho || RHO;
    var RHO2 = rho * rho; if (Math.abs(RHO2 - Math.round(RHO2)) < 1e-12) RHO2 = Math.round(RHO2); // sqrt(2)^2 -> exactly 2
    var RHO4 = RHO2 * RHO2;
    var ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2];
    var dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    if (d2 < EPS) {
      var S0 = Math.log(w1 / w0) / rho;
      return function (t) { return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S0)]; };
    }
    var d1 = Math.sqrt(d2);
    var b0 = (w1 * w1 - w0 * w0 + RHO4 * d2) / (2 * w0 * RHO2 * d1);
    var b1 = (w1 * w1 - w0 * w0 - RHO4 * d2) / (2 * w1 * RHO2 * d1);
    var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    var S = (r1 - r0) / rho, coshr0 = cosh(r0);
    return function (t) {
      var s = t * S, u = w0 / (RHO2 * d1) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, w0 * coshr0 / cosh(rho * s + r0)];
    };
  }

  // opts = { easing: id, arc: id }; no opts = cubic in-out, rho = sqrt(2) (today's flight).
  function path(start, end, frames, width, opts) {
    frames = Math.round(Number(frames) || 0);
    if (frames < 2) throw new Error("Use at least 2 frames.");
    opts = opts || {};
    var rho = arcRho(opts.arc), ez = easing(opts.easing), over = opts.easing === "overshoot";
    var x0 = wrapLon(start.lon) * D2R, x1 = end.lon * D2R;
    if (x1 - x0 > Math.PI) x1 -= 2 * Math.PI; else if (x0 - x1 > Math.PI) x1 += 2 * Math.PI;
    var peak = over ? clampZoom(end.zoom + OVERSHOOT_ZOOM) : end.zoom;
    var f = interpolator([x0, mercY(start.lat), viewWidth(start.zoom, width)], [x1, mercY(end.lat), viewWidth(peak, width)], rho);
    var endLon = wrapLon(end.lon), out = [];
    for (var k = 0; k < frames; k++) {
      var t = k / (frames - 1);
      if (over && t > OVERSHOOT_AT + 1e-9) { // phase 2: position held, zoom settles back to the target
        out.push({ lat: end.lat, lon: endLon, zoom: peak + (end.zoom - peak) * gentle((t - OVERSHOOT_AT) / (1 - OVERSHOOT_AT)) });
      } else if (over && t >= OVERSHOOT_AT - 1e-9) { // end of phase 1: exactly on the destination at the peak zoom
        out.push({ lat: end.lat, lon: endLon, zoom: peak });
      } else {
        var v = f(ez(over ? t / OVERSHOOT_AT : t));
        out.push({ lat: latFromY(v[1]), lon: wrapLon(v[0] / D2R), zoom: clampZoom(zoomFor(v[2], width)) });
      }
    }
    out[0] = { lat: start.lat, lon: start.lon, zoom: start.zoom };
    out[frames - 1] = { lat: end.lat, lon: endLon, zoom: end.zoom };
    return out;
  }

  // End view of a drift: Push in / Pull out change zoom; pans move the centre by 5 % of the frame
  // width (left / right) or height (up / down) at the start zoom, through Web Mercator.
  function driftEnd(start, move, compW, compH) {
    var res = { lat: start.lat, lon: start.lon, zoom: start.zoom };
    var perPx = viewWidth(start.zoom, compW) / compW; // radians per pixel at the start zoom
    if (move === "in") res.zoom = clampZoom(start.zoom + DRIFT_ZOOM);
    else if (move === "out") res.zoom = clampZoom(start.zoom - DRIFT_ZOOM);
    else if (move === "left" || move === "right") res.lon = wrapLon(start.lon + (move === "right" ? 1 : -1) * DRIFT_PAN * compW * perPx / D2R);
    else if (move === "up" || move === "down") res.lat = latFromY(mercY(start.lat) + (move === "up" ? 1 : -1) * DRIFT_PAN * compH * perPx);
    return res;
  }

  // Straight, gently eased interpolation from start to end (lon the short way round), endpoints exact.
  function driftPath(start, end, frames) {
    frames = Math.round(Number(frames) || 0);
    if (frames < 2) throw new Error("Use at least 2 frames.");
    var dLon = wrapLon(end.lon - start.lon), out = [];
    for (var k = 0; k < frames; k++) {
      var g = gentle(k / (frames - 1));
      out.push({ lat: start.lat + (end.lat - start.lat) * g, lon: wrapLon(start.lon + dLon * g), zoom: start.zoom + (end.zoom - start.zoom) * g });
    }
    out[0] = { lat: start.lat, lon: start.lon, zoom: start.zoom };
    out[frames - 1] = { lat: end.lat, lon: wrapLon(end.lon), zoom: end.zoom };
    return out;
  }

  return { path: path, ease: ease, easing: easing, EASINGS: EASINGS, ARCS: ARCS, DRIFTS: DRIFTS, driftEnd: driftEnd, driftPath: driftPath };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoFly;

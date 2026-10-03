// Map projections shared by the panel and by every map layer expression.
// Output is in Cavalry pixels: the camera centre is at (0, 0), north is +y.
var GeoProjection = (function () {
  var MERCATOR = 0, EQUAL_EARTH = 1, ORTHOGRAPHIC = 2;
  var D2R = Math.PI / 180;
  var MAX_LAT = 85.0511287798;
  var MAX_ZOOM = 22;
  var A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;

  // Pixels per radian: at zoom z the mercator world is 256 * 2^z px wide.
  function worldScale(zoom) { return 256 * Math.pow(2, zoom) / (2 * Math.PI); }
  function clampLat(lat) { return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)); }
  function mercY(lat) { var p = clampLat(lat) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }

  function equalEarth(lon, lat, out) {
    var l = lon * D2R, p = lat * D2R;
    var t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
    out[0] = l * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
    out[1] = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  }

  function makeProjector(cam) {
    var proj = Math.max(MERCATOR, Math.min(ORTHOGRAPHIC, Math.round(cam.projection || 0)));
    var R = worldScale(Math.max(0, Math.min(MAX_ZOOM, cam.zoom)));
    var rot = (cam.rotation || 0) * D2R, cr = Math.cos(rot), sr = Math.sin(rot);
    var lon0 = cam.lon, lat0 = cam.lat;
    var sinLat0 = Math.sin(lat0 * D2R), cosLat0 = Math.cos(lat0 * D2R);
    var cx = 0, cy = 0, tmp = [0, 0];
    if (proj === MERCATOR) { cx = lon0 * D2R; cy = mercY(lat0); }
    else if (proj === EQUAL_EARTH) { equalEarth(lon0, lat0, tmp); cx = tmp[0]; cy = tmp[1]; }

    function finish(x, y, out) {
      x *= R; y *= R;
      out[0] = x * cr - y * sr;
      out[1] = x * sr + y * cr;
    }

    return function (lon, lat, out) {
      if (proj === MERCATOR) { finish(lon * D2R - cx, mercY(lat) - cy, out); return true; }
      if (proj === EQUAL_EARTH) { equalEarth(lon, lat, tmp); finish(tmp[0] - cx, tmp[1] - cy, out); return true; }
      var p = lat * D2R, dl = (lon - lon0) * D2R;
      var cp = Math.cos(p), sp = Math.sin(p), cdl = Math.cos(dl);
      var x = cp * Math.sin(dl), y = cosLat0 * sp - sinLat0 * cp * cdl;
      var visible = sinLat0 * sp + cosLat0 * cp * cdl >= 0;
      if (!visible) { var len = Math.sqrt(x * x + y * y) || 1; x /= len; y /= len; }
      finish(x, y, out);
      return visible;
    };
  }

  // Orthographic projection of a 3D point in Earth-centred coordinates (unit sphere =
  // surface; x toward lon 0 / lat 0, z toward the north pole). Lifted route points are
  // scaled outward. Visible unless the point is behind the globe (negative depth AND inside
  // the globe's disc); hidden points are clamped onto the globe's edge, like makeProjector.
  function makeGlobeProjector3(cam) {
    var R = worldScale(Math.max(0, Math.min(MAX_ZOOM, cam.zoom)));
    var rot = (cam.rotation || 0) * D2R, cr = Math.cos(rot), sr = Math.sin(rot);
    var l0 = cam.lon * D2R, sl0 = Math.sin(l0), cl0 = Math.cos(l0);
    var sp0 = Math.sin(cam.lat * D2R), cp0 = Math.cos(cam.lat * D2R);
    return function (X, Y, Z, out) {
      var xr = X * cl0 + Y * sl0, yr = -X * sl0 + Y * cl0;
      var x = yr, y = cp0 * Z - sp0 * xr, depth = sp0 * Z + cp0 * xr;
      var visible = depth >= 0 || x * x + y * y >= 1;
      if (!visible) { var len = Math.sqrt(x * x + y * y) || 1; x /= len; y /= len; }
      x *= R; y *= R;
      out[0] = x * cr - y * sr;
      out[1] = x * sr + y * cr;
      return visible;
    };
  }

  function invMercY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R; }

  // Lon/lat box visible in a width x height frame (Web Mercator maths; rotation widens it).
  // Zoom is clamped exactly as makeProjector does, and the resulting box is clamped to
  // valid lon/lat ranges, so a camera keyed past MAX_ZOOM (or negative) never produces an
  // out-of-range bbox for Overpass.
  function mercatorViewBounds(cam, width, height) {
    var R = worldScale(Math.max(0, Math.min(MAX_ZOOM, cam.zoom)));
    var hw = width / 2, hh = height / 2;
    if (cam.rotation) { var d = Math.sqrt(hw * hw + hh * hh); hw = d; hh = d; }
    var lonSpan = hw / R / D2R, y0 = mercY(cam.lat);
    var west = cam.lon - lonSpan, east = cam.lon + lonSpan;
    var south = invMercY(y0 - hh / R), north = invMercY(y0 + hh / R);
    return {
      west: Math.max(-180, Math.min(180, west)), east: Math.max(-180, Math.min(180, east)),
      south: Math.max(-MAX_LAT, Math.min(MAX_LAT, south)), north: Math.max(-MAX_LAT, Math.min(MAX_LAT, north))
    };
  }

  // Like mercatorViewBounds, but a view that crosses the date line comes back as two
  // boxes (one ending at 180, one starting at -180) so street downloads cover both sides.
  function mercatorViewBoxes(cam, width, height) {
    var whole = mercatorViewBounds({ lat: cam.lat, lon: 0, zoom: cam.zoom, rotation: cam.rotation }, width, height);
    var half = whole.east, lon = ((cam.lon + 540) % 360) - 180;
    if (half >= 180) return [mercatorViewBounds(cam, width, height)];
    var west = lon - half, east = lon + half, s = whole.south, n = whole.north;
    function box(w, e) { return { west: w, east: e, south: s, north: n }; }
    if (west < -180) return [box(-180, east), box(west + 360, 180)];
    if (east > 180) return [box(west, 180), box(-180, east - 360)];
    return [mercatorViewBounds(cam, width, height)];
  }

  // b.east < b.west means the box crosses the antimeridian (e.g. Fiji); treat the span as
  // wrapping around by adding a full turn to east before measuring its width.
  function zoomForBounds(b, width, height) {
    var east = b.east < b.west ? b.east + 360 : b.east;
    var lonSpan = (east - b.west) * D2R;
    var ySpan = mercY(b.north) - mercY(b.south);
    var R = Math.min(width / lonSpan, height / ySpan);
    return Math.log(R * 2 * Math.PI / 256) / Math.LN2;
  }

  return {
    MERCATOR: MERCATOR, EQUAL_EARTH: EQUAL_EARTH, ORTHOGRAPHIC: ORTHOGRAPHIC, MAX_LAT: MAX_LAT, MAX_ZOOM: MAX_ZOOM,
    worldScale: worldScale, makeProjector: makeProjector, makeGlobeProjector3: makeGlobeProjector3,
    mercatorViewBounds: mercatorViewBounds, mercatorViewBoxes: mercatorViewBoxes, zoomForBounds: zoomForBounds
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoProjection;

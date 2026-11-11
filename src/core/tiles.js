// Map tile maths for imagery: which zoom levels show, cross-fades, which tiles a view
// needs, and where tiles and level groups sit. Pure and self-contained: it is also
// inlined into imagery driver expressions, so it must not use api/ui/require.
var GeoTiles = (function () {
  var D2R = Math.PI / 180, TWO_PI = 2 * Math.PI, MAX_LAT = 85.0511287798, MAX_ZOOM = 22;
  var TILE = 256;
  // Level L is fully opaque ("current") from z = L - OPAQUE_FROM and starts fading in at
  // z = L - FADE_FROM. Like web maps, level L is current for z in [L, L + 1), so it is
  // shown at 1x-2x its size; it fades in over [L - 0.2, L], so it covers little more than
  // the view (a level coming in earlier needs many more tiles: 2^(2*FADE_FROM)x).
  var OPAQUE_FROM = 0, FADE_FROM = 0.2;
  // Every tile is a footage layer and Cavalry slows down sharply as they add up (a 559-tile build ran at ~2.6 s/tile), so tile sources stay at 300; EOX and NASA use large images (GeoBlocks).
  var MAX_TILES = 300, WARN_TILES = 150;

  function clampZoom(z) { return Math.max(0, Math.min(MAX_ZOOM, Number(z) || 0)); }
  function worldScale(z) { return TILE * Math.pow(2, z) / TWO_PI; }
  function mercY(lat) { var p = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
  function tileOriginX(x, L) { return x / Math.pow(2, L) * TWO_PI - Math.PI; }
  function tileOriginY(y, L) { return Math.PI - y / Math.pow(2, L) * TWO_PI; }

  // L is current for z in [L - OPAQUE_FROM, L + 1 - OPAQUE_FROM).
  function currentLevel(z, minZoom, maxZoom) { return Math.max(minZoom, Math.min(maxZoom, Math.floor(z + OPAQUE_FROM))); }
  function visibleLevels(z, minZoom, maxZoom) {
    var L = currentLevel(z, minZoom, maxZoom), out = [L];
    if (L + 1 <= maxZoom && z > L + 1 - FADE_FROM) out.push(L + 1);
    return out;
  }
  // A level stays at 100 until the next level is fully opaque on top of it, so a
  // fading-in level always has an opaque level beneath it (no see-through frames).
  function levelOpacity(z, L, lo, hi, projection) {
    if (Math.round(projection || 0) !== 0 || L < lo || L > hi) return 0;
    if (L !== hi && z >= (L + 1) - OPAQUE_FROM) return 0;
    if (L === lo || z >= L - OPAQUE_FROM) return 100;
    if (z <= L - FADE_FROM) return 0;
    return 100 * (z - (L - FADE_FROM)) / (FADE_FROM - OPAQUE_FROM);
  }

  // Tiles a bent build needs, for any projection: the visible region of every sample at
  // each visible level, with unwrapped x (lon = cam.lon + dlon, so x may be < 0 or >= 2^L).
  // regionFn(cam, width, height) -> { dlon0, dlon1, lat0, lat1 } or null (GeoReproject.visibleRegion).
  function bentTileSet(samples, width, height, minZoom, maxZoom, regionFn) {
    var seen = {}, tiles = [], lo = Infinity, hi = -Infinity, frames = 0;
    for (var i = 0; i < samples.length; i++) {
      var cam = samples[i], reg = regionFn(cam, width, height);
      if (!reg) continue;
      frames++;
      var levels = visibleLevels(clampZoom(cam.zoom), minZoom, maxZoom);
      for (var j = 0; j < levels.length; j++) {
        var L = levels[j], n = Math.pow(2, L);
        if (L < lo) lo = L;
        if (L > hi) hi = L;
        var x0 = Math.floor((cam.lon + reg.dlon0 + 180) / 360 * n), x1 = Math.floor((cam.lon + reg.dlon1 + 180) / 360 * n);
        var y0 = Math.max(0, Math.min(n - 1, Math.floor((Math.PI - mercY(reg.lat1)) / TWO_PI * n)));
        var y1 = Math.max(0, Math.min(n - 1, Math.floor((Math.PI - mercY(reg.lat0)) / TWO_PI * n)));
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
          var key = L + "/" + x + "/" + y;
          if (!seen[key]) { seen[key] = true; tiles.push({ z: L, x: x, y: y }); }
        }
      }
    }
    tiles.sort(function (a, b) { return (a.z - b.z) || (a.y - b.y) || (a.x - b.x); });
    return { tiles: tiles, lo: frames ? lo : 0, hi: frames ? hi : -1, frames: frames };
  }

  function levelOrigin(tiles) {
    var x0 = Infinity, y0 = Infinity;
    for (var i = 0; i < tiles.length; i++) { if (tiles[i].x < x0) x0 = tiles[i].x; if (tiles[i].y < y0) y0 = tiles[i].y; }
    return { x0: x0, y0: y0 };
  }

  function levelPosition(cam, L, x0, y0) {
    var R = worldScale(clampZoom(cam.zoom));
    return [(tileOriginX(x0, L) - cam.lon * D2R) * R, (tileOriginY(y0, L) - mercY(cam.lat)) * R];
  }
  function levelScale(cam, L) { var s = Math.pow(2, clampZoom(cam.zoom) - L); return [s, s]; }
  // The Whole Earth level: the world repeats every 360 degrees, so it is placed from the camera's longitude
  // wrapped into [-180, 180). The copies it holds cover -360..360, which the wrapped camera needs (see planImagery).
  function wrapLon(lon) { return ((lon + 180) % 360 + 360) % 360 - 180; }
  function worldLevelPosition(cam, L, x0, y0) {
    return levelPosition({ lat: cam.lat, lon: wrapLon(cam.lon), zoom: cam.zoom }, L, x0, y0);
  }

  return { MAX_TILES: MAX_TILES, WARN_TILES: WARN_TILES, worldScale: worldScale, mercY: mercY,
    currentLevel: currentLevel, visibleLevels: visibleLevels, levelOpacity: levelOpacity,
    bentTileSet: bentTileSet, levelOrigin: levelOrigin,
    levelPosition: levelPosition, levelScale: levelScale, worldLevelPosition: worldLevelPosition };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoTiles;

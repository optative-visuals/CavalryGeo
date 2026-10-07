// Large-image imagery: the tiles a flight needs are grouped into 8x8-tile blocks and each
// block is fetched as one WMS image cropped to the tiles it needs, so a flight is a few
// dozen footage layers instead of hundreds. Pure. A rect is { z, x0, y0, x1, y1 } with
// inclusive tile indices; a single tile is a 1x1 rect.
var GeoBlocks = (function () {
  var BLOCK = 8, TILE = 256, HALF = Math.PI * 6378137, WORLD = 2 * HALF;
  // Every image is a footage layer and Cavalry slows down as they add up; the tile cap
  // bounds the pixels (memory) the images hold.
  var MAX_IMAGES = 150, WARN_IMAGES = 80, MAX_IMAGE_TILES = 2000;

  function tileRect(t) { return { z: t.z, x0: t.x, y0: t.y, x1: t.x, y1: t.y }; }
  function blocksForTiles(tiles) {
    var by = {}, out = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], k = t.z + "/" + Math.floor(t.x / BLOCK) + "/" + Math.floor(t.y / BLOCK), r = by[k];
      if (!r) { r = by[k] = tileRect(t); out.push(r); continue; }
      if (t.x < r.x0) r.x0 = t.x;
      if (t.x > r.x1) r.x1 = t.x;
      if (t.y < r.y0) r.y0 = t.y;
      if (t.y > r.y1) r.y1 = t.y;
    }
    out.sort(function (a, b) { return (a.z - b.z) || (a.y0 - b.y0) || (a.x0 - b.x0); });
    return out;
  }
  function rectMercator(r) {
    var n = Math.pow(2, r.z);
    return { minx: r.x0 / n * WORLD - HALF, maxx: (r.x1 + 1) / n * WORLD - HALF, miny: HALF - (r.y1 + 1) / n * WORLD, maxy: HALF - r.y0 / n * WORLD };
  }
  function rectPixels(r) { return [(r.x1 - r.x0 + 1) * TILE, (r.y1 - r.y0 + 1) * TILE]; }
  function rectTiles(r) { return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }
  function totalTiles(rects) { var n = 0; for (var i = 0; i < rects.length; i++) n += rectTiles(rects[i]); return n; }
  function levelOrigin(rects) {
    var x0 = Infinity, y0 = Infinity;
    for (var i = 0; i < rects.length; i++) { if (rects[i].x0 < x0) x0 = rects[i].x0; if (rects[i].y0 < y0) y0 = rects[i].y0; }
    return { x0: x0, y0: y0 };
  }
  // Level-local centre, in the same frame as GeoTiles.tileLocal (north up, origin at the
  // level origin's north-west corner).
  function rectLocal(r, origin) { return [((r.x0 + r.x1 + 1) / 2 - origin.x0) * TILE, -((r.y0 + r.y1 + 1) / 2 - origin.y0) * TILE]; }

  // Reuse of saved images: each missing rect is replaced by the smallest saved rect of the
  // same level and 8x8 block that contains it, while the plan stays within maxTiles.
  // Returns { items, missing, reused }; inputs are not changed.
  function contains(a, r) { return a.z === r.z && a.x0 <= r.x0 && a.y0 <= r.y0 && a.x1 >= r.x1 && a.y1 >= r.y1; }
  function sameBlock(a, r) { return Math.floor(a.x0 / BLOCK) === Math.floor(r.x0 / BLOCK) && Math.floor(a.y0 / BLOCK) === Math.floor(r.y0 / BLOCK); }
  function rectKey(r) { return r.z + "/" + r.x0 + "_" + r.y0 + "_" + r.x1 + "_" + r.y1; }
  function reuseCovering(missing, saved, items, maxTiles) {
    var cur = items.slice(), left = [], reused = 0;
    for (var i = 0; i < missing.length; i++) {
      var r = missing[i], best = null;
      for (var j = 0; j < saved.length; j++) {
        var c = saved[j];
        if (contains(c, r) && sameBlock(c, r) && (!best || rectTiles(c) < rectTiles(best))) best = c;
      }
      if (!best) { left.push(r); continue; }
      var at = -1, dup = false, key = rectKey(best), next = [];
      for (var k = 0; k < cur.length; k++) {
        if (cur[k] === r) { at = k; continue; }
        if (rectKey(cur[k]) === key) dup = true;
      }
      for (k = 0; k < cur.length; k++) {
        if (k === at) { if (!dup) next.push(best); } else next.push(cur[k]);
      }
      if (totalTiles(next) > maxTiles) { left.push(r); continue; }
      cur = next; reused++;
    }
    return { items: cur, missing: left, reused: reused };
  }

  return { BLOCK: BLOCK, MAX_IMAGES: MAX_IMAGES, WARN_IMAGES: WARN_IMAGES, MAX_IMAGE_TILES: MAX_IMAGE_TILES,
    tileRect: tileRect, blocksForTiles: blocksForTiles, rectMercator: rectMercator, rectPixels: rectPixels,
    rectTiles: rectTiles, totalTiles: totalTiles, levelOrigin: levelOrigin, rectLocal: rectLocal, reuseCovering: reuseCovering };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoBlocks;

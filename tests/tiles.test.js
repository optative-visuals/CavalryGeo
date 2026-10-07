const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/core/tiles.js");
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const cam = (o) => Object.assign({ lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 }, o);

test("tile cap and warn threshold", () => {
  assert.equal(T.MAX_TILES, 300);
  assert.equal(T.WARN_TILES, 150);
});

// Web-map style: level L is current (fully opaque) for z in [L, L + 1) and fades in over
// [L - 0.2, L], so it is shown at 1x-2x and covers little more than the view.
test("current and visible levels", () => {
  assert.equal(T.currentLevel(4.9, 0, 15), 4, "still the lower level while L fades in");
  assert.equal(T.currentLevel(5, 0, 15), 5, "current from exactly L");
  assert.equal(T.currentLevel(5.99, 0, 15), 5);
  assert.equal(T.currentLevel(20, 0, 15), 15);
  assert.equal(T.currentLevel(-3, 2, 8), 2);
  assert.deepEqual(T.visibleLevels(4.7, 0, 15), [4]);
  assert.deepEqual(T.visibleLevels(5 - 0.2, 0, 15), [4], "not yet fading in at exactly L - 0.2");
  assert.deepEqual(T.visibleLevels(4.9, 0, 15), [4, 5]);
  assert.deepEqual(T.visibleLevels(4, 0, 15), [4], "a camera at a whole zoom shows just that level");
  assert.deepEqual(T.visibleLevels(15.4, 0, 15), [15]);
});

test("cross-fade opacity", () => {
  assert.equal(T.levelOpacity(4.5, 4, 2, 8, 0), 100);
  assert.equal(T.levelOpacity(4.9, 4, 2, 8, 0), 100, "still opaque while the next level fades in");
  assert.equal(T.levelOpacity(5, 4, 2, 8, 0), 0, "gone once the next level is fully opaque");
  assert.equal(T.levelOpacity(5, 5, 2, 8, 0), 100);
  near(T.levelOpacity(4.9, 5, 2, 8, 0), 50, 1e-6);
  assert.equal(T.levelOpacity(5 - 0.2, 5, 2, 8, 0), 0);
  assert.equal(T.levelOpacity(4.7, 5, 2, 8, 0), 0);
  assert.equal(T.levelOpacity(1.0, 2, 2, 8, 0), 100, "lowest level never fades in");
  assert.equal(T.levelOpacity(9.9, 8, 2, 8, 0), 100, "highest level never fades out");
  assert.equal(T.levelOpacity(4.5, 4, 2, 8, 1), 0, "not Web Mercator");
  assert.equal(T.levelOpacity(4.0, 1, 2, 8, 0), 0, "not built");
  assert.equal(T.levelOpacity(3.0, 5, 5, 5, 0), 100, "single level");
});

test("never see-through: the lowest visible level is opaque and at most two show", () => {
  for (let z = 0; z <= 11; z += 0.01) {
    const vis = [];
    for (let L = 2; L <= 8; L++) { const o = T.levelOpacity(z, L, 2, 8, 0); if (o > 0) vis.push([L, o]); }
    assert.ok(vis.length >= 1 && vis.length <= 2, `z=${z}: ${JSON.stringify(vis)}`);
    assert.equal(vis[0][1], 100, `z=${z}`);
  }
});

// For any zoom in [lo - 1, hi + 1], some level is fully opaque, and a half-faded level
// always has the level below it fully opaque - including exactly at the fade boundaries.
test("cross-fade invariant holds at every zoom, including the exact boundaries", () => {
  [[2, 8], [0, 1], [4, 5], [3, 15]].forEach(([lo, hi]) => {
    const zs = [];
    for (let z = lo - 1; z <= hi + 1; z += 0.01) zs.push(z);
    for (let L = lo; L <= hi + 1; L++) zs.push(L, L - 0.2, L - 0.1, L + 1, L + 0.5);
    zs.forEach((z) => {
      const op = {};
      for (let L = lo; L <= hi; L++) op[L] = T.levelOpacity(z, L, lo, hi, 0);
      assert.ok(Object.values(op).some((o) => o === 100), `lo=${lo} hi=${hi} z=${z}: ${JSON.stringify(op)}`);
      for (let L = lo; L <= hi; L++) {
        if (op[L] > 0 && op[L] < 100) assert.equal(op[L - 1], 100, `lo=${lo} hi=${hi} z=${z} L=${L}: ${JSON.stringify(op)}`);
      }
    });
  });
});

test("tiles for a 1920x1080 view", () => {
  assert.equal(T.tilesForView(cam({}), 1920, 1080, 4).length, 48);
  const xs = T.tilesForView(cam({}), 1920, 1080, 4).map((t) => t.x);
  assert.equal(Math.min(...xs), 4); assert.equal(Math.max(...xs), 11);
  assert.equal(T.tilesForView(cam({ rotation: 90 }), 1920, 1080, 4).length, 48);
  assert.equal(T.tilesForView(cam({ rotation: 45 }), 1920, 1080, 4).length, 100);
  const edge = T.tilesForView(cam({ lon: 179, lat: 85 }), 1920, 1080, 4);
  assert.ok(edge.every((t) => t.x >= 0 && t.x <= 15 && t.y >= 0 && t.y <= 15), "clamped, no wrap");
  assert.ok(edge.every((t) => t.z === 4));
});

test("tile set for an animation", () => {
  const still = T.tileSet([cam({}), cam({}), cam({ projection: 1 })], 1920, 1080, 0, 15);
  assert.equal(still.tiles.length, 48);
  assert.equal(still.frames, 2);
  assert.deepEqual([still.lo, still.hi], [4, 4]);
  const fade = T.tileSet([cam({ zoom: 4.9 })], 1920, 1080, 0, 15);
  assert.deepEqual([fade.lo, fade.hi], [4, 5]);
  assert.ok(fade.tiles.some((t) => t.z === 5) && fade.tiles.some((t) => t.z === 4));
  const none = T.tileSet([cam({ projection: 2 })], 1920, 1080, 0, 15);
  assert.equal(none.frames, 0);
  assert.equal(none.tiles.length, 0);
  const capped = T.tileSet([cam({ zoom: 12 })], 1920, 1080, 0, 8);
  assert.deepEqual([capped.lo, capped.hi], [8, 8]);
});

test("placement and driver maths", () => {
  const tiles = [{ z: 4, x: 8, y: 8 }, { z: 4, x: 9, y: 8 }, { z: 4, x: 8, y: 9 }, { z: 5, x: 1, y: 1 }];
  const by = T.groupByLevel(tiles);
  assert.equal(by[4].length, 3);
  const o = T.levelOrigin(by[4]);
  assert.deepEqual(o, { x0: 8, y0: 8 });
  assert.deepEqual(T.tileLocal({ z: 4, x: 9, y: 9 }, o), [384, -384]);
  const p0 = T.levelPosition(cam({}), 4, 8, 8);
  near(p0[0], 0); near(p0[1], 0);
  const p1 = T.levelPosition(cam({ lon: 22.5 }), 4, 8, 8);
  near(p1[0], -256, 1e-6); near(p1[1], 0);
  assert.deepEqual(T.levelScale(cam({ zoom: 5 }), 4), [2, 2]);
  near(T.worldScale(4), 4096 / (2 * Math.PI));
});

// The later fade-in needs each finer level for a shorter stretch of the flight, so a
// zoom flight needs fewer tiles than with the old 0.5 / 0.7 scheme.
test("a zoom flight needs fewer tiles than with the old fade constants", () => {
  const flight = [];
  for (let k = 0; k <= 120; k++) flight.push(cam({ lat: 48.85, lon: 2.35, zoom: 2 + k * 11 / 120 }));
  const fresh = T.tileSet(flight, 1920, 1080, 0, 15).tiles.length;
  const seen = {};
  flight.forEach((c) => {
    const L = Math.max(0, Math.min(15, Math.floor(c.zoom + 0.5))), levels = [L];
    if (L + 1 <= 15 && c.zoom > L + 1 - 0.7) levels.push(L + 1);
    levels.forEach((lv) => T.tilesForView(c, 1920, 1080, lv).forEach((t) => { seen[t.z + "/" + t.x + "/" + t.y] = true; }));
  });
  const old = Object.keys(seen).length;
  assert.ok(fresh < old * 0.9, `new ${fresh} vs old ${old}`);
});

const R = require("../src/core/reproject.js");
const region = (c, w, h) => R.visibleRegion(c, w, h);
test("bentTileSet: unwrapped x beyond the date line, every sample counts, null regions skipped", () => {
  const east = T.bentTileSet([cam({ projection: 1, lon: 170, zoom: 3 })], 1920, 1080, 0, 22, region);
  assert.ok(east.tiles.some((t) => t.x > 7));
  const west = T.bentTileSet([cam({ projection: 1, lon: -170, zoom: 3 })], 1920, 1080, 0, 22, region);
  assert.ok(west.tiles.some((t) => t.x < 0));
  const two = T.bentTileSet([cam({ zoom: 3 }), cam({ projection: 2, zoom: 3 })], 1920, 1080, 0, 22, region);
  assert.equal(two.frames, 2);
  const none = T.bentTileSet([cam()], 1920, 1080, 0, 22, () => null);
  assert.deepEqual(none, { tiles: [], lo: 0, hi: -1, frames: 0 });
});
test("bentTileSet: a Mercator sample covers tileSet", () => {
  const s = [cam({ lat: 40, lon: 10, zoom: 5.3 })];
  const flat = T.tileSet(s, 1920, 1080, 0, 22), bent = T.bentTileSet(s, 1920, 1080, 0, 22, region);
  const keys = new Set(bent.tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
  for (const t of flat.tiles) assert.ok(keys.has(`${t.z}/${t.x}/${t.y}`));
  assert.equal(bent.lo, flat.lo); assert.equal(bent.hi, flat.hi);
});

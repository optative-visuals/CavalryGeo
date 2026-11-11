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

test("placement and driver maths", () => {
  const tiles = [{ z: 4, x: 8, y: 8 }, { z: 4, x: 9, y: 8 }, { z: 4, x: 8, y: 9 }, { z: 5, x: 1, y: 1 }];
  const level4 = tiles.filter((t) => t.z === 4);
  assert.equal(level4.length, 3);
  const o = T.levelOrigin(level4);
  assert.deepEqual(o, { x0: 8, y0: 8 });
  const p0 = T.levelPosition(cam({}), 4, 8, 8);
  near(p0[0], 0); near(p0[1], 0);
  const p1 = T.levelPosition(cam({ lon: 22.5 }), 4, 8, 8);
  near(p1[0], -256, 1e-6); near(p1[1], 0);
  assert.deepEqual(T.levelScale(cam({ zoom: 5 }), 4), [2, 2]);
  near(T.worldScale(4), 4096 / (2 * Math.PI));
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
// Independent of the region maths: the Web Mercator tile under the view centre and under each
// view corner (unrotated camera) must be in the set, at every visible level.
test("bentTileSet: a Mercator sample covers the tiles under the view centre and corners", () => {
  const c = cam({ lat: 40, lon: 10, zoom: 5.3 }), W = 1920, H = 1080;
  const bent = T.bentTileSet([c], W, H, 0, 22, region);
  assert.deepEqual([bent.lo, bent.hi], [5, 5]);
  const keys = new Set(bent.tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
  const Rw = T.worldScale(c.zoom), X = c.lon * Math.PI / 180, Y = T.mercY(c.lat);
  for (const L of T.visibleLevels(c.zoom, 0, 22)) {
    const n = Math.pow(2, L);
    for (const [sx, sy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = Math.floor((X + sx * (W / 2 - 1) / Rw + Math.PI) / (2 * Math.PI) * n);
      const y = Math.floor((Math.PI - (Y + sy * (H / 2 - 1) / Rw)) / (2 * Math.PI) * n);
      assert.ok(keys.has(`${L}/${x}/${y}`), `${L}/${x}/${y}`);
    }
  }
});
test("bentTileSet: a region spanning the whole world gives 2^L + 1 columns (the extra one is the wrapped copy, shift 1)", () => {
  const full = () => ({ dlon0: -180, dlon1: 180, lat0: -60, lat1: 60 });
  const set = T.bentTileSet([cam({ zoom: 2, lon: 0 })], 1920, 1080, 2, 2, full);
  const level = set.tiles.filter((t) => t.z === 2);
  const xs = Array.from(new Set(level.map((t) => t.x))).sort((a, b) => a - b);
  const x0 = xs[0], n = Math.pow(2, 2);
  assert.equal(xs.length, n + 1, "2^L + 1 columns");
  assert.deepEqual(xs, Array.from({ length: n + 1 }, (_, i) => x0 + i), "consecutive, x0 .. x0 + 2^L");
  assert.equal(x0, 0);
});

// Whole Earth: the world level follows the camera's longitude wrapped into [-180, 180).
test("worldLevelPosition equals levelPosition for a camera longitude in [-180, 180)", () => {
  for (const lon of [-180, -95.5, 0, 12.25, 170, 179.9]) {
    const c = cam({ lon: lon, lat: 20, zoom: 3.4 });
    const a = T.worldLevelPosition(c, 3, -4, 0), b = T.levelPosition(c, 3, -4, 0);
    near(a[0], b[0]); near(a[1], b[1]);
  }
});

test("worldLevelPosition wraps the longitude: 170 + 360k gives the same as 170, and the camera is not changed", () => {
  const c = cam({ lon: 170 }), before = Object.assign({}, c);
  const base = T.worldLevelPosition(c, 3, -4, 0);
  for (const k of [-2, -1, 1, 2]) {
    const p = T.worldLevelPosition(cam({ lon: 170 + 360 * k }), 3, -4, 0);
    near(p[0], base[0]); near(p[1], base[1]);
  }
  const q = T.worldLevelPosition(cam({ lon: 720 }), 3, -4, 0), zero = T.levelPosition(cam({ lon: 0 }), 3, -4, 0);
  near(q[0], zero[0]); near(q[1], zero[1]);
  assert.deepEqual(c, before);
});

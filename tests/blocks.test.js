const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/core/blocks.js");
const T = require("../src/core/tiles.js");
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("limits", () => {
  assert.equal(B.BLOCK, 8);
  assert.equal(B.MAX_IMAGES, 150);
  assert.equal(B.WARN_IMAGES, 80);
  assert.equal(B.MAX_IMAGE_TILES, 2000);
});

test("reuseCovering swaps a missing crop for the smallest saved rect of its block that contains it", () => {
  const r = { z: 4, x0: 5, y0: 5, x1: 6, y1: 6 }, other = { z: 4, x0: 9, y0: 0, x1: 9, y1: 0 };
  const bigger = { z: 4, x0: 0, y0: 0, x1: 7, y1: 7 }, snug = { z: 4, x0: 4, y0: 4, x1: 7, y1: 7 };
  const res = B.reuseCovering([r, other], [bigger, snug], [r, other], 2000);
  assert.deepEqual(res.items, [snug, other]);
  assert.deepEqual(res.missing, [other]);
  assert.equal(res.reused, 1);
});

test("reuseCovering never uses another block, another level or a rect that does not contain it", () => {
  const r = { z: 4, x0: 6, y0: 6, x1: 9, y1: 7 }; // spans two columns of blocks only by input, anchored in block (0,0)
  const saved = [{ z: 4, x0: 8, y0: 0, x1: 15, y1: 7 }, { z: 5, x0: 0, y0: 0, x1: 7, y1: 7 }, { z: 4, x0: 0, y0: 0, x1: 7, y1: 7 }, { z: 4, x0: 0, y0: 0, x1: 5, y1: 7 }];
  const res = B.reuseCovering([r], saved, [r], 2000);
  assert.deepEqual(res.items, [r]);
  assert.equal(res.reused, 0);
  const r2 = { z: 4, x0: 8, y0: 8, x1: 9, y1: 9 };
  assert.equal(B.reuseCovering([r2], [{ z: 4, x0: 0, y0: 0, x1: 15, y1: 15 }], [r2], 2000).reused, 0);
});

test("reuseCovering respects the tile cap and keeps a shared saved rect once", () => {
  const a = { z: 4, x0: 1, y0: 1, x1: 1, y1: 1 }, b = { z: 4, x0: 3, y0: 3, x1: 3, y1: 3 }, big = { z: 4, x0: 0, y0: 0, x1: 7, y1: 7 };
  const dup = B.reuseCovering([a, b], [big], [a, b], 2000);
  assert.deepEqual(dup.items, [big]);
  assert.equal(dup.reused, 2);
  assert.deepEqual(dup.missing, []);
  const capped = B.reuseCovering([a], [big], [a], 63);
  assert.deepEqual(capped.items, [a]);
  assert.deepEqual(capped.missing, [a]);
  assert.equal(capped.reused, 0);
  assert.equal(B.reuseCovering([a], [big], [a], 64).reused, 1);
});

test("blocksForTiles groups by 8x8 block and crops to the tiles needed", () => {
  const tiles = [];
  for (let x = 4; x <= 11; x++) for (let y = 5; y <= 10; y++) tiles.push({ z: 4, x, y });
  tiles.push({ z: 5, x: 17, y: 12 });
  const r = B.blocksForTiles(tiles);
  assert.deepEqual(r, [
    { z: 4, x0: 4, y0: 5, x1: 7, y1: 7 }, { z: 4, x0: 8, y0: 5, x1: 11, y1: 7 },
    { z: 4, x0: 4, y0: 8, x1: 7, y1: 10 }, { z: 4, x0: 8, y0: 8, x1: 11, y1: 10 },
    { z: 5, x0: 17, y0: 12, x1: 17, y1: 12 }
  ]);
  assert.equal(B.totalTiles(r), 49);
});

test("rect pixels, tile counts and tileRect", () => {
  assert.deepEqual(B.rectPixels({ z: 4, x0: 8, y0: 5, x1: 11, y1: 7 }), [1024, 768]);
  assert.equal(B.rectTiles({ z: 4, x0: 8, y0: 5, x1: 11, y1: 7 }), 12);
  assert.deepEqual(B.tileRect({ z: 3, x: 2, y: 1 }), { z: 3, x0: 2, y0: 1, x1: 2, y1: 1 });
  assert.deepEqual(B.rectPixels(B.tileRect({ z: 3, x: 2, y: 1 })), [256, 256]);
});

test("rectMercator matches tile edges in EPSG:3857 metres", () => {
  const H = Math.PI * 6378137;
  const w = B.rectMercator({ z: 0, x0: 0, y0: 0, x1: 0, y1: 0 });
  near(w.minx, -H); near(w.maxx, H); near(w.miny, -H); near(w.maxy, H);
  const q = B.rectMercator({ z: 1, x0: 1, y0: 0, x1: 1, y1: 0 }); // north-east quarter
  near(q.minx, 0); near(q.maxx, H); near(q.miny, 0); near(q.maxy, H);
});

test("rectLocal of a one-tile rect equals GeoTiles.tileLocal; bigger rects are centred", () => {
  const origin = { x0: 4, y0: 5 };
  const t = { z: 4, x: 6, y: 7 };
  assert.deepEqual(B.rectLocal(B.tileRect(t), origin), T.tileLocal(t, origin));
  assert.deepEqual(B.rectLocal({ z: 4, x0: 4, y0: 5, x1: 7, y1: 7 }, origin), [512, -384]);
  assert.deepEqual(B.levelOrigin([{ z: 4, x0: 8, y0: 5, x1: 11, y1: 7 }, { z: 4, x0: 4, y0: 8, x1: 7, y1: 10 }]), { x0: 4, y0: 5 });
});

test("wrapRect / placedRect / blocksForWrappedTiles", () => {
  assert.deepEqual(B.wrapRect({ z: 3, x0: -2, y0: 1, x1: -1, y1: 2 }), { z: 3, x0: 6, y0: 1, x1: 7, y1: 2, shift: -1 });
  assert.deepEqual(B.placedRect({ z: 3, x0: 6, y0: 1, x1: 7, y1: 2, shift: -1 }), { z: 3, x0: -2, y0: 1, x1: -1, y1: 2 });
  assert.deepEqual(B.placedRect({ z: 3, x0: 6, y0: 1, x1: 7, y1: 2 }), { z: 3, x0: 6, y0: 1, x1: 7, y1: 2 });
  const r = B.blocksForWrappedTiles([{ z: 3, x: 7, y: 2 }, { z: 3, x: 8, y: 2 }]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((q) => [q.shift, q.x0]), [[0, 7], [1, 0]]);
  assert.deepEqual(B.placedRect(r[1]).x0, 8);
});
test("reuseCovering keeps the missing rect's shift", () => {
  const saved = { z: 3, x0: 0, y0: 0, x1: 3, y1: 3 };
  const a = { z: 3, x0: 1, y0: 1, x1: 1, y1: 1, shift: 1 }, b = { z: 3, x0: 1, y0: 1, x1: 1, y1: 1, shift: 0 };
  const one = B.reuseCovering([a], [saved], [a], 100);
  assert.equal(one.items[0].shift, 1); assert.equal(B.rectKey(one.items[0]), B.rectKey(saved));
  const two = B.reuseCovering([a, b], [saved], [a, b], 100);
  assert.equal(two.items.length, 2); assert.equal(two.reused, 2);
  assert.deepEqual(two.items.map((q) => q.shift || 0).sort(), [0, 1]);
});

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

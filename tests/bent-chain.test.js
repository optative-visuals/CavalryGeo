const test = require("node:test");
const assert = require("node:assert/strict");
const RP = require("../src/core/reproject.js");
const GT = require("../src/core/tiles.js");
const GB = require("../src/core/blocks.js");

const D2R = Math.PI / 180;
const MAX_LAT = 85.0511287798;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R / 2));
const W = 1920, H = 1080, N = 41;

// The chain a bent build runs: visible region -> tiles at the current level -> placed (unwrapped)
// blocks, against the filter's per-pixel source point. Every sampled source point must lie
// inside the View mask and inside some placed tile of the current level.
test("bent chain: every filter source point is inside the mask box and a planned tile", () => {
  const failures = [];
  for (const projection of [0, 1, 2]) {
    for (const lon of [0, 170, -179.5]) {
      for (const lat of [0, 45, -70]) {
        for (const zoom of [1.5, 4, 7]) {
          for (const rotation of [0, 40]) {
            const cam = { lat, lon, zoom, rotation, projection };
            const L = GT.currentLevel(zoom, 0, 18), n = Math.pow(2, L);
            const set = GT.bentTileSet([cam], W, H, L, L, RP.visibleRegion);
            if (!set.tiles.length) continue;
            const rects = GB.blocksForWrappedTiles(set.tiles).map(GB.placedRect);
            const v = RP.view(cam, W, H), R = GT.worldScale(zoom);
            for (let i = 0; i < N; i++) {
              for (let j = 0; j < N; j++) {
                const X = -W / 2 + W * i / (N - 1), Y = -H / 2 + H * j / (N - 1);
                const sp = RP.sourcePoint(cam, v, X, Y);
                if (!sp) continue;
                const tag = JSON.stringify(cam) + " @" + X + "," + Y;
                if (Math.abs(sp[0]) > v.w * v.scale / 2 + 2 || Math.abs(sp[1]) > v.h * v.scale / 2 + 2) { failures.push("mask " + tag); continue; }
                const mx = sp[0] / v.scale + v.cx, my = sp[1] / v.scale + v.cy;
                const tx = Math.floor((lon + mx / R / D2R + 180) / 360 * n);
                const ty = Math.max(0, Math.min(n - 1, Math.floor((Math.PI - (my / R + mercY(lat))) / (2 * Math.PI) * n)));
                if (!rects.some((r) => r.z === L && tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1)) failures.push("tile " + tx + "/" + ty + " " + tag);
              }
            }
          }
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

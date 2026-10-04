const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/core/preview.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const VIEW = { lat: 48.86, lon: 2.35, zoom: 4, width: 320, height: 180 };

test("toPx puts the view centre in the middle, and fromPx inverts it", () => {
  const c = P.toPx(VIEW, VIEW.lon, VIEW.lat);
  near(c[0], 160); near(c[1], 90);
  const p = P.fromPx(VIEW, 37, 151);
  const back = P.toPx(VIEW, p.lon, p.lat);
  near(back[0], 37, 1e-6); near(back[1], 151, 1e-6);
  assert.ok(P.toPx(VIEW, VIEW.lon, 60)[1] < 90, "north is up (smaller y)");
});

test("pan moves the map with the mouse", () => {
  const v = P.pan(VIEW, 40, -10);
  const p = P.toPx(v, VIEW.lon, VIEW.lat);
  near(p[0], 200, 1e-6); near(p[1], 80, 1e-6);
  assert.equal(v.zoom, VIEW.zoom);
});

test("pan clamps latitude and wraps longitude", () => {
  const north = P.pan(VIEW, 0, 100000);
  assert.ok(north.lat <= 85.0511287798 + 1e-9);
  const east = P.pan({ ...VIEW, lon: 179 }, -64, 0);
  assert.ok(east.lon >= -180 && east.lon < 180);
});

test("zoomAt keeps the point under the mouse fixed and respects the camera zoom range", () => {
  const anchor = P.fromPx(VIEW, 250, 40);
  const v = P.zoomAt(VIEW, 1, 250, 40, 1920, 1080);
  assert.equal(v.zoom, 5);
  const p = P.toPx(v, anchor.lon, anchor.lat);
  near(p[0], 250, 1e-6); near(p[1], 40, 1e-6);
  const top = P.zoomAt({ ...VIEW, zoom: 30 }, 1, 160, 90, 1920, 1080);
  near(P.frameCamera(top, 1920, 1080).zoom, 18, 1e-9);
  const bottom = P.zoomAt({ ...VIEW, zoom: -30 }, -1, 160, 90, 1920, 1080);
  near(P.frameCamera(bottom, 1920, 1080).zoom, 0, 1e-9);
});

test("frameRect fits the composition's shape inside 60% of the preview", () => {
  const wide = P.frameRect(VIEW, 1920, 1080); // 16:9 in a 16:9 preview → limited by both equally
  near(wide.w, 192); near(wide.h, 108); near(wide.x, 64); near(wide.y, 36);
  const tall = P.frameRect(VIEW, 1080, 1920); // 9:16 → limited by height
  near(tall.h, 108); near(tall.w, 108 * 1080 / 1920); near(tall.x + tall.w / 2, 160); near(tall.y, 36);
});

test("frameCamera: camera zoom = preview zoom + log2(compWidth / frame width); viewForCamera inverts it", () => {
  const cam = P.frameCamera(VIEW, 1920, 1080);
  near(cam.zoom, 4 + Math.log2(1920 / 192));
  assert.equal(cam.lat, VIEW.lat); assert.equal(cam.lon, VIEW.lon);
  const v = P.viewForCamera(cam, 1920, 1080, 320, 180);
  near(v.zoom, 4); near(v.lat, VIEW.lat); near(v.lon, VIEW.lon);
  assert.equal(v.width, 320); assert.equal(v.height, 180);
});

test("cameraRect: a camera equal to the frame draws exactly on the frame", () => {
  const cam = P.frameCamera(VIEW, 1920, 1080);
  const r = P.cameraRect(VIEW, cam, 1920, 1080), f = P.frameRect(VIEW, 1920, 1080);
  near(r.x, f.x, 1e-6); near(r.y, f.y, 1e-6); near(r.w, f.w, 1e-6); near(r.h, f.h, 1e-6);
  const wider = P.cameraRect(VIEW, { ...cam, zoom: cam.zoom - 1 }, 1920, 1080);
  near(wider.w, f.w * 2, 1e-6);
});

test("detailFor picks the level by zoom, one lower while dragging", () => {
  assert.deepEqual([0, 0.9, 1, 2.4, 2.5, 3.9, 4, 5.9, 6, 12].map((z) => P.detailFor(z, false)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([0, 1, 2.5, 4, 6].map((z) => P.detailFor(z, true)), [0, 0, 1, 2, 3]);
  assert.deepEqual(P.LEVELS.map((l) => l.data), ["110m", "110m", "50m", "50m", "50m"]);
  assert.deepEqual(P.LEVELS.map((l) => l.lakes), [false, false, false, false, true]);
  near(P.LEVELS[0].tolerance, 1); near(P.LEVELS[1].tolerance, 1 / 2);
  near(P.LEVELS[2].tolerance, 1 / Math.pow(2, 2.5)); near(P.LEVELS[3].tolerance, 1 / Math.pow(2, 4));
  assert.equal(P.LEVELS[4].tolerance, 0);
});

const square = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const LAYER = { kind: "polygon", features: [
  { name: "Big", rings: [square(0, 40, 10)] },
  { name: "Far", rings: [square(-120, -40, 10)] },
  { name: "Tiny", rings: [square(5, 45, 0.001)] }
] };

test("prepare projects once to world units with a bbox per feature", () => {
  const p = P.prepare(LAYER);
  const big = p.features[0];
  assert.equal(big.name, "Big");
  assert.equal(big.rings[0].length, 10);
  near(big.rings[0][0], P.worldX(0)); near(big.rings[0][1], P.worldY(40));
  near(big.bbox.x0, P.worldX(0)); near(big.bbox.x1, P.worldX(10));
  near(big.bbox.y0, P.worldY(50)); near(big.bbox.y1, P.worldY(40));
});

test("visible skips features out of view and ones under 2 px", () => {
  const p = P.prepare(LAYER);
  const names = P.visible(p, { lat: 45, lon: 5, zoom: 3, width: 320, height: 180 }).map((f) => f.name);
  assert.deepEqual(names, ["Big"]);
});

test("project turns world rings into preview pixels", () => {
  const p = P.prepare(LAYER), v = { lat: 45, lon: 5, zoom: 3, width: 320, height: 180 };
  const px = P.project([p.features[0]], v)[0];
  const first = P.toPx(v, 0, 40);
  near(px[0], first[0], 1e-6); near(px[1], first[1], 1e-6);
});

test("simplify drops points within tolerance and keeps rings closed; collapsed rings go", () => {
  const wiggly = [[0, 0]];
  for (let i = 1; i < 50; i++) wiggly.push([i * 0.2, (i % 2) * 0.0001]);
  wiggly.push([10, 0], [10, 10], [0, 10], [0, 0]);
  const p = P.prepare({ features: [{ name: "W", rings: [wiggly] }, { name: "Dot", rings: [square(1, 1, 0.00001)] }] });
  const s = P.simplify(p, 0.01);
  const r = s.features[0].rings[0];
  assert.ok(r.length / 2 < wiggly.length / 2, "fewer points");
  assert.equal(r[0], r[r.length - 2]); assert.equal(r[1], r[r.length - 1]);
  assert.equal(s.features.length, 1, "a ring that collapses below 4 points is dropped with its feature");
});

test("hitDot finds the nearest place within the radius", () => {
  const places = [{ lat: 48.86, lon: 2.35 }, { lat: 51.5, lon: -0.12 }];
  const london = P.toPx(VIEW, -0.12, 51.5);
  assert.equal(P.hitDot(VIEW, places, london[0] + 3, london[1] - 2, 6), 1);
  assert.equal(P.hitDot(VIEW, places, 5, 5, 6), -1);
});

test("dashes splits a rectangle's outline into dash segments", () => {
  const segs = P.dashes({ x: 0, y: 0, w: 14, h: 7 }, 4, 3);
  assert.ok(segs.length >= 4);
  segs.forEach((s) => assert.ok(Math.hypot(s[2] - s[0], s[3] - s[1]) <= 4 + 1e-9));
  assert.deepEqual(segs[0], [0, 0, 4, 0]);
});

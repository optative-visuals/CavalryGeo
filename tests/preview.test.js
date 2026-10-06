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

test("dragZoom: 100 px up is one zoom level in, down is out, anchored at the press point", () => {
  assert.equal(P.ZOOM_DRAG_PX, 100);
  const up = P.dragZoom(VIEW, 160, 90, 90 - 100, 1920, 1080);
  near(up.zoom, VIEW.zoom + 1, 1e-9);
  const down = P.dragZoom(VIEW, 160, 90, 90 + 50, 1920, 1080);
  near(down.zoom, VIEW.zoom - 0.5, 1e-9);
  const before = P.fromPx(VIEW, 250, 40), after = P.fromPx(P.dragZoom(VIEW, 250, 40, 40 - 100, 1920, 1080), 250, 40);
  near(after.lon, before.lon, 1e-9); near(after.lat, before.lat, 1e-9);
  assert.equal(P.dragZoom(VIEW, 160, 90, 90, 1920, 1080).zoom, VIEW.zoom, "no movement, no zoom");
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
  assert.equal(big.ringBoxes.length, 1);
  assert.deepEqual(big.ringBoxes[0], big.bbox);
});

const TWO_RINGS = { features: [{ name: "Split", rings: [square(0, 40, 10), square(-120, -40, 10), square(5, 45, 0.001)] }] };

test("prepare gives each ring its own bbox; the feature bbox covers them all", () => {
  const f = P.prepare(TWO_RINGS).features[0];
  assert.equal(f.ringBoxes.length, 3);
  near(f.ringBoxes[0].x0, P.worldX(0)); near(f.ringBoxes[0].x1, P.worldX(10));
  near(f.ringBoxes[1].x0, P.worldX(-120)); near(f.ringBoxes[1].y1, P.worldY(-40));
  near(f.bbox.x0, P.worldX(-120)); near(f.bbox.x1, P.worldX(10));
  near(f.bbox.y0, P.worldY(50)); near(f.bbox.y1, P.worldY(-40));
});

test("project skips a feature's rings that are off the view or under 2 px", () => {
  const p = P.prepare(TWO_RINGS), v = { lat: 45, lon: 5, zoom: 3, width: 320, height: 180 };
  assert.equal(P.visible(p, v).length, 1, "the feature itself is on screen");
  const px = P.project(P.visible(p, v), v);
  assert.equal(px.length, 1, "only the in-view ring");
  const first = P.toPx(v, 0, 40);
  near(px[0][0], first[0], 1e-6); near(px[0][1], first[1], 1e-6);
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
  assert.equal(s.features[0].ringBoxes.length, 1);
});

test("simplify keeps the bbox of each surviving ring, in step with the rings", () => {
  const p = P.prepare({ features: [{ name: "M", rings: [square(1, 1, 0.00001), square(0, 40, 10), square(-120, -40, 10)] }] });
  const f = P.simplify(p, 0.01).features[0];
  assert.equal(f.rings.length, 2, "the collapsed ring goes");
  assert.equal(f.ringBoxes.length, 2);
  near(f.ringBoxes[0].x0, P.worldX(0)); near(f.ringBoxes[1].x0, P.worldX(-120));
  assert.deepEqual(f.bbox, p.features[0].bbox);
});

test("hitDot finds the nearest place within the radius", () => {
  const places = [{ lat: 48.86, lon: 2.35 }, { lat: 51.5, lon: -0.12 }];
  const london = P.toPx(VIEW, -0.12, 51.5);
  assert.equal(P.hitDot(VIEW, places, london[0] + 3, london[1] - 2, 6), 1);
  assert.equal(P.hitDot(VIEW, places, 5, 5, 6), -1);
});

test("distinctPlaces drops places within km of one already kept; the picked one is considered first", () => {
  const a = { lat: 48.8566, lon: 2.3522 }, b = { lat: 48.8656, lon: 2.3522 }; // ~1 km apart
  assert.deepEqual(P.distinctPlaces([a, b], 1, 5), [1], "the picked (second) place wins");
  assert.deepEqual(P.distinctPlaces([a, b], 0, 5), [0]);
  assert.deepEqual(P.distinctPlaces([a, b], -1, 5), [0], "no pick: the first is kept");
  const far = { lat: 49.0366, lon: 2.3522 }; // ~20 km north
  assert.deepEqual(P.distinctPlaces([a, far], 1, 5), [0, 1], "20 km apart: both, in original order");
  assert.deepEqual(P.distinctPlaces([a, b, far], -1, 5), [0, 2]);
  assert.deepEqual(P.distinctPlaces([a, b, far], 1, 5), [1, 2]);
  assert.deepEqual(P.distinctPlaces([], 0, 5), []);
  assert.deepEqual(P.distinctPlaces([a], 7, 5), [0], "an out-of-range pick is ignored");
});

test("dashes splits a rectangle's outline into dash segments", () => {
  const segs = P.dashes({ x: 0, y: 0, w: 14, h: 7 }, 4, 3);
  assert.ok(segs.length >= 4);
  segs.forEach((s) => assert.ok(Math.hypot(s[2] - s[0], s[3] - s[1]) <= 4 + 1e-9));
  assert.deepEqual(segs[0], [0, 0, 4, 0]);
});

test("isClick: under 4 px is a click, 4 px or more is a drag", () => {
  assert.equal(P.isClick({ x: 10, y: 10 }, { x: 13, y: 10 }), true);
  assert.equal(P.isClick({ x: 10, y: 10 }, { x: 12, y: 12 }), true);
  assert.equal(P.isClick({ x: 10, y: 10 }, { x: 14, y: 10 }), false);
  assert.equal(P.isClick({ x: 10, y: 10 }, { x: 10, y: 15 }), false);
});

test("legCurve runs from stop to stop and bulges to the same side as the real leg", () => {
  const view = { lat: 0, lon: 0, zoom: 2, width: 320, height: 180 };
  const a = { lon: -40, lat: 0 }, b = { lon: 40, lat: 0 };
  const pts = P.legCurve(view, a, b, { arc: 50, lean: 0, flip: false });
  assert.equal(pts.length, 17);
  const pa = P.toPx(view, a.lon, a.lat), pb = P.toPx(view, b.lon, b.lat);
  assert.ok(Math.abs(pts[0][0] - pa[0]) < 1e-9 && Math.abs(pts[0][1] - pa[1]) < 1e-9);
  assert.ok(Math.abs(pts[16][0] - pb[0]) < 1e-9 && Math.abs(pts[16][1] - pb[1]) < 1e-9);
  // West to east: GeoCurve's normal (90° anticlockwise, y up) points north = up the preview (smaller y).
  assert.ok(pts[8][1] < pa[1] - 10, "bulges up the screen");
  const flipped = P.legCurve(view, a, b, { arc: 50, lean: 0, flip: true });
  assert.ok(flipped[8][1] > pa[1] + 10, "flip bulges down");
  const straight = P.legCurve(view, a, b, { arc: 0 });
  assert.ok(Math.abs(straight[8][1] - pa[1]) < 1e-9, "arc 0 is straight");
});

test("dashPolyline dashes along every segment; dashes() still dashes a rectangle", () => {
  const segs = P.dashPolyline([[0, 0], [10, 0], [10, 10]], 4, 2);
  assert.deepEqual(segs[0], [0, 0, 4, 0]);
  assert.deepEqual(segs[1], [6, 0, 10, 0]);
  assert.ok(segs.some((s) => s[0] === 10 && s[2] === 10), "continues down the second segment");
  assert.equal(P.dashPolyline([[0, 0]], 4, 2).length, 0);
  assert.ok(P.dashes({ x: 0, y: 0, w: 10, h: 10 }, 4, 3).length > 0);
});

test("wrapLon keeps longitudes in -180..180", () => {
  assert.equal(P.wrapLon(190), -170);
  assert.equal(P.wrapLon(-190), 170);
  assert.equal(P.wrapLon(20), 20);
});

test("budget keeps on-screen features, largest first, under the point cap", () => {
  const sq = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
  const layer = (rings) => P.prepare({ features: rings.map((r, i) => ({ name: "f" + i, rings: [r] })) });
  const view = { lat: 0, lon: 0, zoom: 4, width: 320, height: 180 };
  const big = layer([sq(-5, -5, 8)]), small = layer([sq(1, 1, 1), sq(2, 2, 1)]), far = layer([sq(150, 60, 1)]);
  const out = P.budget([{ kind: "fill", color: "#111111", prepared: small }, { kind: "line", color: "#222222", prepared: big }, { kind: "fill", color: "#333333", prepared: far }], view, 10);
  assert.deepEqual(out.map((l) => l.color), ["#111111", "#222222"], "layer order kept; the off-screen layer dropped");
  assert.equal(out[1].features.length, 1, "the big square (5 points) is kept first");
  assert.equal(out[0].features.length, 1, "only one small square (5 points) still fits");
  assert.deepEqual(P.budget([], view, 10), []);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/core/runtime.js");
const C = require("../src/core/codec.js");
const P = require("../src/core/projection.js");

class FakePath {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(["M", x, y]); }
  lineTo(x, y) { this.ops.push(["L", x, y]); }
  close() { this.ops.push(["Z"]); }
  addEllipse(x, y, rx, ry) { this.ops.push(["E", x, y, rx, ry]); }
  addText(t, size, x, y) { this.ops.push(["T", t, size, x, y]); }
}
const cam = (o) => Object.assign({ lat: 0, lon: 0, zoom: 0, rotation: 0, projection: 0 }, o);
const tri = [[0, 0], [10, 0], [10, 10], [0, 0]];

test("Q matches the codec", () => assert.equal(R.Q, C.Q));

test("polygon: move, lines, close", () => {
  const enc = C.encodeLayer({ kind: "polygon", features: [{ name: "a", rank: 1, rings: [tri] }] });
  const p = R.buildPath(enc, cam({}), 100, {}, FakePath);
  assert.deepEqual(p.ops.map((o) => o[0]), ["M", "L", "L", "L", "Z"]);
});

test("line: no close", () => {
  const enc = C.encodeLayer({ kind: "line", features: [{ name: "a", rank: 1, rings: [[[0, 0], [5, 5]]] }] });
  assert.deepEqual(R.buildPath(enc, cam({}), 100, {}, FakePath).ops.map((o) => o[0]), ["M", "L"]);
});

test("detail draws the most important share of features", () => {
  const features = [1, 2, 3, 4].map((rank) => ({ name: "f" + rank, rank, rings: [[[rank, 0], [rank, 1]]] }));
  const enc = C.encodeLayer({ kind: "line", features });
  const moves = (d) => R.buildPath(enc, cam({}), d, {}, FakePath).ops.filter((o) => o[0] === "M");
  assert.equal(moves(100).length, 4);
  assert.equal(moves(50).length, 2);
  assert.equal(moves(0).length, 0);
  const x4 = R.buildPath(C.encodeLayer({ kind: "line", features: [features[3]] }), cam({}), 100, {}, FakePath).ops[0][1];
  assert.equal(moves(25)[0][1], x4); // the rank-4 feature survives
});

test("point: ellipse with radius times ellipseScale", () => {
  const enc = C.encodeLayer({ kind: "point", features: [{ name: "p", rank: 1, rings: [[[0, 0]]] }] });
  assert.deepEqual(R.buildPath(enc, cam({}), 100, { pointRadius: 6, ellipseScale: 2 }, FakePath).ops, [["E", 0, 0, 12, 12]]);
});

test("text: addText with the feature name, size = pointRadius", () => {
  const enc = C.encodeLayer({ kind: "text", features: [{ name: "Paris", rank: 1, rings: [[[0, 0]]] }] });
  assert.deepEqual(R.buildPath(enc, cam({}), 100, { pointRadius: 24 }, FakePath).ops, [["T", "Paris", 24, 0, 0]]);
});

test("orthographic: a feature entirely on the far side is skipped", () => {
  const enc = C.encodeLayer({ kind: "polygon", features: [{ name: "far", rank: 1, rings: [[[170, 0], [175, 0], [175, 5], [170, 0]]] }] });
  assert.equal(R.buildPath(enc, cam({ projection: 2 }), 100, {}, FakePath).ops.length, 0);
});

test("projectPoint uses the camera", () => {
  const p = R.projectPoint(180, 0, cam({}));
  assert.ok(Math.abs(p[0] - 128) < 1e-6);
});

test("point: an explicit pointRadius of 0 draws a zero-size dot, not the default", () => {
  const enc = C.encodeLayer({ kind: "point", features: [{ name: "p", rank: 1, rings: [[[0, 0]]] }] });
  assert.deepEqual(R.buildPath(enc, cam({}), 100, { pointRadius: 0, ellipseScale: 1 }, FakePath).ops, [["E", 0, 0, 0, 0]]);
  assert.deepEqual(R.buildPath(enc, cam({}), 100, {}, FakePath).ops, [["E", 0, 0, 4, 4]]);
});

test("pointVisible: false only on the far side of an orthographic globe", () => {
  assert.equal(R.pointVisible(0, 0, cam({ projection: 2 })), true);
  assert.equal(R.pointVisible(170, 10, cam({ projection: 2 })), false);
  assert.equal(R.pointVisible(170, 10, cam({ projection: 0 })), true);
});

test("orthographic lines stop at the globe's edge instead of running along it", () => {
  const line = [[80, 0], [85, 0], [95, 0], [100, 0], [110, 0]];
  const enc = C.encodeLayer({ kind: "line", features: [{ name: "l", rank: 1, rings: [line] }] });
  const ops = R.buildPath(enc, cam({ projection: 2 }), 100, {}, FakePath).ops;
  // visible 80, 85, then one step onto the edge (95), nothing further round the back
  assert.deepEqual(ops.map((o) => o[0]), ["M", "L", "L"]);
});

test("orthographic lines that dip behind the globe and return are split into two runs", () => {
  const line = [[80, 0], [95, 0], [100, 0], [95, 1], [80, 1]];
  const enc = C.encodeLayer({ kind: "line", features: [{ name: "l", rank: 1, rings: [line] }] });
  const ops = R.buildPath(enc, cam({ projection: 2 }), 100, {}, FakePath).ops;
  assert.deepEqual(ops.map((o) => o[0]), ["M", "L", "M", "L"]);
});

const routeEnc = (a, b) => C.encodeLayer({ kind: "route", features: [{ name: "r", rank: 1, rings: [[a, b]] }] });
const LONDON = [-0.1276, 51.5072], NEW_YORK = [-74.006, 40.7128];

test("route, flat, lift 0: the path starts and ends exactly on the stops", () => {
  const c = cam({ lat: 45, lon: -40, zoom: 2 });
  const ops = R.buildPath(routeEnc(LONDON, NEW_YORK), c, 100, { lift: 0 }, FakePath).ops;
  assert.equal(ops[0][0], "M");
  assert.ok(ops.slice(1).every((o) => o[0] === "L"));
  const f = P.makeProjector(c), a = [0, 0], b = [0, 0];
  f(LONDON[0], LONDON[1], a); f(NEW_YORK[0], NEW_YORK[1], b);
  const last = ops[ops.length - 1];
  assert.ok(Math.abs(ops[0][1] - a[0]) < 1e-6 && Math.abs(ops[0][2] - a[1]) < 1e-6);
  assert.ok(Math.abs(last[1] - b[0]) < 1e-6 && Math.abs(last[2] - b[1]) < 1e-6);
});

test("route, flat, lift bows the middle towards screen-up by lift/100 * 0.5 * chord", () => {
  const c = cam({ lat: 45, lon: -40, zoom: 2 });
  const flat = R.buildPath(routeEnc(LONDON, NEW_YORK), c, 100, { lift: 0 }, FakePath).ops;
  const lifted = R.buildPath(routeEnc(LONDON, NEW_YORK), c, 100, { lift: 30 }, FakePath).ops;
  const mid = Math.floor(flat.length / 2);
  const L = Math.hypot(flat[flat.length - 1][1] - flat[0][1], flat[flat.length - 1][2] - flat[0][2]);
  const dy = lifted[mid][2] - flat[mid][2], dx = lifted[mid][1] - flat[mid][1];
  assert.ok(dy > 0, "bows upward");
  assert.ok(Math.abs(Math.hypot(dx, dy) - 0.15 * L) < 0.02 * L);
  assert.deepEqual(lifted[0], flat[0]);
});

test("route, flat, vertical chord bows to the left", () => {
  const ops = R.buildPath(routeEnc([0, -10], [0, 10]), cam({ zoom: 2 }), 100, { lift: 50 }, FakePath).ops;
  assert.ok(ops[Math.floor(ops.length / 2)][1] < -1);
});

test("route, flat: Tokyo → Los Angeles runs off the side instead of jumping across", () => {
  const ops = R.buildPath(routeEnc([139.6917, 35.6895], [-118.2437, 34.0522]), cam({ lat: 35, lon: 180, zoom: 2 }), 100, { lift: 0 }, FakePath).ops;
  for (let i = 1; i < ops.length; i++) assert.ok(Math.abs(ops[i][1] - ops[i - 1][1]) < 60, "no jump at step " + i);
  assert.ok(ops[ops.length - 1][1] > ops[0][1]);
});

test("route, globe: a leg entirely behind draws nothing; lifted high enough its middle shows", () => {
  const behind = routeEnc([92, 10], [92, -10]);
  assert.equal(R.buildPath(behind, cam({ projection: 2 }), 100, { lift: 0 }, FakePath).ops.length, 0);
  assert.ok(R.buildPath(behind, cam({ projection: 2 }), 100, { lift: 100 }, FakePath).ops.length > 0);
  assert.equal(R.buildPath(routeEnc([170, 10], [170, -10]), cam({ projection: 2 }), 100, { lift: 30 }, FakePath).ops.length, 0);
});

test("route: identical stops draw nothing; detail 0 draws nothing", () => {
  assert.equal(R.buildPath(routeEnc([2, 48], [2, 48]), cam({}), 100, { lift: 30 }, FakePath).ops.length, 0);
  assert.equal(R.buildPath(routeEnc(LONDON, NEW_YORK), cam({}), 0, { lift: 30 }, FakePath).ops.length, 0);
});

// F1: the flat bow must be computed in unrotated map space and turn rigidly with the
// camera's rotation, instead of flipping sides across a near-vertical chord.
test("route, flat: the bow's offset from the chord midpoint is stable across small camera rotations (F1)", () => {
  const rotations = [-1, -0.1, 0, 0.1, 1];
  const offsets = rotations.map((rotation) => {
    const c = cam({ zoom: 3, rotation: rotation });
    const ops = R.buildPath(routeEnc([2, 50], [2, 40]), c, 100, { lift: 40 }, FakePath).ops;
    const first = ops[0], last = ops[ops.length - 1], mid = ops[Math.floor(ops.length / 2)];
    const chordMidX = (first[1] + last[1]) / 2, chordMidY = (first[2] + last[2]) / 2;
    const dx = mid[1] - chordMidX, dy = mid[2] - chordMidY;
    // Rotate the offset back by -rotation (the same convention as makeProjector's finish).
    const r = -rotation * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
    return { x: dx * cr - dy * sr, y: dx * sr + dy * cr };
  });
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(Math.abs(offsets[i].x - offsets[0].x) < 1e-6, "x mismatch at rotation " + rotations[i]);
    assert.ok(Math.abs(offsets[i].y - offsets[0].y) < 1e-6, "y mismatch at rotation " + rotations[i]); // no sign flip
  }
});

test("route, flat: with rotation 90°, the lifted midpoint equals the rotation-0 midpoint rotated by 90° (F1)", () => {
  const ops0 = R.buildPath(routeEnc([2, 50], [2, 40]), cam({ zoom: 3 }), 100, { lift: 40 }, FakePath).ops;
  const ops90 = R.buildPath(routeEnc([2, 50], [2, 40]), cam({ zoom: 3, rotation: 90 }), 100, { lift: 40 }, FakePath).ops;
  const mid0 = ops0[Math.floor(ops0.length / 2)], mid90 = ops90[Math.floor(ops90.length / 2)];
  const r = 90 * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
  const rx = mid0[1] * cr - mid0[2] * sr, ry = mid0[1] * sr + mid0[2] * cr;
  assert.ok(Math.abs(mid90[1] - rx) < 1e-6);
  assert.ok(Math.abs(mid90[2] - ry) < 1e-6);
});

test("projectNearest on flat maps: a pin across the date line lands on the copy nearest the camera", () => {
  [179.9, 180, -180, -179.9].forEach((camLon) => {
    const near = R.projectNearest(179.5, 0, cam({ lon: camLon }));
    const direct = R.projectPoint(P.nearestLon(179.5, camLon), 0, cam({ lon: camLon }));
    assert.deepEqual(near, direct);
    assert.ok(Math.abs(near[0]) <= 128 + 1e-6, `camera ${camLon}: x ${near[0]} is a whole world away`);
  });
});

test("projectNearest: a pin moves continuously as the camera pans across the date line", () => {
  let prev = null, worst = 0;
  for (let c = 178; c <= 182.0001; c += 0.01) {
    const camLon = ((c + 540) % 360) - 180; // -180 .. 180
    const x = R.projectNearest(179.5, 0, cam({ lon: camLon, zoom: 0 }))[0];
    if (prev !== null) worst = Math.max(worst, Math.abs(x - prev));
    prev = x;
  }
  assert.ok(worst < 1, `largest step ${worst} px is a screen jump`);
});

test("projectNearest on a rotated flat camera matches the projector of the folded longitude", () => {
  const c = cam({ lon: 179.9, lat: 10, zoom: 2, rotation: 30 });
  const expect = [0, 0];
  P.makeProjector(c)(P.nearestLon(-179.5, c.lon), 20, expect);
  const got = R.projectNearest(-179.5, 20, c);
  assert.ok(Math.abs(got[0] - expect[0]) < 1e-9 && Math.abs(got[1] - expect[1]) < 1e-9);
});

test("projectNearest on globe and Equal Earth equals projectPoint", () => {
  [1, 2].forEach((projection) => {
    [[179.5, 10], [-170, -30], [10, 0]].forEach(([lon, lat]) => {
      const c = cam({ lon: 179.9, lat: 5, zoom: 1, projection });
      assert.deepEqual(R.projectNearest(lon, lat, c), R.projectPoint(lon, lat, c));
    });
  });
});

test("buildPath with nearest: a single point across the date line is drawn on the nearest copy", () => {
  const enc = C.encodeLayer({ kind: "point", features: [{ name: "p", rank: 1, rings: [[[179.5, 0]]] }] });
  const ops = R.buildPath(enc, cam({ lon: -179.9 }), 100, { pointRadius: 0, nearest: true }, FakePath).ops;
  assert.ok(Math.abs(ops[0][1]) <= 128 + 1e-6, `x ${ops[0][1]} is a whole world away`);
  const plainOps = R.buildPath(enc, cam({ lon: -179.9 }), 100, { pointRadius: 0 }, FakePath).ops;
  assert.ok(Math.abs(plainOps[0][1]) > 128, "without nearest the point is still drawn on the far copy");
});

test("projectNearest treats a negative projection as Mercator, like makeProjector", () => {
  const c = cam({ lon: 179.9, projection: -1 });
  assert.deepEqual(R.projectNearest(179.5, 10, c), R.projectPoint(P.nearestLon(179.5, 179.9), 10, c));
});

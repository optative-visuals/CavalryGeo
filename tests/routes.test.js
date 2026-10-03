const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/core/routes.js");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);
const LONDON = [-0.1276, 51.5072], NEW_YORK = [-74.006, 40.7128];

test("toVec / toLonLat round trip", () => {
  const ll = G.toLonLat(G.toVec(139.6917, 35.6895));
  near(ll[0], 139.6917); near(ll[1], 35.6895);
});

test("stepsFor: 2 degrees per step, clamped to 16..128", () => {
  assert.equal(G.stepsFor(3.52), 16);
  assert.equal(G.stepsFor(50.09), 26);
  assert.equal(G.stepsFor(152.83), 77);
  assert.equal(G.stepsFor(400), 128);
});

test("greatCircle London → New York: exact ends, peaks further north than both cities", () => {
  const gc = G.greatCircle(LONDON[0], LONDON[1], NEW_YORK[0], NEW_YORK[1]);
  near(gc.angle * 180 / Math.PI, 50.0944, 1e-3);
  assert.equal(gc.points.length, 27);
  assert.equal(gc.ts.length, 27);
  const first = G.toLonLat(gc.points[0]), last = G.toLonLat(gc.points[26]);
  near(first[0], LONDON[0], 1e-9); near(first[1], LONDON[1], 1e-9);
  near(last[0], NEW_YORK[0], 1e-9); near(last[1], NEW_YORK[1], 1e-9);
  const maxLat = Math.max(...gc.points.map((p) => G.toLonLat(p)[1]));
  assert.ok(maxLat > 53.5 && maxLat < 54, "peaks near 53.8°N, got " + maxLat);
  gc.points.forEach((p) => near(Math.hypot(p[0], p[1], p[2]), 1, 1e-12));
});

test("greatCircle: identical stops give no points", () => {
  assert.deepEqual(G.greatCircle(2.35, 48.85, 2.35, 48.85), { angle: 0, points: [], ts: [] });
});

test("greatCircle: antipodal stops go through the north pole", () => {
  const gc = G.greatCircle(0, 0, 180, 0);
  const mid = G.toLonLat(gc.points[Math.floor(gc.points.length / 2)]);
  near(mid[1], 90, 1e-6);
  const last = G.toLonLat(gc.points[gc.points.length - 1]);
  near(Math.abs(last[0]), 180, 1e-6); near(last[1], 0, 1e-6);
});

test("liftFactor: 0 at the ends, peak at the middle, clamped", () => {
  near(G.liftFactor(0, 30), 0);
  near(G.liftFactor(1, 30), 0, 1e-12);
  near(G.liftFactor(0.5, 30), 0.15);
  near(G.liftFactor(0.5, 100), 0.5);
  near(G.liftFactor(0.5, 150), 0.5);
  near(G.liftFactor(0.5, -10), 0);
});

test("unwrapLons keeps each step within 180°", () => {
  assert.deepEqual(G.unwrapLons([170, 179, -179, -170]), [170, 179, 181, 190]);
  assert.deepEqual(G.unwrapLons([-170, 179]), [-170, -181]);
  assert.deepEqual(G.unwrapLons([]), []);
});

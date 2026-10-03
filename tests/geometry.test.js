const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/core/geometry.js");

const near = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

test("ringAreaKm2: 1x1 degree square at the equator", () => {
  near(G.ringAreaKm2(square), 12392, 5);
});

test("ringAreaKm2: winding does not matter", () => {
  near(G.ringAreaKm2(square.slice().reverse()), G.ringAreaKm2(square), 1e-9);
});

test("ringLengthKm: one degree of longitude at the equator", () => {
  near(G.ringLengthKm([[0, 0], [1, 0]]), 111.32, 0.01);
});

test("isClosed", () => {
  assert.equal(G.isClosed(square), true);
  assert.equal(G.isClosed([[0, 0], [1, 0], [1, 1]]), false);
});

test("joinRings: joins fragments, reversing where needed, and drops unclosable pieces", () => {
  const a = [[0, 0], [1, 0], [1, 1]];
  const b = [[0, 0], [0, 1], [1, 1]];
  const stray = [[5, 5], [6, 6]];
  const rings = G.joinRings([a, b, stray]);
  assert.equal(rings.length, 1);
  assert.equal(G.isClosed(rings[0]), true);
  assert.equal(rings[0].length, 5);
});

test("joinRings: an already closed segment passes through", () => {
  assert.deepEqual(G.joinRings([square]), [square]);
});

test("bboxAreaKm2", () => {
  near(G.bboxAreaKm2({ west: 0, east: 1, south: 0, north: 1 }), 12392, 5);
});

test("totalLengthKm: sum of ringLengthKm over all rings", () => {
  const ring1 = [[0, 0], [1, 0]];
  const ring2 = [[0, 0], [1, 0]];
  const expected = G.ringLengthKm(ring1) + G.ringLengthKm(ring2);
  near(G.totalLengthKm([ring1, ring2]), expected, 1e-9);
});

test("totalLengthKm: empty array returns 0", () => {
  assert.equal(G.totalLengthKm([]), 0);
});

test("totalAreaKm2: sum of ringAreaKm2 over all rings", () => {
  const rings = [square, square];
  const expected = G.ringAreaKm2(square) * 2;
  near(G.totalAreaKm2(rings), expected, 1e-9);
});

test("totalAreaKm2: empty array returns 0", () => {
  assert.equal(G.totalAreaKm2([]), 0);
});

test("signedArea: positive for CCW (y-up), negative for CW", () => {
  const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const cw = ccw.slice().reverse();
  assert.ok(G.signedArea(ccw) > 0);
  assert.ok(G.signedArea(cw) < 0);
  near(Math.abs(G.signedArea(ccw)), Math.abs(G.signedArea(cw)), 1e-9);
});

test("orientRing: flips a ring to match the requested winding, leaves a matching ring untouched", () => {
  const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const cw = ccw.slice().reverse();
  assert.deepEqual(G.orientRing(ccw, true), ccw);
  assert.deepEqual(G.orientRing(cw, true), ccw);
  assert.deepEqual(G.orientRing(ccw, false), cw);
  assert.deepEqual(G.orientRing(cw, false), cw);
});

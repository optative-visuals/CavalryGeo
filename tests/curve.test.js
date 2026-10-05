const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core/curve.js");

// Point on the cubic from p0 (handle p0+s) to p1 (handle p1+e) at t.
function at(p0, p1, h, t) {
  const c1 = [p0[0] + h.start[0], p0[1] + h.start[1]], c2 = [p1[0] + h.end[0], p1[1] + h.end[1]], u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k]);
}
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + " vs " + b);

test("zero-length leg: both handles are zero", () => {
  assert.deepEqual(C.handles([5, 5], [5, 5], { arc: 50 }), { start: [0, 0], end: [0, 0] });
});

test("symmetric arc: the middle sits arc% x half the chord to the left of travel", () => {
  const h = C.handles([0, 0], [200, 0], { arc: 40, lean: 0, flip: false });
  const mid = at([0, 0], [200, 0], h, 0.5);
  close(mid[0], 100); close(mid[1], 0.4 * 0.5 * 200);
  close(h.start[0], 200 / 3); close(h.end[0], -200 / 3);
});

test("arc 0 is a straight line", () => {
  const h = C.handles([0, 0], [90, 30], { arc: 0 });
  close(h.start[0], 30); close(h.start[1], 10); close(h.end[0], -30); close(h.end[1], -10);
});

test("flip bows to the other side", () => {
  const a = C.handles([0, 0], [200, 0], { arc: 40 }), b = C.handles([0, 0], [200, 0], { arc: 40, flip: true });
  close(b.start[1], -a.start[1]); close(b.end[1], -a.end[1]);
  assert.ok(at([0, 0], [200, 0], b, 0.5)[1] < 0);
});

test("positive lean moves the middle towards the end stop", () => {
  const h = C.handles([0, 0], [200, 0], { arc: 40, lean: 50 });
  assert.ok(at([0, 0], [200, 0], h, 0.5)[0] > 100);
  const g = C.handles([0, 0], [200, 0], { arc: 40, lean: -50 });
  assert.ok(at([0, 0], [200, 0], g, 0.5)[0] < 100);
});

test("arc and lean are clamped", () => {
  assert.deepEqual(C.handles([0, 0], [200, 0], { arc: 500, lean: 900 }), C.handles([0, 0], [200, 0], { arc: 100, lean: 100 }));
  assert.deepEqual(C.handles([0, 0], [200, 0], { arc: -5, lean: -900 }), C.handles([0, 0], [200, 0], { arc: 0, lean: -100 }));
});

test("the shape scales with the stops (zooming keeps the curve's shape)", () => {
  const a = C.handles([10, 20], [110, 70], { arc: 30, lean: 20 }), b = C.handles([20, 40], [220, 140], { arc: 30, lean: 20 });
  close(b.start[0], 2 * a.start[0]); close(b.start[1], 2 * a.start[1]); close(b.end[0], 2 * a.end[0]); close(b.end[1], 2 * a.end[1]);
});

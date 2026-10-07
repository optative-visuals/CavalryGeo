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

const P = require("../src/core/projection.js");
const cams = [
  [{ lat: 40, lon: 60, zoom: 1.5, rotation: 0, projection: 0 }, { lat: 10, lon: -20, zoom: 2.5, rotation: 30, projection: 0 }],
  [{ lat: 20, lon: 50, zoom: 1.5, rotation: 0, projection: 1 }, { lat: 0, lon: 80, zoom: 2, rotation: -20, projection: 1 }],
  [{ lat: 45, lon: 40, zoom: 1, rotation: 0, projection: 2 }, { lat: 30, lon: 70, zoom: 1.5, rotation: 25, projection: 2 }]
];
const L = [-0.13, 51.51], T = [139.69, 35.68];
function setup(cam, opts, offA = [0, 0], offB = [0, 0]) {
  const proj = P.makeProjector(cam, true), p0 = [0, 0], p1 = [0, 0];
  proj(L[0], L[1], p0); proj(T[0], T[1], p1);
  p0[0] += offA[0]; p0[1] += offA[1]; p1[0] += offB[0]; p1[1] += offB[1];
  const h = C.greatCircleHandles(p0, p1, { cam, aLon: L[0], aLat: L[1], bLon: T[0], bLat: T[1], offA, offB }, opts);
  return { proj, p0, p1, h };
}

test("greatCirclePoint: endpoints and the equator midpoint", () => {
  const a = C.greatCirclePoint(0, 0, 90, 0, 0), m = C.greatCirclePoint(0, 0, 90, 0, 0.5), b = C.greatCirclePoint(0, 0, 90, 0, 1);
  close(a[0], 0, 1e-9); close(b[0], 90, 1e-9); close(m[0], 45, 1e-9); close(m[1], 0, 1e-9);
});

test("greatCircleHandles: the Bézier passes through the projected great-circle points", () => {
  cams.forEach((pair) => pair.forEach((cam) => {
    const { proj, p0, p1, h } = setup(cam, { arc: 0 });
    [1 / 3, 2 / 3].forEach((t) => {
      const g = C.greatCirclePoint(L[0], L[1], T[0], T[1], t), want = [0, 0];
      proj(g[0], g[1], want);
      const got = at(p0, p1, h, t);
      close(got[0], want[0], 1e-6); close(got[1], want[1], 1e-6);
    });
  }));
});

test("greatCircleHandles: arc lifts the middle on Arc's side, flip mirrors, lean makes it uneven", () => {
  const cam = cams[0][0];
  const flat = setup(cam, { arc: 0 }), up = setup(cam, { arc: 50 }), dn = setup(cam, { arc: 50, flip: 1 });
  const dx = flat.p1[0] - flat.p0[0], dy = flat.p1[1] - flat.p0[1], len = Math.hypot(dx, dy);
  const nrm = [-dy / len, dx / len];
  const m0 = at(flat.p0, flat.p1, flat.h, 0.5), m1 = at(up.p0, up.p1, up.h, 0.5), m2 = at(dn.p0, dn.p1, dn.h, 0.5);
  const lift1 = (m1[0] - m0[0]) * nrm[0] + (m1[1] - m0[1]) * nrm[1], lift2 = (m2[0] - m0[0]) * nrm[0] + (m2[1] - m0[1]) * nrm[1];
  assert.ok(Math.abs(lift1 - 0.25 * len) < 0.05 * 0.25 * len, lift1 + " vs " + 0.25 * len);
  close(lift2, -lift1, 1e-6);
  const lean = setup(cam, { arc: 50, lean: 60 });
  const l1 = at(lean.p0, lean.p1, lean.h, 1 / 3), l2 = at(lean.p0, lean.p1, lean.h, 2 / 3), f1 = at(flat.p0, flat.p1, flat.h, 1 / 3), f2 = at(flat.p0, flat.p1, flat.h, 2 / 3);
  const a = (l1[0] - f1[0]) * nrm[0] + (l1[1] - f1[1]) * nrm[1], b = (l2[0] - f2[0]) * nrm[0] + (l2[1] - f2[1]) * nrm[1];
  assert.ok(b > a + 1, "positive lean lifts nearer the end stop more");
  assert.ok(b > 0 && a > 0, "lean keeps lifting both thirds");
  const even = setup(cam, { arc: 50, lean: 0 });
  const e1 = at(even.p0, even.p1, even.h, 1 / 3), e2 = at(even.p0, even.p1, even.h, 2 / 3);
  close((e1[0] - f1[0]) * nrm[0] + (e1[1] - f1[1]) * nrm[1], (e2[0] - f2[0]) * nrm[0] + (e2[1] - f2[1]) * nrm[1], 1e-6);
});

test("greatCircleHandles: drag offsets blend into the thirds", () => {
  const cam = cams[0][0];
  const base = setup(cam, { arc: 0 }), drag = setup(cam, { arc: 0 }, [30, 0], [0, 0]);
  const b = at(base.p0, base.p1, base.h, 1 / 3), d = at(drag.p0, drag.p1, drag.h, 1 / 3);
  close(d[0] - b[0], 20, 1e-6); close(d[1] - b[1], 0, 1e-6);
});

test("greatCircleHandles: a leg across the date line on flat projections falls back to the plain arc; the globe keeps the great circle", () => {
  const TK = [139.69, 35.68], LA = [-118.24, 34.05], opts = { arc: 30, lean: 10, flip: 0 };
  [0, 1].forEach((projection) => {
    const cam = { lat: 20, lon: 0, zoom: 1, rotation: 0, projection }, proj = P.makeProjector(cam, true), p0 = [0, 0], p1 = [0, 0];
    proj(TK[0], TK[1], p0); proj(LA[0], LA[1], p1);
    const h = C.greatCircleHandles(p0, p1, { cam, aLon: TK[0], aLat: TK[1], bLon: LA[0], bLat: LA[1], offA: [0, 0], offB: [0, 0] }, opts);
    assert.deepEqual(h, C.handles(p0, p1, opts), "projection " + projection);
  });
  const cam = { lat: 20, lon: 180, zoom: 1, rotation: 0, projection: 2 }, proj = P.makeProjector(cam, true), p0 = [0, 0], p1 = [0, 0];
  proj(TK[0], TK[1], p0); proj(LA[0], LA[1], p1);
  const g = C.greatCircleHandles(p0, p1, { cam, aLon: TK[0], aLat: TK[1], bLon: LA[0], bLat: LA[1], offA: [0, 0], offB: [0, 0] }, opts);
  assert.notDeepEqual(g, C.handles(p0, p1, opts));
  const NY = [-74, 40.7], SG = [103.8, 1.35];
  [0, 1].forEach((projection) => {
    const cam2 = { lat: 20, lon: 0, zoom: 1, rotation: 0, projection }, pr = P.makeProjector(cam2, true), a = [0, 0], b = [0, 0];
    pr(NY[0], NY[1], a); pr(SG[0], SG[1], b);
    const h = C.greatCircleHandles(a, b, { cam: cam2, aLon: NY[0], aLat: NY[1], bLon: SG[0], bLat: SG[1], offA: [0, 0], offB: [0, 0] }, opts);
    assert.notDeepEqual(h, C.handles(a, b, opts), "NY to Singapore keeps the great circle on projection " + projection);
  });
});

test("greatCircleHandles: identical and antipodal stops fall back to Arc", () => {
  const cam = cams[0][0], opts = { arc: 30, lean: 10, flip: 0 };
  const p0 = [10, 20], p1 = [210, -40];
  const same = C.greatCircleHandles(p0, p1, { cam, aLon: 5, aLat: 5, bLon: 5, bLat: 5, offA: [0, 0], offB: [0, 0] }, opts);
  assert.deepEqual(same, C.handles(p0, p1, opts));
  const anti = C.greatCircleHandles(p0, p1, { cam, aLon: 10, aLat: 20, bLon: -170, bLat: -20, offA: [0, 0], offB: [0, 0] }, opts);
  assert.deepEqual(anti, C.handles(p0, p1, opts));
});

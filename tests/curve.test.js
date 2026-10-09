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

// ---- visibleSpan ----
// The leg as the scene draws it: stops on screen (hidden ones pushed onto the limb), great-circle handles.
function leg(cam, A = L, B = T) {
  const proj = P.makeProjector(cam, false), p0 = [0, 0], p1 = [0, 0];
  proj(A[0], A[1], p0); proj(B[0], B[1], p1);
  const gc = { cam, aLon: A[0], aLat: A[1], bLon: B[0], bLat: B[1], offA: [0, 0], offB: [0, 0] };
  const h = C.greatCircleHandles(p0, p1, gc, { arc: 0 });
  return { p0, p1, h, gc, span: C.visibleSpan(p0, p1, h.start, h.end, gc) };
}
// The point a fraction s along the leg's screen length.
function alongLeg(p0, p1, h, s) {
  const pts = [], cum = [0];
  for (let i = 0; i <= 2000; i++) { pts.push(at(p0, p1, h, i / 2000)); if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  const want = s * cum[2000];
  for (let i = 1; i <= 2000; i++) if (cum[i] >= want) return pts[i];
  return pts[2000];
}
// Where the great circle A -> B leaves the front hemisphere, projected (bisection, independent of visibleSpan).
function limbCrossing(cam, A, B, from, to) {
  const raw = P.makeProjector(cam, true), q = [0, 0];
  const vis = (t) => { const g = C.greatCirclePoint(A[0], A[1], B[0], B[1], t); return raw(g[0], g[1], q); };
  let a = from, b = to;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (vis(m) === vis(a)) a = m; else b = m; }
  const g = C.greatCirclePoint(A[0], A[1], B[0], B[1], (a + b) / 2);
  raw(g[0], g[1], q);
  return q;
}

test("visibleSpan: flat projections show the whole leg", () => {
  [0, 1].forEach((projection) => {
    const cam = { lat: 20, lon: 0, zoom: 1, rotation: 0, projection };
    assert.deepEqual(plainSpan(leg(cam).span), { s0: 0, s1: 1 });
  });
});
function plainSpan(s) { return s && { s0: s.s0, s1: s.s1 }; }

test("visibleSpan: London to Tokyo seen from the west is cut off where it goes round the back", () => {
  const cam = { lat: 0, lon: -30, zoom: 2, rotation: 0, projection: 2 };
  const { p0, p1, h, span } = leg(cam);
  assert.equal(span.s0, 0);
  assert.ok(span.s1 > 0.05 && span.s1 < 0.95, "s1 " + span.s1);
  const want = limbCrossing(cam, L, T, 0, 1), got = alongLeg(p0, p1, h, span.s1);
  assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 6, "off by " + Math.hypot(got[0] - want[0], got[1] - want[1]));
});

test("visibleSpan: seen from the east the leg starts at the limb and ends at Tokyo", () => {
  const cam = { lat: 0, lon: 110, zoom: 2, rotation: 0, projection: 2 };
  const { p0, p1, h, span } = leg(cam);
  assert.equal(span.s1, 1);
  assert.ok(span.s0 > 0.05 && span.s0 < 0.95, "s0 " + span.s0);
  const want = limbCrossing(cam, L, T, 0, 1), got = alongLeg(p0, p1, h, span.s0);
  assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 6, "off by " + Math.hypot(got[0] - want[0], got[1] - want[1]));
});

test("visibleSpan: a leg wholly on the far side is null; wholly in front is the whole leg", () => {
  const far = { lat: -65, lon: -100, zoom: 2, rotation: 0, projection: 2 };
  assert.equal(leg(far).span, null);
  const near = { lat: 45, lon: 60, zoom: 2, rotation: 0, projection: 2 };
  assert.deepEqual(plainSpan(leg(near, [30, 40], [90, 50]).span), { s0: 0, s1: 1 });
});

test("visibleSpan: a long leg with both stops in front is whole", () => {
  const cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 };
  const { span } = leg(cam, [-80, 0], [80, 60]);
  assert.deepEqual(plainSpan(span), { s0: 0, s1: 1 });
});

test("visibleSpan: identical and antipodal stops", () => {
  const cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 };
  assert.deepEqual(plainSpan(C.visibleSpan([0, 0], [10, 0], [0, 0], [0, 0], { cam, aLon: 0, aLat: 0, bLon: 0, bLat: 0 })), { s0: 0, s1: 1 });
  assert.equal(C.visibleSpan([0, 0], [10, 0], [0, 0], [0, 0], { cam, aLon: 170, aLat: 0, bLon: 170, bLat: 0 }), null);
  assert.deepEqual(plainSpan(C.visibleSpan([0, 0], [10, 0], [0, 0], [0, 0], { cam, aLon: 0, aLat: 0, bLon: 180, bLat: 0 })), { s0: 0, s1: 1 });
});

test("visibleSpan: stops dragged off their places (end points offset) still map onto the leg the scene draws", () => {
  const cam = { lat: 0, lon: -30, zoom: 2, rotation: 0, projection: 2 };
  [[[25, -10], [0, 0]], [[0, 0], [-15, 20]], [[30, 15], [-20, -25]]].forEach(([offA, offB]) => {
    const proj = P.makeProjector(cam, false), p0 = [0, 0], p1 = [0, 0];
    proj(L[0], L[1], p0); proj(T[0], T[1], p1);
    p0[0] += offA[0]; p0[1] += offA[1]; p1[0] += offB[0]; p1[1] += offB[1];
    const gc = { cam, aLon: L[0], aLat: L[1], bLon: T[0], bLat: T[1], offA, offB };
    const h = C.greatCircleHandles(p0, p1, gc, { arc: 0 }), span = C.visibleSpan(p0, p1, h.start, h.end, gc);
    assert.equal(span.s0, 0);
    assert.ok(span.s1 > 0.1 && span.s1 < 0.95, "s1 " + span.s1);
    const want = limbCrossing(cam, L, T, 0, 1), got = alongLeg(p0, p1, h, span.s1);
    // The dragged curve is bent towards the dragged ends, so the crossing is only approximate: stay near the limb point.
    assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 40, "off by " + Math.hypot(got[0] - want[0], got[1] - want[1]));
  });
});

test("anyVisible: agrees with visibleSpan", () => {
  [[0, -30], [0, 110], [-65, -100], [45, 60]].forEach(([lat, lon]) => {
    const cam = { lat, lon, zoom: 2, rotation: 0, projection: 2 }, l = leg(cam);
    assert.equal(C.anyVisible(l.gc), l.span !== null);
  });
  assert.equal(C.anyVisible({ cam: { projection: 0, lat: 0, lon: 0, zoom: 1 }, aLon: 0, aLat: 0, bLon: 90, bLat: 0 }), true);
});

test("arcSpan: an Arc-shaped globe leg is cut on the globe's edge, or at the hidden stop when the bow stays inside the disc", () => {
  const NY = [-74, 40.7], BKK = [100.5, 13.75], R = P.worldScale(2);
  let edge = 0, ends = 0;
  [[10, -60], [10, 110], [0, -30], [0, 110], [30, -100]].forEach(([lat, lon]) => [[NY, BKK], [BKK, NY], [L, T]].forEach(([A, B]) => [0, 30, 100].forEach((arc) => [0, 1].forEach((flip) => {
    const cam = { lat, lon, zoom: 2, rotation: 0, projection: 2 }, proj = P.makeProjector(cam, false), raw = P.makeProjector(cam, true), tmp = [0, 0];
    const p0 = [0, 0], p1 = [0, 0];
    proj(A[0], A[1], p0); proj(B[0], B[1], p1);
    const h = C.handles(p0, p1, { arc, flip });
    const gc = { cam, aLon: A[0], aLat: A[1], bLon: B[0], bLat: B[1] };
    const aVis = raw(A[0], A[1], tmp), bVis = raw(B[0], B[1], tmp);
    const span = C.arcSpan(p0, p1, h.start, h.end, gc);
    const tag = [lat, lon, arc, flip, A[0], B[0]].join("/");
    if (aVis === bVis) return;
    if (aVis) {
      assert.equal(span.s0, 0, tag);
      if (span.s1 === 1) { ends++; for (let i = 0; i <= 100; i++) assert.ok(Math.hypot.apply(null, at(p0, p1, h, i / 100)) <= R + 2, tag + " bow inside"); }
      else { edge++; const q = alongLeg(p0, p1, h, span.s1); assert.ok(Math.abs(Math.hypot(q[0], q[1]) - R) < 2, tag + " cut at " + Math.hypot(q[0], q[1])); }
    } else {
      assert.equal(span.s1, 1, tag);
      if (span.s0 === 0) { ends++; }
      else { edge++; const q = alongLeg(p0, p1, h, span.s0); assert.ok(Math.abs(Math.hypot(q[0], q[1]) - R) < 2, tag + " cut at " + Math.hypot(q[0], q[1])); }
    }
    assert.deepEqual(plainSpan(C.legSpan(p0, p1, h.start, h.end, gc, 0)), plainSpan(span));
  }))));
  assert.ok(edge > 10, "edge cuts " + edge);
});

test("arcSpan: both stops in front is whole, both hidden follows visibleSpan, flat maps whole; legSpan picks by shape", () => {
  const cam = { lat: 0, lon: -30, zoom: 2, rotation: 0, projection: 2 }, l = leg(cam, [-60, 10], [20, 30]);
  assert.deepEqual(plainSpan(C.arcSpan(l.p0, l.p1, l.h.start, l.h.end, l.gc)), { s0: 0, s1: 1 });
  const far = { lat: -65, lon: -100, zoom: 2, rotation: 0, projection: 2 }, f = leg(far);
  assert.equal(C.arcSpan(f.p0, f.p1, f.h.start, f.h.end, f.gc), null);
  const flat = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 }, g = leg(flat);
  assert.deepEqual(plainSpan(C.legSpan(g.p0, g.p1, g.h.start, g.h.end, g.gc, 0)), { s0: 0, s1: 1 });
  const w = leg({ lat: 0, lon: -30, zoom: 2, rotation: 0, projection: 2 });
  assert.deepEqual(plainSpan(C.legSpan(w.p0, w.p1, w.h.start, w.h.end, w.gc, 1)), plainSpan(w.span));
});

test("greatCircleHandles: chained longitudes past 180 keep the great circle on flat projections", () => {
  // Tokyo -> Los Angeles the short way: LA's chained longitude is 241.76, past the date line.
  const TK = [139.69, 35.68], LA = [241.76, 34.05], opts = { arc: 30, lean: 10, flip: 0 };
  const cam = { lat: 20, lon: 190, zoom: 1, rotation: 0, projection: 0 }, proj = P.makeProjector(cam, true), p0 = [0, 0], p1 = [0, 0];
  proj(TK[0], TK[1], p0); proj(LA[0], LA[1], p1);
  const g = C.greatCircleHandles(p0, p1, { cam, aLon: TK[0], aLat: TK[1], bLon: LA[0], bLat: LA[1], offA: [0, 0], offB: [0, 0] }, opts);
  assert.notDeepEqual(g, C.handles(p0, p1, opts));
  // The same leg with LA's raw longitude is still the plain arc (its copy is a whole turn away).
  const raw = C.greatCircleHandles(p0, p1, { cam, aLon: TK[0], aLat: TK[1], bLon: -118.24, bLat: LA[1], offA: [0, 0], offB: [0, 0] }, opts);
  assert.deepEqual(raw, C.handles(p0, p1, opts));
});

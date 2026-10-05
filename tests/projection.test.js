const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/core/projection.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);
const cam = (o) => Object.assign({ lat: 0, lon: 0, zoom: 0, rotation: 0, projection: P.MERCATOR }, o);

test("worldScale: the zoom-0 world is 256 px wide", () => {
  near(P.worldScale(0) * 2 * Math.PI, 256);
  near(P.worldScale(1) * 2 * Math.PI, 512);
});

test("mercator: centre at origin, lon 180 at x=128, max lat at y=128", () => {
  const f = P.makeProjector(cam({}));
  const o = [0, 0];
  assert.equal(f(0, 0, o), true);
  near(o[0], 0); near(o[1], 0);
  f(180, 0, o); near(o[0], 128);
  f(0, P.MAX_LAT, o); near(o[1], 128, 1e-4);
});

test("mercator: north is up", () => {
  const f = P.makeProjector(cam({}));
  const o = [0, 0];
  f(0, 10, o);
  assert.ok(o[1] > 0);
});

test("mercator: the camera centre maps to the origin", () => {
  const f = P.makeProjector(cam({ lat: 48.85, lon: 2.35, zoom: 16 }));
  const o = [0, 0];
  f(2.35, 48.85, o); near(o[0], 0); near(o[1], 0);
  f(2.36, 48.85, o); assert.ok(o[0] > 0);
});

test("rotation 90 turns east into north", () => {
  const f = P.makeProjector(cam({ rotation: 90 }));
  const o = [0, 0];
  f(180, 0, o); near(o[0], 0, 1e-9); near(o[1], 128);
});

test("equal earth: known extents", () => {
  const f = P.makeProjector(cam({ projection: P.EQUAL_EARTH }));
  const R = P.worldScale(0);
  const o = [0, 0];
  f(180, 0, o); near(o[0] / R, 2.70663, 1e-4);
  f(0, 90, o); near(o[1] / R, 1.31737, 1e-4);
});

test("orthographic: near side visible, far side hidden and clamped to the horizon", () => {
  const f = P.makeProjector(cam({ projection: P.ORTHOGRAPHIC }));
  const R = P.worldScale(0);
  const o = [0, 0];
  assert.equal(f(0, 0, o), true); near(o[0], 0); near(o[1], 0);
  assert.equal(f(90, 0, o), true); near(o[0], R);
  assert.equal(f(170, 10, o), false); near(Math.hypot(o[0], o[1]), R);
});

test("mercatorViewBounds: zoom 0, 256x256 covers the whole mercator world", () => {
  const b = P.mercatorViewBounds(cam({}), 256, 256);
  near(b.west, -180); near(b.east, 180);
  near(b.north, P.MAX_LAT, 1e-4); near(b.south, -P.MAX_LAT, 1e-4);
});

test("zoomForBounds: inverse of mercatorViewBounds", () => {
  const c = cam({ lat: 48.85, lon: 2.35, zoom: 15.3 });
  const b = P.mercatorViewBounds(c, 1920, 1080);
  near(P.zoomForBounds(b, 1920, 1080), 15.3);
  near(P.zoomForBounds({ west: -180, east: 180, south: -P.MAX_LAT, north: P.MAX_LAT }, 256, 256), 0, 1e-6);
});

test("zoomForBounds: antimeridian-crossing bbox (east < west) does not produce NaN", () => {
  // Fiji-like bbox crossing the antimeridian: west=177, east=-179 (i.e. spans 4deg).
  const b = { west: 177, east: -179, south: -20, north: -15 };
  const z = P.zoomForBounds(b, 1920, 1080);
  assert.ok(Number.isFinite(z), "zoom should be finite for an antimeridian-crossing bbox");
  // Should roughly match the equivalent bbox expressed without wraparound (4deg span).
  const equivalent = P.zoomForBounds({ west: 177, east: 181, south: -20, north: -15 }, 1920, 1080);
  near(z, equivalent, 1e-9);
});

test("mercatorViewBounds: clamps zoom to 0..MAX_ZOOM and clamps lon/lat to valid ranges", () => {
  const huge = P.mercatorViewBounds(cam({ lat: 0, lon: 0, zoom: 40 }), 1920, 1080);
  assert.ok(huge.west >= -180 && huge.east <= 180);
  assert.ok(huge.south >= -P.MAX_LAT && huge.north <= P.MAX_LAT);
  // Should match the bounds you'd get from a camera clamped to MAX_ZOOM.
  const clamped = P.mercatorViewBounds(cam({ lat: 0, lon: 0, zoom: P.MAX_ZOOM }), 1920, 1080);
  near(huge.west, clamped.west, 1e-9);
  near(huge.east, clamped.east, 1e-9);

  const negZoom = P.mercatorViewBounds(cam({ lat: 0, lon: 0, zoom: -5 }), 1920, 1080);
  const zeroZoom = P.mercatorViewBounds(cam({ lat: 0, lon: 0, zoom: 0 }), 1920, 1080);
  near(negZoom.west, zeroZoom.west, 1e-9);
});

test("makeProjector clamps zoom to MAX_ZOOM", () => {
  assert.equal(P.MAX_ZOOM, 22);
  const f31 = P.makeProjector(cam({ lat: 0, lon: 0, zoom: 31 }));
  const f22 = P.makeProjector(cam({ lat: 0, lon: 0, zoom: 22 }));
  const o31 = [0, 0], o22 = [0, 0];
  f31(0.001, 0, o31);
  f22(0.001, 0, o22);
  near(o31[0], o22[0], 1e-9);
  const fNeg = P.makeProjector(cam({ lat: 0, lon: 0, zoom: -3 }));
  const f0 = P.makeProjector(cam({ lat: 0, lon: 0, zoom: 0 }));
  const oNeg = [0, 0], o0 = [0, 0];
  fNeg(0.001, 0, oNeg);
  f0(0.001, 0, o0);
  near(oNeg[0], o0[0], 1e-9);
});

test("projection codes outside 0-2 are clamped", () => {
  const o1 = [0, 0], o2 = [0, 0];
  P.makeProjector(cam({ projection: 7 }))(170, 10, o1);
  const hidden = P.makeProjector(cam({ projection: 2 }))(170, 10, o2);
  assert.deepEqual(o1, o2);
  assert.equal(hidden, false);
  const m = [0, 0], n = [0, 0];
  P.makeProjector(cam({ projection: -3 }))(180, 0, m);
  P.makeProjector(cam({ projection: 0 }))(180, 0, n);
  assert.deepEqual(m, n);
});

test("mercatorViewBoxes: one box normally, two boxes across the date line", () => {
  const normal = P.mercatorViewBoxes(cam({ lat: 48.85, lon: 2.35, zoom: 15 }), 1920, 1080);
  assert.deepEqual(normal, [P.mercatorViewBounds(cam({ lat: 48.85, lon: 2.35, zoom: 15 }), 1920, 1080)]);
  const fiji = P.mercatorViewBoxes(cam({ lat: -17, lon: 179.99, zoom: 12 }), 1920, 1080);
  assert.equal(fiji.length, 2);
  const east = fiji.find((b) => b.east === 180), west = fiji.find((b) => b.west === -180);
  assert.ok(east && west, "one box ends at 180, the other starts at -180");
  assert.ok(east.west > 179 && west.east < -179);
  assert.equal(east.south, west.south);
});

test("makeGlobeProjector3 matches makeProjector on the globe's surface", () => {
  const c = cam({ lat: 20, lon: 118.5, zoom: 2.9, rotation: 15, projection: 2 });
  const f2 = P.makeProjector(c), f3 = P.makeGlobeProjector3(c);
  const D = Math.PI / 180;
  for (const [lon, lat] of [[139.7, 35.7], [100, -10], [-60, 20], [118.5, 20], [10, 80]]) {
    const a = [0, 0], b = [0, 0];
    const va = f2(lon, lat, a);
    const vb = f3(Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D), b);
    assert.equal(vb, va, "visibility for " + lon + "," + lat);
    near(b[0], a[0], 1e-6); near(b[1], a[1], 1e-6);
  }
});

test("makeGlobeProjector3: a raised point behind the globe but outside its disc is visible", () => {
  const f3 = P.makeGlobeProjector3(cam({ projection: 2 }));
  const D = Math.PI / 180, o = [0, 0];
  const X = Math.cos(100 * D), Y = Math.sin(100 * D);
  assert.equal(f3(X, Y, 0, o), false, "on the surface it is hidden");
  near(Math.hypot(o[0], o[1]), P.worldScale(0), 1e-6);
  assert.equal(f3(X * 1.2, Y * 1.2, 0, o), true, "lifted 20% it peeks over the edge");
  near(o[0], Y * 1.2 * P.worldScale(0), 1e-6);
});

test("unproject undoes the projector for all three projections, with rotation", () => {
  const P = require("../src/core/projection.js");
  const cams = [];
  [0, 1, 2].forEach((projection) => [0, 30].forEach((rotation) => [2, 6].forEach((zoom) => cams.push({ lat: 40, lon: 10, zoom, rotation, projection }))));
  cams.forEach((cam) => {
    const project = P.makeProjector(cam), out = [0, 0];
    [[10, 40], [12.5, 41.2], [8, 38.5], [11, 43]].forEach(([lon, lat]) => {
      assert.ok(project(lon, lat, out));
      const back = P.unproject(cam, out[0], out[1]);
      assert.ok(back, JSON.stringify(cam));
      assert.ok(Math.abs(back.lon - lon) < 1e-6 && Math.abs(back.lat - lat) < 1e-6, JSON.stringify({ cam, lon, lat, back }));
    });
  });
});

test("unproject: off the globe's disc and outside Equal Earth give null", () => {
  const P = require("../src/core/projection.js");
  const R = P.worldScale(2);
  assert.equal(P.unproject({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 }, 1.01 * R, 0), null);
  assert.equal(P.unproject({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 1 }, 10 * R, 0), null);
  assert.equal(P.unproject({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 1 }, 1e300, 1e300), null, "a huge y never lands on a finite latitude");
  assert.equal(P.unproject({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 1 }, 0, 1e300), null);
});

test("unproject (Mercator) does not wrap: a stop pinned east of the date line re-projects where it was dropped", () => {
  const P = require("../src/core/projection.js");
  const cam = { lat: 0, lon: 180, zoom: 2, rotation: 0, projection: 0 };
  const project = P.makeProjector(cam), a = [0, 0];
  project(178, 10, a);
  const back = P.unproject(cam, a[0] + 30, a[1]);
  const b = [0, 0];
  project(back.lon, back.lat, b);
  near(b[0], a[0] + 30, 1e-6);
  near(b[1], a[1], 1e-6);
  const east = P.unproject(cam, 20 * Math.PI / 180 * P.worldScale(2), 0);
  near(east.lon, 200, 1e-9);
});

test("unproject (Mercator) clamps the latitude to the map's edge, so it re-projects where it was dropped", () => {
  const P = require("../src/core/projection.js");
  const cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 };
  assert.equal(P.unproject(cam, 0, 1e6 * P.worldScale(2)).lat, P.MAX_LAT);
  assert.equal(P.unproject(cam, 0, -1e6 * P.worldScale(2)).lat, -P.MAX_LAT);
});

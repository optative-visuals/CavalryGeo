const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/core/flyto.js");
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

const london = { lat: 51.5, lon: -0.12, zoom: 10 }, tokyo = { lat: 35.68, lon: 139.69, zoom: 10 };

test("exact start and end, one point per frame", () => {
  const p = F.path(london, tokyo, 10, 1920);
  assert.equal(p.length, 10);
  near(p[0].lat, 51.5); near(p[0].lon, -0.12); near(p[0].zoom, 10);
  near(p[9].lat, 35.68); near(p[9].lon, 139.69); near(p[9].zoom, 10);
  assert.throws(() => F.path(london, tokyo, 1, 1920), /Use at least 2 frames/);
});

test("long flights zoom out, short hops barely do", () => {
  const long = F.path(london, tokyo, 50, 1920);
  assert.ok(Math.min(...long.map((p) => p.zoom)) < 6);
  const hop = F.path({ lat: 48.8566, lon: 2.3522, zoom: 12 }, { lat: 48.86, lon: 2.36, zoom: 12 }, 20, 1920);
  assert.ok(Math.min(...hop.map((p) => p.zoom)) > 11);
});

test("zoom-only flights change zoom steadily", () => {
  const z = F.path({ lat: 10, lon: 20, zoom: 3 }, { lat: 10, lon: 20, zoom: 10 }, 30, 1920);
  for (let i = 1; i < z.length; i++) assert.ok(z[i].zoom >= z[i - 1].zoom - 1e-9);
  near(z[15].lat, 10, 1e-6); near(z[15].lon, 20, 1e-6);
});

test("crosses the date line the short way", () => {
  const p = F.path({ lat: 35.68, lon: 139.69, zoom: 4 }, { lat: 34.05, lon: -118.24, zoom: 4 }, 31, 1920);
  assert.ok(Math.abs(p[15].lon) > 150, `mid lon ${p[15].lon}`);
  assert.ok(p.every((q) => q.lon >= -180 && q.lon <= 180));
});

// F8: a start longitude far outside [-180, 180] (e.g. accumulated from repeated flights)
// must be wrapped before computing the flight path, or the "shortest way" date-line
// logic sees a huge bogus delta and the flight zooms out far more than it should.
test("start longitude far outside +/-180 is wrapped before the path is computed (F8)", () => {
  const p = F.path({ lat: 0, lon: 730, zoom: 5 }, { lat: 0, lon: 20, zoom: 5 }, 20, 1920);
  near(p[0].lon, 730, 1e-9); // out[0] is forced to the given start, unchanged
  const minZoom = Math.min(...p.map((q) => q.zoom));
  assert.ok(minZoom > 4.5, `expected barely any zoom-out for a short hop, got min zoom ${minZoom}`);
});

test("ease in and out", () => {
  near(F.ease(0), 0); near(F.ease(1), 1); near(F.ease(0.5), 0.5);
  const p = F.path(london, { lat: 51.5, lon: 10, zoom: 10 }, 100, 1920);
  assert.ok(Math.abs(p[1].lon - p[0].lon) < Math.abs(p[50].lon - p[49].lon));
});

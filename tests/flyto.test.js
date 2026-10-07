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

const paris = { lat: 48.8566, lon: 2.3522, zoom: 10 }, tokyo10 = { lat: 35.68, lon: 139.69, zoom: 10 };

test("easing and zoom-out tables are exact", () => {
  assert.deepEqual(F.EASINGS, [
    { id: "smooth", name: "Smooth" }, { id: "gentle", name: "Gentle" },
    { id: "snappy", name: "Snappy" }, { id: "overshoot", name: "Overshoot" }]);
  assert.deepEqual(F.ARCS, [
    { id: "low", name: "Low", rho: 1.0 }, { id: "normal", name: "Normal", rho: Math.SQRT2 },
    { id: "high", name: "High", rho: 2.0 }]);
  assert.deepEqual(F.DRIFTS, [
    { id: "in", name: "Push in" }, { id: "out", name: "Pull out" }, { id: "left", name: "Pan left" },
    { id: "right", name: "Pan right" }, { id: "up", name: "Pan up" }, { id: "down", name: "Pan down" }]);
});

test("easing functions: endpoints, monotonic, smooth equals ease", () => {
  F.EASINGS.forEach((e) => { const f = F.easing(e.id); near(f(0), 0); near(f(1), 1); });
  ["smooth", "gentle", "snappy"].forEach((id) => {
    const f = F.easing(id);
    for (let i = 1; i <= 100; i++) assert.ok(f(i / 100) >= f((i - 1) / 100) - 1e-12, `${id} at ${i}`);
  });
  for (let i = 0; i <= 20; i++) assert.equal(F.easing("smooth")(i / 20), F.ease(i / 20));
  near(F.easing("gentle")(0.25), 0.5 - Math.cos(Math.PI * 0.25) / 2);
  near(F.easing("snappy")(0.25), 16 * Math.pow(0.25, 5));
  near(F.easing("snappy")(0.75), 1 - Math.pow(-1.5 + 2, 5) / 2);
});

test("default options reproduce the plain path", () => {
  assert.deepEqual(F.path(paris, tokyo10, 120, 1920), F.path(paris, tokyo10, 120, 1920, { easing: "smooth", arc: "normal" }));
});

test("zoom-out arcs: High < Normal < Low minimum zoom", () => {
  const m = (arc) => Math.min(...F.path(paris, tokyo10, 120, 1920, { arc }).map((p) => p.zoom));
  assert.ok(m("high") < m("normal"), `${m("high")} ${m("normal")}`);
  assert.ok(m("normal") < m("low"), `${m("normal")} ${m("low")}`);
});

test("overshoot: two phases, position lands first, zoom settles", () => {
  const p = F.path(paris, tokyo10, 101, 1920, { easing: "overshoot" });
  assert.equal(p.length, 101);
  near(p[0].lat, paris.lat); near(p[0].lon, paris.lon); near(p[0].zoom, 10);
  near(p[100].lat, tokyo10.lat); near(p[100].lon, tokyo10.lon); near(p[100].zoom, 10);
  near(p[85].lat, tokyo10.lat); near(p[85].lon, tokyo10.lon); near(p[85].zoom, 10.3);
  for (let k = 86; k <= 100; k++) {
    near(p[k].lat, tokyo10.lat); near(p[k].lon, tokyo10.lon);
    assert.ok(p[k].zoom < p[k - 1].zoom, `zoom falls at ${k}`);
  }
  const c = F.path(paris, { lat: 35.68, lon: 139.69, zoom: 21.9 }, 101, 1920, { easing: "overshoot" });
  near(c[85].zoom, 22); near(c[100].zoom, 21.9);
  assert.ok(Math.max(...c.map((q) => q.zoom)) <= 22 + 1e-12);
});

test("snappy differs from smooth mid-flight", () => {
  const a = F.path(paris, tokyo10, 101, 1920, { easing: "snappy" }), b = F.path(paris, tokyo10, 101, 1920);
  assert.ok(Math.abs(a[25].zoom - b[25].zoom) > 1e-6);
});

const MPX = (zoom) => 256 * Math.pow(2, zoom) / (2 * Math.PI); // pixels per radian at a zoom
const D2R = Math.PI / 180, merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));

test("driftEnd: six moves", () => {
  const s = { lat: 48.85, lon: 2.35, zoom: 10 };
  near(F.driftEnd(s, "in", 1920, 1080).zoom, 10.15); near(F.driftEnd(s, "out", 1920, 1080).zoom, 9.85);
  near(F.driftEnd({ lat: 0, lon: 0, zoom: 0 }, "out", 1920, 1080).zoom, 0);
  near(F.driftEnd({ lat: 0, lon: 0, zoom: 22 }, "in", 1920, 1080).zoom, 22);
  const L = F.driftEnd(s, "left", 1920, 1080), R = F.driftEnd(s, "right", 1920, 1080);
  near(L.lat, s.lat); near(R.lat, s.lat); near(L.zoom, 10); near(R.zoom, 10);
  assert.ok(L.lon < s.lon && R.lon > s.lon);
  near(s.lon - L.lon, R.lon - s.lon);
  assert.ok(Math.abs(Math.abs(R.lon - s.lon) * D2R * MPX(10) - 0.05 * 1920) < 0.5);
  const U = F.driftEnd(s, "up", 1920, 1080), Dn = F.driftEnd(s, "down", 1920, 1080);
  near(U.lon, s.lon); near(Dn.lon, s.lon);
  assert.ok(U.lat > s.lat && Dn.lat < s.lat);
  assert.ok(Math.abs((merc(U.lat) - merc(s.lat)) * MPX(10) - 0.05 * 1080) < 0.5);
  assert.ok(Math.abs((merc(s.lat) - merc(Dn.lat)) * MPX(10) - 0.05 * 1080) < 0.5);
});

test("driftPath: endpoints, gentle easing, short way round", () => {
  const a = { lat: 10, lon: 20, zoom: 5 }, b = { lat: 14, lon: 28, zoom: 6 };
  const p = F.driftPath(a, b, 5);
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], a); assert.deepEqual(p[4], b);
  near(p[2].lat, 12); near(p[2].lon, 24); near(p[2].zoom, 5.5);
  const g = 0.5 - Math.cos(Math.PI * 0.25) / 2;
  near(p[1].lat, 10 + 4 * g); near(p[1].lon, 20 + 8 * g); near(p[1].zoom, 5 + g);
  const d = F.driftPath({ lat: 0, lon: 179.99, zoom: 4 }, { lat: 0, lon: -179.99, zoom: 4 }, 5);
  assert.ok(d.every((q) => Math.abs(q.lon) > 179.98), JSON.stringify(d));
});

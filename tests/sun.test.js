const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core/sun.js");

function FakePath() { this.cmds = []; }
["moveTo", "lineTo", "close", "addText", "addEllipse"].forEach((m) => { FakePath.prototype[m] = function () { this.cmds.push([m, ...arguments]); }; });
const cav = { Path: FakePath };
const D2R = Math.PI / 180;
function dist(lon1, lat1, lon2, lat2) {
  const c = Math.sin(lat1 * D2R) * Math.sin(lat2 * D2R) + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon1 - lon2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}
const wrap = (l) => ((l + 540) % 360) - 180;

test("dayOfYear on a non-leap calendar", () => {
  assert.equal(S.dayOfYear(1, 1), 1);
  assert.equal(S.dayOfYear(21, 6), 172);
  assert.equal(S.dayOfYear(31, 12), 365);
  assert.equal(S.dayOfYear(29, 2), 60);
  assert.equal(S.dayOfYear(31, 2), 60);
  assert.equal(S.dayOfYear(31, 4), 120);
});

test("subsolar point", () => {
  const a = S.subsolar(172, 12);
  assert.ok(Math.abs(a.lat - 23.44) < 0.5);
  assert.ok(Math.abs(wrap(a.lon)) < 2);
  const b = S.subsolar(355, 0);
  assert.ok(Math.abs(b.lat + 23.44) < 0.5);
  assert.ok(Math.abs(Math.abs(b.lon) - 180) < 2);
  assert.ok(Math.abs(S.subsolar(80, 12).lat) < 1);
});

test("night ring points sit on the terminator circle", () => {
  [[172, 12], [355, 3], [80, 12], [30, 20.5], [172, 0]].forEach(([d, t]) => {
    [0, 6, 12, 18].forEach((a) => {
      const s = S.subsolar(d, t), alat = -s.lat, alon = s.lon + 180;
      S.nightRing(d, t, a).forEach((p) => {
        if (Math.abs(p[1]) === 90) return;
        assert.ok(Math.abs(dist(p[0], p[1], alon, alat) - (90 - a)) < 0.5, d + " " + t + " " + a + " " + p);
      });
    });
  });
});

test("solstice night cap holds the South Pole, not the North", () => {
  const ring = S.nightRing(172, 12, 0);
  assert.ok(ring.some((p) => p[1] === -90));
  assert.ok(!ring.some((p) => p[1] === 90));
  const lons = ring.map((p) => p[0]);
  assert.equal(Math.min.apply(null, lons), -180);
  assert.equal(Math.max.apply(null, lons), 180);
  const w = S.nightRing(355, 12, 0);
  assert.ok(w.some((p) => p[1] === 90));
});

test("equinox ring is a near-meridian band, continuous in longitude", () => {
  const ring = S.nightRing(80, 12, 6);
  const lons = ring.map((p) => p[0]);
  for (let i = 1; i < lons.length; i++) assert.ok(Math.abs(lons[i] - lons[i - 1]) < 20);
  const lats = ring.map((p) => p[1]);
  assert.ok(Math.max.apply(null, lats) > 80 && Math.min.apply(null, lats) < -80);
  assert.ok(Math.max.apply(null, lons) - Math.min.apply(null, lons) < 175);
});

test("a cap straddling the antimeridian keeps continuous longitudes", () => {
  // subsolar lon 0 at noon -> antisolar at 180: ring runs past +-180
  const ring = S.nightRing(80, 12, 6);
  const lons = ring.map((p) => p[0]);
  assert.ok(Math.max.apply(null, lons) > 180 || Math.min.apply(null, lons) < -180);
});

test("nightPath draws on a flat map, with a copy wrapped past the edge", () => {
  const cam = { lat: 0, lon: 0, zoom: 1, rotation: 0, projection: 0 };
  const p = S.nightPath(cam, 80, 12, 6, cav);
  const closes = p.cmds.filter((c) => c[0] === "close").length;
  assert.equal(closes, 2);
  const g = S.nightPath({ lat: 0, lon: 180, zoom: 1, rotation: 0, projection: 2 }, 80, 12, 6, cav);
  assert.equal(g.cmds.filter((c) => c[0] === "close").length, 1);
  const q = S.nightPath(cam, 172, 12, 0, cav);
  assert.equal(q.cmds.filter((c) => c[0] === "close").length, 1);
});

test("stepOpacity", () => {
  const soft = S.stepOpacity(55, 1, 0);
  for (let k = 0; k < 4; k++) assert.equal(S.stepOpacity(55, 1, k), soft);
  assert.ok(Math.abs(1 - Math.pow(1 - soft / 100, 4) - 0.55) < 1e-9);
  assert.deepEqual([0, 1, 2, 3].map((k) => S.stepOpacity(55, 0, k)), [55, 0, 0, 0]);
});

test("timeText", () => {
  assert.equal(S.timeText(172, 14.5), "21 Jun · 14:30 UTC");
  assert.equal(S.timeText(1, 24), "1 Jan · 00:00 UTC");
  assert.equal(S.timeText(172, 14.999), "21 Jun · 14:59 UTC");
});

test("timeLabel writes the text at the corner", () => {
  const p = S.timeLabel({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0, dayOfYear: 172, utcTime: 14.5, compW: 1920, compH: 1080, corner: 0, margin: 40, size: 18 }, cav);
  const t = p.cmds.filter((c) => c[0] === "addText");
  assert.equal(t.length, 1);
  assert.equal(t[0][1], "21 Jun · 14:30 UTC");
  assert.equal(t[0][4] > 0, true);
});

test("nightPath covers cam.lon +- 180 on flat maps wherever the camera looks", () => {
  const lonsOf = (p) => p.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => c[1]);
  const P = require("../src/core/projection.js");
  // pole-containing cap, camera at 180: the 180..360 half must be drawn too
  const cam = { lat: 0, lon: 180, zoom: 1, rotation: 0, projection: 0 };
  const proj = P.makeProjector(cam), out = [0, 0];
  proj(180, 0, out); const x180 = out[0]; proj(360, 0, out); const x360 = out[0];
  const xs = lonsOf(S.nightPath(cam, 172, 12, 0, cav));
  assert.ok(xs.some((x) => x > x180 + 1e-6 && x <= x360 + 1e-6), "points in 180..360");
  assert.ok(xs.some((x) => x < x180 - 1e-6), "and the original half");
  // day 80 20:00, ring -156..36, camera 170: 180..260 covered by the +360 copy
  const cam2 = { lat: 0, lon: 170, zoom: 1, rotation: 0, projection: 0 };
  const p2 = P.makeProjector(cam2);
  p2(180, 0, out); const a = out[0]; p2(260, 0, out); const b = out[0];
  const xs2 = lonsOf(S.nightPath(cam2, 80, 20, 0, cav));
  assert.ok(xs2.some((x) => x > a && x < b), "points in 180..260");
  // a camera-centred pole cap needs just one ring
  assert.equal(S.nightPath({ lat: 0, lon: 0, zoom: 1, rotation: 0, projection: 0 }, 172, 12, 0, cav).cmds.filter((c) => c[0] === "close").length, 1);
});

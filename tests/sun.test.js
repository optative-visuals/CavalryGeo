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


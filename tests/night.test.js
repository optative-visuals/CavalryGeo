const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../src/core/night.js");
const S = require("../src/core/sun.js");
const P = require("../src/core/projection.js");

const D2R = Math.PI / 180;
// True when two longitudes (or any angles in degrees) agree modulo 360.
function nearDeg(a, b, tol) { return Math.abs((((a - b) % 360) + 540) % 360 - 180) < tol; }
function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)); }

test("curve, twilight 1: 0 at the sun line, about 0.69 at 6 degrees, 1 from 18 degrees", () => {
  const f = (d) => N.curve(d, 1, 0.01);
  assert.equal(f(0), 0);
  assert.ok(Math.abs(f(6) - 0.69) < 0.01);
  assert.ok(Math.abs(f(12) - 0.92) < 0.01);
  assert.equal(f(18), 1);
  assert.equal(f(40), 1);
  assert.equal(f(-5), 0);
  for (let d = 0; d < 18; d += 0.5) assert.ok(f(d + 0.5) >= f(d), "monotonic at " + d);
});

test("curve, twilight 0.5: band is 9 degrees, same shape squeezed", () => {
  assert.equal(N.curve(9, 0.5, 0.01), 1);
  assert.ok(Math.abs(N.curve(3, 0.5, 0.01) - N.curve(6, 1, 0.01)) < 1e-9);
});

test("curve, twilight 0: hard edge smoothed over one pixel", () => {
  assert.equal(N.curve(-0.1, 0, 0.1), 0);
  assert.equal(N.curve(0.1, 0, 0.1), 1);
  const mid = N.curve(0, 0, 0.1);
  assert.ok(mid > 0 && mid < 1, "mid value " + mid);
});

test("depression is 0 on the terminator and 6 on the 6-degree ring", () => {
  for (const [doy, utc] of [[1, 0], [80, 12], [172, 6.5], [355, 23.75]]) {
    for (const depth of [0, 6]) {
      for (const [lon, lat] of S.nightRing(doy, utc, depth)) {
        if (Math.abs(lat) === 90) continue;
        const d = N.depression(lat, lon, doy, utc);
        assert.ok(Math.abs(d - depth) < 1e-6, doy + " " + utc + " depth " + depth + " at " + lon + "," + lat + " gave " + d);
      }
    }
  }
});

test("unproject round trip against makeProjector (visible points only)", () => {
  const grid = [];
  for (let lat = -80; lat <= 80; lat += 20) for (let lon = -170; lon <= 170; lon += 20) grid.push([lon, lat]);
  let checked = 0;
  for (const projection of [0, 1, 2]) for (const rotation of [0, 33, 90])
    for (const zoom of projection === 2 ? [0, 3] : [0, 3, 20])
      for (const lat of [-60, 0, 45]) for (const lon of [-179, 0, 170]) {
        const cam = { lat, lon, zoom, rotation, projection };
        const R = P.worldScale(zoom);
        const project = P.makeProjector(cam);
        const out = [0, 0];
        const tag = JSON.stringify(cam);
        for (const [glon, glat] of grid) {
          if (!project(glon, glat, out)) continue;
          if (projection === 2 && Math.hypot(out[0], out[1]) > 0.99 * R) continue;
          const ll = N.unproject(cam, out[0], out[1]);
          assert.ok(ll, "null at " + glon + "," + glat + " " + tag);
          assert.ok(Math.abs(ll.lat - glat) < 1e-6, "lat " + ll.lat + " vs " + glat + " " + tag);
          assert.ok(nearDeg(ll.lon, glon, 1e-6), "lon " + ll.lon + " vs " + glon + " " + tag);
          checked++;
        }
      }
  assert.ok(checked > 5000, "checked " + checked);
});

test("unproject: edge is 1 well inside the Earth", () => {
  for (const projection of [0, 1, 2]) {
    const cam = { lat: 10, lon: 20, zoom: 2, rotation: 0, projection };
    const project = P.makeProjector(cam);
    const out = [0, 0];
    for (const [lon, lat] of [[20, 10], [-40, 5], [60, -15]]) {
      if (!project(lon, lat, out)) continue;
      assert.equal(N.unproject(cam, out[0], out[1]).edge, 1, "projection " + projection + " " + lon + "," + lat);
    }
  }
});

test("unproject: globe, points beyond the disc are off the Earth", () => {
  const cam = { lat: 0, lon: 0, zoom: 3, rotation: 0, projection: 2 };
  const R = P.worldScale(3);
  assert.equal(N.unproject(cam, 1.01 * R, 0), null);
  assert.equal(N.unproject(cam, 0, -1.01 * R), null);
  assert.notEqual(N.unproject(cam, 0.99 * R, 0), null);
});

test("unproject: Equal Earth, a point beyond the +180 edge is off the Earth", () => {
  const cam = { lat: 0, lon: 0, zoom: 0, rotation: 0, projection: 1 };
  const out = [0, 0];
  P.makeProjector(cam)(190, 0, out);
  assert.equal(N.unproject(cam, out[0], out[1]), null);
  P.makeProjector(cam)(170, 0, out);
  assert.notEqual(N.unproject(cam, out[0], out[1]), null);
});

test("unproject: flat, above MAX_LAT is off the map, but the far side of the date line is not", () => {
  const cam = { lat: 30, lon: 10, zoom: 2, rotation: 0, projection: 0 };
  const R = P.worldScale(2);
  const above = (Math.PI + 0.01 - mercY(30)) * R;
  const below = (Math.PI - 0.01 - mercY(30)) * R;
  assert.equal(N.unproject(cam, 0, above), null);
  const top = N.unproject(cam, 0, below);
  assert.ok(top && top.lat > 84.9 && top.lat < P.MAX_LAT, "top lat " + (top && top.lat));

  const far = { lat: 0, lon: 10, zoom: 1, rotation: 0, projection: 0 };
  const out = [0, 0];
  P.makeProjector(far)(310, 0, out);
  const ll = N.unproject(far, out[0], out[1]);
  assert.ok(ll, "sideways point is off the Earth");
  assert.ok(nearDeg(ll.lon, 310, 1e-6), "sideways lon " + ll.lon);
});

test("alphaAt: deep in the night is the night opacity, lights add up to full", () => {
  const cam = { lat: -23.44, lon: 180, zoom: 2, rotation: 0, projection: 0 };
  const base = { dayOfYear: 172, utcTime: 12, nightOpacity: 55, twilight: 1, lights: 0 };
  assert.ok(Math.abs(N.alphaAt(cam, 0, 0, base) - 0.55) < 1e-9);
  assert.ok(Math.abs(N.alphaAt(cam, 0, 0, Object.assign({}, base, { lights: 100 })) - 1) < 1e-9);
});

test("alphaAt: day side is see-through", () => {
  const cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 };
  const inp = { dayOfYear: 172, utcTime: 12, nightOpacity: 55, twilight: 1, lights: 100 };
  assert.equal(N.alphaAt(cam, 0, 0, inp), 0);
});

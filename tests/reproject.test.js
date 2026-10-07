const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/core/projection.js");
const RP = require("../src/core/reproject.js");

const D2R = Math.PI / 180;
const clampLat = (lat) => Math.max(-P.MAX_LAT, Math.min(P.MAX_LAT, lat));
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + clampLat(lat) * D2R / 2));
const wrap = (d) => d - 360 * Math.floor((d + 180) / 360);
const R = (cam) => P.worldScale(Math.max(0, Math.min(P.MAX_ZOOM, cam.zoom)));
const VIEW = { scale: 0.75, cx: 120, cy: -40 };

// The Mercator source position of a lon / lat, as the filter samples it.
function expected(cam, view, lon, lat) {
  const r = R(cam);
  return [(wrap(lon - cam.lon) * D2R * r - view.cx) * view.scale, ((mercY(lat) - mercY(cam.lat)) * r - view.cy) * view.scale];
}

const CAMS = [
  [{ lat: 20, lon: 30, zoom: 3, rotation: 0, projection: 2 }, 1e-6],
  [{ lat: -35, lon: 170, zoom: 4.5, rotation: 25, projection: 2 }, 1e-6],
  [{ lat: 10, lon: -60, zoom: 2.2, rotation: 0, projection: 1 }, 1e-6],
  [{ lat: 51.5, lon: -0.1, zoom: 9, rotation: -15, projection: 0 }, 1e-4]
];

test("sourcePoint mirrors the filter: projected places land on their Mercator source position", () => {
  for (const [cam, eps] of CAMS) {
    const project = P.makeProjector(cam), out = [0, 0];
    let checked = 0;
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const lon = wrap(cam.lon - 40 + i * 10), lat = Math.max(-80, Math.min(80, cam.lat - 30 + j * 7.5));
        if (!project(lon, lat, out)) continue;
        const got = RP.sourcePoint(cam, VIEW, out[0], out[1]), want = expected(cam, VIEW, lon, lat);
        assert.ok(got, "null at " + lon + ", " + lat);
        assert.ok(Math.abs(got[0] - want[0]) < eps && Math.abs(got[1] - want[1]) < eps,
          JSON.stringify(cam) + " " + lon + "," + lat + ": " + got + " vs " + want);
        checked++;
      }
    }
    assert.ok(checked > 40, "too few visible places for " + JSON.stringify(cam));
  }
});

test("sourcePoint across the date line: camera lon 170, place lon -175 is dlon 15", () => {
  const cam = { lat: 0, lon: 170, zoom: 3, rotation: 0, projection: 2 }, out = [0, 0];
  P.makeProjector(cam)(-175, 0, out);
  const got = RP.sourcePoint(cam, VIEW, out[0], out[1]);
  assert.ok(Math.abs(got[0] - (15 * D2R * R(cam) - 120) * 0.75) < 1e-6);
  assert.ok(Math.abs(got[1] - 30) < 1e-6);
});

test("sourcePoint is null off the globe's disc and outside the Equal Earth outline", () => {
  const globe = { lat: 0, lon: 0, zoom: 3, rotation: 0, projection: 2 };
  assert.equal(RP.sourcePoint(globe, VIEW, 1.01 * R(globe), 0), null);
  const ee = { lat: 0, lon: 0, zoom: 3, rotation: 0, projection: 1 };
  assert.equal(RP.sourcePoint(ee, VIEW, 2.8 * R(ee), 0), null);
  assert.equal(RP.sourcePoint(ee, VIEW, 0, 1.4 * R(ee)), null);
});

function cornerPlaces(cam, w, h) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => P.unproject(cam, sx * w / 2, sy * h / 2));
}
function contains(cam, region, place) {
  const d = wrap(place.lon - cam.lon);
  return d >= region.dlon0 && d <= region.dlon1 && place.lat >= region.lat0 && place.lat <= region.lat1;
}

test("visibleRegion: whole globe in frame reaches past ±90° and covers the poles' latitudes", () => {
  const r = RP.visibleRegion({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 }, 1920, 1080);
  assert.ok(r.dlon0 <= -90 && r.dlon1 >= 90, JSON.stringify(r));
  assert.ok(r.lat0 <= -80 && r.lat1 >= 80 && r.lat0 >= -P.MAX_LAT && r.lat1 <= P.MAX_LAT, JSON.stringify(r));
});

test("visibleRegion: a pole in view reaches MAX_LAT and every longitude", () => {
  const r = RP.visibleRegion({ lat: 80, lon: 0, zoom: 2, rotation: 0, projection: 2 }, 1920, 1080);
  assert.equal(r.lat1, P.MAX_LAT);
  assert.equal(r.dlon0, -180);
  assert.equal(r.dlon1, 180);
});

test("visibleRegion: a zoomed-in globe gives a small span containing the frame's corners", () => {
  const cam = { lat: 40, lon: 10, zoom: 8, rotation: 0, projection: 2 };
  const r = RP.visibleRegion(cam, 1920, 1080);
  assert.ok(r.dlon1 - r.dlon0 < 20 && r.dlon0 > -10 && r.dlon1 < 10, JSON.stringify(r));
  assert.ok(r.lat1 - r.lat0 < 20 && r.lat0 > 30 && r.lat1 < 50, JSON.stringify(r));
  for (const p of cornerPlaces(cam, 1920, 1080)) assert.ok(contains(cam, r, p), JSON.stringify(p));
});

test("visibleRegion: Equal Earth world view spans every longitude and MAX_LAT", () => {
  const r = RP.visibleRegion({ lat: 0, lon: 0, zoom: 1.5, rotation: 0, projection: 1 }, 1920, 1080);
  assert.deepEqual(r, { dlon0: -180, dlon1: 180, lat0: -P.MAX_LAT, lat1: P.MAX_LAT });
});

test("visibleRegion: camera near the date line stays within ±180 and contains the camera", () => {
  const r = RP.visibleRegion({ lat: 0, lon: 170, zoom: 4, rotation: 0, projection: 2 }, 1920, 1080);
  assert.ok(r.dlon0 >= -180 && r.dlon1 <= 180 && r.dlon0 < 0 && r.dlon1 > 0, JSON.stringify(r));
});

test("visibleRegion: a rotated zoomed-in view contains every frame corner", () => {
  for (const projection of [0, 1, 2]) {
    const cam = { lat: 30, lon: -100, zoom: 7, rotation: 45, projection };
    const r = RP.visibleRegion(cam, 1920, 1080);
    for (const p of cornerPlaces(cam, 1920, 1080)) assert.ok(contains(cam, r, p), projection + " " + JSON.stringify(p));
  }
});

test("visibleRegion: brute force, every on-Earth pixel of the frame lies inside the region", () => {
  const W = 1920, H = 1080, N = 61, places = [[0, 0], [35, 90], [-20, -170], [60, 178], [-70, 179.5], [10, -179.9], [80, -45]];
  let failures = [];
  for (const projection of [0, 1, 2]) {
    for (const zoom of [1.2, 1.8, 2.5, 3.5, 6]) {
      for (const rotation of [0, 30, -75]) {
        for (const [lat, lon] of places) {
          const cam = { lat, lon, zoom, rotation, projection }, r = RP.visibleRegion(cam, W, H);
          for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
              const p = P.unproject(cam, -W / 2 + W * i / (N - 1), -H / 2 + H * j / (N - 1));
              if (!p) continue;
              const d = wrap(p.lon - cam.lon), la = clampLat(p.lat);
              if (!r || d < r.dlon0 - 1e-9 || d > r.dlon1 + 1e-9 || la < r.lat0 - 1e-9 || la > r.lat1 + 1e-9) {
                failures.push(JSON.stringify(cam) + " " + d + "," + la + " " + JSON.stringify(r));
                break;
              }
            }
          }
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("visibleRegion: null when nothing of the Earth is in frame", () => {
  const orig = P.unproject;
  P.unproject = () => null;
  try {
    assert.equal(RP.visibleRegion({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 }, 1920, 1080), null);
    assert.deepEqual(RP.view({ lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 }, 1920, 1080), { scale: 1, cx: 0, cy: 0, w: 0, h: 0 });
  } finally { P.unproject = orig; }
});

test("viewTransform: the region's Mercator box, its centre and the 4096 px cap", () => {
  const cam = { lat: 10, lon: 50, zoom: 6, rotation: 0, projection: 2 }, r = R(cam);
  const v = RP.viewTransform(cam, { dlon0: -2, dlon1: 4, lat0: 5, lat1: 12 });
  const x0 = -2 * D2R * r, x1 = 4 * D2R * r, y0 = (mercY(5) - mercY(10)) * r, y1 = (mercY(12) - mercY(10)) * r;
  assert.ok(Math.abs(v.cx - (x0 + x1) / 2) < 1e-9 && Math.abs(v.cy - (y0 + y1) / 2) < 1e-9);
  assert.ok(Math.abs(v.w - (x1 - x0)) < 1e-9 && Math.abs(v.h - (y1 - y0)) < 1e-9);
  assert.equal(v.scale, 1);
  assert.equal(RP.MAX_VIEW_PX, 4096);

  assert.equal(RP.view({ lat: 0, lon: 0, zoom: 6, rotation: 0, projection: 2 }, 1920, 1080).scale, 1);

  // The whole Mercator world is 4096 px wide at zoom 4, so anything above zoom 4 is capped.
  const ee = { lat: 0, lon: 0, zoom: 4.5, rotation: 0, projection: 1 };
  const big = RP.viewTransform(ee, { dlon0: -180, dlon1: 180, lat0: -P.MAX_LAT, lat1: P.MAX_LAT });
  assert.ok(big.scale < 1);
  assert.ok(Math.abs(Math.max(big.w, big.h) * big.scale - 4096) < 1e-6);
  const shown = RP.view({ lat: 0, lon: 0, zoom: 4.5, rotation: 0, projection: 1 }, 3840, 2160);
  assert.ok(shown.scale < 1 && Math.abs(Math.max(shown.w, shown.h) * shown.scale - 4096) < 1e-6, JSON.stringify(shown));
});

test("visibleRegion: the Mercator box covers the frame's rotated bounding box (Equal Earth is taller than Mercator)", () => {
  const W = 1920, H = 1080;
  for (const projection of [0, 1, 2]) {
    for (const zoom of [5, 8, 12]) {
      for (const rotation of [0, 40]) {
        const cam = { lat: 0, lon: 0, zoom, rotation, projection }, v = RP.view(cam, W, H), s = v.scale;
        const c = Math.abs(Math.cos(rotation * D2R)), sn = Math.abs(Math.sin(rotation * D2R));
        const bw = W * c + H * sn, bh = W * sn + H * c;
        assert.ok(v.w * s >= bw - 1e-6, projection + " zoom " + zoom + " rot " + rotation + ": width " + v.w * s + " < " + bw);
        assert.ok(v.h * s >= bh - 1e-6, projection + " zoom " + zoom + " rot " + rotation + ": height " + v.h * s + " < " + bh);
      }
    }
  }
});

test("visibleRegion: brute force on Equal Earth near the poles and the date line", () => {
  const W = 1920, H = 1080, N = 61, failures = [];
  for (const [lat, lon, zoom] of [[70, 0, 5], [80, 0, 8], [0, 179, 9], [-75, -178, 4], [85, 30, 3]]) {
    for (const rotation of [0, 35]) {
      const cam = { lat, lon, zoom, rotation, projection: 1 }, r = RP.visibleRegion(cam, W, H);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const p = P.unproject(cam, -W / 2 + W * i / (N - 1), -H / 2 + H * j / (N - 1));
          if (!p) continue;
          const d = wrap(p.lon - cam.lon), la = clampLat(p.lat);
          if (!r || d < r.dlon0 - 1e-9 || d > r.dlon1 + 1e-9 || la < r.lat0 - 1e-9 || la > r.lat1 + 1e-9) { failures.push(JSON.stringify(cam) + " " + d + "," + la + " " + JSON.stringify(r)); break; }
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

test("visibleRegion: Equal Earth at lat 70 zoom 5 no longer widens to every longitude", () => {
  const r = RP.visibleRegion({ lat: 70, lon: 0, zoom: 5, rotation: 0, projection: 1 }, 1920, 1080);
  assert.ok(r.dlon1 - r.dlon0 < 200, JSON.stringify(r));
});

test("sourcePoint: Web Mercator is see-through past the map's top / bottom and its single world's sides", () => {
  const cam = { lat: 80, lon: 170, zoom: 3, rotation: 0, projection: 0 }, r = R(cam), v = { scale: 1, cx: 0, cy: 0 };
  assert.ok(RP.sourcePoint(cam, v, 0, 0));
  assert.equal(RP.sourcePoint(cam, v, 0, (Math.PI - mercY(80) + 0.01) * r), null, "beyond the top");
  assert.ok(RP.sourcePoint(cam, v, 0, (Math.PI - mercY(80) - 0.01) * r));
  assert.equal(RP.sourcePoint(cam, v, (10.5 * D2R) * r, 0), null, "past lon 180");
  assert.ok(RP.sourcePoint(cam, v, (9.5 * D2R) * r, 0));
  assert.equal(RP.sourcePoint(cam, v, (-350.5 * D2R) * r, 0), null, "past lon -180");
  const rot = { lat: 0, lon: 0, zoom: 3, rotation: 90, projection: 0 };
  assert.equal(RP.sourcePoint(rot, v, 0, 181 * D2R * R(rot)), null, "rotated: x is the map's y axis");
});

test("sourcePoint: the globe's cancellation-free latitude matches the plain formula, also near the poles and at the series switch", () => {
  const plain = (cam, X, Y) => { const p = P.unproject(cam, X, Y); return p && [wrap(p.lon - cam.lon), mercY(p.lat) - mercY(cam.lat)]; };
  for (const cam of [{ lat: 0, lon: 5, zoom: 3 }, { lat: 45, lon: -170, zoom: 4 }, { lat: -70, lon: 90, zoom: 2.5 }, { lat: 85, lon: 0, zoom: 3 }, { lat: 89.5, lon: 10, zoom: 3 }]) {
    const c = Object.assign({ rotation: 20, projection: 2 }, cam), r = R(c);
    for (let i = -9; i <= 9; i++) for (let j = -9; j <= 9; j++) {
      const X = r * i / 10, Y = r * j / 10, want = plain(c, X, Y), got = RP.sourcePoint(c, { scale: 1, cx: 0, cy: 0 }, X, Y);
      if (!want) { assert.equal(got, null); continue; }
      if (Math.abs(want[1]) > 3.1) continue; // clamped at the map's edge
      assert.ok(Math.abs(got[0] - want[0] * D2R * r) < 1e-6 * Math.max(1, r) && Math.abs(got[1] - want[1] * r) < 1e-6 * Math.max(1, r), JSON.stringify(c) + " " + X + "," + Y + ": " + got + " vs " + want);
    }
  }
});

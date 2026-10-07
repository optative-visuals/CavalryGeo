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
  assert.equal(q.cmds.filter((c) => c[0] === "close").length, 3, "the ring and a copy on each side, for the overscan");
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
  // a camera-centred pole cap: the ring and a copy on each side (the overscan past the edges)
  assert.equal(S.nightPath({ lat: 0, lon: 0, zoom: 1, rotation: 0, projection: 0 }, 172, 12, 0, cav).cmds.filter((c) => c[0] === "close").length, 3);
});

// Fill check: the drawn night path (screen space, even-odd over every contour) against the
// true solar elevation, on a 10-degree grid of the points each projection actually shows.
const P = require("../src/core/projection.js");
function contoursOf(path) {
  const out = [];
  let cur = null;
  path.cmds.forEach((c) => {
    if (c[0] === "moveTo") { cur = [[c[1], c[2]]]; out.push(cur); }
    else if (c[0] === "lineTo") cur.push([c[1], c[2]]);
  });
  return out;
}
function insideEvenOdd(contours, x, y) {
  let inside = false;
  contours.forEach((poly) => {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}
function elevation(lon, lat, sub) {
  return 90 - dist(lon, lat, sub.lon, sub.lat);
}
function fillCase(cam, doy, utc, a) {
  const contours = contoursOf(S.nightPath(cam, doy, utc, a, cav));
  const sub = S.subsolar(doy, utc), proj = P.makeProjector(cam), out = [0, 0];
  const lons = [];
  if (cam.projection === 0) {
    const lo = Math.min(-180, cam.lon - 180), hi = Math.max(180, cam.lon + 180);
    for (let l = -175 - 360; l <= 535; l += 10) if (l > lo && l < hi) lons.push(l);
  } else for (let l = -175; l <= 175; l += 10) lons.push(l);
  let tested = 0, wrong = 0;
  lons.forEach((lon) => {
    for (let lat = -80; lat <= 80; lat += 10) {
      const e = elevation(wrap(lon), lat, sub);
      if (Math.abs(e + a) < 4) continue;
      if (!proj(lon, lat, out)) continue;
      if (cam.projection === 2 && dist(lon, lat, cam.lon, cam.lat) > 89) continue; // on the limb itself
      if (Math.abs(out[0]) > 960 || Math.abs(out[1]) > 540) continue;
      tested++;
      if (insideEvenOdd(contours, out[0], out[1]) !== (e < -a)) wrong++;
    }
  });
  return { tested, wrong };
}
const FILL_CAMS = [[20, 0], [20, 90], [-30, 170], [60, -120]];
const FILL_TIMES = [[172, 12], [80, 12], [355, 3], [80, 20]];

[0, 1, 2].forEach((projection) => {
  test("night fill matches the solar angle, projection " + projection, () => {
    let tested = 0, wrong = 0;
    const bad = [];
    FILL_CAMS.forEach(([lat, lon]) => {
      FILL_TIMES.forEach(([doy, utc]) => {
        [0, 18].forEach((a) => {
          [1, 2].forEach((zoom) => {
            const r = fillCase({ lat, lon, zoom, rotation: 0, projection }, doy, utc, a);
            tested += r.tested; wrong += r.wrong;
            if (r.wrong > Math.max(1, r.tested * 0.01)) bad.push(`cam ${lat},${lon} z${zoom} day ${doy} ${utc} UTC a${a}: ${r.wrong}/${r.tested}`);
          });
        });
      });
    });
    assert.deepEqual(bad, [], `projection ${projection}: ${wrong}/${tested} wrong overall`);
  });
});

test("Mercator over the Pacific shades land past the antimeridian", () => {
  const cam = { lat: 0, lon: 170, zoom: 1, rotation: 0, projection: 0 };
  const contours = contoursOf(S.nightPath(cam, 80, 12, 18, cav));
  const proj = P.makeProjector(cam), out = [0, 0];
  [-150, -170, -120].forEach((lon) => {
    proj(lon, 0, out);
    assert.ok(insideEvenOdd(contours, out[0], out[1]), "lon " + lon);
  });
});

test("blurAmount: half a twilight step (3 degrees) on the screen, clamped, and zero for a hard edge", () => {
  const ws = (z) => 256 * Math.pow(2, z) / (2 * Math.PI);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " vs " + b);
  near(S.blurAmount(2, 1), 3 * Math.PI / 180 * ws(2));
  near(S.blurAmount(4, 1), 3 * Math.PI / 180 * ws(4));
  assert.ok(S.blurAmount(4, 1) > 4 * S.blurAmount(2, 1) - 1e-9);
  assert.equal(S.blurAmount(10, 1), 200);
  assert.equal(S.blurAmount(22, 0.5), 200);
  assert.equal(S.blurAmount(4, 0), 0);
  assert.equal(S.blurAmount(4, 0.49), 0);
  near(S.blurAmount(-3, 1), S.blurAmount(0, 1));
  near(S.blurAmount(NaN, 1), S.blurAmount(2, 1));
  near(S.blurAmount(4, undefined), S.blurAmount(4, 1));
});

test("earthOutline: the globe's outline is a circle of the world scale round the centre, whatever the rotation", () => {
  const P = require("../src/core/projection.js");
  [[2, 0], [4, 37], [0, 90]].forEach(([zoom, rotation]) => {
    const p = S.earthOutline({ lat: 20, lon: 40, zoom, rotation, projection: 2 }, cav);
    const pts = p.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    assert.ok(pts.length >= 90);
    assert.equal(p.cmds[0][0], "moveTo"); assert.equal(p.cmds[p.cmds.length - 1][0], "close");
    pts.forEach((c) => assert.ok(Math.abs(Math.hypot(c[1], c[2]) - P.worldScale(zoom)) < 1e-6));
  });
  const big = S.earthOutline({ lat: 0, lon: 0, zoom: 40, rotation: 0, projection: 2 }, cav);
  assert.ok(Math.abs(Math.hypot(big.cmds[0][1], big.cmds[0][2]) - P.worldScale(P.MAX_ZOOM)) < 1e-6, "zoom is clamped");
});

test("earthOutline: Equal Earth traces the oval from -180 to +180, pole to pole, closed", () => {
  const P = require("../src/core/projection.js");
  const cam = { lat: 0, lon: 0, zoom: 3, rotation: 0, projection: 1 }, proj = P.makeProjector(cam), o = [0, 0];
  const p = S.earthOutline(cam, cav), pts = p.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
  assert.equal(p.cmds.filter((c) => c[0] === "moveTo").length, 1);
  assert.equal(p.cmds.filter((c) => c[0] === "close").length, 1);
  assert.ok(pts.length >= 180);
  proj(180, 0, o); const right = o[0]; proj(0, 90, o); const top = o[1]; proj(0, -90, o); const bottom = o[1];
  const xs = pts.map((c) => c[1]), ys = pts.map((c) => c[2]);
  assert.ok(Math.abs(Math.max.apply(null, xs) - right) < 1e-6 && Math.abs(Math.min.apply(null, xs) + right) < 1e-6, "spans -180 to +180");
  assert.ok(Math.abs(Math.max.apply(null, ys) - top) < 1e-6 && Math.abs(Math.min.apply(null, ys) - bottom) < 1e-6, "pole to pole");
  // every point sits on the oval: it projects back onto the -180 / +180 meridian or a pole line
  pts.forEach((c) => {
    const onMeridian = [-180, 180].some((lon) => { let hit = false; for (let lat = -90; lat <= 90; lat += 1) { proj(lon, lat, o); if (Math.hypot(o[0] - c[1], o[1] - c[2]) < 1e-6) hit = true; } return hit; });
    const onPole = [-90, 90].some((lat) => { let hit = false; for (let lon = -180; lon <= 180; lon += 1) { proj(lon, lat, o); if (Math.hypot(o[0] - c[1], o[1] - c[2]) < 1e-6) hit = true; } return hit; });
    assert.ok(onMeridian || onPole);
  });
  // a turned camera moves the whole outline
  const off = S.earthOutline({ lat: 10, lon: 60, zoom: 3, rotation: 0, projection: 1 }, cav).cmds[0];
  assert.ok(Math.abs(off[1] - pts[0][1]) > 1);
});

test("earthOutline: Web Mercator is the world rectangle, lon +-180 and lat +-85.05", () => {
  const P = require("../src/core/projection.js");
  const cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 }, proj = P.makeProjector(cam), o = [0, 0];
  const p = S.earthOutline(cam, cav), pts = p.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
  assert.equal(pts.length, 4);
  assert.equal(p.cmds[p.cmds.length - 1][0], "close");
  [[-180, P.MAX_LAT], [180, P.MAX_LAT], [180, -P.MAX_LAT], [-180, -P.MAX_LAT]].forEach(([lon, lat], i) => {
    proj(lon, lat, o);
    assert.ok(Math.abs(pts[i][1] - o[0]) < 1e-9 && Math.abs(pts[i][2] - o[1]) < 1e-9, "corner " + i);
  });
});

test("earthOutline: the Mercator rectangle spans the night's longitudes, so night past the date line is inside it", () => {
  const P = require("../src/core/projection.js");
  const inside = (pts, x, y) => { let n = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { if ((pts[i][2] > y) !== (pts[j][2] > y) && x < (pts[j][1] - pts[i][1]) * (y - pts[i][2]) / (pts[j][2] - pts[i][2]) + pts[i][1]) n = !n; } return n; };
  const hi = { lat: 0, lon: 170, zoom: 1, rotation: 0, projection: 0 }, o = [0, 0];
  const pts = S.earthOutline(hi, cav).cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
  P.makeProjector(hi)(203, 21, o);
  assert.ok(o[0] > 40 && inside(pts, o[0], o[1]), "Hawaii");
  [[0, 0], [170, 0], [-170, 0], [170, 30], [-170, 30]].forEach(([lon, rotation]) => [[80, 12, 0], [172, 3, 6]].forEach(([doy, utc, dep]) => {
    const cam = { lat: 20, lon, zoom: 1, rotation, projection: 0 };
    const out = S.earthOutline(cam, cav).cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
    S.nightPath(cam, doy, utc, dep, cav).cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").forEach((c) => {
      const rr = rotation * Math.PI / 180, ux = c[1] * Math.cos(rr) + c[2] * Math.sin(rr);
      const uy = -c[1] * Math.sin(rr) + c[2] * Math.cos(rr), oys = out.map((p) => -p[1] * Math.sin(rr) + p[2] * Math.cos(rr));
      if (uy > Math.max.apply(null, oys) + 1e-6 || uy < Math.min.apply(null, oys) - 1e-6) return; // the overscan past the top / bottom edge, cut off by the mask
      if (Math.abs(ux) > 256) return; // beyond the camera's lon +- 180 view (zoom 1: 256 px) nothing shows
      const mx = out.reduce((t, p) => t + p[1], 0) / out.length, my = out.reduce((t, p) => t + p[2], 0) / out.length; // nudged 1e-6 toward the centre: points on the edge count
      assert.ok(inside(out, c[1] + (mx - c[1]) * 1e-6, c[2] + (my - c[2]) * 1e-6), lon + "/" + rotation);
    });
  }));
});

// ---- the night is drawn past the Earth's edge (overscan), so the blur's fade falls outside it ----
const pts = (p) => p.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo");
function contours(p) { const out = []; let cur = []; p.cmds.forEach((c) => { if (c[0] === "close") { out.push(cur); cur = []; } else cur.push(c); }); return out; }
function inPoly(poly, x, y) { let n = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { if ((poly[i][2] > y) !== (poly[j][2] > y) && x < (poly[j][1] - poly[i][1]) * (y - poly[i][2]) / (poly[j][2] - poly[i][2]) + poly[i][1]) n = !n; } return n; }
const covered = (p, x, y) => contours(p).some((c) => inPoly(c, x, y));
const overscanOf = (zoom) => 2 * S.blurAmount(zoom, 1) + 2;

test("overscan (globe): the limb is drawn at R + M, the terminator is where it was, the old night is still covered", () => {
  const P = require("../src/core/projection.js");
  [[2, 80, 12, 0], [4, 172, 3, 6], [3, 80, 23, 18], [2, 355, 20, 0]].forEach(([zoom, doy, utc, dep]) => [[20, 40], [-30, 200], [60, -100], [0, 0]].forEach(([lat, lon]) => {
    const cam = { lat, lon, zoom, rotation: 0, projection: 2 }, R = P.worldScale(zoom), M = overscanOf(zoom);
    const night = S.nightPath(cam, doy, utc, dep, cav), ps = pts(night), radii = ps.map((c) => Math.hypot(c[1], c[2]));
    if (!ps.length) return;
    // every point is inside the disc (terminator, interior) or on the pushed limb circle
    radii.forEach((r) => assert.ok(r <= R + 1e-6 || Math.abs(r - (R - 0 + M)) < 1e-6, "radius " + r));
    const pushed = ps.filter((c, i) => radii[i] > R + 1e-6);
    if (!pushed.length || Math.min.apply(null, radii) > 0.9 * R) return; // (a sliver of night: nothing to check)
    // the old path ran its limb arc at R between the same two terminator ends: those ends are on the disc's rim, and the rim
    // points between them (the old limb) are covered by the new polygon
    const dirs = pushed.map((c) => Math.atan2(c[2], c[1]));
    [dirs[Math.floor(dirs.length / 2)]].forEach((a) => assert.ok(covered(night, R * Math.cos(a) * 0.999, R * Math.sin(a) * 0.999), "old limb point " + [zoom, doy, utc, dep, lat, lon]));
    // the pushed limb's first and last point sit in the same direction as a terminator end on the rim
    const rim = ps.filter((c, i) => Math.abs(radii[i] - R) < 1e-6);
    [dirs[0], dirs[dirs.length - 1]].forEach((a) => assert.ok(rim.some((c) => Math.abs(Math.atan2(c[2], c[1]) - a) < 1e-6), "radial join"));
  }));
});

test("overscan (flat maps): night along the outline reaches M - 1 px past it, away from the edge nothing moves", () => {
  const P = require("../src/core/projection.js"), D = Math.PI / 180;
  [1, 0].forEach((projection) => [[0, 2], [0, 3]].forEach(([c, zoom]) => [[80, 12, 0], [172, 3, 6], [355, 20, 0], [80, 0, 18]].forEach(([doy, utc, dep]) => {
    const cam = { lat: 0, lon: 0, zoom, rotation: 0, projection }, M = overscanOf(zoom);
    const outline = pts(S.earthOutline(cam, cav)), night = S.nightPath(cam, doy, utc, dep, cav);
    const sun = S.subsolar(doy, utc), r = (90 - dep) * D;
    const inNight = (lon, lat) => {
      const cd = Math.sin(-sun.lat * D) * Math.sin(lat * D) + Math.cos(-sun.lat * D) * Math.cos(lat * D) * Math.cos((lon - sun.lon - 180) * D);
      return Math.acos(Math.max(-1, Math.min(1, cd))) < r - 2 * D;
    };
    const proj = P.makeProjector(cam), o = [0, 0];
    for (let lat = -80; lat <= 80; lat += 10) [-180, 180].forEach((lon) => {
      if (!inNight(lon, lat)) return;
      proj(lon, lat, o);
      const sgn = lon < 0 ? -1 : 1; // the oval's edge slopes: probe straight out sideways, M - 1 px (the strip is wider)
      assert.ok(covered(night, o[0] + sgn * (M - 1), o[1]), "side " + lon + "/" + lat + " proj " + projection);
    });
    [-1, 1].forEach((sg) => {
      for (let lon = -170; lon <= 170; lon += 10) {
        const lat = sg * (projection === 1 ? 90 : P.MAX_LAT);
        if (!inNight(lon, sg * 89.9)) continue;
        proj(lon, lat, o);
        assert.ok(covered(night, o[0], o[1] + sg * (M - 1)), "pole " + lon + "/" + sg + " proj " + projection);
      }
    });
    // the interior is untouched: every ring point well inside is a vertex of the path
    const ring = S.nightRing(doy, utc, dep), all = pts(night);
    ring.filter((p) => Math.abs(p[0]) < 170 && Math.abs(p[1]) < 80).forEach((p) => {
      proj(p[0], p[1], o);
      assert.ok(all.some((q) => Math.hypot(q[1] - o[0], q[2] - o[1]) < 1e-6), "ring point " + p);
    });
  })));
});

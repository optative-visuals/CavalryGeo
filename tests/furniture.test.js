const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/core/furniture.js");
const P = require("../src/core/projection.js");

// A fake cavalry with a recording Path (no measureText, so text widths are estimated).
function FakePath() { this.cmds = []; }
["moveTo", "lineTo", "close", "addText", "addEllipse"].forEach((m) => { FakePath.prototype[m] = function () { this.cmds.push([m, ...arguments]); }; });
const cav = { Path: FakePath };
const texts = (p) => p.cmds.filter((c) => c[0] === "addText").map((c) => c[1]);
const moves = (p) => p.cmds.filter((c) => c[0] === "moveTo").length;
const cam = (o) => Object.assign({ lat: 0, lon: 0, zoom: 10, rotation: 0, projection: 0 }, o);
const BAR = (o) => Object.assign({ lat: 48.85, lon: 2.35, zoom: 12, rotation: 0, projection: 0, compW: 1920, compH: 1080, units: 0, style: 0, corner: 2, margin: 40, maxWidth: 200, raise: 0, textSize: 16 }, o);
const ARROW = (o) => Object.assign({ lat: 48.85, lon: 2.35, zoom: 12, rotation: 0, projection: 0, compW: 1920, compH: 1080, style: 0, corner: 1, margin: 40, size: 40 }, o);

test("metresPerPixel matches the Web Mercator ground resolution", () => {
  [[0, 10], [48.85, 12], [60, 5]].forEach(([lat, zoom]) => {
    const want = 156543.034 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    const got = F.metresPerPixel(cam({ lat, zoom }));
    assert.ok(Math.abs(got - want) / want < 0.01, `${lat}, ${zoom}: ${got} vs ${want}`);
  });
  assert.ok(F.metresPerPixel(cam({ projection: 2, zoom: 6 })) > 0, "globe");
  assert.ok(F.metresPerPixel(cam({ projection: 1, zoom: 4 })) > 0, "Equal Earth");
  assert.equal(F.metresPerPixel(cam({ projection: 2, zoom: -3 })), null, "a globe smaller than 100 px can't be measured");
});

test("niceDistance picks the longest 1 / 2 / 5 step that fits, with units and commas", () => {
  assert.equal(F.niceDistance(999, "metric").label, "500 m");
  assert.equal(F.niceDistance(1000, "metric").label, "1 km");
  assert.equal(F.niceDistance(4999, "metric").label, "2 km");
  assert.equal(F.niceDistance(1500000, "metric").label, "1,000 km");
  assert.equal(F.niceDistance(1500000, "metric").metres, 1000000);
  assert.equal(F.niceDistance(300, "imperial").label, "500 ft");
  assert.equal(F.niceDistance(1609.344 * 3, "imperial").label, "2 mi");
  assert.equal(F.niceDistance(0.5, "metric"), null, "never 0");
  assert.equal(F.niceDistance(0, "imperial"), null);
});

test("cornerPoint puts each corner inside the frame by the margin", () => {
  assert.deepEqual(F.cornerPoint(0, 1920, 1080, 40), { x: -920, y: 500, right: false, top: true });
  assert.deepEqual(F.cornerPoint(1, 1920, 1080, 40), { x: 920, y: 500, right: true, top: true });
  assert.deepEqual(F.cornerPoint(2, 1920, 1080, 40), { x: -920, y: -500, right: false, top: false });
  assert.deepEqual(F.cornerPoint(3, 1920, 1080, 40), { x: 920, y: -500, right: true, top: false });
  assert.deepEqual(F.cornerPoint(7, 1920, 1080, 40), F.cornerPoint(2, 1920, 1080, 40), "out of range → bottom-left");
});

test("northDirection points north on every projection and turns with rotation", () => {
  [0, 1, 2].forEach((projection) => {
    [0, 30, 90, -120].forEach((rotation) => {
      const c = cam({ lat: 40, lon: 10, zoom: 5, rotation, projection });
      const d = F.northDirection(c);
      assert.ok(Math.abs(Math.hypot(d[0], d[1]) - 1) < 1e-9);
      const ll = P.unproject(c, d[0] * 100, d[1] * 100);
      assert.ok(ll && ll.lat > 40, `p${projection} r${rotation}: 100 px along it goes north`);
    });
  });
  const up = F.northDirection(cam({ lat: 40, rotation: 0 }));
  assert.ok(Math.abs(up[0]) < 1e-9 && up[1] > 0.999, "straight up at rotation 0");
  assert.deepEqual(F.northDirection(cam({ lat: 90, projection: 2 })), [0, 1], "at the pole: up");
});

test("fade: 0 below Hide below zoom, 100 half a level above, linear between", () => {
  assert.equal(F.fade(2.4, 3), 0);
  assert.equal(F.fade(2.75, 3), 50);
  assert.equal(F.fade(3, 3), 100);
  assert.equal(F.fade(12, 3), 100);
  assert.equal(F.fade(-5, 0), 0);
});

test("scaleBar draws a line bar with its label at the corner; Segmented has 3 labels; Both draws two bars", () => {
  const line = F.scaleBar(BAR(), cav);
  assert.equal(texts(line).length, 1);
  assert.match(texts(line)[0], /^\d[\d,]* (m|km)$/);
  assert.equal(moves(line), 3, "line + two ticks");
  const firstMove = line.cmds.find((c) => c[0] === "moveTo");
  assert.equal(firstMove[1], -920, "left end at the margin");
  const seg = F.scaleBar(BAR({ style: 1 }), cav);
  assert.equal(texts(seg).length, 3);
  assert.equal(texts(seg)[0], "0");
  const both = F.scaleBar(BAR({ units: 2 }), cav);
  assert.equal(texts(both).length, 2);
  assert.match(texts(both)[1], /(ft|mi)$/);
  const right = F.scaleBar(BAR({ corner: 3 }), cav);
  const xs = right.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => c[1]);
  assert.ok(Math.abs(Math.max(...xs) - 920) < 1e-9, "right end at the margin");
  assert.equal(F.scaleBar(BAR({ projection: 2, zoom: -3 }), cav).cmds.length, 0, "nothing when it can't measure");
});

test("scaleBar raise lifts a bottom bar; a top bar sits under the top margin", () => {
  const low = F.scaleBar(BAR(), cav), high = F.scaleBar(BAR({ raise: 40 }), cav);
  const minY = (p) => Math.min(...p.cmds.filter((c) => c[0] === "moveTo").map((c) => c[2]));
  assert.equal(minY(high) - minY(low), 40);
  const top = F.scaleBar(BAR({ corner: 0 }), cav);
  const label = top.cmds.find((c) => c[0] === "addText");
  assert.ok(label[4] <= 500 - 16 * 0.75 + 1e-9, "label below the top margin");
});

test("northArrow draws each style with an N, turned with the camera", () => {
  [0, 1, 2].forEach((style) => {
    const a = F.northArrow(ARROW({ style }), cav);
    assert.deepEqual(texts(a), ["N"]);
    assert.ok(moves(a) >= 1);
  });
  const pts = (p) => p.cmds.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => [c[1], c[2]]);
  const a0 = pts(F.northArrow(ARROW(), cav)), a90 = pts(F.northArrow(ARROW({ rotation: 90 }), cav));
  assert.notDeepEqual(a0, a90, "rotation turns it");
  const cx = 920 - 20, cy = 500 - 20; // corner 1, margin 40 + size / 2
  const tip = a0.reduce((b, q) => (q[1] > b[1] ? q : b));
  assert.ok(Math.abs(tip[0] - cx) < 1e-6 && Math.abs(tip[1] - (cy + 20)) < 1e-6, "tip straight above the centre at rotation 0");
});

test("northDirection at a pole (or Mercator's clamp) still turns with rotation", () => {
  const r = 45 * Math.PI / 180, want = [-Math.sin(r), Math.cos(r)];
  [0, 1, 2].forEach((projection) => {
    const d = F.northDirection(cam({ lat: 90, projection, rotation: 45 }));
    assert.ok(Math.abs(d[0] - want[0]) < 1e-9 && Math.abs(d[1] - want[1]) < 1e-9, `p${projection}: ${d}`);
  });
  const m = F.northDirection(cam({ lat: 85.06, projection: 0, rotation: 45 }));
  assert.ok(Math.abs(m[0] - want[0]) < 1e-9 && Math.abs(m[1] - want[1]) < 1e-9, `mercator clamp: ${m}`);
  assert.deepEqual(F.northDirection(cam({ lat: 90, projection: 2, rotation: 0 })), [0, 1]);
  assert.deepEqual(F.northDirection(cam({ lat: 85.06, projection: 0, rotation: 0 })), [0, 1]);
});

test("a segmented bar's right end is closed by a 1 px side the height of the block", () => {
  const p = F.scaleBar(BAR({ style: 1 }), cav), c = p.cmds;
  // boxes are moveTo, 3 lineTo, close; find 1 px wide boxes
  const boxes = [];
  for (let i = 0; i + 4 < c.length; i++) {
    if (c[i][0] === "moveTo" && c[i + 1][0] === "lineTo" && c[i + 3][0] === "lineTo" && c[i + 4][0] === "close") boxes.push({ x: c[i][1], y: c[i][2], w: c[i + 1][1] - c[i][1], h: c[i + 3][2] - c[i][2] });
  }
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const side = boxes.filter((b) => b.w === 1 && b.x + b.w === right);
  assert.equal(side.length, 1, "one 1 px box touches the right end");
  const fill = boxes.find((b) => b.h > 1 && b.w > 1);
  assert.equal(side[0].h, fill.h, "as tall as a filled block");
});

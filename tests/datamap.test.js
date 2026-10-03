const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/core/datamap.js");
const C = require("../src/core/codec.js");

class FakePath { constructor() { this.ops = []; } moveTo(x, y) { this.ops.push(["M", x, y]); } lineTo(x, y) { this.ops.push(["L", x, y]); } close() { this.ops.push(["Z"]); } addEllipse(x, y, a, b) { this.ops.push(["E", x, y, a, b]); } addText(t, s, x, y) { this.ops.push(["T", t, s, x, y]); } addRect(a, b, c, d) { this.ops.push(["R", a, b, c, d]); } }
class FakeMaterial {}
class FakeMesh { constructor() { this.paths = []; } addPath(p, m) { this.paths.push([p, m]); } }
const cav = { Path: FakePath, Mesh: FakeMesh, Material: FakeMaterial };
const cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 };
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const colours = { low: "#000000", high: "#ffffff", useMiddle: 0, middle: "#ff0000", middleValue: 0, min: 0, max: 0, noData: "#dddddd" };

test("valueAt interpolates and clamps", () => {
  const s = [[2000, 10], [2010, 20], [2020, 40]];
  assert.equal(G.valueAt(s, 2005), 15);
  assert.equal(G.valueAt(s, 2015), 30);
  assert.equal(G.valueAt(s, 1990), 10);
  assert.equal(G.valueAt(s, 2030), 40);
  assert.equal(G.valueAt([[0, 7]], 2020), 7);
  assert.equal(G.valueAt(null, 2020), null);
});

test("toRgb accepts hex, arrays and {r,g,b}", () => {
  assert.deepEqual(G.toRgb("#ff8000"), [255, 128, 0]);
  assert.deepEqual(G.toRgb("#f80"), [255, 136, 0]);
  assert.deepEqual(G.toRgb([1, 2, 3, 255]), [1, 2, 3]);
  assert.deepEqual(G.toRgb({ r: 4, g: 5, b: 6, a: 255 }), [4, 5, 6]);
});

test("colorAt: 2-stop, 3-stop, clamping, auto range, no data", () => {
  const range = { min: 0, max: 100, maxAbs: 100 };
  assert.equal(G.colorAt(50, colours, range), "#808080");
  assert.equal(G.colorAt(150, colours, range), "#ffffff");
  assert.equal(G.colorAt(null, colours, range), "#dddddd");
  assert.equal(G.colorAt(50, Object.assign({}, colours, { min: 50, max: 150 }), range), "#000000");
  const mid = Object.assign({}, colours, { useMiddle: 1, middleValue: 25 });
  assert.equal(G.colorAt(25, mid, range), "#ff0000");
  assert.equal(G.colorAt(0, mid, range), "#000000");
});

test("bubbleRadius is area-proportional", () => {
  near(G.bubbleRadius(100, 100, 40), 40);
  near(G.bubbleRadius(25, 100, 40), 20);
  near(G.bubbleRadius(-25, 100, 40), 20);
  assert.equal(G.bubbleRadius(null, 100, 40), 0);
});

test("formatValue: compact, full, fixed, negatives, prefix and suffix", () => {
  assert.equal(G.formatValue(67600000, 0, 1), "67.6M");
  assert.equal(G.formatValue(1234, 0, 1), "1.2k");
  assert.equal(G.formatValue(12.345, 0, 1), "12.3");
  assert.equal(G.formatValue(67600000, 1, 1), "67,600,000");
  assert.equal(G.formatValue(-5.678, 2, 2, "$", " bn"), "-$5.68 bn");
  assert.equal(G.formatValue(null, 0, 1), "");
});

const geo = C.encodeLayer({ kind: "polygon", features: [
  { name: "A", rank: 2, rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
  { name: "B", rank: 1, rings: [[[20, 0], [30, 0], [30, 10], [20, 0]]] }
] });

test("choropleth: empty placeholder first, then one coloured path per country", () => {
  const data = { geo: geo, series: [[[2000, 0], [2020, 100]], null], range: { min: 0, max: 100, maxAbs: 100 } };
  const mesh = G.choropleth(data, cam, Object.assign({ year: 2010 }, colours), cav);
  assert.equal(mesh.paths.length, 3);
  assert.equal(mesh.paths[0][0].ops.length, 0);
  assert.equal(mesh.paths[1][1].fillColor, "#808080");
  assert.equal(mesh.paths[1][1].fill, true);
  assert.equal(mesh.paths[2][1].fillColor, "#dddddd");
  assert.ok(mesh.paths[1][0].ops.length > 0);
});

test("bubbles and value labels draw at their points", () => {
  const data = { pts: [[0, 0, "A"], [10, 0, "B"]], series: [[[0, 100]], [[0, 25]]], range: { min: 25, max: 100, maxAbs: 100 }, fmt: { prefix: "", suffix: "%" } };
  const b = G.bubbles(data, cam, { year: 0, maxRadius: 40, ellipseScale: 1 }, FakePath).ops;
  assert.equal(b[0][0], "E");
  near(b[0][1], 0); near(b[0][2], 0); near(b[0][3], 40); near(b[0][4], 40);
  near(b[1][3], 20);
  const l = G.valueLabels(data, cam, { year: 0, textSize: 10, format: 2, decimals: 0 }, cav).ops;
  assert.equal(l[0][1], "100%");
  assert.equal(l[0][2], 10);
  near(l[0][3], -10, 1e-9); // no measureText: 4 chars x 10 x 0.5 wide, centred
  const measured = G.valueLabels(data, cam, { year: 0, textSize: 10, format: 2, decimals: 0 },
    Object.assign({ measureText: () => ({ width: 30 }) }, cav)).ops;
  near(measured[0][3], -15, 1e-9);
});

test("legend: gradient strips plus a text path; bubble legend: two circles", () => {
  const data = { range: { min: 0, max: 100, maxAbs: 100 }, title: "Population", fmt: { prefix: "", suffix: "", format: 0, decimals: 1 } };
  const mesh = G.legend(data, colours, cav);
  assert.equal(mesh.paths.length, 1 + 48 + 1);
  assert.equal(mesh.paths[1][1].fillColor, G.colorAt(100 * 0.5 / 48, colours, data.range));
  const texts = mesh.paths[49][0].ops.map((o) => o[1]);
  assert.deepEqual(texts, ["Population", "0.0", "100.0"]);
  const bl = G.bubbleLegend(data, { maxRadius: 40 }, cav);
  const circles = bl.paths[1][0].ops.filter((o) => o[0] === "E");
  assert.equal(circles.length, 2);
  near(circles[1][3], 40 * Math.sqrt(0.5));
});

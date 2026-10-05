const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const E = require("../src/core/expression.js");
const C = require("../src/core/codec.js");
const { buildRuntimeSource } = require("../tools/buildlib.js");

class FakePath {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(["M", x, y]); }
  lineTo(x, y) { this.ops.push(["L", x, y]); }
  close() { this.ops.push(["Z"]); }
  addEllipse() { this.ops.push(["E"]); }
  addText() { this.ops.push(["T"]); }
}
const enc = C.encodeLayer({ kind: "polygon", features: [{ name: "A", rank: 1, rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }] });
const meta = { camera: "javaScript#1", category: "countries" };

test("map layer expression runs with index inputs (n0..n6)", () => {
  const expr = E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 1 });
  const ctx = { cavalry: { Path: FakePath }, n0: 0, n1: 0, n2: 3, n3: 0, n4: 0, n5: 100, n6: 4 };
  const path = vm.runInNewContext(expr, ctx);
  assert.deepEqual(path.ops.map((o) => o[0]), ["M", "L", "L", "L", "Z"]);
});

test("renamed inputs take precedence over index inputs", () => {
  const expr = E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 1 });
  const ctx = { cavalry: { Path: FakePath }, n0: 0, n1: 0, n2: 3, n3: 0, n4: 0, n5: 100, n6: 4, detail: 0 };
  assert.equal(vm.runInNewContext(expr, ctx).ops.length, 0);
});

test("meta and data can be read back from an expression", () => {
  const expr = E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 1 });
  assert.deepEqual(E.readTag(expr, "GEO_META"), meta);
  assert.deepEqual(E.readData(expr), enc);
});

test("tags survive a name containing a comment terminator", () => {
  const tag = E.writeTag("GEO_CAMERA", { name: "evil */ name" });
  assert.deepEqual(E.readTag(tag, "GEO_CAMERA"), { name: "evil */ name" });
  assert.equal(tag.indexOf("*/"), tag.length - 2);
});

test("readTag returns null when missing", () => {
  assert.equal(E.readTag("0;", "GEO_CAMERA"), null);
});

test("camera expression carries its tag and body", () => {
  const expr = E.cameraExpression({ name: "Paris" }, "0;");
  assert.deepEqual(E.readTag(expr, "GEO_CAMERA"), { name: "Paris" });
  assert.equal(vm.runInNewContext(expr, {}), 0);
});

test("label driver expression returns the projected point", () => {
  const expr = E.labelDriverExpression(buildRuntimeSource(), meta, "array");
  const ctx = { cavalry: {}, n0: 0, n1: 0, n2: 0, n3: 0, n4: 0, n5: 180, n6: 0 };
  const out = Array.from(vm.runInNewContext(expr, ctx));
  assert.ok(Math.abs(out[0] - 128) < 1e-6);
  assert.ok(Math.abs(out[1]) < 1e-6);
});

test("input lists have the documented order", () => {
  assert.deepEqual(E.MAP_INPUTS.map((i) => i[0]), ["camLat", "camLon", "camZoom", "camRotation", "camProjection", "detail", "pointRadius"]);
  assert.deepEqual(E.CAMERA_INPUTS.map((i) => i[0]), ["centerLat", "centerLon", "zoom", "rotation", "projection"]);
  assert.deepEqual(E.LABEL_INPUTS.map((i) => i[0]), ["camLat", "camLon", "camZoom", "camRotation", "camProjection", "labelLon", "labelLat"]);
});

test("label visibility expression returns 100 when visible and 0 behind the globe", () => {
  const expr = E.labelVisibilityExpression(buildRuntimeSource(), meta);
  const run = (lon, projection) => vm.runInNewContext(expr, { cavalry: {}, n0: 0, n1: 0, n2: 0, n3: 0, n4: projection, n5: lon, n6: 0 });
  assert.equal(run(10, 2), 100);
  assert.equal(run(170, 2), 0);
  assert.equal(run(170, 0), 100);
  assert.deepEqual(E.readTag(expr, "GEO_META"), meta);
});

test("map layer expression keeps an explicit ellipseScale of 0", () => {
  assert.ok(E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 0 }).includes("ellipseScale: 0}"));
});

test("route layer expression draws a leg and reads lift from n7 or the renamed input", () => {
  const renc = C.encodeLayer({ kind: "route", features: [{ name: "L", rank: 1, rings: [[[-0.1276, 51.5072], [-74.006, 40.7128]]] }] });
  const expr = E.routeLayerExpression(buildRuntimeSource(), renc, { camera: "javaScript#1", category: "route" }, { ellipseScale: 1 });
  const base = { cavalry: { Path: FakePath }, n0: 45, n1: -40, n2: 2, n3: 0, n4: 0, n5: 100, n6: 4 };
  const mid = (ctx) => { const ops = vm.runInNewContext(expr, ctx).ops; return ops[Math.floor(ops.length / 2)][2]; };
  const flatY = mid(Object.assign({ n7: 0 }, base));
  assert.ok(mid(Object.assign({ n7: 40 }, base)) > flatY);
  assert.equal(mid(Object.assign({ n7: 40, lift: 0 }, base)), flatY, "renamed 'lift' takes precedence");
  assert.deepEqual(E.readTag(expr, "GEO_META"), { camera: "javaScript#1", category: "route" });
  assert.deepEqual(E.readData(expr), renc);
});

test("ROUTE_INPUTS is MAP_INPUTS plus lift", () => {
  assert.deepEqual(E.ROUTE_INPUTS.map((i) => i[0]), ["camLat", "camLon", "camZoom", "camRotation", "camProjection", "detail", "pointRadius", "lift"]);
  assert.equal(E.ROUTE_INPUTS[7][1], 30);
  assert.equal(E.MAP_INPUTS.length, 7);
});

const { buildDataRuntimeSource } = require("../tools/buildlib.js");
class FakeMat {}
class FakeMesh2 { constructor() { this.paths = []; } addPath(p, m) { this.paths.push([p, m]); } }
class TextPath extends FakePath { addText(t, s, x, y) { this.ops.push(["T", t, s, x, y]); } } // the file's FakePath drops text arguments

test("input defaults are JSON literals (numbers unchanged, colours quoted)", () => {
  assert.equal(E.REGION_INPUTS[8][2], "color");
  const expr = E.regionsExpression(buildDataRuntimeSource(), { geo: C.encodeLayer({ kind: "polygon", features: [] }), series: [], range: { min: 0, max: 0, maxAbs: 0 } }, { camera: "c", category: "data" });
  assert.ok(expr.includes('(typeof n8 !== "undefined") ? n8 : "#f2e8cf"'));
  assert.ok(expr.includes('(typeof n7 !== "undefined") ? n7 : 0'));
});

test("regions expression renders a coloured Mesh from n-inputs", () => {
  const geo = C.encodeLayer({ kind: "polygon", features: [{ name: "A", rank: 1, rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }] });
  const data = { geo: geo, series: [[[2000, 0], [2020, 100]]], range: { min: 0, max: 100, maxAbs: 100 } };
  const expr = E.regionsExpression(buildDataRuntimeSource(), data, { camera: "c", category: "data" });
  const ctx = { cavalry: { Path: TextPath, Mesh: FakeMesh2, Material: FakeMat }, n0: 0, n1: 0, n2: 2, n3: 0, n4: 0, n5: 100, n6: 4, n7: 2010,
    n8: "#000000", n9: "#ffffff", n10: 0, n11: "#ff0000", n12: 0, n13: 0, n14: 0, n15: "#dddddd" };
  const mesh = vm.runInNewContext(expr, ctx);
  assert.equal(mesh.paths[1][1].fillColor, "#808080");
  assert.deepEqual(E.readData(expr), data);
});

test("bubbles, labels and legend expressions run", () => {
  const data = { pts: [[0, 0, "A"]], series: [[[0, 50]]], range: { min: 50, max: 50, maxAbs: 50 }, title: "T", fmt: { prefix: "", suffix: "", format: 0, decimals: 1 } };
  const run = (expr, extra) => vm.runInNewContext(expr, Object.assign({ cavalry: { Path: TextPath, Mesh: FakeMesh2, Material: FakeMat }, n0: 0, n1: 0, n2: 2, n3: 0, n4: 0, n5: 100, n6: 4, n7: 0 }, extra));
  assert.equal(run(E.bubblesExpression(buildDataRuntimeSource(), data, { category: "data" }, { ellipseScale: 1 }), { n8: 40 }).ops[0][0], "E");
  assert.equal(run(E.valueLabelsExpression(buildDataRuntimeSource(), data, { category: "data" }), { n8: 16, n9: 0, n10: 1 }).ops[0][1], "50.0");
  const leg = vm.runInNewContext(E.legendExpression(buildDataRuntimeSource(), data, { category: "data" }),
    { cavalry: { Path: TextPath, Mesh: FakeMesh2, Material: FakeMat }, n0: 0, n1: 0, n2: 0, n3: 0, n4: "#000000", n5: "#ffffff", n6: "#ff0000" });
  assert.equal(leg.paths.length, 50);
  assert.equal(leg.paths[1][1].fillColor, "#808080", "flat data (min = max): middle of the black→white ramp");
});

test("legend inputs are numbers first and all exist on the regions layer", () => {
  assert.equal(E.LEGEND_INPUTS[0][2], undefined);
  E.LEGEND_INPUTS.forEach((inp) => assert.ok(E.inputIndex(E.REGION_INPUTS, inp[0]) >= 8, inp[0]));
  assert.equal(E.inputIndex(E.REGION_INPUTS, "nope"), -1);
});

test("replaceData swaps only the stored payload", () => {
  const expr = E.bubblesExpression("/*rt*/", { a: 1 }, { category: "data" }, { ellipseScale: 1 });
  const next = E.replaceData(expr, { a: 2 });
  assert.deepEqual(E.readData(next), { a: 2 });
  assert.equal(next.replace('{"a":2}', '{"a":1}'), expr);
});

const { buildImageryRuntimeSource } = require("../tools/buildlib.js");
const camCtx = (o) => Object.assign({ n0: 0, n1: 0, n2: 4, n3: 0, n4: 0 }, o);

test("imagery rotation driver: sign times camera rotation, with readable meta", () => {
  const meta = { camera: "javaScript#1", category: "imagery", group: "group#2", cacheKey: "eox", meta: { source: "eox" } };
  const expr = E.imageryRotationExpression(meta, 1);
  assert.equal(vm.runInNewContext(expr, camCtx({ n3: 30 })), 30);
  assert.equal(vm.runInNewContext(E.imageryRotationExpression(meta, -1), camCtx({ n3: 30 })), -30);
  assert.deepEqual(E.readTag(expr, "GEO_META"), meta);
  assert.equal(E.IMAGERY_INPUTS.length, 5);
});

test("imagery level drivers: position, scale and opacity", () => {
  const src = buildImageryRuntimeSource(), level = { L: 4, x0: 8, y0: 8, lo: 3, hi: 6 };
  const pos = vm.runInNewContext(E.imageryLevelExpression(src, "position", level), camCtx({ n1: 22.5 }));
  assert.ok(Math.abs(pos[0] + 256) < 1e-6 && Math.abs(pos[1]) < 1e-6);
  const sc = vm.runInNewContext(E.imageryLevelExpression(src, "scale", level), camCtx({ n2: 5 }));
  assert.deepEqual(Array.from(sc), [2, 2]);
  assert.equal(vm.runInNewContext(E.imageryLevelExpression(src, "opacity", level), camCtx({ n2: 4 })), 100);
  assert.equal(vm.runInNewContext(E.imageryLevelExpression(src, "opacity", level), camCtx({ n2: 4, n4: 2 })), 0);
  assert.equal(vm.runInNewContext(E.imageryLevelExpression(src, "opacity", level), { camLat: 0, camLon: 0, camZoom: 5, camRotation: 0, camProjection: 0 }), 0);
  assert.throws(() => E.imageryLevelExpression(src, "rotation", level), /Unknown imagery driver/);
});

test("route helper expressions: end point, handles (plugin and hand mode) and fade", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  const curveSrc = fs.readFileSync(path.join(__dirname, "../src/core/curve.js"), "utf8");
  const Curve = require("../src/core/curve.js");
  const run = (expr, inputs) => vm.runInNewContext(expr, Object.fromEntries(inputs.map((v, i) => ["n" + i, v])));
  assert.deepEqual(Array.from(run(E.routeEndPointExpression({ camera: "c", category: "stopEnd" }), [100, 50, 20, -10])), [120, 40]);
  const ins = [0, 0, 10, 0, 200, 0, -10, 0, 40, 20, 0, 0, 7, 8];
  const want = Curve.handles([10, 0], [190, 0], { arc: 40, lean: 20, flip: 0 });
  assert.deepEqual(Array.from(run(E.routeHandleExpression(curveSrc, { camera: "c", category: "legHandle" }, "start"), ins)), want.start);
  assert.deepEqual(Array.from(run(E.routeHandleExpression(curveSrc, { camera: "c", category: "legHandle" }, "end"), ins)), want.end);
  const hand = ins.slice(); hand[11] = 1;
  assert.deepEqual(Array.from(run(E.routeHandleExpression(curveSrc, { camera: "c", category: "legHandle" }, "end"), hand)), [7, 8]);
  assert.throws(() => E.routeHandleExpression(curveSrc, {}, "middle"), /Unknown handle/);
  assert.equal(run(E.routeFadeExpression({ camera: "c", category: "legFade" }), [100, 0]), 0);
  assert.equal(run(E.routeFadeExpression({ camera: "c", category: "legFade" }), [100, 100]), 100);
  assert.deepEqual(E.HANDLE_INPUTS.map((i) => i[0]), ["aHolderX", "aHolderY", "aStopX", "aStopY", "bHolderX", "bHolderY", "bStopX", "bStopY", "arc", "lean", "flip", "hand", "handX", "handY"]);
});

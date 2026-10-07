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

test("imagery view drivers: position, scale, mask size, filter scale and offset match GeoReproject.view", () => {
  const { buildReprojectSource } = require("../tools/buildlib.js");
  const RP = require("../src/core/reproject.js");
  const src = buildReprojectSource(), size = { width: 1920, height: 1080 };
  const cams = [{ lat: 40, lon: 10, zoom: 6, rotation: 20, projection: 2 }, { lat: -20, lon: 170, zoom: 3, rotation: 0, projection: 1 }];
  for (const cam of cams) {
    const v = RP.view(cam, 1920, 1080);
    const named = { camLat: cam.lat, camLon: cam.lon, camZoom: cam.zoom, camRotation: cam.rotation, camProjection: cam.projection };
    const indexed = { n0: cam.lat, n1: cam.lon, n2: cam.zoom, n3: cam.rotation, n4: cam.projection };
    const want = {
      position: [-v.cx * v.scale, -v.cy * v.scale], scale: [v.scale, v.scale], maskSize: [v.w * v.scale + 4, v.h * v.scale + 4],
      viewScale: v.scale, viewOffset: [v.cx, v.cy]
    };
    for (const which of Object.keys(want)) {
      for (const ctx of [named, indexed]) {
        const got = vm.runInNewContext(E.imageryViewExpression(src, which, size), Object.assign({}, ctx));
        assert.deepEqual(typeof got === "number" ? got : Array.from(got), want[which], which);
      }
    }
  }
  const meta = { camera: "javaScript#1", category: "imagery", bent: true };
  const tagged = E.imageryViewExpression(src, "viewScale", size, meta);
  assert.deepEqual(E.readTag(tagged, "GEO_META"), meta);
  assert.ok(tagged.indexOf("/*GEO_META") === 0);
  assert.equal(E.readTag(E.imageryViewExpression(src, "viewScale", size), "GEO_META"), null);
  assert.throws(() => E.imageryViewExpression(src, "rotation", size), /Unknown imagery view driver: rotation/);
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
  assert.deepEqual(E.HANDLE_INPUTS, [["aHolderX", 0], ["aHolderY", 0], ["aStopX", 0], ["aStopY", 0], ["bHolderX", 0], ["bHolderY", 0], ["bStopX", 0], ["bStopY", 0],
    ["arc", 30], ["lean", 0], ["flip", 0], ["hand", 0], ["handX", 0], ["handY", 0],
    ["shape", 0], ["camLat", 0], ["camLon", 0], ["camZoom", 2], ["camRotation", 0], ["camProjection", 0], ["aLon", 0], ["aLat", 0], ["bLon", 0], ["bLat", 0]]);
  // Great circle branch: shape 1 uses greatCircleHandles, shape 0 stays Arc, hand still wins.
  const bundle = require("../tools/buildlib.js").buildCurveSource();
  const gcIn = ins.concat([1, 20, 10, 3, 15, 2, 0, 51, 100, 35]);
  const GC = require("../src/core/curve.js");
  const gcWant = GC.greatCircleHandles([10, 0], [190, 0], { cam: { lat: 20, lon: 10, zoom: 3, rotation: 15, projection: 2 }, aLon: 0, aLat: 51, bLon: 100, bLat: 35, offA: [10, 0], offB: [-10, 0] }, { arc: 40, lean: 20, flip: 0 });
  assert.deepEqual(Array.from(run(E.routeHandleExpression(bundle, {}, "start"), gcIn)), gcWant.start);
  assert.deepEqual(Array.from(run(E.routeHandleExpression(bundle, {}, "end"), gcIn)), gcWant.end);
  assert.notDeepEqual(gcWant.start, want.start);
  const arcIn = gcIn.slice(); arcIn[14] = 0;
  assert.deepEqual(Array.from(run(E.routeHandleExpression(bundle, {}, "start"), arcIn)), want.start);
  const gcHand = gcIn.slice(); gcHand[11] = 1;
  assert.deepEqual(Array.from(run(E.routeHandleExpression(bundle, {}, "end"), gcHand)), [7, 8]);
});

test("traveller scale helper: size times the source layer's own scale", () => {
  const vm = require("node:vm");
  const run = (expr, inputs) => vm.runInNewContext(expr, Object.fromEntries(inputs.map((v, i) => ["n" + i, v])));
  assert.deepEqual(E.TRAVELLER_SCALE_INPUTS, [["size", 1], ["sourceScaleX", 1], ["sourceScaleY", 1]]);
  const expr = E.travellerScaleExpression({ camera: "c", category: "travellerScale" });
  assert.deepEqual(Array.from(run(expr, [2, 0.25, 0.5])), [0.5, 1]);
  assert.deepEqual(Array.from(run(expr, [1, 1, 1])), [1, 1]);
  assert.equal(E.readTag(expr, "GEO_META").category, "travellerScale");
});

test("traveller helpers: tip clamps to 0..99.9; show is the current leg only", () => {
  const vm = require("node:vm");
  const run = (expr, inputs) => vm.runInNewContext(expr, Object.fromEntries(inputs.map((v, i) => ["n" + i, v])));
  const tip = E.travellerTipExpression({ camera: "c", category: "travellerTip" });
  assert.equal(run(tip, [0]), 0);
  assert.equal(run(tip, [50]), 50);
  assert.equal(run(tip, [100]), 99.9);
  assert.equal(run(tip, [-5]), 0);
  assert.deepEqual(E.TRAVELLER_TIP_INPUTS.map((i) => i[0]), ["drawOn"]);
  assert.deepEqual(E.travellerShowInputs(2).map((i) => i[0]), ["drawOn", "legOpacity", "later1", "later2"]);
  const show2 = E.travellerShowExpression({ camera: "c", category: "travellerShow" }, 2);
  assert.equal(run(show2, [0, 100, 0, 0]), 0, "not started → hidden");
  assert.equal(run(show2, [40, 100, 0, 0]), 100, "drawing, later legs not started → shown");
  assert.equal(run(show2, [100, 100, 30, 0]), 0, "a later leg has started → hidden");
  assert.equal(run(show2, [40, 0, 0, 0]), 0, "leg faded out → hidden");
  const show0 = E.travellerShowExpression({ camera: "c", category: "travellerShow" }, 0);
  assert.equal(run(show0, [100, 100]), 100, "last leg fully drawn → shown at the end");
});

test("furniture inputs and expressions", () => {
  assert.deepEqual(E.SCALE_BAR_INPUTS.map((i) => i[0]), ["camLat", "camLon", "camZoom", "camRotation", "camProjection", "compW", "compH", "units", "style", "corner", "margin", "maxWidth", "raise", "textSize"]);
  assert.deepEqual(E.SCALE_BAR_INPUTS.slice(5).map((i) => i[1]), [1920, 1080, 0, 0, 2, 40, 200, 0, 16]);
  assert.deepEqual(E.NORTH_ARROW_INPUTS.map((i) => i[0]), ["camLat", "camLon", "camZoom", "camRotation", "camProjection", "compW", "compH", "style", "corner", "margin", "size"]);
  assert.deepEqual(E.NORTH_ARROW_INPUTS.slice(5).map((i) => i[1]), [1920, 1080, 0, 1, 40, 40]);
  assert.deepEqual(E.FURNITURE_FADE_INPUTS, [["zoom", 2], ["hideBelow", 3]]);
  const sb = E.scaleBarExpression("/*SRC*/", { camera: "c", category: "scaleBar" });
  assert.deepEqual(E.readTag(sb, "GEO_META"), { camera: "c", category: "scaleBar" });
  assert.ok(sb.includes("/*SRC*/") && sb.includes("GeoFurniture.scaleBar("));
  assert.ok(E.northArrowExpression("/*SRC*/", { camera: "c", category: "northArrow" }).includes("GeoFurniture.northArrow("));
});

test("the fade expression evaluates exactly like GeoFurniture.fade", () => {
  const F = require("../src/core/furniture.js");
  const expr = E.furnitureFadeExpression({ camera: "c", category: "scaleBarFade" });
  [[2, 3], [2.75, 3], [5, 3], [1, 0]].forEach(([zoom, hideBelow]) => {
    const got = Function("zoom", "hideBelow", "return eval(" + JSON.stringify(expr) + ");")(zoom, hideBelow);
    assert.equal(got, F.fade(zoom, hideBelow));
  });
});

test("the bundled scale bar and north arrow layer expressions run and draw", () => {
  const { buildFurnitureSource } = require("../tools/buildlib.js");
  const src = buildFurnitureSource();
  class Path {
    constructor() { this.cmds = []; }
    moveTo() { this.cmds.push(["moveTo"]); }
    lineTo() { this.cmds.push(["lineTo"]); }
    close() { this.cmds.push(["close"]); }
    addEllipse() { this.cmds.push(["addEllipse"]); }
    addText(t) { this.cmds.push(["addText", t]); }
  }
  const run = (expr, inputs) => {
    const names = inputs.map((x) => x[0]), values = inputs.map((x) => x[1]);
    // `require` is not in scope, as in Cavalry
    return Function(...names, "cavalry", "require", "return eval(" + JSON.stringify(expr) + ");")(...values, { Path }, undefined);
  };
  const bar = run(E.scaleBarExpression(src, { camera: "c", category: "scaleBar" }), E.SCALE_BAR_INPUTS.map((x) => x[0] === "lat" ? ["lat", 48.85] : x[0] === "zoom" ? ["zoom", 12] : x));
  const barText = bar.cmds.filter((c) => c[0] === "addText").map((c) => c[1]);
  assert.ok(bar.cmds.filter((c) => c[0] === "lineTo").length >= 3, "the bar has drawing commands");
  assert.equal(barText.length, 1);
  assert.match(barText[0], /^[\d,]+ (m|km)$/, "a distance label");
  const arrow = run(E.northArrowExpression(src, { camera: "c", category: "northArrow" }), E.NORTH_ARROW_INPUTS);
  assert.ok(arrow.cmds.filter((c) => c[0] === "lineTo").length >= 3, "the arrow has drawing commands");
  assert.deepEqual(arrow.cmds.filter((c) => c[0] === "addText").map((c) => c[1]), ["N"]);
});

test("route draw helper: Travel % draws the legs one after another", () => {
  assert.deepEqual(E.ROUTE_DRAW_INPUTS, [["travel", 100], ["index", 0], ["count", 1]]);
  const expr = E.routeDrawExpression({ camera: "c", category: "routeDraw" });
  assert.deepEqual(E.readTag(expr, "GEO_META"), { camera: "c", category: "routeDraw" });
  const run = (travel, index, count) => Function("travel", "index", "count", "return eval(" + JSON.stringify(expr) + ");")(travel, index, count);
  const legs = (t) => [0, 1, 2].map((i) => Math.round(run(t, i, 3) * 10) / 10);
  assert.deepEqual(legs(0), [0, 0, 0]);
  assert.deepEqual(legs(100 / 6), [50, 0, 0]);
  assert.deepEqual(legs(100 / 3), [100, 0, 0]);
  assert.deepEqual(legs(50), [100, 50, 0]);
  assert.deepEqual(legs(100), [100, 100, 100]);
});

test("callout geometry: edge, bend and the two draw-on lines", () => {
  const GEOM = [["placeX", 0], ["placeY", 0], ["boxX", 0], ["boxY", 0], ["boxW", 0], ["boxH", 0], ["style", 1], ["elbow", 40]];
  assert.deepEqual(E.CALLOUT_GEOM_INPUTS, GEOM);
  assert.deepEqual(E.CALLOUT_DRAW_INPUTS, GEOM.concat([["draw", 100], ["index", 0]]));
  const meta = { camera: "c", category: "callout" };
  const exprs = { edge: E.calloutEdgeExpression(meta), bend: E.calloutBendExpression(meta), draw: E.calloutDrawExpression(meta) };
  for (const k of Object.keys(exprs)) assert.deepEqual(E.readTag(exprs[k], "GEO_META"), meta);
  const names = (inputs) => inputs.map((x) => x[0]);
  const evalExpr = (expr, inputs, vals) => Function.apply(null, names(inputs).concat(["return eval(" + JSON.stringify(expr) + ");"]))
    .apply(null, names(inputs).map((n) => vals[n]));
  const base = { placeX: 400, placeY: -110, boxX: 100, boxY: 50, boxW: 200, boxH: 60, style: 1, elbow: 40, draw: 100, index: 0 };
  const edge = (o) => evalExpr(exprs.edge, E.CALLOUT_GEOM_INPUTS, Object.assign({}, base, o));
  const bend = (o) => evalExpr(exprs.bend, E.CALLOUT_GEOM_INPUTS, Object.assign({}, base, o));
  const draw = (o) => evalExpr(exprs.draw, E.CALLOUT_DRAW_INPUTS, Object.assign({}, base, o));
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + " vs " + b);
  // place right of the box
  assert.deepEqual(edge({}), [200, 50]);
  assert.deepEqual(bend({}), [240, 50]);
  assert.deepEqual(bend({ style: 0 }), [200, 50]);
  // place left of the box
  assert.deepEqual(edge({ placeX: -300 }), [0, 50]);
  assert.deepEqual(bend({ placeX: -300 }), [-40, 50]);
  // the elbow never goes past the place: a place within 40 px of the edge puts the bend on the place's x, farther keeps 40
  assert.deepEqual(bend({ placeX: 230 }), [230, 50]);
  assert.deepEqual(bend({ placeX: 200 }), [200, 50]);
  assert.deepEqual(bend({ placeX: 240 }), [240, 50]);
  assert.deepEqual(bend({ placeX: 241 }), [240, 50]);
  assert.deepEqual(bend({ placeX: -15 }), [-15, 50]);
  assert.deepEqual(bend({ placeX: -15, style: 0 }), [0, 50]);
  assert.deepEqual(bend({ placeX: 230, elbow: 10 }), [210, 50]);
  // a place inside the box (the wrong side of the edge) keeps the bend on the edge
  assert.deepEqual(bend({ placeX: 150 }), [200, 50]);
  // draw split, Elbow: label to bend first (40 px), then bend to place
  const len2 = Math.hypot(400 - 240, -110 - 50);
  const both = (d) => [draw({ draw: d, index: 0 }), draw({ draw: d, index: 1 })];
  assert.deepEqual(both(0), [0, 0]);
  assert.deepEqual(both(100), [100, 100]);
  const split = both(40 / (40 + len2) * 100);
  close(split[0], 100); close(split[1], 0);
  const half = both((40 + len2 / 2) / (40 + len2) * 100);
  close(half[0], 100); close(half[1], 50);
  // Straight: line 1 is zero length, so it is full once Draw % starts and empty at 0; line 2 follows Draw %
  for (const d of [0, 25, 100]) {
    const s = [draw({ style: 0, draw: d, index: 0 }), draw({ style: 0, draw: d, index: 1 })];
    close(s[0], d > 0 ? 100 : 0); close(s[1], d);
  }
  // everything collapsed: both lines follow Draw %
  const flat = { placeX: 200, placeY: 50, style: 0 };
  close(draw(Object.assign({ draw: 30, index: 0 }, flat)), 30);
  close(draw(Object.assign({ draw: 30, index: 1 }, flat)), 30);
});

test("highlight shape: Pulse grows the outline by phase × 40, Glow by 6, Fill in and Outline not at all", () => {
  assert.deepEqual(E.HIGHLIGHT_SHAPE_INPUTS, E.MAP_INPUTS.concat([["phase", 0]]));
  const enc = { kind: "polygon", features: [] };
  const run = (effect, phase) => {
    const calls = [], path = { pointCount: () => 10, offset: (d, round) => calls.push([d, round]) };
    const src = "var GeoRuntime = { buildPath: function () { return GEO_PATH; } };";
    const expr = E.highlightLayerExpression(src, enc, { camera: "c", category: "highlight", effect }, {});
    assert.deepEqual(E.readTag(expr, "GEO_META"), { camera: "c", category: "highlight", effect });
    assert.deepEqual(E.readData(expr), enc);
    const out = Function("GEO_PATH", "phase", "cavalry", "return eval(" + JSON.stringify(expr) + ");")(path, phase, { Path: function () {} });
    assert.equal(out, path);
    return calls;
  };
  assert.deepEqual(run("pulse", 0.5), [[20, true]]);
  assert.deepEqual(run("glow", 0), [[6, true]]);
  assert.deepEqual(run("fill", 0), []);
  assert.deepEqual(run("outline", 0), []);
});

test("highlight shape: a large outline grows by scaling about its box centre, not by offset", () => {
  const calls = [];
  const path = {
    pointCount: () => 5000,
    boundingBox: () => { calls.push(["boundingBox"]); return { width: 200, height: 100, centre: { x: 50, y: 25 } }; },
    translate: (x, y) => calls.push(["translate", x, y]),
    scale: (sx, sy) => calls.push(["scale", sx, sy]),
    offset: () => calls.push(["offset"])
  };
  const src = "var GeoRuntime = { buildPath: function () { return GEO_PATH; } };";
  const expr = E.highlightLayerExpression(src, { kind: "polygon", features: [] }, { camera: "c", category: "highlight", effect: "pulse" }, {});
  const out = Function("GEO_PATH", "phase", "cavalry", "return eval(" + JSON.stringify(expr) + ");")(path, 0.5, { Path: function () {} });
  assert.equal(out, path);
  const s = 1 + 40 / 150;
  assert.deepEqual(calls, [["boundingBox"], ["translate", -50, -25], ["scale", s, s], ["translate", 50, 25]]);
});

test("highlight shape: a failing offset still returns the plain outline", () => {
  const src = "var GeoRuntime = { buildPath: function () { return GEO_PATH; } };";
  const expr = E.highlightLayerExpression(src, { kind: "polygon", features: [] }, { camera: "c", category: "highlight", effect: "glow" }, {});
  const path = { offset: () => { throw new Error("no"); } };
  assert.equal(Function("GEO_PATH", "cavalry", "return eval(" + JSON.stringify(expr) + ");")(path, { Path: function () {} }), path);
});

test("highlight fade: (1 - phase) × 100", () => {
  assert.deepEqual(E.HIGHLIGHT_FADE_INPUTS, [["phase", 0]]);
  const expr = E.highlightFadeExpression({ camera: "c", category: "highlightFade" });
  assert.deepEqual(E.readTag(expr, "GEO_META"), { camera: "c", category: "highlightFade" });
  const run = (phase) => Function("phase", "return eval(" + JSON.stringify(expr) + ");")(phase);
  assert.equal(run(0), 100);
  assert.equal(run(0.25), 75);
  assert.equal(run(1), 0);
});

test("day & night expressions: inputs, tags and the bundled runtime", () => {
  const S = require("../src/core/sun.js");
  const cam5 = ["camLat", "camLon", "camZoom", "camRotation", "camProjection"];
  assert.deepEqual(E.NIGHT_INPUTS.map((i) => i[0]), cam5.concat(["dayOfYear", "utcTime", "depression"]));
  assert.deepEqual(E.NIGHT_OPACITY_INPUTS, [["night", 55], ["twilight", 1], ["step", 0]]);
  assert.deepEqual(E.TIME_LABEL_INPUTS.map((i) => i[0]), cam5.concat(["dayOfYear", "utcTime", "compW", "compH", "corner", "margin", "size"]));
  assert.deepEqual(E.TIME_LABEL_INPUTS.slice(7).map((i) => i[1]), [1920, 1080, 0, 40, 18]);
  const { buildSunSource } = require("../tools/buildlib.js");
  const src = buildSunSource();
  assert.ok(!/var Geo(Codec|Runtime|Routes) =/.test(src), "the sun bundle is projection + furniture + sun only");
  const night = E.nightExpression(src, { camera: "c", category: "dayNight", depression: 6 });
  assert.deepEqual(E.readTag(night, "GEO_META"), { camera: "c", category: "dayNight", depression: 6 });
  assert.deepEqual(E.readTag(E.timeLabelExpression("/*S*/", { camera: "c", category: "timeLabel" }), "GEO_META"), { camera: "c", category: "timeLabel" });
  assert.deepEqual(E.readTag(E.nightOpacityExpression({ camera: "c", category: "dayNightOpacity", step: 2 }), "GEO_META"), { camera: "c", category: "dayNightOpacity", step: 2 });
  class Path {
    constructor() { this.cmds = []; }
    moveTo() { this.cmds.push(["moveTo"]); }
    lineTo() { this.cmds.push(["lineTo"]); }
    close() { this.cmds.push(["close"]); }
    addEllipse() { this.cmds.push(["addEllipse"]); }
    addText(t) { this.cmds.push(["addText", t]); }
  }
  const run = (expr, inputs) => {
    const names = inputs.map((x) => x[0]), values = inputs.map((x) => x[1]);
    return Function(...names, "cavalry", "require", "return eval(" + JSON.stringify(expr) + ");")(...values, { Path }, undefined);
  };
  const withIn = (list, o) => list.map((x) => (x[0] in o ? [x[0], o[x[0]]] : x));
  const p = run(night, withIn(E.NIGHT_INPUTS, { camZoom: 1, dayOfYear: 80, utcTime: 12, depression: 6 }));
  assert.equal(p.cmds.filter((c) => c[0] === "close").length, 2, "the antimeridian copy is drawn");
  const lab = run(E.timeLabelExpression(src, { camera: "c", category: "timeLabel" }), withIn(E.TIME_LABEL_INPUTS, { dayOfYear: 172, utcTime: 14.5 }));
  assert.deepEqual(lab.cmds.filter((c) => c[0] === "addText").map((c) => c[1]), ["21 Jun · 14:30 UTC"]);
  [[55, 1], [55, 0], [30, 1], [100, 1], [0, 1]].forEach(([n, t]) => [0, 1, 2, 3].forEach((step) => {
    const got = run(E.nightOpacityExpression({ camera: "c", category: "dayNightOpacity", step }), [["night", n], ["twilight", t], ["step", step]]);
    assert.ok(Math.abs(got - S.stepOpacity(n, t, step)) < 1e-9);
  }));
});

test("the opacity expression treats non-numbers as the defaults", () => {
  const expr = E.nightOpacityExpression({ camera: "c", category: "dayNightOpacity", step: 0 });
  const got = Function("night", "twilight", "step", "return eval(" + JSON.stringify(expr) + ");")(NaN, undefined, "x");
  assert.ok(isFinite(got));
  assert.ok(Math.abs(got - require("../src/core/sun.js").stepOpacity(55, 1, 0)) < 1e-9);
});

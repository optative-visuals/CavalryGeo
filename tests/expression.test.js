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
  assert.ok(E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 0 }).includes("ellipseScale: 0,"));
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
    ["shape", 0], ["camLat", 0], ["camLon", 0], ["camZoom", 2], ["camRotation", 0], ["camProjection", 0], ["aLon", 0], ["aLat", 0], ["bLon", 0], ["bLat", 0],
    ["aChainLon", 0], ["bChainLon", 0], ["refLon", 0]]);
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
  assert.deepEqual(E.travellerShowInputs(2).map((i) => i[0]), ["drawOn", "legOpacity", "later1", "later2", "trimStart", "drawFull"]);
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
  const GEOM0 = [["placeX", 0], ["placeY", 0], ["boxX", 0], ["boxY", 0], ["boxW", 0], ["boxH", 0], ["style", 1], ["elbow", 40]];
  // the anchor is appended to both lists, so every older index keeps its meaning (draw 8, index 9 in the draw list)
  assert.deepEqual(E.CALLOUT_GEOM_INPUTS, GEOM0.concat([["anchor", 1]]));
  assert.deepEqual(E.CALLOUT_DRAW_INPUTS, GEOM0.concat([["draw", 100], ["index", 0], ["anchor", 1]]));
  assert.equal(E.inputIndex(E.CALLOUT_GEOM_INPUTS, "anchor"), 8);
  assert.equal(E.inputIndex(E.CALLOUT_DRAW_INPUTS, "anchor"), 10);
  const meta = { camera: "c", category: "callout" };
  const exprs = { edge: E.calloutEdgeExpression(meta), bend: E.calloutBendExpression(meta), draw: E.calloutDrawExpression(meta) };
  for (const k of Object.keys(exprs)) assert.deepEqual(E.readTag(exprs[k], "GEO_META"), meta);
  const names = (inputs) => inputs.map((x) => x[0]);
  const evalExpr = (expr, inputs, vals) => Function.apply(null, names(inputs).concat(["return eval(" + JSON.stringify(expr) + ");"]))
    .apply(null, names(inputs).map((n) => vals[n]));
  const base = { placeX: 400, placeY: -110, boxX: 100, boxY: 50, boxW: 200, boxH: 60, style: 1, elbow: 40, draw: 100, index: 0, anchor: 0 };
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

test("callout anchor: Side is today's geometry bit for bit, whatever the place, box and elbow", () => {
  const meta = { camera: "c", category: "callout" };
  const names = (inputs) => inputs.map((x) => x[0]);
  const run = (expr, inputs, vals) => Function.apply(null, names(inputs).concat(["return eval(" + JSON.stringify(expr) + ");"])).apply(null, names(inputs).map((n) => vals[n]));
  // the geometry as it was before the anchor existed
  const old = (v) => {
    const cs = v.placeX < v.boxX ? -1 : 1, ce = [v.boxX + cs * v.boxW / 2, v.boxY];
    const cb = v.style >= 0.5 ? [ce[0] + cs * Math.min(v.elbow, Math.max(0, cs * (v.placeX - ce[0]))), ce[1]] : ce;
    return { ce, cb };
  };
  const xs = [-700, -300, -15, 0, 99.5, 100, 150, 200, 230, 241, 400, 900], ys = [-400, -110, 0, 50, 300];
  let n = 0;
  for (const placeX of xs) for (const placeY of ys) for (const style of [0, 1]) for (const elbow of [0, 10, 40]) for (const boxX of [100, -50]) {
    const v = { placeX, placeY, boxX, boxY: 50, boxW: 200, boxH: 60, style, elbow, anchor: 0, draw: 100, index: 0 }, want = old(v);
    assert.deepStrictEqual(run(E.calloutEdgeExpression(meta), E.CALLOUT_GEOM_INPUTS, v), want.ce);
    assert.deepStrictEqual(run(E.calloutBendExpression(meta), E.CALLOUT_GEOM_INPUTS, v), want.cb);
    n++;
  }
  assert.ok(n > 500);
  // a negative anchor, or one that rounds to 0, is Side too
  const v = { placeX: 400, placeY: -110, boxX: 100, boxY: 50, boxW: 200, boxH: 60, style: 1, elbow: 40, anchor: -3 };
  assert.deepStrictEqual(run(E.calloutBendExpression(meta), E.CALLOUT_GEOM_INPUTS, v), [240, 50]);
  assert.deepStrictEqual(run(E.calloutBendExpression(meta), E.CALLOUT_GEOM_INPUTS, Object.assign({}, v, { anchor: 0.4 })), [240, 50]);
});

test("callout anchor: Auto takes the nearest of the box's 8 points; 2-9 are fixed", () => {
  const meta = { camera: "c", category: "callout" };
  const names = (inputs) => inputs.map((x) => x[0]);
  const run = (expr, inputs, vals) => Function.apply(null, names(inputs).concat(["return eval(" + JSON.stringify(expr) + ");"])).apply(null, names(inputs).map((n) => vals[n]));
  // box centre (100, 50), 200 x 60: x edges at 0 and 200, y edges at 20 (bottom) and 80 (top); y points up
  const pts = { 2: [0, 80], 3: [100, 80], 4: [200, 80], 5: [200, 50], 6: [200, 20], 7: [100, 20], 8: [0, 20], 9: [0, 50] };
  const base = { boxX: 100, boxY: 50, boxW: 200, boxH: 60, style: 0, elbow: 40, draw: 100, index: 0 };
  const edge = (o) => run(E.calloutEdgeExpression(meta), E.CALLOUT_GEOM_INPUTS, Object.assign({}, base, o));
  const bend = (o) => run(E.calloutBendExpression(meta), E.CALLOUT_GEOM_INPUTS, Object.assign({}, base, o));
  const far = { 2: [-300, 400], 3: [100, 500], 4: [500, 400], 5: [500, 50], 6: [500, -300], 7: [100, -300], 8: [-300, -300], 9: [-300, 50] };
  const opposite = { 2: 6, 3: 7, 4: 8, 5: 9, 6: 2, 7: 3, 8: 4, 9: 5 };
  Object.keys(pts).forEach((k) => {
    assert.deepStrictEqual(edge({ anchor: 1, placeX: far[k][0], placeY: far[k][1] }), pts[k], "auto picks point " + k);
    // a fixed anchor ignores where the place is
    assert.deepStrictEqual(edge({ anchor: Number(k), placeX: far[opposite[k]][0], placeY: far[opposite[k]][1] }), pts[k], "fixed " + k);
    assert.deepStrictEqual(bend({ anchor: Number(k), style: 0, placeX: far[opposite[k]][0], placeY: far[opposite[k]][1] }), pts[k], "straight bend is the point " + k);
  });
  // Auto follows the place: moving it along the top changes the point
  assert.deepStrictEqual(edge({ anchor: 1, placeX: 120, placeY: 400 }), [100, 80]);
  assert.deepStrictEqual(edge({ anchor: 1, placeX: 20, placeY: 400 }), [0, 80]);
  // anchor values past 9 stay on the last point
  assert.deepStrictEqual(edge({ anchor: 12, placeX: 0, placeY: 0 }), pts[9]);
});

test("callout anchor: elbows bend outward, horizontally from sides and corners, vertically from top and bottom, never past the place", () => {
  const meta = { camera: "c", category: "callout" };
  const names = (inputs) => inputs.map((x) => x[0]);
  const run = (expr, inputs, vals) => Function.apply(null, names(inputs).concat(["return eval(" + JSON.stringify(expr) + ");"])).apply(null, names(inputs).map((n) => vals[n]));
  const base = { boxX: 100, boxY: 50, boxW: 200, boxH: 60, style: 1, elbow: 40, draw: 100, index: 0 };
  const bend = (o) => run(E.calloutBendExpression(meta), E.CALLOUT_GEOM_INPUTS, Object.assign({}, base, o));
  // top edge midpoint (100, 80): vertical, up
  assert.deepStrictEqual(bend({ anchor: 3, placeX: 300, placeY: 400 }), [100, 120]);
  assert.deepStrictEqual(bend({ anchor: 3, placeX: 300, placeY: 100 }), [100, 100], "stops on the place's y");
  assert.deepStrictEqual(bend({ anchor: 3, placeX: 300, placeY: 80 }), [100, 80]);
  assert.deepStrictEqual(bend({ anchor: 3, placeX: 300, placeY: 30 }), [100, 80], "a place below the top edge keeps the bend on the point");
  // bottom edge midpoint (100, 20): vertical, down
  assert.deepStrictEqual(bend({ anchor: 7, placeX: 300, placeY: -400 }), [100, -20]);
  assert.deepStrictEqual(bend({ anchor: 7, placeX: -300, placeY: -5 }), [100, -5]);
  assert.deepStrictEqual(bend({ anchor: 7, placeX: 300, placeY: 60 }), [100, 20]);
  // corners and sides: horizontal, outward
  assert.deepStrictEqual(bend({ anchor: 4, placeX: 600, placeY: 400 }), [240, 80]);
  assert.deepStrictEqual(bend({ anchor: 4, placeX: 215, placeY: 400 }), [215, 80]);
  assert.deepStrictEqual(bend({ anchor: 8, placeX: -600, placeY: -400 }), [-40, 20]);
  assert.deepStrictEqual(bend({ anchor: 6, placeX: 600, placeY: -400 }), [240, 20]);
  assert.deepStrictEqual(bend({ anchor: 2, placeX: -10, placeY: 400 }), [-10, 80]);
  assert.deepStrictEqual(bend({ anchor: 5, placeX: 600, placeY: 0, elbow: 10 }), [210, 50]);
  assert.deepStrictEqual(bend({ anchor: 9, placeX: -600, placeY: 0 }), [-40, 50]);
  // Auto bends the way its chosen point faces
  assert.deepStrictEqual(bend({ anchor: 1, placeX: 100, placeY: 400 }), [100, 120]);
  assert.deepStrictEqual(bend({ anchor: 1, placeX: 600, placeY: 50 }), [240, 50]);
  // Straight: the line goes from the point straight to the place
  assert.deepStrictEqual(bend({ anchor: 3, style: 0, placeX: 300, placeY: 400 }), [100, 80]);
});

test("callout anchor: draw-on lengths follow the chosen point and stay consistent", () => {
  const meta = { camera: "c", category: "callout" };
  const names = (inputs) => inputs.map((x) => x[0]);
  const run = (expr, inputs, vals) => Function.apply(null, names(inputs).concat(["return eval(" + JSON.stringify(expr) + ");"])).apply(null, names(inputs).map((n) => vals[n]));
  const base = { placeX: 300, placeY: 400, boxX: 100, boxY: 50, boxW: 200, boxH: 60, style: 1, elbow: 40, index: 0, anchor: 3 };
  const draw = (o) => run(E.calloutDrawExpression(meta), E.CALLOUT_DRAW_INPUTS, Object.assign({}, base, o));
  // top midpoint (100, 80) -> bend (100, 120) -> place (300, 400): 40 px, then the rest
  const len1 = 40, len2 = Math.hypot(300 - 100, 400 - 120), both = (d) => [draw({ draw: d, index: 0 }), draw({ draw: d, index: 1 })];
  assert.deepStrictEqual(both(0), [0, 0]);
  assert.deepStrictEqual(both(100), [100, 100]);
  const split = both(len1 / (len1 + len2) * 100);
  assert.ok(Math.abs(split[0] - 100) < 1e-9 && Math.abs(split[1]) < 1e-9);
  const half = both((len1 + len2 / 2) / (len1 + len2) * 100);
  assert.ok(Math.abs(half[0] - 100) < 1e-9 && Math.abs(half[1] - 50) < 1e-9);
  // Side and a fixed Right give the same lengths for a place to the right; Auto matches the anchor it picks
  const pair = (o) => [draw(Object.assign({ draw: 60, index: 0 }, o)), draw(Object.assign({ draw: 60, index: 1 }, o))];
  assert.deepStrictEqual(pair({ placeX: 600, placeY: 50, anchor: 0 }), pair({ placeX: 600, placeY: 50, anchor: 5 }));
  assert.deepStrictEqual(pair({ placeX: 600, placeY: 50, anchor: 1 }), pair({ placeX: 600, placeY: 50, anchor: 5 }));
  assert.deepStrictEqual(pair({ placeX: 100, placeY: 400, anchor: 1 }), pair({ placeX: 100, placeY: 400, anchor: 3 }));
  // Straight: line 1 has no length, so it is full once Draw % starts; line 2 follows Draw %
  const straight = { style: 0, draw: 25 };
  assert.deepStrictEqual([draw(Object.assign({ index: 0 }, straight)), draw(Object.assign({ index: 1 }, straight))], [100, 25]);
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

test("highlight shape: drawn whole (one shape, one copy) by buildPath", () => {
  const expr = E.highlightLayerExpression("var GeoRuntime = {};", { kind: "polygon", features: [] }, { camera: "c", category: "highlight", effect: "fill" }, {});
  assert.ok(expr.includes("{pointRadius: _i6, ellipseScale: 1, whole: true}"));
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
  const cam5 = ["camLat", "camLon", "camZoom", "camRotation", "camProjection"];
  assert.deepEqual(E.NIGHT_INPUTS.map((i) => i[0]), cam5.concat(["dayOfYear", "utcTime", "depression"]));
  assert.deepEqual(E.NIGHT_OPACITY_INPUTS, [["night", 55], ["twilight", 1], ["step", 0], ["lights", 0]]);
  assert.deepEqual(E.NIGHT_OPACITY_INPUTS.map((i) => i[0]), ["night", "twilight", "step", "lights"]);
  assert.deepEqual(E.TIME_LABEL_INPUTS.map((i) => i[0]), cam5.concat(["dayOfYear", "utcTime", "compW", "compH", "corner", "margin", "size"]));
  assert.deepEqual(E.TIME_LABEL_INPUTS.slice(7).map((i) => i[1]), [1920, 1080, 0, 40, 18]);
  const { buildSunSource } = require("../tools/buildlib.js");
  const src = buildSunSource();
  assert.ok(!/var Geo(Codec|Runtime|Routes) =/.test(src), "the sun bundle is projection + furniture + sun only");
  assert.deepEqual(E.readTag(E.timeLabelExpression("/*S*/", { camera: "c", category: "timeLabel" }), "GEO_META"), { camera: "c", category: "timeLabel" });
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
  const lab = run(E.timeLabelExpression(src, { camera: "c", category: "timeLabel" }), withIn(E.TIME_LABEL_INPUTS, { dayOfYear: 172, utcTime: 14.5 }));
  assert.deepEqual(lab.cmds.filter((c) => c[0] === "addText").map((c) => c[1]), ["21 Jun · 14:30 UTC"]);
});

test("route clip helpers: trim start / trim end / fade follow GeoCurve.visibleSpan on the globe", () => {
  const vm = require("node:vm");
  const bundle = require("../tools/buildlib.js").buildCurveSource();
  const Curve = require("../src/core/curve.js"), P = require("../src/core/projection.js");
  const byName = (extra) => {
    const ctx = {};
    E.CLIP_INPUTS.forEach((inp) => { ctx[inp[0]] = inp[1]; });
    return Object.assign(ctx, extra);
  };
  const run = (expr, extra) => vm.runInNewContext(expr, byName(extra));
  const meta = (c) => ({ camera: "c", category: c });
  const expr = { start: E.routeClipStartExpression(bundle, meta("legClip")), end: E.routeClipEndExpression(bundle, meta("legClip")), fade: E.routeClipFadeExpression(bundle, meta("legFade")) };
  assert.deepEqual(E.readTag(expr.start, "GEO_META"), { camera: "c", category: "legClip" });
  assert.equal(E.CLIP_INPUTS[0][0], "fromOpacity"); assert.equal(E.CLIP_INPUTS[1][0], "toOpacity");
  assert.equal(E.FADE_INPUTS.length, 2);
  // London -> Tokyo from the west: a stop hidden at the far end.
  const cam = { lat: 0, lon: -30, zoom: 2, rotation: 0, projection: 2 }, L = [-0.13, 51.51], T = [139.69, 35.68];
  const pr = P.makeProjector(cam, false), p0 = [0, 0], p1 = [0, 0];
  pr(L[0], L[1], p0); pr(T[0], T[1], p1);
  const gc = { cam, aLon: L[0], aLat: L[1], bLon: T[0], bLat: T[1], offA: [0, 0], offB: [0, 0] };
  const h = Curve.greatCircleHandles(p0, p1, gc, { arc: 0 });
  const span = Curve.visibleSpan(p0, p1, h.start, h.end, gc);
  const inputs = { aX: p0[0], aY: p0[1], bX: p1[0], bY: p1[1], startX: h.start[0], startY: h.start[1], endX: h.end[0], endY: h.end[1], shape: 1,
    camLat: cam.lat, camLon: cam.lon, camZoom: cam.zoom, camRotation: 0, camProjection: 2, aLon: L[0], aLat: L[1], bLon: T[0], bLat: T[1] };
  assert.ok(span.s1 > 0.1 && span.s1 < 0.9);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " vs " + b);
  near(run(expr.start, inputs), 0);
  near(run(expr.end, Object.assign({ draw: 100 }, inputs)), span.s1 * 100);
  near(run(expr.end, Object.assign({ draw: 20 }, inputs)), 20);
  assert.equal(run(expr.fade, Object.assign({ fromOpacity: 0 }, inputs)), 100, "a hidden stop no longer fades the leg");
  // Seen from the east the leg starts at the limb; trim start never passes the draw.
  const cam2 = { lat: 0, lon: 110, zoom: 2, rotation: 0, projection: 2 }, pr2 = P.makeProjector(cam2, false), q0 = [0, 0], q1 = [0, 0];
  pr2(L[0], L[1], q0); pr2(T[0], T[1], q1);
  const gc2 = { cam: cam2, aLon: L[0], aLat: L[1], bLon: T[0], bLat: T[1], offA: [0, 0], offB: [0, 0] };
  const h2 = Curve.greatCircleHandles(q0, q1, gc2, { arc: 0 }), span2 = Curve.visibleSpan(q0, q1, h2.start, h2.end, gc2);
  const in2 = Object.assign({}, inputs, { aX: q0[0], aY: q0[1], bX: q1[0], bY: q1[1], startX: h2.start[0], startY: h2.start[1], endX: h2.end[0], endY: h2.end[1], camLon: 110 });
  assert.ok(span2.s0 > 0.1);
  near(run(expr.start, Object.assign({ draw: 100 }, in2)), span2.s0 * 100);
  near(run(expr.start, Object.assign({ draw: 5 }, in2)), 5);
  near(run(expr.end, Object.assign({ draw: 100 }, in2)), 100);
  // Nothing visible: fade 0, draw untouched.
  const far = Object.assign({}, inputs, { camLat: -65, camLon: -100 });
  assert.equal(run(expr.fade, Object.assign({ fromOpacity: 0, toOpacity: 0 }, far)), 0);
  near(run(expr.end, Object.assign({ draw: 70 }, far)), 70);
  // An Arc-shaped leg on the globe is clipped too.
  near(run(expr.end, Object.assign({ draw: 100 }, inputs, { shape: 0 })), Curve.arcSpan(p0, p1, h.start, h.end, gc).s1 * 100);
  assert.equal(run(expr.fade, Object.assign({ fromOpacity: 0, toOpacity: 0 }, far, { shape: 0 })), 0);
  assert.equal(run(expr.fade, Object.assign({ fromOpacity: 0, toOpacity: 0 }, inputs, { shape: 0 })), 100);
  // Flat map / Equal Earth: identical to today.
  [Object.assign({}, inputs, { camProjection: 0 }), Object.assign({}, inputs, { camProjection: 1 })].forEach((f) => {
    near(run(expr.start, Object.assign({ draw: 100 }, f)), 0);
    near(run(expr.end, Object.assign({ draw: 100 }, f)), 100);
    assert.equal(run(expr.fade, Object.assign({ fromOpacity: 100, toOpacity: 0 }, f)), 0, "stops' opacities still fade the leg");
    assert.equal(run(expr.fade, Object.assign({ fromOpacity: 100, toOpacity: 100 }, f)), 100);
  });
});

test("traveller show helper: also hides before the leg's clip start and after its clipped end", () => {
  const vm = require("node:vm");
  const run = (expr, extra) => vm.runInNewContext(expr, extra);
  const show = E.travellerShowExpression({ camera: "c", category: "travellerShow" }, 1);
  assert.deepEqual(E.travellerShowInputs(1).map((i) => i[0]), ["drawOn", "legOpacity", "later1", "trimStart", "drawFull"]);
  const base = { drawOn: 40, legOpacity: 100, later1: 0, trimStart: 0, drawFull: 0 };
  assert.equal(run(show, base), 100, "an unclipped leg behaves as before");
  assert.equal(run(show, Object.assign({}, base, { drawOn: 0 })), 0);
  assert.equal(run(show, Object.assign({}, base, { trimStart: 40 })), 0, "tip at the clip start: still round the back");
  assert.equal(run(show, Object.assign({}, base, { trimStart: 30 })), 100);
  assert.equal(run(show, Object.assign({}, base, { drawFull: 70 })), 0, "the draw has gone past the clipped end");
  assert.equal(run(show, Object.assign({}, base, { drawFull: 40 })), 100);
  assert.equal(run(show, Object.assign({}, base, { later1: 5 })), 0);
});

test("label driver expression: default output is unchanged and projects the place as given", () => {
  const plain = E.labelDriverExpression(buildRuntimeSource(), meta, "array");
  assert.equal(E.labelDriverExpression(buildRuntimeSource(), meta, "array", {}), plain);
  assert.equal(E.labelDriverExpression(buildRuntimeSource(), meta, "array", { nearest: false }), plain);
  assert.ok(plain.includes("GeoRuntime.projectPoint(_i5, _i6, "));
  assert.ok(!plain.includes("GeoRuntime.projectNearest("));
});

test("label driver expression with nearest: true calls projectNearest and folds the place onto the camera's copy", () => {
  const expr = E.labelDriverExpression(buildRuntimeSource(), meta, "array", { nearest: true });
  assert.ok(expr.includes("GeoRuntime.projectNearest(_i5, _i6, "));
  assert.ok(!expr.includes("GeoRuntime.projectPoint("));
  const ctx = { cavalry: {}, n0: 0, n1: -179.9, n2: 0, n3: 0, n4: 0, n5: 179.5, n6: 0 };
  const out = Array.from(vm.runInNewContext(expr, ctx));
  assert.ok(Math.abs(out[0]) <= 128 + 1e-6, `x ${out[0]} is a whole world away`);
});

test("map layer expression: nearest is passed to buildPath only when asked for", () => {
  const plain = E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 1 });
  assert.ok(!plain.includes("nearest: true"));
  const near = E.mapLayerExpression(buildRuntimeSource(), enc, meta, { ellipseScale: 1, nearest: true });
  assert.ok(near.includes("nearest: true"));
});

// Date line: the input lists as they were at 82b4dbd. Map and data layers gained compW and compH at the end only.
const MAP_BASE = [["camLat", 0], ["camLon", 0], ["camZoom", 2], ["camRotation", 0], ["camProjection", 0], ["detail", 100], ["pointRadius", 4]];
const COMP_SIZE = [["compW", 1920], ["compH", 1080]];
const COLOUR_BASE = [["low", "#f2e8cf", "color"], ["high", "#bc4749", "color"], ["useMiddle", 0], ["middle", "#ffffff", "color"], ["middleValue", 0], ["min", 0], ["max", 0]];
test("input lists: earlier names, defaults and indices are unchanged; compW and compH are appended last", () => {
  assert.deepEqual(E.MAP_INPUTS, MAP_BASE);
  assert.deepEqual(E.MAP_LAYER_INPUTS, MAP_BASE.concat(COMP_SIZE));
  assert.deepEqual(E.REGION_INPUTS, MAP_BASE.concat([["year", 0]], COLOUR_BASE, [["noData", "#dddddd", "color"]], COMP_SIZE));
  assert.deepEqual(E.BUBBLE_INPUTS, MAP_BASE.concat([["year", 0], ["maxRadius", 40]], COMP_SIZE));
  assert.deepEqual(E.VALUE_LABEL_INPUTS, MAP_BASE.concat([["year", 0], ["textSize", 16], ["format", 0], ["decimals", 1]], COMP_SIZE));
  assert.deepEqual(E.ROUTE_INPUTS, MAP_BASE.concat([["lift", 30]]));
  assert.equal(E.inputIndex(E.MAP_LAYER_INPUTS, "compW"), 7);
  assert.equal(E.inputIndex(E.MAP_LAYER_INPUTS, "compH"), 8);
  assert.equal(E.inputIndex(E.REGION_INPUTS, "compW"), 16);
  assert.equal(E.inputIndex(E.BUBBLE_INPUTS, "compW"), 9);
  assert.equal(E.inputIndex(E.VALUE_LABEL_INPUTS, "compH"), 12);
});

const wide = C.encodeLayer({ kind: "polygon", features: [{ name: "a", rank: 1, rings: [[[-178.5, 0], [-177.5, 0], [-177.5, 1], [-178.5, 0]]] }] });
const copyCtx = (over) => Object.assign({ cavalry: { Path: FakePath }, n0: 0, n1: 175, n2: 4, n3: 0, n4: 0, n5: 100, n6: 4, n7: 1920, n8: 1080 }, over || {});
test("map layer expression repeats on flat maps: one copy east of the date line", () => {
  const expr = E.mapLayerExpression(buildRuntimeSource(), wide, meta, { ellipseScale: 1 });
  assert.ok(expr.includes("frame: {w: _i7, h: _i8}"));
  const ms = vm.runInNewContext(expr, copyCtx()).ops.filter((o) => o[0] === "M");
  assert.equal(ms.length, 2);
  assert.ok(ms[0][1] < -4000, "the original, 353 degrees west, is always drawn");
  assert.ok(ms[1][1] > 0, "plus the copy at +1 world-width, on the frame");
});

test("single things and old layers get no frame: the shape is drawn once at its own longitude", () => {
  const single = E.mapLayerExpression(buildRuntimeSource(), wide, meta, { ellipseScale: 1, single: true });
  assert.ok(!single.includes("frame: {w:"));
  const x = vm.runInNewContext(single, copyCtx()).ops[0][1];
  assert.ok(x < -4000, `x ${x} is the copy 353 degrees west`);
  const nearest = E.mapLayerExpression(buildRuntimeSource(), wide, meta, { ellipseScale: 1, nearest: true });
  assert.ok(!nearest.includes("frame: {w:"));
});

test("regions and bubbles expressions pass the comp frame into the data helpers", () => {
  const data = { geo: wide, series: [[[2010, 5]]], range: { min: 0, max: 10, maxAbs: 10 } };
  const regions = E.regionsExpression(buildDataRuntimeSource(), data, meta);
  assert.ok(regions.includes("frame: {w: _i16, h: _i17}"));
  const mesh = vm.runInNewContext(regions, copyCtx({ n7: 2010, cavalry: { Path: FakePath, Mesh: class { constructor() { this.paths = []; } addPath(p) { this.paths.push([p]); } }, Material: class {} } }));
  assert.equal(mesh.paths[1][0].ops.filter((o) => o[0] === "M").length, 2); // the original (off the frame) and its copy on the frame
  const bubbles = E.bubblesExpression(buildDataRuntimeSource(), { pts: [[170, 0]], series: [[[2010, 5]]], range: { min: 0, max: 10, maxAbs: 10 } }, meta);
  assert.ok(bubbles.includes("frame: {w: _i9, h: _i10}"));
  const dots = vm.runInNewContext(bubbles, copyCtx({ n1: 0, n2: 0, n7: 2010, n8: 40, n9: 1920, n10: 1080, cavalry: { Path: FakePath } })).ops;
  assert.equal(dots.length, 8);
  assert.ok(E.valueLabelsExpression(buildDataRuntimeSource(), { pts: [], series: [], range: {} }, meta).includes("frame: {w: _i11, h: _i12}"));
});

test("routes, highlights and the legends never take a frame", () => {
  assert.ok(!E.routeLayerExpression(buildRuntimeSource(), wide, meta, {}).includes("frame: {w:"));
  assert.ok(!E.highlightLayerExpression(buildRuntimeSource(), wide, { effect: "outline" }, {}).includes("frame: {w:"));
  assert.ok(!E.legendExpression(buildDataRuntimeSource(), { range: {}, title: "" }, meta).includes("frame: {w:"));
});

test("route stop driver: flat maps move a stop by the route's shift, globe and Equal Earth project its own longitude", () => {
  const GP = require("../src/core/projection.js");
  const src = buildRuntimeSource();
  const run = (expr, ins) => Array.from(vm.runInNewContext(expr, Object.fromEntries(ins.map((v, i) => ["n" + i, v]))));
  const at = (lon, lat, cam) => { const o = [0, 0]; GP.makeProjector(cam)(lon, lat, o); return o; };
  const near = (a, b) => assert.ok(a.every((v, k) => Math.abs(v - b[k]) < 1e-9), a + " is not " + b);
  const expr = E.routeStopDriverExpression(src, { camera: "c", category: "stopDriver" }, "array");
  // Inputs: camLat, camLon, zoom, rotation, projection, labelLon, labelLat, chainLon, refLon.
  // Tokyo (chained 139.69) -> Los Angeles (chained 241.76): the route's midpoint is 190.73, so the camera at 0 gets shift -360.
  const cam0 = { lat: 10, lon: 0, zoom: 2, rotation: 0, projection: 0 };
  near(run(expr, [10, 0, 2, 0, 0, 139.69, 35.68, 139.69, 190.725]), at(-220.31, 35.68, cam0));
  near(run(expr, [10, 0, 2, 0, 0, -118.24, 34.05, 241.76, 190.725]), at(-118.24, 34.05, cam0));
  // Camera at 180: the route is already nearest, so no shift.
  const cam180 = { lat: 10, lon: 180, zoom: 2, rotation: 0, projection: 0 };
  near(run(expr, [10, 180, 2, 0, 0, 139.69, 35.68, 139.69, 190.725]), at(139.69, 35.68, cam180));
  // Globe and Equal Earth ignore the chain: each stop projects its own longitude.
  [1, 2].forEach((projection) => {
    const cam = { lat: 10, lon: 0, zoom: 2, rotation: 0, projection };
    near(run(expr, [10, 0, 2, 0, projection, -118.24, 34.05, 241.76, 190.725]), at(-118.24, 34.05, cam));
  });
  assert.throws(() => E.routeStopDriverExpression(src, {}, "middle"), /Unknown driver return form/);
  assert.deepEqual(E.ROUTE_STOP_INPUTS.map((i) => i[0]), E.LABEL_INPUTS.map((i) => i[0]).concat(["chainLon", "refLon"]));
});

test("route handle expression: chained stops on flat maps use their chained longitudes moved by the route's shift", () => {
  const GP = require("../src/core/projection.js"), GC = require("../src/core/curve.js");
  const bundle = require("../tools/buildlib.js").buildCurveSource();
  const run = (expr, ins) => Array.from(vm.runInNewContext(expr, Object.fromEntries(ins.map((v, i) => ["n" + i, v]))));
  const H = (name) => E.inputIndex(E.HANDLE_INPUTS, name);
  assert.equal(E.HANDLE_INPUTS.length, 27);
  assert.deepEqual(E.HANDLE_INPUTS.slice(24).map((i) => i[0]), ["aChainLon", "bChainLon", "refLon"]);
  // First leg of Tokyo -> Los Angeles: Tokyo 139.69, LA chained 241.76; the route's midpoint 190.725 puts it on the copy at -360 from camera 0.
  const cam = { lat: 20, lon: 0, zoom: 1, rotation: 0, projection: 0 };
  const proj = GP.makeProjector(cam, true);
  const p0 = [0, 0], p1 = [0, 0];
  proj(-220.31, 35.68, p0); proj(-118.24, 34.05, p1);
  const ins = new Array(27).fill(0);
  Object.assign(ins, { 0: p0[0], 1: p0[1], 2: 0, 3: 0, 4: p1[0], 5: p1[1], 6: 0, 7: 0 });
  Object.assign(ins, { 8: 40, 9: 20, 10: 0, 11: 0, 12: 0, 13: 0, 14: 1, 15: 20, 16: 0, 17: 1, 18: 0, 19: 0, 20: 139.69, 21: 35.68, 22: -118.24, 23: 34.05 });
  Object.assign(ins, { 24: 139.69, 25: 241.76, 26: 190.725 });
  const want = GC.greatCircleHandles(p0, p1, { cam, aLon: -220.31, aLat: 35.68, bLon: -118.24, bLat: 34.05, offA: [0, 0], offB: [0, 0] }, { arc: 40, lean: 20, flip: 0 });
  const expr = (which) => E.routeHandleExpression(bundle, { camera: "c", category: "legHandle" }, which, { chained: true });
  assert.deepEqual(run(expr("start"), ins), want.start);
  assert.deepEqual(run(expr("end"), ins), want.end);
  // Unchained (older routes): the same helper keeps the old expression, which ignores the chain inputs.
  const old = E.routeHandleExpression(bundle, { camera: "c", category: "legHandle" }, "start");
  const oldIns = ins.slice(); oldIns[24] = 0; oldIns[25] = 0; oldIns[26] = 0;
  assert.deepEqual(run(old, ins), run(old, oldIns));
  // Globe: the chain is ignored and the raw longitudes are used.
  const gcam = { lat: 20, lon: 0, zoom: 1, rotation: 0, projection: 2 }, gproj = GP.makeProjector(gcam, true), g0 = [0, 0], g1 = [0, 0];
  gproj(139.69, 35.68, g0); gproj(-118.24, 34.05, g1);
  const globe = ins.slice(); globe[19] = 2; globe[15] = 20; globe[0] = g0[0]; globe[1] = g0[1]; globe[4] = g1[0]; globe[5] = g1[1];
  const gwant = GC.greatCircleHandles(g0, g1, { cam: gcam, aLon: 139.69, aLat: 35.68, bLon: -118.24, bLat: 34.05, offA: [0, 0], offB: [0, 0] }, { arc: 40, lean: 20, flip: 0 });
  assert.deepEqual(run(expr("start"), globe), gwant.start);
  assert.equal(H("refLon"), 26);
  assert.equal(H("aChainLon"), 24);
});

test("route stop driver: a keyed labelLon folds onto the copy its chain picks, so the animation still moves the place (flat)", () => {
  const GP = require("../src/core/projection.js");
  const src = buildRuntimeSource();
  const run = (expr, ins) => Array.from(vm.runInNewContext(expr, Object.fromEntries(ins.map((v, i) => ["n" + i, v]))));
  const at = (lon, lat, cam) => { const o = [0, 0]; GP.makeProjector(cam)(lon, lat, o); return o; };
  const near = (a, b) => assert.ok(a.every((v, k) => Math.abs(v - b[k]) < 1e-9), a + " is not " + b);
  const expr = E.routeStopDriverExpression(src, { camera: "c", category: "stopDriver" }, "array");
  // Tokyo chained to 139.69 and keyed to labelLon 150: the chain picks the copy, the route's shift is -360 from camera 0.
  const cam0 = { lat: 10, lon: 0, zoom: 2, rotation: 0, projection: 0 };
  near(run(expr, [10, 0, 2, 0, 0, 150, 35.68, 139.69, 190.725]), at(-210, 35.68, cam0));
  // Camera at 180: no shift, so the keyed place itself.
  const cam180 = { lat: 10, lon: 180, zoom: 2, rotation: 0, projection: 0 };
  near(run(expr, [10, 180, 2, 0, 0, 150, 35.68, 139.69, 190.725]), at(150, 35.68, cam180));
  // A static stop (labelLon = chain) is unchanged: -220.31 from camera 0.
  near(run(expr, [10, 0, 2, 0, 0, 139.69, 35.68, 139.69, 190.725]), at(-220.31, 35.68, cam0));
});

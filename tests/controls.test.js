const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/core/controls.js");

const V = "javaScript#V";
function model(extra) {
  return Object.assign({ valuesId: V, camera: "cam", ocean: null, layers: [], pins: [], labels: [], routes: [], data: { year: [], sets: [] }, imagery: [] }, extra);
}
function labels(p) { return p.rows.map((r) => r.label); }
function row(p, label) { return p.rows.find((r) => r.label === label); }
const CAMERA = ["Camera · Zoom", "Camera · Centre latitude", "Camera · Centre longitude", "Camera · Rotation", "Camera · Projection (0 flat · 1 Equal Earth · 2 globe)"];

test("camera rows come first, with limits on the projection", () => {
  const p = G.plan(model());
  assert.deepEqual(labels(p), CAMERA);
  assert.deepEqual(p.rows.map((r) => [r.kind, r.layer, r.attr]), [["direct", "cam", "array.2"], ["direct", "cam", "array.0"], ["direct", "cam", "array.1"], ["direct", "cam", "array.3"], ["direct", "cam", "array.4"]]);
  assert.deepEqual(p.rows[4].overrides, { hardMin: 0, hardMax: 2, step: 1 });
  assert.deepEqual(p.trim, []);
});

test("ocean and map layers: direct rows for what the layer uses, values for Detail and Dot size", () => {
  const p = G.plan(model({
    ocean: "oc",
    layers: [
      { id: "ci", category: "cities", name: "Map: Cities", fill: true, stroke: false, point: true, state: {} },
      { id: "co", category: "coastlines", name: "Map: Coastlines", fill: false, stroke: true, point: false, state: {} },
      { id: "cn", category: "countries", name: "Map: Countries", fill: true, stroke: true, point: false, state: {} }
    ]
  }));
  assert.deepEqual(labels(p).slice(5), [
    "Ocean · Colour", "Ocean · Hide",
    "Cities · Hide", "Cities · Opacity", "Cities · Fill colour", "Cities · Detail", "Cities · Dot size",
    "Coastlines · Hide", "Coastlines · Opacity", "Coastlines · Outline colour", "Coastlines · Outline width", "Coastlines · Detail",
    "Countries · Hide", "Countries · Opacity", "Countries · Fill colour", "Countries · Outline colour", "Countries · Outline width", "Countries · Detail"
  ]);
  assert.deepEqual(row(p, "Ocean · Colour"), { kind: "direct", layer: "oc", attr: "material.materialColor", label: "Ocean · Colour" });
  assert.deepEqual(row(p, "Countries · Outline width"), { kind: "direct", layer: "cn", attr: "stroke.width", label: "Countries · Outline width" });
  assert.deepEqual(row(p, "Cities · Detail"), { kind: "value", key: "layer:ci:detail", type: "double", label: "Cities · Detail", link: [{ layer: "ci", attr: "generator.array.5" }], linked: [] });
  assert.deepEqual(row(p, "Cities · Dot size").link, [{ layer: "ci", attr: "generator.array.6" }]);
});

test("repeated names are numbered, extracts use their own name", () => {
  const L = (id, category, name) => ({ id, category, name, fill: true, stroke: false, point: false, state: {} });
  const p = G.plan(model({ layers: [L("a", "countries", "x"), L("b", "countries", "y"), L("e1", "extract", "France"), L("e2", "extract", "France")] }));
  assert.deepEqual(labels(p).filter((l) => l.endsWith("· Hide")), ["Countries · Hide", "Countries 2 · Hide", "France · Hide", "France 2 · Hide"]);
});

test("pins share one value per setting and every free pin is linked", () => {
  const p = G.plan(model({ pins: [{ id: "p1", state: {} }, { id: "p2", state: {} }] }));
  assert.deepEqual(labels(p).slice(5), ["Pins · Hide", "Pins · Colour", "Pins · Size"]);
  assert.deepEqual(row(p, "Pins · Hide"), { kind: "value", key: "pins:hidden", type: "bool", label: "Pins · Hide", link: [{ layer: "p1", attr: "hidden" }, { layer: "p2", attr: "hidden" }], linked: [] });
  assert.equal(row(p, "Pins · Colour").type, "color");
  assert.deepEqual(row(p, "Pins · Size").link.map((t) => t.attr), ["generator.array.6", "generator.array.6"]);
});

test("linking rules: keep ours, leave wired, animated and user-unlinked layers alone", () => {
  const C = "material.materialColor";
  const st = (s) => ({ [C]: Object.assign({ from: "", keyed: false, record: null }, s) });
  const p = G.plan(model({ pins: [
    { id: "ours", state: st({ from: V + ".array.3", record: G.recordFor(V, "pins:color") }) },
    { id: "unlinked", state: st({ record: G.recordFor(V, "pins:color") }) },
    { id: "keyed", state: st({ keyed: true }) },
    { id: "wired", state: st({ from: "other#1.material.materialColor" }) },
    { id: "stale", state: st({ record: G.recordFor("javaScript#OLD", "pins:color") }) },
    { id: "new", state: st({}) }
  ] }));
  const r = row(p, "Pins · Colour");
  assert.deepEqual(r.linked, [{ layer: "ours", attr: C }]);
  assert.deepEqual(r.link, [{ layer: "stale", attr: C }, { layer: "new", attr: C }]);
});

test("a value with nothing to drive is left out", () => {
  const C = "material.materialColor";
  const p = G.plan(model({ pins: [{ id: "k", state: { [C]: { from: "", keyed: true, record: null } } }] }));
  assert.deepEqual(labels(p).slice(5), ["Pins · Hide", "Pins · Size"]);
});

test("labels share Hide, Colour and Size (font size)", () => {
  const p = G.plan(model({ labels: [{ id: "t1", state: {} }] }));
  assert.deepEqual(labels(p).slice(5), ["Labels · Hide", "Labels · Colour", "Labels · Size"]);
  assert.deepEqual(row(p, "Labels · Size").link, [{ layer: "t1", attr: "fontSize" }]);
  assert.equal(row(p, "Labels · Size").key, "labels:size");
});

test("routes: shared colour, width and arc height, then each leg's draw on % in leg order", () => {
  const p = G.plan(model({ routes: [{ id: "rg", name: "Paris → Rome", legs: [{ id: "l1", number: 1, state: {} }, { id: "l2", number: 2, state: {} }] }] }));
  assert.deepEqual(labels(p).slice(5), ["Paris → Rome · Colour", "Paris → Rome · Width", "Paris → Rome · Arc height", "Paris → Rome · Leg 1 draw on %", "Paris → Rome · Leg 2 draw on %"]);
  assert.deepEqual(row(p, "Paris → Rome · Colour").link, [{ layer: "l1", attr: "stroke.strokeColor" }, { layer: "l2", attr: "stroke.strokeColor" }]);
  assert.equal(row(p, "Paris → Rome · Arc height").key, "route:rg:lift");
  assert.deepEqual(row(p, "Paris → Rome · Arc height").link[0], { layer: "l1", attr: "generator.array.7" });
  assert.deepEqual(row(p, "Paris → Rome · Leg 2 draw on %"), { kind: "direct", layer: "l2", attr: "stroke.trimEnd", label: "Paris → Rome · Leg 2 draw on %" });
  assert.deepEqual(p.trim, ["l1", "l2"]);
});

test("data: one shared Year, colours per set (Middle only when used), bubble and label size", () => {
  const regions = { id: "rg", useMiddle: false, state: {} }, bubbles = { id: "bb", state: {} }, vals = { id: "vl", state: {} };
  const p = G.plan(model({ data: { year: [regions, bubbles, vals], sets: [{ id: "dg", name: "GDP", regions, bubbles, labels: vals }] } }));
  assert.deepEqual(labels(p).slice(5), ["Data · Year", "GDP · Low colour", "GDP · High colour", "GDP · No-data colour", "GDP · Bubble size", "GDP · Bubble colour", "GDP · Label size"]);
  assert.deepEqual(row(p, "Data · Year").link, [{ layer: "rg", attr: "generator.array.7" }, { layer: "bb", attr: "generator.array.7" }, { layer: "vl", attr: "generator.array.7" }]);
  assert.deepEqual(row(p, "GDP · Low colour"), { kind: "value", key: "data:dg:low", type: "color", label: "GDP · Low colour", link: [{ layer: "rg", attr: "generator.array.8" }], linked: [] });
  assert.deepEqual(row(p, "GDP · No-data colour").link, [{ layer: "rg", attr: "generator.array.15" }]);
  assert.deepEqual(row(p, "GDP · Bubble size").link, [{ layer: "bb", attr: "generator.array.8" }]);
  assert.deepEqual(row(p, "GDP · Bubble colour"), { kind: "direct", layer: "bb", attr: "material.materialColor", label: "GDP · Bubble colour" });
  assert.deepEqual(row(p, "GDP · Label size").link, [{ layer: "vl", attr: "generator.array.8" }]);
  regions.useMiddle = true;
  assert.deepEqual(row(G.plan(model({ data: { year: [regions], sets: [{ id: "dg", name: "GDP", regions, bubbles: null, labels: null }] } })), "GDP · Middle colour").link, [{ layer: "rg", attr: "generator.array.11" }]);
});

test("imagery: opacity and hide on each imagery group", () => {
  const p = G.plan(model({ imagery: [{ id: "ig", name: "Imagery: EOX" }] }));
  assert.deepEqual(p.rows.slice(5).map((r) => [r.label, r.layer, r.attr]), [["Imagery: EOX · Opacity", "ig", "opacity"], ["Imagery: EOX · Hide", "ig", "hidden"]]);
});

test("sections keep their order: camera, ocean, layers, pins, labels, routes, data, imagery", () => {
  const regions = { id: "rg", useMiddle: false, state: {} };
  const p = G.plan(model({
    ocean: "oc", layers: [{ id: "cn", category: "countries", name: "", fill: true, stroke: false, point: false, state: {} }],
    pins: [{ id: "p1", state: {} }], labels: [{ id: "t1", state: {} }],
    routes: [{ id: "r", name: "A → B", legs: [{ id: "l1", number: 1, state: {} }] }],
    data: { year: [regions], sets: [{ id: "dg", name: "GDP", regions, bubbles: null, labels: null }] },
    imagery: [{ id: "ig", name: "Imagery" }]
  }));
  const first = (prefix) => labels(p).findIndex((l) => l.startsWith(prefix));
  const order = ["Camera", "Ocean", "Countries", "Pins", "Labels", "A → B", "Data", "Imagery"].map(first);
  assert.deepEqual(order.slice().sort((a, b) => a - b), order);
  assert.ok(order.every((i) => i >= 0));
});

test("ids lists every layer in the model", () => {
  const regions = { id: "rg", useMiddle: false, state: {} };
  const ids = G.ids(model({
    ocean: "oc", layers: [{ id: "cn" }], pins: [{ id: "p1" }], labels: [{ id: "t1" }],
    routes: [{ id: "r", name: "", legs: [{ id: "l1" }] }],
    data: { year: [regions], sets: [{ id: "dg", name: "", regions, bubbles: { id: "bb" }, labels: { id: "vl" } }] },
    imagery: [{ id: "ig" }]
  }));
  assert.deepEqual(Object.keys(ids).sort(), [V, "bb", "cam", "cn", "ig", "l1", "oc", "p1", "rg", "t1", "vl"].sort());
});

test("STATE_ATTRS name the attributes each kind of member is driven on", () => {
  assert.deepEqual(G.STATE_ATTRS.layer, ["generator.array.5", "generator.array.6"]);
  assert.deepEqual(G.STATE_ATTRS.pin, ["hidden", "material.materialColor", "generator.array.6"]);
  assert.deepEqual(G.STATE_ATTRS.label, ["hidden", "material.materialColor", "fontSize"]);
  assert.deepEqual(G.STATE_ATTRS.leg, ["stroke.strokeColor", "stroke.width", "generator.array.7"]);
  assert.deepEqual(G.STATE_ATTRS.regions, ["generator.array.7", "generator.array.8", "generator.array.9", "generator.array.11", "generator.array.15"]);
  assert.deepEqual(G.STATE_ATTRS.bubbles, ["generator.array.7", "generator.array.8"]);
  assert.deepEqual(G.STATE_ATTRS.valueLabels, ["generator.array.7", "generator.array.8"]);
  assert.ok(G.BASE.indexOf("countries") >= 0 && G.BASE.indexOf("extract") < 0);
});

test("BASE lists every base category, in order", () => {
  assert.deepEqual(G.BASE, ["countries", "states", "lakes", "coastlines", "rivers", "cities", "buildings", "water", "parks", "roads", "railways"]);
});

test("every values row has the key its input is found again by", () => {
  const regions = { id: "rg", useMiddle: true, state: {} }, bubbles = { id: "bb", state: {} }, vals = { id: "vl", state: {} };
  const p = G.plan(model({
    layers: [{ id: "ci", category: "cities", name: "", fill: true, stroke: false, point: true, state: {} }],
    pins: [{ id: "p1", state: {} }], labels: [{ id: "t1", state: {} }],
    routes: [{ id: "r", name: "A → B", legs: [{ id: "l1", number: 1, state: {} }] }],
    data: { year: [regions, bubbles, vals], sets: [{ id: "dg", name: "GDP", regions, bubbles, labels: vals }] }
  }));
  assert.deepEqual(p.rows.filter((r) => r.kind === "value").map((r) => [r.label, r.key]), [
    ["Cities · Detail", "layer:ci:detail"], ["Cities · Dot size", "layer:ci:dot"],
    ["Pins · Hide", "pins:hidden"], ["Pins · Colour", "pins:color"], ["Pins · Size", "pins:size"],
    ["Labels · Hide", "labels:hidden"], ["Labels · Colour", "labels:color"], ["Labels · Size", "labels:size"],
    ["A → B · Colour", "route:r:color"], ["A → B · Width", "route:r:width"], ["A → B · Arc height", "route:r:lift"],
    ["Data · Year", "data:year"],
    ["GDP · Low colour", "data:dg:low"], ["GDP · High colour", "data:dg:high"], ["GDP · Middle colour", "data:dg:middle"], ["GDP · No-data colour", "data:dg:noData"],
    ["GDP · Bubble size", "data:dg:bubbleSize"], ["GDP · Label size", "data:dg:labelSize"]
  ]);
});

test("routes and data sets with the same name are numbered, separately from the layers", () => {
  const leg = (id) => [{ id, number: 1, state: {} }];
  const regions = (id) => ({ id, useMiddle: false, state: {} });
  const r1 = regions("rg1"), r2 = regions("rg2");
  const p = G.plan(model({
    layers: [{ id: "cn", category: "countries", name: "", fill: true, stroke: false, point: false, state: {} }],
    routes: [{ id: "a", name: "A → B", legs: leg("l1") }, { id: "b", name: "A → B", legs: leg("l2") }, { id: "c", name: "Countries", legs: leg("l3") }],
    data: { year: [r1, r2], sets: [{ id: "d1", name: "GDP", regions: r1, bubbles: null, labels: null }, { id: "d2", name: "GDP", regions: r2, bubbles: null, labels: null }] }
  }));
  const L = labels(p);
  assert.ok(L.indexOf("Countries · Hide") >= 0, "the layer keeps its name");
  assert.deepEqual(L.filter((l) => / · Colour$/.test(l)), ["A → B · Colour", "A → B 2 · Colour", "Countries · Colour"]);
  assert.deepEqual(L.filter((l) => / · Low colour$/.test(l)), ["GDP · Low colour", "GDP 2 · Low colour"]);
  assert.equal(row(p, "A → B 2 · Leg 1 draw on %").layer, "l2");
});

test("new routes: shared stop rows, then per-route curve rows and per-leg hand rows", () => {
  const leg = (id, n) => ({ id, number: n, state: {}, start: { id: id + "s", state: {} }, end: { id: id + "e", state: {} } });
  const p = G.plan(model({
    stops: [{ id: "c1", state: {} }, { id: "c2", state: {} }],
    newRoutes: [{ id: "rg", name: "A → B", legs: [leg("l1", 1), leg("l2", 2)] }]
  }));
  assert.deepEqual(labels(p).slice(5), [
    "Stops · Hide", "Stops · Colour", "Stops · Size",
    "A → B · Colour", "A → B · Width", "A → B · Arc height", "A → B · Lean", "A → B · Flip side",
    "A → B · Leg 1 draw on %", "A → B · Leg 1 shape by hand", "A → B · Leg 1 start handle X", "A → B · Leg 1 start handle Y", "A → B · Leg 1 end handle X", "A → B · Leg 1 end handle Y",
    "A → B · Leg 2 draw on %", "A → B · Leg 2 shape by hand", "A → B · Leg 2 start handle X", "A → B · Leg 2 start handle Y", "A → B · Leg 2 end handle X", "A → B · Leg 2 end handle Y"
  ]);
  assert.deepEqual(row(p, "Stops · Size").link, [
    { layer: "c1", attr: "generator.radius.x" }, { layer: "c1", attr: "generator.radius.y" },
    { layer: "c2", attr: "generator.radius.x" }, { layer: "c2", attr: "generator.radius.y" }
  ]);
  assert.equal(row(p, "Stops · Size").key, "stops:size");
  assert.deepEqual(row(p, "A → B · Colour").link, [{ layer: "l1", attr: "stroke.strokeColor" }, { layer: "l2", attr: "stroke.strokeColor" }]);
  assert.deepEqual(row(p, "A → B · Arc height").link.map((t) => t.layer + "." + t.attr), ["l1s.array.8", "l1e.array.8", "l2s.array.8", "l2e.array.8"]);
  assert.equal(row(p, "A → B · Arc height").key, "route:rg:arc");
  assert.equal(row(p, "A → B · Flip side").type, "bool");
  assert.deepEqual(row(p, "A → B · Lean").link[0], { layer: "l1s", attr: "array.9" });
  assert.deepEqual(row(p, "A → B · Leg 1 shape by hand").link, [{ layer: "l1s", attr: "array.11" }, { layer: "l1e", attr: "array.11" }]);
  assert.equal(row(p, "A → B · Leg 1 shape by hand").type, "bool");
  assert.deepEqual(row(p, "A → B · Leg 2 end handle Y"), { kind: "value", key: "leg:l2:endY", type: "double", label: "A → B · Leg 2 end handle Y", link: [{ layer: "l2e", attr: "array.13" }], linked: [] });
  assert.deepEqual(row(p, "A → B · Leg 1 draw on %"), { kind: "direct", layer: "l1", attr: "stroke.trimEnd", label: "A → B · Leg 1 draw on %" });
  assert.deepEqual(p.trim, ["l1", "l2"]);
});

test("new routes: an old-style route and a new one share the route name numbering; ids include every part", () => {
  const leg = { id: "n1", number: 1, state: {}, start: { id: "n1s", state: {} }, end: { id: "n1e", state: {} } };
  const m = model({ routes: [{ id: "old", name: "A → B", legs: [{ id: "o1", number: 1, state: {} }] }], stops: [{ id: "c1", state: {} }], newRoutes: [{ id: "new", name: "A → B", legs: [leg] }] });
  const p = G.plan(m);
  assert.ok(labels(p).indexOf("A → B · Arc height") >= 0 && labels(p).indexOf("A → B 2 · Lean") >= 0);
  assert.ok(labels(p).indexOf("Stops · Hide") < labels(p).indexOf("A → B · Colour"));
  const ids = Object.keys(G.ids(m));
  ["c1", "n1", "n1s", "n1e"].forEach((id) => assert.ok(ids.indexOf(id) >= 0, id));
  assert.deepEqual(G.STATE_ATTRS.stop, ["hidden", "material.materialColor", "generator.radius.x", "generator.radius.y"]);
  assert.deepEqual(G.STATE_ATTRS.newLeg, ["stroke.strokeColor", "stroke.width"]);
  assert.deepEqual(G.STATE_ATTRS.handle, ["array.8", "array.9", "array.10", "array.11", "array.12", "array.13"]);
});

test("travellers: hide, size, colour (plugin markers) and faces direction after the route's rows", () => {
  const leg = { id: "n1", number: 1, state: {}, start: { id: "n1s", state: {} }, end: { id: "n1e", state: {} } };
  const p = G.plan(model({
    newRoutes: [{ id: "rg", name: "A → B", legs: [leg] }],
    travellers: [{ routeId: "rg", marker: { id: "mk", state: {} }, dups: [{ id: "d1", state: {} }, { id: "d2", state: {} }] }]
  }));
  const L = labels(p);
  const i = L.indexOf("A → B · Traveller hide");
  assert.ok(i > L.indexOf("A → B · Leg 1 end handle Y"));
  assert.deepEqual(L.slice(i, i + 4), ["A → B · Traveller hide", "A → B · Traveller size", "A → B · Traveller colour", "A → B · Traveller faces direction"]);
  assert.deepEqual(row(p, "A → B · Traveller size").link.map((t) => t.layer + "." + t.attr), ["d1.shapeScale.x", "d1.shapeScale.y", "d2.shapeScale.x", "d2.shapeScale.y"]);
  assert.equal(row(p, "A → B · Traveller hide").key, "trav:rg:hide");
  assert.deepEqual(row(p, "A → B · Traveller colour").link, [{ layer: "mk", attr: "material.materialColor" }]);
  assert.equal(row(p, "A → B · Traveller faces direction").type, "bool");
  assert.deepEqual(row(p, "A → B · Traveller faces direction").link.map((t) => t.attr), ["generator.calculateRotations", "generator.calculateRotations"]);
  const own = G.plan(model({ routes: [{ id: "old", name: "C → D", legs: [{ id: "o1", number: 1, state: {} }] }], travellers: [{ routeId: "old", marker: null, dups: [{ id: "d9", state: {} }] }] }));
  assert.ok(labels(own).indexOf("C → D · Traveller colour") < 0, "no colour row for your own layer");
  assert.ok(labels(own).indexOf("C → D · Traveller hide") > labels(own).indexOf("C → D · Leg 1 draw on %"));
  assert.ok(Object.keys(G.ids(model({ travellers: [{ routeId: "x", marker: { id: "mk", state: {} }, dups: [{ id: "d1", state: {} }] }] }))).indexOf("d1") >= 0);
});

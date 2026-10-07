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

test("old-style route: Travel %, Arc height, Colour, Width — numbered, with the stops as notes", () => {
  const p = G.plan(model({ routes: [{ id: "g1", name: "A → B", number: 3, title: "A → B", legs: [{ id: "l1", number: 1, state: {} }, { id: "l2", number: 2, state: {} }], draws: [{ id: "d1", state: {} }, { id: "d2", state: {} }] }] }));
  const rows = p.rows.filter((r) => r.label.indexOf("Route 3") === 0);
  assert.deepEqual(rows.map((r) => r.label), ["Route 3 · Travel %", "Route 3 · Arc height", "Route 3 · Colour", "Route 3 · Width"]);
  assert.deepEqual(rows[0].link, [{ layer: "d1", attr: "array.0" }, { layer: "d2", attr: "array.0" }]);
  assert.deepEqual(rows[0].overrides, { hardMin: 0, hardMax: 100 });
  rows.forEach((r) => assert.equal(r.notes, "A → B"));
  assert.deepEqual(p.trim, ["l1", "l2"]);
  assert.ok(!p.rows.some((r) => /draw on|Lean|Flip|hand|handle/.test(r.label)));
});

test("new-style route: the same four rows (Arc height on the handle helpers) plus traveller rows, nothing per leg", () => {
  const leg = (id, s, e) => ({ id, number: 1, state: {}, start: { id: s, state: {} }, end: { id: e, state: {} } });
  const p = G.plan(model({
    newRoutes: [{ id: "g2", name: "C → D", number: 1, title: "C → D", legs: [leg("l3", "h1", "h2")], draws: [{ id: "d3", state: {} }] }],
    travellers: [{ routeId: "g2", marker: { id: "mk", state: {} }, scale: { id: "sc", state: {} }, dups: [{ id: "u1", state: {} }] }]
  }));
  assert.deepEqual(p.rows.filter((r) => r.label.indexOf("Route 1") === 0).map((r) => r.label), [
    "Route 1 · Travel %", "Route 1 · Arc height", "Route 1 · Shape (0 arc · 1 great circle)", "Route 1 · Colour", "Route 1 · Width",
    "Route 1 · Traveller hide", "Route 1 · Traveller size", "Route 1 · Traveller colour", "Route 1 · Traveller faces direction"
  ]);
  assert.deepEqual(row(p, "Route 1 · Arc height").link, [{ layer: "h1", attr: "array.8" }, { layer: "h2", attr: "array.8" }]);
  assert.ok(p.rows.filter((r) => r.label.indexOf("Route 1") === 0).every((r) => r.notes === "C → D"));
});

test("new-style route: a Shape row right after Arc height, on every handle helper's shape input", () => {
  const leg = (id, s, e) => ({ id, number: 1, state: {}, start: { id: s, state: {} }, end: { id: e, state: {} } });
  const p = G.plan(model({ newRoutes: [{ id: "g2", name: "C → D", number: 1, title: "C → D", legs: [leg("l3", "h1", "h2"), leg("l4", "h3", "h4")], draws: [] }] }));
  const names = p.rows.map((r) => r.label), at = names.indexOf("Route 1 · Arc height");
  assert.equal(names[at + 1], "Route 1 · Shape (0 arc · 1 great circle)");
  const r = row(p, "Route 1 · Shape (0 arc · 1 great circle)");
  assert.deepEqual(r.link, [{ layer: "h1", attr: "array.14" }, { layer: "h2", attr: "array.14" }, { layer: "h3", attr: "array.14" }, { layer: "h4", attr: "array.14" }]);
  assert.deepEqual(r.overrides, { hardMin: 0, hardMax: 1, step: 1 });
  assert.equal(r.type, "double");
  assert.equal(r.notes, "C → D");
  assert.equal(r.key, "route:g2:shape");
  assert.ok(G.STATE_ATTRS.handle.indexOf("array.14") >= 0);
});

test("a route without a number falls back to its name; data sets read Data n with their title as notes", () => {
  const p = G.plan(model({
    routes: [{ id: "g", name: "E → F", number: 0, title: "E → F", legs: [{ id: "l", number: 1, state: {} }], draws: [] }],
    data: { year: [{ id: "rg", state: {} }], sets: [{ id: "s1", name: "Population", regions: { id: "rg", state: {}, useMiddle: false }, bubbles: null, labels: null }] }
  }));
  assert.ok(p.rows.some((r) => r.label === "E → F · Colour"));
  assert.ok(!p.rows.some((r) => r.label === "E → F · Travel %"), "no draw helpers, no Travel row");
  assert.equal(row(p, "Data 1 · Low colour").notes, "Population");
  assert.ok(row(p, "Data · Year"));
});

test("data: one shared Year, colours per set (Middle only when used), bubble and label size", () => {
  const regions = { id: "rg", useMiddle: false, state: {} }, bubbles = { id: "bb", state: {} }, vals = { id: "vl", state: {} };
  const p = G.plan(model({ data: { year: [regions, bubbles, vals], sets: [{ id: "dg", name: "GDP", regions, bubbles, labels: vals }] } }));
  assert.deepEqual(labels(p).slice(5), ["Data · Year", "Data 1 · Low colour", "Data 1 · High colour", "Data 1 · No-data colour", "Data 1 · Bubble size", "Data 1 · Bubble colour", "Data 1 · Label size"]);
  assert.deepEqual(row(p, "Data · Year").link, [{ layer: "rg", attr: "generator.array.7" }, { layer: "bb", attr: "generator.array.7" }, { layer: "vl", attr: "generator.array.7" }]);
  assert.deepEqual(row(p, "Data 1 · Low colour"), { kind: "value", key: "data:dg:low", type: "color", label: "Data 1 · Low colour", link: [{ layer: "rg", attr: "generator.array.8" }], linked: [], notes: "GDP" });
  assert.deepEqual(row(p, "Data 1 · No-data colour").link, [{ layer: "rg", attr: "generator.array.15" }]);
  assert.deepEqual(row(p, "Data 1 · Bubble size").link, [{ layer: "bb", attr: "generator.array.8" }]);
  assert.deepEqual(row(p, "Data 1 · Bubble colour"), { kind: "direct", layer: "bb", attr: "material.materialColor", label: "Data 1 · Bubble colour", notes: "GDP" });
  assert.deepEqual(row(p, "Data 1 · Label size").link, [{ layer: "vl", attr: "generator.array.8" }]);
  regions.useMiddle = true;
  assert.deepEqual(row(G.plan(model({ data: { year: [regions], sets: [{ id: "dg", name: "GDP", regions, bubbles: null, labels: null }] } })), "Data 1 · Middle colour").link, [{ layer: "rg", attr: "generator.array.11" }]);
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
    routes: [{ id: "r", name: "", legs: [{ id: "l1" }], draws: [{ id: "dw" }] }],
    data: { year: [regions], sets: [{ id: "dg", name: "", regions, bubbles: { id: "bb" }, labels: { id: "vl" } }] },
    imagery: [{ id: "ig" }]
  }));
  assert.deepEqual(Object.keys(ids).sort(), [V, "bb", "cam", "cn", "dw", "ig", "l1", "oc", "p1", "rg", "t1", "vl"].sort());
});

test("STATE_ATTRS name the attributes each kind of member is driven on", () => {
  assert.deepEqual(G.STATE_ATTRS.layer, ["generator.array.5", "generator.array.6"]);
  assert.deepEqual(G.STATE_ATTRS.pin, ["hidden", "material.materialColor", "generator.array.6"]);
  assert.deepEqual(G.STATE_ATTRS.label, ["hidden", "material.materialColor", "fontSize"]);
  assert.deepEqual(G.STATE_ATTRS.draw, ["array.0"]);
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
    ["A → B · Arc height", "route:r:lift"], ["A → B · Colour", "route:r:color"], ["A → B · Width", "route:r:width"],
    ["Data · Year", "data:year"],
    ["Data 1 · Low colour", "data:dg:low"], ["Data 1 · High colour", "data:dg:high"], ["Data 1 · Middle colour", "data:dg:middle"], ["Data 1 · No-data colour", "data:dg:noData"],
    ["Data 1 · Bubble size", "data:dg:bubbleSize"], ["Data 1 · Label size", "data:dg:labelSize"]
  ]);
});

test("routes without a number and with the same name are numbered, data sets by position, separately from the layers", () => {
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
  assert.deepEqual(L.filter((l) => / · Low colour$/.test(l)), ["Data 1 · Low colour", "Data 2 · Low colour"]);
  assert.equal(row(p, "A → B 2 · Arc height").link[0].layer, "l2");
});

test("new routes: shared stop rows, then four rows per route and no per-leg rows", () => {
  const leg = (id, n) => ({ id, number: n, state: {}, start: { id: id + "s", state: {} }, end: { id: id + "e", state: {} } });
  const p = G.plan(model({
    stops: [{ id: "c1", state: {} }, { id: "c2", state: {} }],
    newRoutes: [{ id: "rg", name: "A → B", legs: [leg("l1", 1), leg("l2", 2)] }]
  }));
  assert.deepEqual(labels(p).slice(5), [
    "Stops · Hide", "Stops · Colour", "Stops · Size",
    "A → B · Arc height", "A → B · Shape (0 arc · 1 great circle)", "A → B · Colour", "A → B · Width"
  ]);
  assert.deepEqual(row(p, "Stops · Size").link, [
    { layer: "c1", attr: "generator.radius.x" }, { layer: "c1", attr: "generator.radius.y" },
    { layer: "c2", attr: "generator.radius.x" }, { layer: "c2", attr: "generator.radius.y" }
  ]);
  assert.equal(row(p, "Stops · Size").key, "stops:size");
  assert.deepEqual(row(p, "A → B · Colour").link, [{ layer: "l1", attr: "stroke.strokeColor" }, { layer: "l2", attr: "stroke.strokeColor" }]);
  assert.deepEqual(row(p, "A → B · Arc height").link.map((t) => t.layer + "." + t.attr), ["l1s.array.8", "l1e.array.8", "l2s.array.8", "l2e.array.8"]);
  assert.equal(row(p, "A → B · Arc height").key, "route:rg:arc");
  assert.deepEqual(p.trim, ["l1", "l2"]);
});

test("new routes: an old-style route and a new one share the route name numbering; ids include every part", () => {
  const leg = { id: "n1", number: 1, state: {}, start: { id: "n1s", state: {} }, end: { id: "n1e", state: {} } };
  const m = model({ routes: [{ id: "old", name: "A → B", legs: [{ id: "o1", number: 1, state: {} }] }], stops: [{ id: "c1", state: {} }], newRoutes: [{ id: "new", name: "A → B", legs: [leg] }] });
  const p = G.plan(m);
  assert.ok(labels(p).indexOf("A → B · Arc height") >= 0 && labels(p).indexOf("A → B 2 · Arc height") >= 0);
  assert.ok(labels(p).indexOf("Stops · Hide") < labels(p).indexOf("A → B · Colour"));
  const ids = Object.keys(G.ids(m));
  ["c1", "n1", "n1s", "n1e"].forEach((id) => assert.ok(ids.indexOf(id) >= 0, id));
  assert.deepEqual(G.STATE_ATTRS.stop, ["hidden", "material.materialColor", "generator.radius.x", "generator.radius.y"]);
  assert.deepEqual(G.STATE_ATTRS.newLeg, ["stroke.strokeColor", "stroke.width"]);
  assert.deepEqual(G.STATE_ATTRS.handle, ["array.8", "array.9", "array.10", "array.11", "array.12", "array.13", "array.14"]);
});

test("travellers: hide, size, colour (plugin markers) and faces direction after the route's rows", () => {
  const leg = { id: "n1", number: 1, state: {}, start: { id: "n1s", state: {} }, end: { id: "n1e", state: {} } };
  const p = G.plan(model({
    newRoutes: [{ id: "rg", name: "A → B", legs: [leg] }],
    travellers: [{ routeId: "rg", marker: { id: "mk", state: {} }, scale: { id: "sc", state: {} }, dups: [{ id: "d1", state: {} }, { id: "d2", state: {} }] }]
  }));
  const L = labels(p);
  const i = L.indexOf("A → B · Traveller hide");
  assert.ok(i > L.indexOf("A → B · Width"));
  assert.deepEqual(L.slice(i, i + 4), ["A → B · Traveller hide", "A → B · Traveller size", "A → B · Traveller colour", "A → B · Traveller faces direction"]);
  assert.deepEqual(row(p, "A → B · Traveller size").link.map((t) => t.layer + "." + t.attr), ["sc.array.0"], "one target: the scale helper's size input");
  assert.equal(row(p, "A → B · Traveller size").key, "trav:rg:size");
  assert.deepEqual(G.STATE_ATTRS.travellerScale, ["array.0"]);
  assert.deepEqual(G.STATE_ATTRS.dup, ["hidden", "generator.calculateRotations"]);
  assert.equal(row(p, "A → B · Traveller hide").key, "trav:rg:hide");
  assert.deepEqual(row(p, "A → B · Traveller colour").link, [{ layer: "mk", attr: "material.materialColor" }]);
  assert.equal(row(p, "A → B · Traveller faces direction").type, "bool");
  assert.deepEqual(row(p, "A → B · Traveller faces direction").link.map((t) => t.attr), ["generator.calculateRotations", "generator.calculateRotations"]);
  const own = G.plan(model({ routes: [{ id: "old", name: "C → D", legs: [{ id: "o1", number: 1, state: {} }] }], travellers: [{ routeId: "old", marker: null, scale: null, dups: [{ id: "d9", state: {} }] }] }));
  assert.ok(labels(own).indexOf("C → D · Traveller size") < 0, "no scale helper, no size row");
  assert.ok(labels(own).indexOf("C → D · Traveller colour") < 0, "no colour row for your own layer");
  assert.ok(labels(own).indexOf("C → D · Traveller hide") > labels(own).indexOf("C → D · Width"));
  const tids = Object.keys(G.ids(model({ travellers: [{ routeId: "x", marker: { id: "mk", state: {} }, scale: { id: "sc", state: {} }, dups: [{ id: "d1", state: {} }] }] })));
  assert.ok(tids.indexOf("d1") >= 0 && tids.indexOf("sc") >= 0);
});

test("furniture rows: hide and colour direct, settings as values with whole-number choices", () => {
  const E = require("../src/core/expression.js");
  const sbAt = (n) => "generator.array." + E.inputIndex(E.SCALE_BAR_INPUTS, n), naAt = (n) => "generator.array." + E.inputIndex(E.NORTH_ARROW_INPUTS, n);
  const p = G.plan({ valuesId: "V", furniture: { scaleBar: { id: "sb" }, northArrow: { id: "na" }, fade: { id: "fd" } } });
  const labels = p.rows.map((r) => r.label);
  assert.deepEqual(labels, [
    "Scale bar · Hide", "Scale bar · Colour", "Scale bar · Units (0 metric · 1 imperial · 2 both)", "Scale bar · Style (0 line · 1 segmented)",
    "Scale bar · Corner (0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right)", "Scale bar · Margin", "Scale bar · Max width", "Scale bar · Hide below zoom",
    "North arrow · Hide", "North arrow · Colour", "North arrow · Style (0 arrow · 1 compass · 2 N with tick)",
    "North arrow · Corner (0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right)", "North arrow · Margin", "North arrow · Size"
  ]);
  const row = (l) => p.rows.find((r) => r.label === l);
  assert.deepEqual(row("Scale bar · Hide"), { kind: "direct", layer: "sb", attr: "hidden", label: "Scale bar · Hide" });
  assert.equal(row("Scale bar · Colour").attr, "material.materialColor");
  assert.deepEqual(row("Scale bar · Units (0 metric · 1 imperial · 2 both)").link, [{ layer: "sb", attr: sbAt("units") }]);
  assert.deepEqual(row("Scale bar · Units (0 metric · 1 imperial · 2 both)").overrides, { hardMin: 0, hardMax: 2, step: 1 });
  assert.deepEqual(row("Scale bar · Corner (0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right)").overrides, { hardMin: 0, hardMax: 3, step: 1 });
  assert.equal(row("Scale bar · Margin").overrides, undefined);
  assert.deepEqual(row("Scale bar · Hide below zoom").link, [{ layer: "fd", attr: "array.1" }]);
  assert.deepEqual(row("North arrow · Size").link, [{ layer: "na", attr: naAt("size") }]);
  assert.deepEqual(G.plan({ valuesId: "V" }).rows, [], "no furniture, no rows");
});

test("every row knows its Controls group, in a list beside the rows", () => {
  assert.deepEqual(G.GROUPS, ["main", "overlay", "data", "extract", "time"]);
  const p = G.plan(model({
    ocean: "oc",
    layers: [
      { id: "cn", category: "countries", name: "Map: Countries", fill: true, stroke: true, point: false, state: {} },
      { id: "ex", category: "extract", name: "France", fill: true, stroke: false, point: false, state: {} }
    ],
    pins: [{ id: "p1", state: {} }],
    labels: [{ id: "l1", state: {} }],
    stops: [{ id: "s1", state: {} }],
    routes: [{ id: "r1", name: "A → B", legs: [{ id: "lg1", number: 1, state: {} }] }],
    newRoutes: [{ id: "r2", name: "C → D", legs: [{ id: "lg2", number: 1, state: {}, start: { id: "h1", state: {} }, end: { id: "h2", state: {} } }] }],
    travellers: [{ routeId: "r2", marker: { id: "mk", state: {} }, scale: { id: "sc", state: {} }, dups: [{ id: "d1", state: {} }] }],
    data: { year: [{ id: "rg", state: {} }], sets: [{ id: "ds", name: "Pop", regions: { id: "rg", state: {}, useMiddle: false }, bubbles: null, labels: null }] },
    imagery: [{ id: "im", name: "Imagery: EOX" }],
    furniture: { scaleBar: { id: "sb" }, northArrow: { id: "na" }, fade: { id: "fd" } }
  }));
  assert.equal(p.groups.length, p.rows.length);
  const groupOf = (prefix) => [...new Set(p.rows.map((r, i) => (r.label.indexOf(prefix) === 0 ? p.groups[i] : null)).filter(Boolean))];
  assert.deepEqual(groupOf("Camera"), ["main"]);
  assert.deepEqual(groupOf("Ocean"), ["main"]);
  assert.deepEqual(groupOf("Countries"), ["main"]);
  assert.deepEqual(groupOf("Imagery: EOX"), ["main"]);
  assert.deepEqual(groupOf("France"), ["extract"]);
  assert.deepEqual(groupOf("Pins"), ["overlay"]);
  assert.deepEqual(groupOf("Labels"), ["overlay"]);
  assert.deepEqual(groupOf("Stops"), ["overlay"]);
  assert.deepEqual(groupOf("A → B"), ["overlay"]);
  assert.deepEqual(groupOf("C → D"), ["overlay"], "new route rows, leg rows and traveller rows");
  assert.deepEqual(groupOf("Data"), ["data"]);
  assert.deepEqual(groupOf("Data 1"), ["data"]);
  assert.deepEqual(groupOf("Scale bar"), ["overlay"]);
  assert.deepEqual(groupOf("North arrow"), ["overlay"]);
  assert.ok(p.rows.some((r) => r.label.indexOf("C → D · Traveller") === 0), "the traveller rows are in the list");
  assert.deepEqual(G.plan(model()).groups, ["main", "main", "main", "main", "main"]);
});

test("highlight rows: Amount %, Colour, and only their own effect's extra row, in the extract group with the extract's name as notes", () => {
  const model = { valuesId: "V", highlights: [
    { id: "g1", number: 1, name: "France", effect: "fill", shape: "s1", osc: null, blur: null },
    { id: "g2", number: 2, name: "Spain", effect: "outline", shape: "s2", osc: null, blur: null },
    { id: "g3", number: 3, name: "Italy", effect: "pulse", shape: "s3", osc: "o3", blur: null },
    { id: "g4", number: 4, name: "Greece", effect: "glow", shape: "s4", osc: null, blur: { id: "b4", state: {} } }
  ] };
  const p = G.plan(model);
  const rows = p.rows.map((r, i) => ({ label: r.label, group: p.groups[i], notes: r.notes, layer: r.layer, attr: r.attr, kind: r.kind }));
  const of = (n) => rows.filter((r) => r.label.indexOf("Highlight " + n + " · ") === 0);
  assert.deepEqual(of(1).map((r) => [r.label, r.layer, r.attr]), [["Highlight 1 · Amount %", "s1", "opacity"], ["Highlight 1 · Colour", "s1", "material.materialColor"]]);
  assert.deepEqual(of(2).map((r) => [r.label, r.layer, r.attr]), [["Highlight 2 · Amount %", "s2", "stroke.trimEnd"], ["Highlight 2 · Colour", "s2", "stroke.strokeColor"], ["Highlight 2 · Width", "s2", "stroke.width"]]);
  assert.deepEqual(of(3).map((r) => [r.label, r.layer, r.attr]), [["Highlight 3 · Amount %", "g3", "opacity"], ["Highlight 3 · Colour", "s3", "stroke.strokeColor"], ["Highlight 3 · Speed", "o3", "frequency"]]);
  assert.deepEqual(of(4).map((r) => r.label), ["Highlight 4 · Amount %", "Highlight 4 · Colour", "Highlight 4 · Size"]);
  const size = p.rows.find((r) => r.label === "Highlight 4 · Size");
  assert.equal(size.kind, "value"); assert.equal(size.key, "hl:g4:size");
  assert.deepEqual(size.link, [{ layer: "b4", attr: "amount.x" }, { layer: "b4", attr: "amount.y" }]);
  rows.filter((r) => /^Highlight/.test(r.label)).forEach((r) => assert.equal(r.group, "extract"));
  assert.equal(of(1)[0].notes, "France"); assert.equal(of(4)[2].notes, "Greece");
  assert.deepEqual(p.rows.find((r) => r.label === "Highlight 1 · Amount %").overrides, { hardMin: 0, hardMax: 100 });
  assert.deepEqual(G.STATE_ATTRS.blur, ["amount.x", "amount.y"]);
  assert.ok(G.ids(model).s1 && G.ids(model).o3 && G.ids(model).b4 && G.ids(model).g3);
});

test("highlight rows: a highlight whose shape is gone shows only the rows it can", () => {
  const p = G.plan({ valuesId: "V", highlights: [{ id: "g1", number: 1, name: "France", effect: "pulse", shape: null, osc: "o1", blur: null }] });
  assert.deepEqual(p.rows.map((r) => r.label), ["Highlight 1 · Amount %", "Highlight 1 · Speed"]);
});

// ---- Callouts ----
const calloutModel = (extra) => Object.assign({ id: "g1", number: 1, text: "Paris", label: "lb", box: "bx", dot: { id: "dt", state: {} },
  bend: { id: "bd", state: {} }, lines: [{ id: "l1", state: {} }, { id: "l2", state: {} }], draws: [{ id: "d1", state: {} }, { id: "d2", state: {} }] }, extra || {});

test("callout rows: nine rows in order, in the overlay group, with the callout's text as notes", () => {
  const model = { valuesId: "V", callouts: [calloutModel()] };
  const p = G.plan(model);
  assert.deepEqual(p.rows.map((r) => r.label), ["Callout 1 · Draw %", "Callout 1 · Line style (0 straight · 1 elbow)", "Callout 1 · Line colour", "Callout 1 · Line width",
    "Callout 1 · Dot size", "Callout 1 · Text colour", "Callout 1 · Text size", "Callout 1 · Box colour", "Callout 1 · Hide box"]);
  p.groups.forEach((g) => assert.equal(g, "overlay"));
  p.rows.forEach((r) => assert.equal(r.notes, "Paris"));
  const row = (label) => p.rows.find((r) => r.label === "Callout 1 · " + label);
  const E = require("../src/core/expression.js");
  const DRAW = "array." + E.inputIndex(E.CALLOUT_DRAW_INPUTS, "draw"), STYLE = "array." + E.inputIndex(E.CALLOUT_GEOM_INPUTS, "style");
  assert.equal(row("Draw %").kind, "value"); assert.equal(row("Draw %").key, "callout:g1:draw");
  assert.deepEqual(row("Draw %").link, [{ layer: "d1", attr: DRAW }, { layer: "d2", attr: DRAW }]);
  assert.deepEqual(row("Draw %").overrides, { hardMin: 0, hardMax: 100 });
  const style = row("Line style (0 straight · 1 elbow)");
  assert.deepEqual(style.link, [{ layer: "bd", attr: STYLE }, { layer: "d1", attr: STYLE }, { layer: "d2", attr: STYLE }]);
  assert.deepEqual(style.overrides, { hardMin: 0, hardMax: 1, step: 1 });
  assert.deepEqual(row("Line colour").link, [{ layer: "l1", attr: "stroke.strokeColor" }, { layer: "l2", attr: "stroke.strokeColor" }]);
  assert.equal(row("Line colour").type, "color");
  assert.deepEqual(row("Line width").link, [{ layer: "l1", attr: "stroke.width" }, { layer: "l2", attr: "stroke.width" }]);
  assert.deepEqual(row("Dot size").link, [{ layer: "dt", attr: "generator.radius.x" }, { layer: "dt", attr: "generator.radius.y" }]);
  [["Text colour", "lb", "material.materialColor"], ["Text size", "lb", "fontSize"], ["Box colour", "bx", "material.materialColor"], ["Hide box", "bx", "hidden"]].forEach(([label, layer, attr]) => {
    assert.equal(row(label).kind, "direct"); assert.equal(row(label).layer, layer); assert.equal(row(label).attr, attr);
  });
  assert.deepEqual(G.STATE_ATTRS.calloutDraw, [DRAW, STYLE]);
  assert.deepEqual(G.STATE_ATTRS.calloutBend, [STYLE]);
  assert.deepEqual(G.STATE_ATTRS.calloutLine, ["stroke.strokeColor", "stroke.width"]);
  assert.deepEqual(G.STATE_ATTRS.calloutDot, ["generator.radius.x", "generator.radius.y"]);
  const ids = G.ids(model);
  ["lb", "bx", "dt", "bd", "l1", "l2", "d1", "d2"].forEach((id) => assert.ok(ids[id], id));
});

test("callout rows: a callout whose box is gone has no Box rows, and rows come after the routes' (callouts numbered apart)", () => {
  const p = G.plan({ valuesId: "V", routes: [], newRoutes: [{ id: "r1", number: 1, title: "A", legs: [{ id: "lg", start: { id: "s" }, end: { id: "e" } }], draws: [] }],
    callouts: [calloutModel({ box: null }), calloutModel({ id: "g2", number: 2, text: "Rome", lines: [{ id: "l3", state: {} }, null], dot: null })] });
  const labels = p.rows.map((r) => r.label);
  assert.ok(labels.indexOf("Callout 1 · Draw %") > labels.indexOf("Route 1 · Width"));
  assert.ok(!labels.some((l) => /^Callout 1 · (Box colour|Hide box)/.test(l)));
  assert.ok(labels.includes("Callout 1 · Text colour"));
  assert.ok(!labels.includes("Callout 2 · Dot size"));
  assert.deepEqual(p.rows.find((r) => r.label === "Callout 2 · Line colour").link, [{ layer: "l3", attr: "stroke.strokeColor" }]);
  assert.equal(p.rows.find((r) => r.label === "Callout 2 · Draw %").notes, "Rome");
});

// ---- Day & night ----
const dnModel = (extra) => ({ valuesId: V, camera: "cam", dayNight: Object.assign({ id: "dn", layers: ["n0", "n6", "n12", "n18"].map((id) => ({ id, state: {} })),
  helpers: ["h0", "h6", "h12", "h18"].map((id) => ({ id, state: {} })), label: { id: "tl", state: {} } }, extra || {}) });
const E = require("../src/core/expression.js");
const NIGHT = (n) => "generator.array." + E.inputIndex(E.NIGHT_INPUTS, n), HELP = (n) => "array." + E.inputIndex(E.NIGHT_OPACITY_INPUTS, n), TLAB = (n) => "generator.array." + E.inputIndex(E.TIME_LABEL_INPUTS, n);

test("day & night rows: the exact rows in order, all in the time group, with their targets and overrides", () => {
  const p = G.plan(dnModel());
  const dn = p.rows.map((r, i) => [r, p.groups[i]]).filter((x) => x[1] === "time").map((x) => x[0]);
  assert.deepEqual(dn.map((r) => r.label), ["Day & night · Day of year (1–365)", "Day & night · UTC time (0–24)", "Day & night · Night colour", "Day & night · Night opacity",
    "Day & night · Twilight (0 hard · 1 soft)", "Day & night · Hide", "Time label · Hide", "Time label · Colour", "Time label · Size",
    "Time label · Corner (0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right)"]);
  assert.equal(dn.length, p.rows.filter((r, i) => p.groups[i] === "time").length);
  const by = (label) => dn.find((r) => r.label === label);
  const day = by("Day & night · Day of year (1–365)");
  assert.equal(day.kind, "value"); assert.equal(day.type, "double");
  assert.deepEqual(day.link, ["n0", "n6", "n12", "n18"].map((l) => ({ layer: l, attr: NIGHT("dayOfYear") })).concat([{ layer: "tl", attr: TLAB("dayOfYear") }]));
  assert.deepEqual(day.overrides, { hardMin: 1, hardMax: 365 });
  const time = by("Day & night · UTC time (0–24)");
  assert.deepEqual(time.link.map((t) => t.attr), [NIGHT("utcTime"), NIGHT("utcTime"), NIGHT("utcTime"), NIGHT("utcTime"), TLAB("utcTime")]);
  assert.deepEqual(time.overrides, { hardMin: 0, hardMax: 24 });
  const colour = by("Day & night · Night colour");
  assert.equal(colour.type, "color");
  assert.deepEqual(colour.link, ["n0", "n6", "n12", "n18"].map((l) => ({ layer: l, attr: "material.materialColor" })));
  const night = by("Day & night · Night opacity");
  assert.deepEqual(night.link, ["h0", "h6", "h12", "h18"].map((l) => ({ layer: l, attr: HELP("night") })));
  assert.deepEqual(night.overrides, { hardMin: 0, hardMax: 100 });
  const tw = by("Day & night · Twilight (0 hard · 1 soft)");
  assert.deepEqual(tw.link.map((t) => t.attr), [HELP("twilight"), HELP("twilight"), HELP("twilight"), HELP("twilight")]);
  assert.deepEqual(tw.overrides, { hardMin: 0, hardMax: 1, step: 1 });
  assert.deepEqual([by("Day & night · Hide").kind, by("Day & night · Hide").layer, by("Day & night · Hide").attr], ["direct", "dn", "hidden"]);
  assert.deepEqual([by("Time label · Hide").kind, by("Time label · Hide").layer, by("Time label · Hide").attr], ["direct", "tl", "hidden"]);
  assert.deepEqual([by("Time label · Colour").kind, by("Time label · Colour").layer, by("Time label · Colour").attr], ["direct", "tl", "material.materialColor"]);
  const size = by("Time label · Size");
  assert.equal(size.kind, "value"); assert.deepEqual(size.link, [{ layer: "tl", attr: TLAB("size") }]);
  const corner = dn[dn.length - 1];
  assert.equal(corner.kind, "value"); assert.deepEqual(corner.link, [{ layer: "tl", attr: TLAB("corner") }]); assert.deepEqual(corner.overrides, { hardMin: 0, hardMax: 3, step: 1 });
  assert.deepEqual(G.STATE_ATTRS.nightLayer, [NIGHT("dayOfYear"), NIGHT("utcTime"), "material.materialColor"]);
  assert.deepEqual(G.STATE_ATTRS.nightHelper, [HELP("night"), HELP("twilight")]);
  assert.deepEqual(G.STATE_ATTRS.timeLabel, [TLAB("dayOfYear"), TLAB("utcTime"), TLAB("size"), TLAB("corner")]);
});

test("day & night rows: none without a model, no label rows without a label, and ids() lists every member", () => {
  assert.ok(!G.plan(model()).groups.includes("time"));
  const p = G.plan(dnModel({ label: null }));
  assert.equal(p.rows.filter((r, i) => p.groups[i] === "time").length, 6);
  assert.ok(!labels(p).some((l) => /^Time label/.test(l)));
  assert.deepEqual(p.rows.find((r) => r.label === "Day & night · Day of year (1–365)").link.length, 4);
  const ids = G.ids(dnModel());
  ["dn", "tl", "n0", "n18", "h0", "h18"].forEach((id) => assert.equal(ids[id], true, id));
});

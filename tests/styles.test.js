const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core/styles.js");

const HEX = /^#[0-9a-fA-F]{6}$/;

test("six built-in styles in order, each filling every role and width", () => {
  assert.deepEqual(S.BUILT_IN.map((s) => s.name), ["Dark", "Light", "Blueprint", "Vintage", "Mono", "Neon night"]);
  assert.equal(S.DARK, S.BUILT_IN[0]);
  assert.equal(S.ROLES.length, 15);
  assert.equal(S.WIDTH_ROLES.length, 7);
  S.BUILT_IN.forEach((s) => {
    S.ROLES.forEach((r) => assert.match(s.colors[r], HEX, s.name + " " + r));
    S.WIDTH_ROLES.forEach((r) => assert.ok(typeof s.widths[r] === "number" && s.widths[r] > 0, s.name + " " + r));
  });
});

test("Dark draws every layer kind exactly as today", () => {
  const TODAY = {
    countries: { fill: "#4a5a50", stroke: "#2a3530", width: 1 }, states: { stroke: "#3a4a40", width: 0.5 }, lakes: { fill: "#1d2a33" },
    coastlines: { stroke: "#2a3530", width: 0.5 }, rivers: { stroke: "#3d6178", width: 1.5 }, cities: { fill: "#e6e6e6" },
    buildings: { fill: "#5c6b61" }, water: { fill: "#1d2a33" }, parks: { fill: "#56705a" },
    roads: { stroke: "#8a948e", width: 2 }, railways: { stroke: "#a0a7a3", width: 1.5 },
    extractFill: { fill: "#e4572e" }, extractLine: { stroke: "#e4572e", width: 3 },
    pin: { fill: "#1F8F4E" }, label: { fill: "#e6e6e6" }, stop: { fill: "#1F8F4E" }, route: { stroke: "#1F8F4E", width: 3 },
    marker: { fill: "#1F8F4E" }, credit: { fill: "#e6e6e6" }, valueLabels: { fill: "#e6e6e6" }, legend: { fill: "#e6e6e6" },
    ocean: { fill: "#1d2a33" }, regions: { stroke: "#1d2a33", width: 0.5 }, bubbles: { fill: "#bc4749", stroke: "#ffffff", width: 1 }
  };
  Object.keys(TODAY).forEach((k) => assert.deepEqual(S.layerStyle(S.DARK, k), TODAY[k], k));
});

test("layerStyle follows the style's roles; fixed parts never change", () => {
  const v = S.builtIn("Vintage");
  assert.deepEqual(S.layerStyle(v, "countries"), { fill: "#e8d9b5", stroke: "#8b6b4a", width: 1.6 });
  assert.deepEqual(S.layerStyle(v, "route"), { stroke: "#a63d2f", width: 3 });
  assert.deepEqual(S.layerStyle(v, "regions"), { stroke: "#a9c4c0", width: 0.5 });
  assert.deepEqual(S.layerStyle(v, "extractLine"), { stroke: "#c76b29", width: 3 });
  assert.deepEqual(S.layerStyle(v, "bubbles"), { fill: "#bc4749", stroke: "#ffffff", width: 1 });
  assert.throws(() => S.layerStyle(v, "nope"), /Unknown style kind: nope/);
});

test("targets lists every colour and width a style sets, primary parts first", () => {
  const t = S.targets({
    ocean: "o", layers: [{ id: "c", category: "countries" }, { id: "s", category: "states" }, { id: "x", category: "extract", line: true }, { id: "y", category: "extract", line: false }, { id: "q", category: "pin" }],
    pins: ["p"], stops: ["st"], legs: ["l"], markers: ["m"], labels: ["lb"], valueLabels: ["vl"], legends: ["lg"], credits: ["cr"], regions: ["rg"]
  });
  const F = "material.materialColor", K = "stroke.strokeColor", W = "stroke.width";
  assert.deepEqual(t, [
    { layer: "o", attr: F, role: "ocean", kind: "color" },
    { layer: "c", attr: F, role: "land", kind: "color" }, { layer: "c", attr: K, role: "borders", kind: "color" }, { layer: "c", attr: W, role: "borders", kind: "width" },
    { layer: "s", attr: K, role: "states", kind: "color" }, { layer: "s", attr: W, role: "states", kind: "width" },
    { layer: "x", attr: K, role: "extract", kind: "color" },
    { layer: "y", attr: F, role: "extract", kind: "color" },
    { layer: "p", attr: F, role: "accent", kind: "color" },
    { layer: "st", attr: F, role: "accent", kind: "color" },
    { layer: "l", attr: K, role: "accent", kind: "color" }, { layer: "l", attr: W, role: "routes", kind: "width" },
    { layer: "m", attr: F, role: "accent", kind: "color" },
    { layer: "lb", attr: F, role: "text", kind: "color" }, { layer: "vl", attr: F, role: "text", kind: "color" },
    { layer: "lg", attr: F, role: "text", kind: "color" }, { layer: "cr", attr: F, role: "text", kind: "color" },
    { layer: "rg", attr: K, role: "ocean", kind: "color" }
  ]);
  assert.deepEqual(S.targets({}), []);
  const b = S.builtIn("Blueprint");
  assert.equal(S.valueFor(b, { role: "routes", kind: "width" }), 2);
  assert.equal(S.valueFor(b, { role: "accent", kind: "color" }), "#ffffff");
});

test("toHex reads Cavalry colours and hex strings", () => {
  assert.equal(S.toHex({ r: 31, g: 143, b: 78, a: 255 }), "#1f8f4e");
  assert.equal(S.toHex("#1F8F4E"), "#1F8F4E");
  assert.equal(S.toHex("#1f8f4eff"), "#1f8f4e");
  assert.equal(S.toHex("green"), null);
  assert.equal(S.toHex(null), null);
});

test("clean fills missing or bad values from the base; fromReadings keeps the first reading per role", () => {
  const c = S.clean({ name: "  Mine ", colors: { land: "#123456", ocean: "blue" }, widths: { roads: 4, rivers: -1, coast: "2" } });
  assert.equal(c.name, "Mine");
  assert.equal(c.colors.land, "#123456");
  assert.equal(c.colors.ocean, S.DARK.colors.ocean);
  assert.equal(c.widths.roads, 4);
  assert.equal(c.widths.rivers, S.DARK.widths.rivers);
  assert.equal(c.widths.coast, S.DARK.widths.coast);
  assert.equal(S.clean({}).name, "Dark");
  const base = S.builtIn("Mono");
  const r = S.fromReadings("Mine", [
    { role: "land", kind: "color", value: { r: 255, g: 0, b: 0 } }, { role: "land", kind: "color", value: "#00ff00" },
    { role: "roads", kind: "width", value: 5 }, { role: "rivers", kind: "width", value: null }, { role: "ocean", kind: "color", value: "nope" }
  ], base);
  assert.equal(r.name, "Mine");
  assert.equal(r.colors.land, "#ff0000");
  assert.equal(r.widths.roads, 5);
  assert.equal(r.widths.rivers, base.widths.rivers);
  assert.equal(r.colors.ocean, base.colors.ocean);
  assert.equal(r.colors.accent, base.colors.accent);
});

test("normalise keeps good saved styles and drops unusable ones without throwing", () => {
  const list = S.normalise([
    { name: "Mine", colors: { land: "#111111" } }, { name: "mine ", colors: {} }, { name: "dark" }, { name: "" }, { colors: {} }, null, 7,
    { name: "Other", colors: { land: "bad" }, widths: { roads: "x" } }
  ]);
  assert.deepEqual(list.map((s) => s.name), ["Mine", "Other"]);
  assert.equal(list[0].colors.land, "#111111");
  assert.equal(list[1].colors.land, S.DARK.colors.land);
  assert.equal(list[1].widths.roads, S.DARK.widths.roads);
  assert.deepEqual(S.normalise(undefined), []);
  assert.deepEqual(S.normalise("junk"), []);
});

test("names, find, builtIn and previewColors", () => {
  const saved = S.normalise([{ name: "Mine" }]);
  assert.deepEqual(S.names(saved), ["Dark", "Light", "Blueprint", "Vintage", "Mono", "Neon night", "Mine"]);
  assert.equal(S.find("BLUEPRINT", saved).name, "Blueprint");
  assert.equal(S.find(" mine", saved).name, "Mine");
  assert.equal(S.find("nope", saved), null);
  assert.equal(S.isBuiltIn("neon NIGHT"), true);
  assert.equal(S.isBuiltIn("Mine"), false);
  assert.equal(S.builtIn("mono").name, "Mono");
  assert.deepEqual(S.previewColors(S.builtIn("Light")), { water: "#cfe3ec", land: "#f2efe6", border: "#b9b4a6" });
});

test("furniture takes the text colour and is a style target", () => {
  assert.deepEqual(S.layerStyle(S.builtIn("Vintage"), "furniture"), { fill: "#4a3423" });
  assert.deepEqual(S.targets({ furniture: ["f"] }), [{ layer: "f", attr: "material.materialColor", role: "text", kind: "color" }]);
});

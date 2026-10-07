// Map styles: named sets of colours and line widths for each part of a map (ocean, land,
// borders, roads, pins, routes, labels...). Pure: GeoScene draws and restyles maps with them
// and the panel lists, saves and deletes them. A style never touches data colours, imagery,
// the camera, or hide / opacity / size settings.
var GeoStyles = (function () {
  var ROLES = ["ocean", "land", "borders", "states", "coast", "water", "rivers", "parks", "buildings", "cities", "roads", "railways", "accent", "text", "extract"];
  var WIDTH_ROLES = ["borders", "states", "coast", "rivers", "roads", "railways", "routes"];
  var FILL = "material.materialColor", STROKE = "stroke.strokeColor", WIDTH = "stroke.width";
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var CALLOUT_BOX_LIGHTEN = 0.15, NIGHT_DARKEN = 0.6;

  // Colours in ROLES order, widths in WIDTH_ROLES order.
  function make(name, colors, widths) {
    var c = {}, w = {};
    ROLES.forEach(function (r, i) { c[r] = colors[i]; });
    WIDTH_ROLES.forEach(function (r, i) { w[r] = widths[i]; });
    return { name: name, colors: c, widths: w };
  }
  var BUILT_IN = [
    make("Dark", ["#1d2a33", "#4a5a50", "#2a3530", "#3a4a40", "#2a3530", "#1d2a33", "#3d6178", "#56705a", "#5c6b61", "#e6e6e6", "#8a948e", "#a0a7a3", "#1F8F4E", "#e6e6e6", "#e4572e"], [1, 0.5, 0.5, 1.5, 2, 1.5, 3]),
    make("Light", ["#cfe3ec", "#f2efe6", "#b9b4a6", "#d6d1c4", "#9fb7c2", "#cfe3ec", "#8fb8cc", "#d5e6c8", "#e2ddd1", "#333333", "#c9c2b2", "#a39e93", "#1F8F4E", "#333333", "#e4572e"], [1, 0.5, 0.5, 1.5, 2, 1.5, 3]),
    make("Blueprint", ["#123a6b", "#1a4a85", "#cfe3ff", "#7fa6d9", "#cfe3ff", "#123a6b", "#8fbfff", "#1f5590", "#2a5c99", "#ffffff", "#cfe3ff", "#9fc1ee", "#ffffff", "#ffffff", "#ffd166"], [0.6, 0.4, 0.8, 1, 1.2, 1, 2]),
    make("Vintage", ["#a9c4c0", "#e8d9b5", "#8b6b4a", "#b39b78", "#6f8f8a", "#a9c4c0", "#6f8f8a", "#c9cf9c", "#d4bf98", "#4a3423", "#b08d63", "#7a5c3e", "#a63d2f", "#4a3423", "#c76b29"], [1.6, 0.8, 1.2, 1.6, 2, 1.5, 3]),
    make("Mono", ["#111111", "#2b2b2b", "#5a5a5a", "#404040", "#5a5a5a", "#111111", "#444444", "#333333", "#3a3a3a", "#f2f2f2", "#6e6e6e", "#7a7a7a", "#ffffff", "#f2f2f2", "#bdbdbd"], [1, 0.5, 0.5, 1.5, 2, 1.5, 3]),
    make("Neon night", ["#07070f", "#14142a", "#2de2e6", "#1d6f86", "#2de2e6", "#07070f", "#2de2e6", "#16302e", "#1e1e3a", "#ff3f8e", "#8a5cf6", "#2de2e6", "#ff3f8e", "#f2f2ff", "#ffd23f"], [0.8, 0.5, 0.8, 1.2, 1.5, 1, 3])
  ];

  // What each kind of layer is drawn with: a role name, or a fixed value no style changes.
  var KINDS = {
    countries: { fill: "land", stroke: "borders", width: "borders" },
    states: { stroke: "states", width: "states" },
    lakes: { fill: "water" },
    coastlines: { stroke: "coast", width: "coast" },
    rivers: { stroke: "rivers", width: "rivers" },
    cities: { fill: "cities" },
    buildings: { fill: "buildings" },
    water: { fill: "water" },
    parks: { fill: "parks" },
    roads: { stroke: "roads", width: "roads" },
    railways: { stroke: "railways", width: "railways" },
    extractFill: { fill: "extract" },
    extractLine: { stroke: "extract", width: 3 },
    pin: { fill: "accent" }, stop: { fill: "accent" }, marker: { fill: "accent" },
    route: { stroke: "accent", width: "routes" },
    timeLabel: { fill: "text" }, label: { fill: "text" }, credit: { fill: "text" }, valueLabels: { fill: "text" }, legend: { fill: "text" }, furniture: { fill: "text" },
    ocean: { fill: "ocean" },
    regions: { stroke: "ocean", width: 0.5 },
    bubbles: { fill: "#bc4749", stroke: "#ffffff", width: 1 }
  };

  function layerStyle(style, kind) {
    var k = KINDS[kind], out = {};
    if (!k) throw new Error("Unknown style kind: " + kind);
    ["fill", "stroke"].forEach(function (p) { if (k[p]) out[p] = k[p].charAt(0) === "#" ? k[p] : style.colors[k[p]]; });
    if (k.width !== undefined) out.width = typeof k.width === "number" ? k.width : style.widths[k.width];
    return out;
  }

  // Every colour / width a style sets on a map's existing parts. Primary parts come first
  // (the Ocean before the data region outlines), so Save reads each role from its main part.
  function targets(parts) {
    var out = [];
    function add(id, attr, role, kind) { out.push({ layer: id, attr: attr, role: role, kind: kind }); }
    function each(ids, attr, role) { (ids || []).forEach(function (id) { add(id, attr, role, "color"); }); }
    if (parts.ocean) add(parts.ocean, FILL, "ocean", "color");
    (parts.layers || []).forEach(function (l) {
      var k = l.category === "extract" ? KINDS[l.line ? "extractLine" : "extractFill"] : KINDS[l.category];
      if (!k || ["pin", "stop", "marker", "route", "label", "credit", "valueLabels", "legend", "furniture", "ocean", "regions", "bubbles"].indexOf(l.category) >= 0) return;
      if (k.fill) add(l.id, FILL, k.fill, "color");
      if (k.stroke) add(l.id, STROKE, k.stroke, "color");
      if (typeof k.width === "string") add(l.id, WIDTH, k.width, "width");
    });
    each(parts.pins, FILL, "accent");
    each(parts.stops, FILL, "accent");
    (parts.legs || []).forEach(function (id) { add(id, STROKE, "accent", "color"); add(id, WIDTH, "routes", "width"); });
    each(parts.markers, FILL, "accent");
    each(parts.labels, FILL, "text");
    each(parts.valueLabels, FILL, "text");
    each(parts.legends, FILL, "text");
    each(parts.credits, FILL, "text");
    each(parts.furniture, FILL, "text");
    each(parts.regions, STROKE, "ocean");
    each(parts.calloutLines, STROKE, "accent");
    each(parts.calloutDots, FILL, "accent");
    each(parts.calloutBoxes, FILL, "calloutBox");
    each(parts.nightLayers, FILL, "night");
    each(parts.timeLabels, FILL, "text");
    return out;
  }

  // A callout's box: the style's ocean colour mixed a little toward white, so it stands out from the water.
  function calloutBox(style) {
    var h = String(style.colors.ocean).slice(1, 7), out = "#";
    for (var i = 0; i < 3; i++) {
      var c = parseInt(h.slice(i * 2, i * 2 + 2), 16), s = Math.round(c + (255 - c) * CALLOUT_BOX_LIGHTEN).toString(16);
      out += s.length < 2 ? "0" + s : s;
    }
    return out;
  }

  // The night side of a day & night overlay: the style's ocean colour mixed 60 % toward black.
  function nightColour(style) {
    var h = String(style.colors.ocean).slice(1, 7), out = "#";
    for (var i = 0; i < 3; i++) {
      var c = parseInt(h.slice(i * 2, i * 2 + 2), 16), s = Math.round(c * (1 - NIGHT_DARKEN)).toString(16);
      out += s.length < 2 ? "0" + s : s;
    }
    return out;
  }

  function valueFor(style, t) {
    if (t.role === "calloutBox") return calloutBox(style);
    if (t.role === "night") return nightColour(style);
    return t.kind === "width" ? style.widths[t.role] : style.colors[t.role];
  }

  function toHex(v) {
    if (v && typeof v === "object" && v.r !== undefined) {
      return "#" + [v.r, v.g, v.b].map(function (n) { var s = Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
    }
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) return v.slice(0, 7);
    return null;
  }

  function clean(entry, base) {
    base = base || BUILT_IN[0];
    entry = entry && typeof entry === "object" ? entry : {};
    var c = entry.colors || {}, w = entry.widths || {};
    var name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : base.name;
    var out = { name: name, colors: {}, widths: {} };
    ROLES.forEach(function (r) { out.colors[r] = typeof c[r] === "string" && HEX.test(c[r]) ? c[r] : base.colors[r]; });
    WIDTH_ROLES.forEach(function (r) { var n = w[r]; out.widths[r] = typeof n === "number" && isFinite(n) && n >= 0 ? n : base.widths[r]; });
    return out;
  }

  function fromReadings(name, readings, fallback) {
    var colors = {}, widths = {};
    (readings || []).forEach(function (r) {
      if (r.value === null || r.value === undefined) return;
      if (r.kind === "width") {
        var n = Number(r.value);
        if (widths[r.role] === undefined && isFinite(n) && n >= 0) widths[r.role] = n;
      } else {
        var h = toHex(r.value);
        if (colors[r.role] === undefined && h) colors[r.role] = h;
      }
    });
    return clean({ name: name, colors: colors, widths: widths }, fallback);
  }

  function key(name) { return String(name).trim().toLowerCase(); }
  function builtIn(name) {
    for (var i = 0; i < BUILT_IN.length; i++) if (key(BUILT_IN[i].name) === key(name)) return BUILT_IN[i];
    return null;
  }
  function isBuiltIn(name) { return builtIn(name) !== null; }

  function normalise(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (e) {
      if (!e || typeof e !== "object" || typeof e.name !== "string" || !e.name.trim()) return;
      var k = key(e.name);
      if (isBuiltIn(e.name) || seen[k]) return;
      seen[k] = true;
      out.push(clean(e, BUILT_IN[0]));
    });
    return out;
  }

  function find(name, saved) {
    var all = BUILT_IN.concat(saved || []);
    for (var i = 0; i < all.length; i++) if (key(all[i].name) === key(name)) return all[i];
    return null;
  }
  function names(saved) { return BUILT_IN.concat(saved || []).map(function (s) { return s.name; }); }
  function previewColors(style) { return { water: style.colors.ocean, land: style.colors.land, border: style.colors.borders }; }

  return {
    ROLES: ROLES, WIDTH_ROLES: WIDTH_ROLES, BUILT_IN: BUILT_IN, DARK: BUILT_IN[0],
    layerStyle: layerStyle, targets: targets, valueFor: valueFor, calloutBox: calloutBox, nightColour: nightColour, CALLOUT_BOX_LIGHTEN: CALLOUT_BOX_LIGHTEN, toHex: toHex, clean: clean, fromReadings: fromReadings,
    normalise: normalise, builtIn: builtIn, isBuiltIn: isBuiltIn, find: find, names: names, previewColors: previewColors
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoStyles;

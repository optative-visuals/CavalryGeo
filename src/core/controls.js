// Works out a map's Controls panel: which settings it shows, in what order, under what
// names, and which layers each "control values" input should drive. Pure: GeoControlPanel
// (src/cavalry/controls.js) reads the map into a plain model and applies the result.
if (typeof GeoExpression === "undefined" && typeof require !== "undefined") { var GeoExpression = require("./expression.js"); }
var GeoControls = (function () {
  var E = GeoExpression;
  var IN = "generator.array.";
  var FILL = "material.materialColor", STROKE = "stroke.strokeColor", WIDTH = "stroke.width";
  var DETAIL = IN + E.inputIndex(E.MAP_INPUTS, "detail");
  var RADIUS = IN + E.inputIndex(E.MAP_INPUTS, "pointRadius");
  var LIFT = IN + E.inputIndex(E.ROUTE_INPUTS, "lift");
  // Regions, bubbles and value labels all put Year straight after the map inputs.
  var YEAR = IN + E.inputIndex(E.REGION_INPUTS, "year");
  var LOW = IN + E.inputIndex(E.REGION_INPUTS, "low"), HIGH = IN + E.inputIndex(E.REGION_INPUTS, "high");
  var MIDDLE = IN + E.inputIndex(E.REGION_INPUTS, "middle"), NO_DATA = IN + E.inputIndex(E.REGION_INPUTS, "noData");
  var MAX_RADIUS = IN + E.inputIndex(E.BUBBLE_INPUTS, "maxRadius"), TEXT_SIZE = IN + E.inputIndex(E.VALUE_LABEL_INPUTS, "textSize");
  var BASE = ["countries", "states", "lakes", "coastlines", "rivers", "cities", "buildings", "water", "parks", "roads", "railways"];
  var NAMES = { countries: "Countries", states: "States", lakes: "Lakes", coastlines: "Coastlines", rivers: "Rivers", cities: "Cities",
    buildings: "Buildings", water: "Water", parks: "Parks", roads: "Roads", railways: "Railways" };
  // The attributes a values input may drive on each kind of member: the glue reads their
  // link state (incoming connection, keyframes, geoLinks record) into model.*.state.
  var STATE_ATTRS = {
    layer: [DETAIL, RADIUS], pin: ["hidden", FILL, RADIUS], label: ["hidden", FILL, "fontSize"], leg: [STROKE, WIDTH, LIFT],
    regions: [YEAR, LOW, HIGH, MIDDLE, NO_DATA], bubbles: [YEAR, MAX_RADIUS], valueLabels: [YEAR, TEXT_SIZE]
  };
  var SEP = " · ";

  // What a layer's geoLinks user data says once a values input has been connected to it.
  function recordFor(valuesId, key) { return valuesId + "|" + key; }

  function plan(model) {
    var out = { rows: [], trim: [] }, V = model.valuesId;
    function direct(layer, attr, label, overrides) {
      var r = { kind: "direct", layer: layer, attr: attr, label: label };
      if (overrides) r.overrides = overrides;
      out.rows.push(r);
    }
    // One values input driving `attr` on the members it may: already ours → linked; wired
    // elsewhere, animated, or unlinked by the user on purpose → left alone; otherwise → link.
    function value(key, type, label, members, attr) {
      var rec = recordFor(V, key), link = [], linked = [];
      members.forEach(function (m) {
        var s = (m.state && m.state[attr]) || {};
        if (s.from) {
          if (s.from.indexOf(V + ".") === 0) linked.push({ layer: m.id, attr: attr });
          return;
        }
        if (s.keyed || s.record === rec) return;
        link.push({ layer: m.id, attr: attr });
      });
      if (link.length || linked.length) out.rows.push({ kind: "value", key: key, type: type, label: label, link: link, linked: linked });
    }
    // A second use of a name gets " 2", " 3"...; layers, routes and data sets are counted apart.
    function numberer() { var used = {}; return function (name) { used[name] = (used[name] || 0) + 1; return used[name] > 1 ? name + " " + used[name] : name; }; }
    var layerName = numberer(), routeName = numberer(), setName = numberer();

    var c = model.camera;
    if (c) {
      direct(c, "array.2", "Camera" + SEP + "Zoom");
      direct(c, "array.0", "Camera" + SEP + "Centre latitude");
      direct(c, "array.1", "Camera" + SEP + "Centre longitude");
      direct(c, "array.3", "Camera" + SEP + "Rotation");
      direct(c, "array.4", "Camera" + SEP + "Projection (0 flat · 1 Equal Earth · 2 globe)", { hardMin: 0, hardMax: 2, step: 1 });
    }
    if (model.ocean) {
      direct(model.ocean, FILL, "Ocean" + SEP + "Colour");
      direct(model.ocean, "hidden", "Ocean" + SEP + "Hide");
    }
    (model.layers || []).forEach(function (l) {
      var n = layerName(l.category === "extract" ? (l.name || "Feature") : (NAMES[l.category] || l.category)) + SEP;
      direct(l.id, "hidden", n + "Hide");
      direct(l.id, "opacity", n + "Opacity");
      if (l.fill) direct(l.id, FILL, n + "Fill colour");
      if (l.stroke) { direct(l.id, STROKE, n + "Outline colour"); direct(l.id, WIDTH, n + "Outline width"); }
      value("layer:" + l.id + ":detail", "double", n + "Detail", [l], DETAIL);
      if (l.point) value("layer:" + l.id + ":dot", "double", n + "Dot size", [l], RADIUS);
    });
    var pins = model.pins || [];
    if (pins.length) {
      value("pins:hidden", "bool", "Pins" + SEP + "Hide", pins, "hidden");
      value("pins:color", "color", "Pins" + SEP + "Colour", pins, FILL);
      value("pins:size", "double", "Pins" + SEP + "Size", pins, RADIUS);
    }
    var labels = model.labels || [];
    if (labels.length) {
      value("labels:hidden", "bool", "Labels" + SEP + "Hide", labels, "hidden");
      value("labels:color", "color", "Labels" + SEP + "Colour", labels, FILL);
      value("labels:size", "double", "Labels" + SEP + "Size", labels, "fontSize");
    }
    (model.routes || []).forEach(function (r) {
      var n = routeName(r.name) + SEP, k = "route:" + r.id + ":";
      value(k + "color", "color", n + "Colour", r.legs, STROKE);
      value(k + "width", "double", n + "Width", r.legs, WIDTH);
      value(k + "lift", "double", n + "Arc height", r.legs, LIFT);
      r.legs.forEach(function (leg, i) {
        direct(leg.id, "stroke.trimEnd", n + "Leg " + (leg.number || i + 1) + " draw on %");
        out.trim.push(leg.id);
      });
    });
    var data = model.data || {};
    if (data.year && data.year.length) value("data:year", "double", "Data" + SEP + "Year", data.year, YEAR);
    (data.sets || []).forEach(function (s) {
      var n = setName(s.name) + SEP, k = "data:" + s.id + ":";
      if (s.regions) {
        value(k + "low", "color", n + "Low colour", [s.regions], LOW);
        value(k + "high", "color", n + "High colour", [s.regions], HIGH);
        if (s.regions.useMiddle) value(k + "middle", "color", n + "Middle colour", [s.regions], MIDDLE);
        value(k + "noData", "color", n + "No-data colour", [s.regions], NO_DATA);
      }
      if (s.bubbles) {
        value(k + "bubbleSize", "double", n + "Bubble size", [s.bubbles], MAX_RADIUS);
        direct(s.bubbles.id, FILL, n + "Bubble colour");
      }
      if (s.labels) value(k + "labelSize", "double", n + "Label size", [s.labels], TEXT_SIZE);
    });
    (model.imagery || []).forEach(function (g) {
      direct(g.id, "opacity", g.name + SEP + "Opacity");
      direct(g.id, "hidden", g.name + SEP + "Hide");
    });
    return out;
  }

  function ids(model) {
    var out = {};
    function add(m) { var id = m && typeof m === "object" ? m.id : m; if (id) out[id] = true; }
    add(model.valuesId); add(model.camera); add(model.ocean);
    (model.layers || []).concat(model.pins || [], model.labels || [], model.imagery || []).forEach(add);
    (model.routes || []).forEach(function (r) { (r.legs || []).forEach(add); });
    var data = model.data || {};
    (data.year || []).forEach(add);
    (data.sets || []).forEach(function (s) { add(s.regions); add(s.bubbles); add(s.labels); });
    return out;
  }

  return { plan: plan, ids: ids, recordFor: recordFor, BASE: BASE, STATE_ATTRS: STATE_ATTRS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoControls;

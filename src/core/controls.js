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
  var H = function (name) { return "array." + E.inputIndex(E.HANDLE_INPUTS, name); };
  var H_SHAPE = H("shape"), H_ARC = H("arc"), H_LEAN = H("lean"), H_FLIP = H("flip"), H_HAND = H("hand"), H_X = H("handX"), H_Y = H("handY");
  var RADIUS_X = "generator.radius.x", RADIUS_Y = "generator.radius.y";
  var BASE = ["countries", "states", "lakes", "coastlines", "rivers", "cities", "buildings", "water", "parks", "roads", "railways"];
  var NAMES = { countries: "Countries", states: "States", lakes: "Lakes", coastlines: "Coastlines", rivers: "Rivers", cities: "Cities",
    buildings: "Buildings", water: "Water", parks: "Parks", roads: "Roads", railways: "Railways" };
  var SB = function (n) { return IN + E.inputIndex(E.SCALE_BAR_INPUTS, n); }, NA = function (n) { return IN + E.inputIndex(E.NORTH_ARROW_INPUTS, n); };
  var CO_DRAW = "array." + E.inputIndex(E.CALLOUT_DRAW_INPUTS, "draw"), CO_STYLE = "array." + E.inputIndex(E.CALLOUT_GEOM_INPUTS, "style");
  // The anchor sits at a different index in the edge / bend helpers and in the draw helpers (it is appended to each list).
  var CO_ANCHOR = "array." + E.inputIndex(E.CALLOUT_GEOM_INPUTS, "anchor"), CO_ANCHOR_DRAW = "array." + E.inputIndex(E.CALLOUT_DRAW_INPUTS, "anchor");
  var N_DAY = IN + E.inputIndex(E.NIGHT_INPUTS, "dayOfYear"), N_TIME = IN + E.inputIndex(E.NIGHT_INPUTS, "utcTime");
  var NH_NIGHT = "array." + E.inputIndex(E.NIGHT_OPACITY_INPUTS, "night"), NH_TWILIGHT = "array." + E.inputIndex(E.NIGHT_OPACITY_INPUTS, "twilight");
  var NH_LIGHTS = "array." + E.inputIndex(E.NIGHT_OPACITY_INPUTS, "lights");
  var TL = function (n) { return IN + E.inputIndex(E.TIME_LABEL_INPUTS, n); };
  function choice(max) { return { hardMin: 0, hardMax: max, step: 1 }; }
  var CORNERS = " (0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right)";
  // The attributes a values input may drive on each kind of member: the glue reads their
  // link state (incoming connection, keyframes, geoLinks record) into model.*.state.
  var STATE_ATTRS = {
    layer: [DETAIL, RADIUS], pin: ["hidden", FILL, RADIUS], label: ["hidden", FILL, "fontSize"], leg: [STROKE, WIDTH, LIFT],
    regions: [YEAR, LOW, HIGH, MIDDLE, NO_DATA], bubbles: [YEAR, MAX_RADIUS], valueLabels: [YEAR, TEXT_SIZE],
    stop: ["hidden", FILL, RADIUS_X, RADIUS_Y], newLeg: [STROKE, WIDTH], handle: [H_ARC, H_LEAN, H_FLIP, H_HAND, H_X, H_Y, H_SHAPE],
    dup: ["hidden", "generator.calculateRotations"], marker: [FILL], travellerScale: ["array.0"], draw: ["array.0"],
    scaleBar: [SB("units"), SB("style"), SB("corner"), SB("margin"), SB("maxWidth")], northArrow: [NA("style"), NA("corner"), NA("margin"), NA("size")], furnitureFade: ["array.1"],
    blur: ["amount.x", "amount.y"],
    calloutDraw: [CO_DRAW, CO_STYLE, CO_ANCHOR_DRAW], calloutBend: [CO_STYLE, CO_ANCHOR], calloutEdge: [CO_ANCHOR], calloutLine: [STROKE, WIDTH], calloutDot: [RADIUS_X, RADIUS_Y],
    nightLayer: [N_DAY, N_TIME, FILL], nightHelper: [NH_NIGHT, NH_TWILIGHT, NH_LIGHTS], nightBlur: [NH_TWILIGHT], timeLabel: [TL("dayOfYear"), TL("utcTime"), TL("size"), TL("corner")], nightLights: ["opacity"]
  };
  var SEP = " · ";
  // Which Controls component a row lives in (plan(model).groups runs parallel to its rows).
  var GROUPS = ["main", "overlay", "data", "extract", "time"];

  // What a layer's geoLinks user data says once a values input has been connected to it.
  function recordFor(valuesId, key) { return valuesId + "|" + key; }

  function plan(model) {
    var out = { rows: [], trim: [], groups: [] }, V = model.valuesId, group = "main", notes = "";
    function direct(layer, attr, label, overrides) {
      var r = { kind: "direct", layer: layer, attr: attr, label: label };
      if (overrides) r.overrides = overrides;
      if (notes) r.notes = notes;
      out.rows.push(r);
      out.groups.push(group);
    }
    // One values input driving each target ({ m: member, attr }) it may: already ours → linked;
    // wired elsewhere, animated, or unlinked by the user on purpose → left alone; otherwise → link.
    // start: a new input begins at that value and drives every target, whatever they hold (for the plugin's own defaults).
    function valueTargets(key, type, label, targets, overrides, start) {
      var rec = recordFor(V, key), link = [], linked = [];
      targets.forEach(function (t) {
        var s = (t.m.state && t.m.state[t.attr]) || {};
        if (s.from) {
          if (s.from.indexOf(V + ".") === 0) linked.push({ layer: t.m.id, attr: t.attr });
          return;
        }
        if (s.keyed || s.record === rec) return;
        link.push({ layer: t.m.id, attr: t.attr });
      });
      if (link.length || linked.length) {
        var row = { kind: "value", key: key, type: type, label: label, link: link, linked: linked };
        if (overrides) row.overrides = overrides;
        if (start !== undefined) row.start = start;
        if (notes) row.notes = notes;
        out.rows.push(row);
        out.groups.push(group);
      }
    }
    // The same attribute on each of several members.
    function value(key, type, label, members, attr, overrides) {
      valueTargets(key, type, label, members.map(function (m) { return { m: m, attr: attr }; }), overrides);
    }
    // A second use of a name gets " 2", " 3"...; layers, routes and data sets are counted apart.
    function numberer() { var used = {}; return function (name) { used[name] = (used[name] || 0) + 1; return used[name] > 1 ? name + " " + used[name] : name; }; }
    var layerName = numberer(), routeName = numberer();
    // "Route 3" when the route has a number, else its name (numbered apart from the layers).
    function routeLabel(r) { return r.number ? "Route " + r.number : routeName(r.name); }
    // A route's travellers (copies riding its legs): shared hide, size, colour (a plugin marker only) and facing.
    function travellerRows(routeId, n) {
      (model.travellers || []).filter(function (t) { return t.routeId === routeId; }).forEach(function (t) {
        var k = "trav:" + routeId + ":";
        value(k + "hide", "bool", n + "Traveller hide", t.dups, "hidden");
        // One target: the scale helper's size input (it multiplies the source layer's own scale).
        if (t.scale) value(k + "size", "double", n + "Traveller size", [t.scale], "array.0");
        if (t.marker) value(k + "color", "color", n + "Traveller colour", [t.marker], FILL);
        value(k + "face", "bool", n + "Traveller faces direction", t.dups, "generator.calculateRotations");
      });
    }

    group = "main";
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
      group = l.category === "extract" ? "extract" : "main";
      var n = layerName(l.category === "extract" ? (l.name || "Feature") : (NAMES[l.category] || l.category)) + SEP;
      direct(l.id, "hidden", n + "Hide");
      direct(l.id, "opacity", n + "Opacity");
      if (l.fill) direct(l.id, FILL, n + "Fill colour");
      if (l.stroke) { direct(l.id, STROKE, n + "Outline colour"); direct(l.id, WIDTH, n + "Outline width"); }
      value("layer:" + l.id + ":detail", "double", n + "Detail", [l], DETAIL);
      if (l.point) value("layer:" + l.id + ":dot", "double", n + "Dot size", [l], RADIUS);
    });
    // Highlights: their Amount % and look, after the extract rows (the keys live on ordinary
    // attributes, so the rows point straight at them).
    group = "extract";
    (model.highlights || []).forEach(function (h) {
      var n = "Highlight " + h.number + SEP, line = h.effect === "outline" || h.effect === "pulse";
      notes = h.name || "";
      var amount = h.effect === "pulse" ? [h.id, "opacity"] : h.shape ? [h.shape, h.effect === "outline" ? "stroke.trimEnd" : "opacity"] : null;
      if (amount) direct(amount[0], amount[1], n + "Amount %", { hardMin: 0, hardMax: 100 });
      if (h.shape) direct(h.shape, line ? STROKE : FILL, n + "Colour");
      if (h.shape && h.effect === "outline") direct(h.shape, WIDTH, n + "Width");
      if (h.osc && h.effect === "pulse") direct(h.osc, "frequency", n + "Speed", { hardMin: 0 });
      if (h.blur && h.effect === "glow") valueTargets("hl:" + h.id + ":size", "double", n + "Size", [{ m: h.blur, attr: "amount.x" }, { m: h.blur, attr: "amount.y" }], { hardMin: 0 });
      notes = "";
    });
    group = "overlay";
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
    var stopsM = model.stops || [];
    if (stopsM.length) {
      value("stops:hidden", "bool", "Stops" + SEP + "Hide", stopsM, "hidden");
      value("stops:color", "color", "Stops" + SEP + "Colour", stopsM, FILL);
      var sizeTargets = [];
      stopsM.forEach(function (m) { sizeTargets.push({ m: m, attr: RADIUS_X }, { m: m, attr: RADIUS_Y }); });
      valueTargets("stops:size", "double", "Stops" + SEP + "Size", sizeTargets);
    }
    (model.routes || []).forEach(function (r) {
      var n = routeLabel(r) + SEP, k = "route:" + r.id + ":";
      notes = r.title || r.name || "";
      if ((r.draws || []).length) value(k + "travel", "double", n + "Travel %", r.draws, "array.0", { hardMin: 0, hardMax: 100 });
      value(k + "lift", "double", n + "Arc height", r.legs, LIFT);
      value(k + "color", "color", n + "Colour", r.legs, STROKE);
      value(k + "width", "double", n + "Width", r.legs, WIDTH);
      r.legs.forEach(function (leg) { out.trim.push(leg.id); });
      travellerRows(r.id, n);
      notes = "";
    });
    (model.newRoutes || []).forEach(function (r) {
      var n = routeLabel(r) + SEP, k = "route:" + r.id + ":", handles = [];
      r.legs.forEach(function (leg) { handles.push(leg.start, leg.end); });
      notes = r.title || r.name || "";
      if ((r.draws || []).length) value(k + "travel", "double", n + "Travel %", r.draws, "array.0", { hardMin: 0, hardMax: 100 });
      value(k + "arc", "double", n + "Arc height", handles, H_ARC);
      value(k + "shape", "double", n + "Shape (0 arc · 1 great circle)", handles, H_SHAPE, { hardMin: 0, hardMax: 1, step: 1 });
      value(k + "color", "color", n + "Colour", r.legs, STROKE);
      value(k + "width", "double", n + "Width", r.legs, WIDTH);
      r.legs.forEach(function (leg) { out.trim.push(leg.id); });
      travellerRows(r.id, n);
      notes = "";
    });
    // Callouts: Draw % and look as values on the helper scripts' inputs (never renamed there); text
    // and box on their own attributes. A member that is gone just drops the rows it would have had.
    (model.callouts || []).forEach(function (c) {
      var n = "Callout " + c.number + SEP, k = "callout:" + c.id + ":", draws = (c.draws || []).filter(Boolean), lines = (c.lines || []).filter(Boolean);
      var styleTargets = [];
      notes = c.text || "";
      if (draws.length) value(k + "draw", "double", n + "Draw %", draws, CO_DRAW, { hardMin: 0, hardMax: 100 });
      if (c.bend) styleTargets.push({ m: c.bend, attr: CO_STYLE });
      draws.forEach(function (d) { styleTargets.push({ m: d, attr: CO_STYLE }); });
      valueTargets(k + "style", "double", n + "Line style (0 straight · 1 elbow)", styleTargets, choice(1));
      // Where the line meets the box, on the edge, bend and both draw helpers (their inputs sit at different indices).
      var anchorTargets = [];
      if (c.edge) anchorTargets.push({ m: c.edge, attr: CO_ANCHOR });
      if (c.bend) anchorTargets.push({ m: c.bend, attr: CO_ANCHOR });
      draws.forEach(function (d) { anchorTargets.push({ m: d, attr: CO_ANCHOR_DRAW }); });
      valueTargets(k + "anchor", "double", n + "Anchor (0 side · 1 auto · 2-9 corners and edges)", anchorTargets, choice(9));
      if (lines.length) {
        value(k + "color", "color", n + "Line colour", lines, STROKE);
        value(k + "width", "double", n + "Line width", lines, WIDTH);
      }
      if (c.dot) valueTargets(k + "dot", "double", n + "Dot size", [{ m: c.dot, attr: RADIUS_X }, { m: c.dot, attr: RADIUS_Y }]);
      if (c.label) {
        direct(c.label, FILL, n + "Text colour");
        direct(c.label, "fontSize", n + "Text size");
      }
      if (c.box) {
        direct(c.box, FILL, n + "Box colour");
        direct(c.box, "hidden", n + "Hide box");
      }
      notes = "";
    });
    group = "data";
    var data = model.data || {};
    if (data.year && data.year.length) value("data:year", "double", "Data" + SEP + "Year", data.year, YEAR);
    (data.sets || []).forEach(function (s, i) {
      var n = "Data " + (i + 1) + SEP, k = "data:" + s.id + ":";
      notes = s.name || "";
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
      notes = "";
    });
    group = "main";
    (model.imagery || []).forEach(function (g) {
      direct(g.id, "opacity", g.name + SEP + "Opacity");
      direct(g.id, "hidden", g.name + SEP + "Hide");
    });
    group = "overlay";
    var fu = model.furniture || {};
    if (fu.scaleBar) {
      var sb = fu.scaleBar, sn = "Scale bar" + SEP;
      direct(sb.id, "hidden", sn + "Hide");
      direct(sb.id, FILL, sn + "Colour");
      value("furn:scale:units", "double", sn + "Units (0 metric · 1 imperial · 2 both)", [sb], SB("units"), choice(2));
      value("furn:scale:style", "double", sn + "Style (0 line · 1 segmented)", [sb], SB("style"), choice(1));
      value("furn:scale:corner", "double", sn + "Corner" + CORNERS, [sb], SB("corner"), choice(3));
      value("furn:scale:margin", "double", sn + "Margin", [sb], SB("margin"));
      value("furn:scale:width", "double", sn + "Max width", [sb], SB("maxWidth"));
      if (fu.fade) value("furn:scale:hide", "double", sn + "Hide below zoom", [fu.fade], "array.1");
    }
    if (fu.northArrow) {
      var na = fu.northArrow, nn = "North arrow" + SEP;
      direct(na.id, "hidden", nn + "Hide");
      direct(na.id, FILL, nn + "Colour");
      value("furn:north:style", "double", nn + "Style (0 arrow · 1 compass · 2 N with tick)", [na], NA("style"), choice(2));
      value("furn:north:corner", "double", nn + "Corner" + CORNERS, [na], NA("corner"), choice(3));
      value("furn:north:margin", "double", nn + "Margin", [na], NA("margin"));
      value("furn:north:size", "double", nn + "Size", [na], NA("size"));
    }
    // Day & night: its time, colour and look as values on the night layers and opacity helpers (script
    // inputs, never renamed there); hiding the group and the time label's own look go straight on their attributes.
    group = "time";
    var dn = model.dayNight;
    if (dn) {
      var nl = (dn.layers || []).filter(Boolean), nh = (dn.helpers || []).filter(Boolean), tl = dn.label, dsn = "Day & night" + SEP;
      var timeTargets = function (attr, labelAttr) {
        var t = nl.map(function (m) { return { m: m, attr: attr }; });
        if (tl) t.push({ m: tl, attr: labelAttr });
        return t;
      };
      valueTargets("dn:day", "double", dsn + "Day of year (1–365)", timeTargets(N_DAY, TL("dayOfYear")), { hardMin: 1, hardMax: 365 });
      valueTargets("dn:time", "double", dsn + "UTC time (0–24)", timeTargets(N_TIME, TL("utcTime")), { hardMin: 0, hardMax: 24 });
      value("dn:colour", "color", dsn + "Night colour", nl, FILL);
      value("dn:night", "double", dsn + "Night opacity", nh, NH_NIGHT, { hardMin: 0, hardMax: 100 });
      // Night lights %: the Night lights group's opacity, then the helpers' lights; a new input starts at 100.
      if (dn.nightLights) {
        var lightTargets = [{ m: dn.nightLights, attr: "opacity" }].concat(nh.map(function (m) { return { m: m, attr: NH_LIGHTS }; }));
        valueTargets("dn:lights", "double", dsn + "Night lights %", lightTargets, { hardMin: 0, hardMax: 100 }, 100);
      }
      // The Night blur helper's twilight is the same input number, so one value drives all of them.
      value("dn:twilight", "double", dsn + "Twilight (0 hard · 1 soft)", dn.blurHelper ? nh.concat([dn.blurHelper]) : nh, NH_TWILIGHT, choice(1));
      direct(dn.id, "hidden", dsn + "Hide");
      if (tl) {
        var tn = "Time label" + SEP;
        direct(tl.id, "hidden", tn + "Hide");
        direct(tl.id, FILL, tn + "Colour");
        value("dn:labelSize", "double", tn + "Size", [tl], TL("size"));
        value("dn:labelCorner", "double", tn + "Corner" + CORNERS, [tl], TL("corner"), choice(3));
      }
    }
    return out;
  }

  function ids(model) {
    var out = {};
    function add(m) { var id = m && typeof m === "object" ? m.id : m; if (id) out[id] = true; }
    add(model.valuesId); add(model.camera); add(model.ocean);
    (model.layers || []).concat(model.pins || [], model.labels || [], model.imagery || []).forEach(add);
    (model.routes || []).forEach(function (r) { (r.legs || []).forEach(add); (r.draws || []).forEach(add); });
    (model.stops || []).forEach(add);
    (model.highlights || []).forEach(function (h) { add(h.id); add(h.shape); add(h.osc); add(h.blur); });
    (model.newRoutes || []).forEach(function (r) { (r.legs || []).forEach(function (l) { add(l); add(l.start); add(l.end); }); (r.draws || []).forEach(add); });
    (model.travellers || []).forEach(function (t) { add(t.marker); add(t.scale); (t.dups || []).forEach(add); });
    (model.callouts || []).forEach(function (c) { add(c.label); add(c.box); add(c.dot); add(c.bend); add(c.edge); (c.lines || []).forEach(add); (c.draws || []).forEach(add); });
    var dn = model.dayNight;
    if (dn) { add(dn.id); (dn.layers || []).concat(dn.helpers || [], dn.blurs || [], [dn.blurHelper, dn.mask, dn.label, dn.nightLights]).forEach(add); }
    var fu = model.furniture || {};
    add(fu.scaleBar); add(fu.northArrow); add(fu.fade);
    var data = model.data || {};
    (data.year || []).forEach(add);
    (data.sets || []).forEach(function (s) { add(s.regions); add(s.bubbles); add(s.labels); });
    return out;
  }

  return { plan: plan, ids: ids, recordFor: recordFor, BASE: BASE, GROUPS: GROUPS, STATE_ATTRS: STATE_ATTRS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = GeoControls;

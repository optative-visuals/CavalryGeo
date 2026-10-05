// Builds and updates each map's "<Map> Controls" component (GeoControls decides what goes in
// it). The component holds one "<Map> control values" utility: its inputs drive the settings
// that map-layer scripts read by name (renaming those inputs on the layer would break them)
// and the settings shared by several layers. Everything else is promoted straight from its
// layer and renamed there.
var GeoControlPanel = (function () {
  var A = GeoAttrs, G = GeoControls;
  var PROMOTED = "promotedAttributes";
  var CONTROLS_KEY = "geoControls", VALUES_KEY = "geoValues", SLOTS_KEY = "geoSlots", LINKS_KEY = "geoLinks", PROMOTED_KEY = "geoPromoted";
  var INPUT_TYPES = { double: "double", bool: "bool", color: A.COLOR_INPUT_TYPE };
  var LINE_SOURCES = ["states", "coastlines", "rivers", "roads", "railways"];
  var DATA_KINDS = { regions: "regions", bubbles: "bubbles", labels: "valueLabels" };

  function has(fn) { return typeof api[fn] === "function"; }
  function attempt(fn) { try { fn(); return true; } catch (e) { return false; } }
  function userData(id, key) {
    try { return api.hasUserDataKey(id, key) ? api.getUserDataKey(id, key) : null; } catch (e) { return null; }
  }
  function setUserData(id, key, value) {
    if (JSON.stringify(userData(id, key)) !== JSON.stringify(value)) api.setUserData(id, key, value);
  }
  function layerType(id) { try { return String(api.getLayerType(id)); } catch (e) { return ""; } }
  function stripPrefix(name, prefix) { name = String(name); return name.indexOf(prefix) === 0 ? name.slice(prefix.length) : name; }
  function one(attr, value) { var o = {}; o[attr] = value; return o; }

  // Cavalry strips plain spaces from the name of a script's dynamic input (array.N) but keeps
  // non-breaking ones (a script reading such an input still works). Built-in attributes keep
  // plain spaces.
  var NBSP = "\u00a0";
  function inputLabel(path, label) { return /^array\.\d+$/.test(String(path)) ? String(label).split(" ").join(NBSP) : label; }

  function requireApis() {
    ["setUserData", "getUserDataKey", "hasUserDataKey", "removeArrayIndex", "getLayerType"].forEach(function (fn) {
      if (!has(fn)) throw new Error("This version of Cavalry can't update a map's Controls.");
    });
  }

  // Cavalry may select layers it creates, and bringToFront acts on the selection: put the
  // user's selection back however this returns.
  function keepSelection(fn) {
    var previous = null;
    try { previous = api.getSelection(); } catch (e) { /* nothing to restore */ }
    try { return fn(); } finally {
      if (previous && has("select")) { try { api.select(previous); } catch (e) { /* cosmetic */ } }
    }
  }

  // A child of `parentId` of this type, tagged with user data key = value; else an untagged one with that name (never one tagged for something else).
  function findChild(parentId, type, key, value, name) {
    var kids = api.getChildren(parentId), byName = null;
    for (var i = 0; i < kids.length; i++) {
      if (layerType(kids[i]) !== type) continue;
      if (userData(kids[i], key) === value) return kids[i];
      if (!byName && api.getNiceName(kids[i]) === name && userData(kids[i], key) === null) byName = kids[i];
    }
    return byName;
  }

  // What holds the map group: its parent, or the composition itself at the top level.
  function containerOf(map) {
    var parent = "";
    try { parent = api.getParent(map.groupId) || ""; } catch (e) { /* treat as top level */ }
    return { parent: String(parent), id: parent ? String(parent) : api.getActiveComp() };
  }

  // Any component in the composition tagged as this map's Controls (the user may have moved it).
  function findAnywhere(map) {
    var layers = [];
    try { layers = api.getCompLayers(false) || []; } catch (e) { /* not available */ }
    for (var i = 0; i < layers.length; i++) {
      if (layerType(layers[i]) === "component" && userData(layers[i], CONTROLS_KEY) === map.cameraId) return layers[i];
    }
    return null;
  }

  // Puts a new (or just moved out) component in the map group's container, directly above the
  // group. After that the plugin never moves it again. Without the optional calls it stays
  // wherever it landed.
  function place(comp, map) {
    var where = containerOf(map);
    attempt(function () {
      if (where.parent) api.parent(comp, where.parent);
      else if (has("unParent") && api.getParent(comp)) api.unParent(comp);
    });
    if (!has("bringForward") || !has("moveBackward") || !has("select")) return;
    attempt(function () {
      var guard = api.getChildren(where.id).length + 1;
      api.select([comp]);
      for (var i = 0; i < guard; i++) {
        var kids = api.getChildren(where.id), at = kids.indexOf(comp), g = kids.indexOf(map.groupId);
        if (at < 0 || g < 0 || at === g - 1) return;
        if (at < g - 1) api.moveBackward(); else api.bringForward();
      }
    });
  }

  // The component (just above the map group) and the values utility inside it.
  function findOrCreate(map) {
    return keepSelection(function () {
      var compName = map.name + " Controls", valuesName = map.name + " control values";
      var comp = findChild(containerOf(map).id, "component", CONTROLS_KEY, map.cameraId, compName), move = false;
      if (!comp) { comp = findChild(map.groupId, "component", CONTROLS_KEY, map.cameraId, compName); move = !!comp; } // an earlier build kept it inside the group
      if (!comp) comp = findAnywhere(map);
      if (!comp) { comp = api.create("component", compName); move = true; }
      setUserData(comp, CONTROLS_KEY, map.cameraId);
      if (move) place(comp, map);
      var values = findChild(comp, A.CAMERA_LAYER_TYPE, VALUES_KEY, map.cameraId, valuesName);
      if (!values) {
        values = api.create(A.CAMERA_LAYER_TYPE, valuesName);
        api.set(values, one(A.CAMERA_EXPR_ATTR, "0;")); // reads none of its inputs, so renaming them is safe
        api.parent(values, comp);
      }
      setUserData(values, VALUES_KEY, map.cameraId);
      return { id: comp, valuesId: values };
    });
  }

  // Sorts layers (ids or { id }) in Scene Window order under the map group: top first, a
  // group's children right after it; layers outside the group go last. The groups in `skip`
  // (imagery, which holds thousands of tiles) are ranked but not looked inside.
  function sceneOrder(groupId, skip) {
    var order = {}, n = 0;
    function visit(id) { api.getChildren(id).forEach(function (k) { order[k] = n++; if (!skip[k]) visit(k); }); }
    function at(x) { var id = typeof x === "string" ? x : x.id; return order[id] === undefined ? 1e9 : order[id]; }
    visit(groupId);
    return function (a, b) { return at(a) - at(b); };
  }

  function linkState(id, attrs) {
    var links = userData(id, LINKS_KEY) || {}, state = {};
    attrs.forEach(function (attr) {
      var from = "", keyed = false;
      try { from = String(api.getInConnection(id, attr) || ""); } catch (e) { /* not connectable */ }
      try { keyed = (api.getKeyframeTimes(id, attr) || []).length > 0; } catch (e) { /* no keys */ }
      state[attr] = { from: from, keyed: keyed, record: links[attr] || null };
    });
    return state;
  }

  function paint(fn, id, styleKey, key) {
    if (has(fn)) { try { return !!api[fn](id); } catch (e) { /* fall back to the style table */ } }
    return !!(GeoScene.STYLE[styleKey] || {})[key];
  }

  function legNumber(name) { var m = /^Leg (\d+)/.exec(String(name)); return m ? Number(m[1]) : 0; }

  // Legs in number order; a leg whose name doesn't start "Leg N" goes after them (in Scene
  // Window order) and is numbered by its place, never at or below the number before it.
  function sortLegs(legs) {
    legs.sort(function (a, b) { return (a.number || 1e9) - (b.number || 1e9) || a.place - b.place; });
    var last = 0;
    legs.forEach(function (leg, i) {
      if (!leg.number) leg.number = Math.max(i + 1, last + 1);
      last = leg.number;
      delete leg.place;
    });
  }

  function readUseMiddle(id) {
    var attr = A.MAP_ARRAY_ATTR + "." + GeoExpression.inputIndex(GeoExpression.REGION_INPUTS, "useMiddle");
    try { return !!Number(api.get(id, attr)); } catch (e) { return false; }
  }

  function readModel(map, valuesId) {
    var S = G.STATE_ATTRS, imagery = GeoScene.findImagery(map), skip = {}, routes = {}, sets = {};
    imagery.forEach(function (im) { skip[im.groupId] = true; });
    var order = sceneOrder(map.groupId, skip);
    var model = { valuesId: valuesId, camera: map.cameraId, ocean: GeoScene.findOcean(map), layers: [], pins: [], labels: [], routes: [], data: { year: [], sets: [] }, imagery: [] };
    GeoScene.findMapLayers(map).sort(order).forEach(function (l, i) {
      var c = l.meta.category;
      if (G.BASE.indexOf(c) >= 0 || c === "extract") {
        var styleKey = c === "extract" ? (LINE_SOURCES.indexOf(l.meta.source) >= 0 ? "extractLine" : "extractFill") : c;
        model.layers.push({ id: l.id, category: c, name: l.name, fill: paint("hasFill", l.id, styleKey, "fill"), stroke: paint("hasStroke", l.id, styleKey, "stroke"),
          point: c === "cities" || (c === "extract" && l.meta.source === "cities"), state: linkState(l.id, S.layer) });
      } else if (c === "pin") {
        model.pins.push({ id: l.id, state: linkState(l.id, S.pin) });
      } else if (c === "route") {
        var g = api.getParent(l.id);
        if (!routes[g]) { routes[g] = { id: g, name: stripPrefix(api.getNiceName(g), "Route: "), legs: [] }; model.routes.push(routes[g]); }
        routes[g].legs.push({ id: l.id, number: legNumber(l.name), place: i, state: linkState(l.id, S.leg) });
      } else if (c === "data" && DATA_KINDS[l.meta.display]) {
        var d = l.meta.display, p = api.getParent(l.id);
        if (!sets[p]) { sets[p] = { id: p, name: stripPrefix(api.getNiceName(p), "Data: "), regions: null, bubbles: null, labels: null }; model.data.sets.push(sets[p]); }
        var member = { id: l.id, state: linkState(l.id, S[DATA_KINDS[d]]) };
        if (d === "regions") member.useMiddle = readUseMiddle(l.id);
        sets[p][d] = member;
        model.data.year.push(member);
      }
    });
    model.routes.forEach(function (r) { sortLegs(r.legs); });
    model.labels = GeoScene.findLabels(map).sort(order).map(function (id) { return { id: id, state: linkState(id, S.label) }; });
    model.imagery = imagery.map(function (im) { return { id: im.groupId, name: String(api.getNiceName(im.groupId)) }; }).sort(order);
    return model;
  }

  function hex(v) {
    if (v && typeof v === "object" && v.r !== undefined) {
      return "#" + [v.r, v.g, v.b].map(function (n) { var s = Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
    }
    return v;
  }

  function read(t) { try { return api.get(t.layer, t.attr); } catch (e) { return undefined; } }

  // Whether a target already shows the value a new input starts with. Nothing to compare
  // (either side unreadable) counts as the same.
  function same(type, a, b) {
    if (a === undefined || a === null || b === undefined || b === null) return true;
    if (type === "color") {
      var norm = function (v) { v = String(hex(v)).toLowerCase(); return v.charAt(0) === "#" && v.length === 9 ? v.slice(0, 7) : v; };
      return norm(a) === norm(b);
    }
    if (type === "bool") return !!a === !!b;
    return Math.abs(Number(a) - Number(b)) < 1e-6;
  }

  // The values input for a row: found again by its key, or added (starting with the first
  // target's current value). Returns its path, and whether it was added just now (with the
  // value it started from).
  function ensureSlot(valuesId, slots, row) {
    var path = slots[row.key];
    var there = false;
    if (path) { try { there = !!api.hasAttribute(valuesId, path); } catch (e) { there = false; } }
    if (there) return { path: path, created: false };
    path = api.addDynamic(valuesId, A.CAMERA_ARRAY_ATTR, INPUT_TYPES[row.type]);
    if (!path) throw new Error("Couldn't add a control value.");
    slots[row.key] = path;
    var seed = read(row.linked[0] || row.link[0]);
    attempt(function () {
      if (seed === undefined || seed === null) return;
      api.set(valuesId, one(path, row.type === "color" ? A.COLOR_VALUE(hex(seed)) : row.type === "bool" ? !!seed : Number(seed)));
    });
    return { path: path, created: true, seed: seed };
  }

  function record(layer, attr, value) {
    var links = userData(layer, LINKS_KEY) || {};
    if (links[attr] === value) return;
    links[attr] = value;
    attempt(function () { api.setUserData(layer, LINKS_KEY, links); });
  }

  // The list's length is the highest filled slot + 1 (other inputs don't count).
  function readPromotions(comp) {
    var count = 0, list = [], slot = /^promotedAttributes\.(\d+)\.attribute$/;
    try {
      api.getInConnectedAttributes(comp).forEach(function (a) {
        var m = slot.exec(String(a));
        if (m && Number(m[1]) + 1 > count) count = Number(m[1]) + 1;
      });
    } catch (e) { count = 0; }
    for (var i = 0; i < count; i++) {
      var src = "", name = "", notes = "";
      try { src = String(api.getInConnection(comp, PROMOTED + "." + i + ".attribute") || ""); } catch (e) { /* empty slot */ }
      try { name = String(api.get(comp, PROMOTED + "." + i + ".name") || ""); } catch (e) { /* no name */ }
      try { notes = String(api.get(comp, PROMOTED + "." + i + ".notes") || ""); } catch (e) { /* no notes */ }
      var dot = src.indexOf(".");
      list.push({ layer: dot > 0 ? src.slice(0, dot) : src, attr: dot > 0 ? src.slice(dot + 1) : "", name: name, notes: notes });
    }
    return list;
  }
  function keyOf(p) { return p.layer + "." + p.attr; }

  // The list should be the plan's rows, then the user's own promotions. A promotion is the
  // plugin's when an earlier sync promoted it (geoPromoted on the component), this sync wants
  // it, or it comes from the values layer; everything else is the user's, whatever its layer.
  // Cavalry can't reorder promotions, so the list is kept up to the first difference and
  // everything after it is removed (highest first) and added again in order.
  function rebuild(comp, valuesId, wanted) {
    var current = readPromotions(comp), ours = {}, stored = userData(comp, PROMOTED_KEY);
    (Array.isArray(stored) ? stored : []).concat(wanted.map(keyOf)).forEach(function (k) { ours[k] = true; });
    var theirs = current.filter(function (p) { return p.layer && p.layer !== valuesId && !ours[keyOf(p)]; });
    var target = wanted.concat(theirs), from = 0;
    while (from < current.length && from < target.length && keyOf(current[from]) === keyOf(target[from])) from++;
    if (from < current.length || from < target.length) {
      for (var i = current.length - 1; i >= from; i--) {
        var path = PROMOTED + "." + i;
        attempt(function () { api.removeArrayIndex(comp, path); });
      }
      // Adding to a list that wasn't cleared would only make it longer on every sync.
      if (readPromotions(comp).length > from) throw new Error("Couldn't clear the old controls list.");
      var n = from;
      target.slice(from).forEach(function (p, k) {
        if (!attempt(function () { api.connect(p.layer, p.attr, comp, PROMOTED); })) return;
        if (from + k >= wanted.length) {
          var o = {};
          o[PROMOTED + "." + n + ".name"] = p.name;
          o[PROMOTED + "." + n + ".notes"] = p.notes;
          attempt(function () { api.set(comp, o); });
        }
        n++;
      });
    }
    attempt(function () { setUserData(comp, PROMOTED_KEY, wanted.map(keyOf)); });
  }

  function sync(map) {
    requireApis();
    var made = findOrCreate(map), V = made.valuesId;
    var model = readModel(map, V), p = G.plan(model);
    var slots = userData(V, SLOTS_KEY) || {}, wanted = [];
    // A failing row only drops its own promotion; the inputs added so far are always recorded.
    try {
      p.rows.forEach(function (row) {
        if (row.kind === "direct") {
          attempt(function () { api.renameAttribute(row.layer, row.attr, inputLabel(row.attr, row.label)); });
          if (row.overrides && has("setAttributeDefinitionOverride")) {
            Object.keys(row.overrides).forEach(function (k) {
              attempt(function () { api.setAttributeDefinitionOverride(row.layer, row.attr, k, row.overrides[k]); });
            });
          }
          wanted.push({ layer: row.layer, attr: row.attr });
          return;
        }
        attempt(function () {
          var slot = ensureSlot(V, slots, row), path = slot.path, rec = G.recordFor(V, row.key);
          attempt(function () { api.renameAttribute(V, path, inputLabel(path, row.label)); });
          row.link.forEach(function (t) {
            // A new input links only the targets already showing its value; any other target
            // was set apart on purpose, so it is marked as if the user had pressed Disconnect.
            if (slot.created && !same(row.type, slot.seed, read(t))) { record(t.layer, t.attr, rec); return; }
            if (attempt(function () { api.connect(V, path, t.layer, t.attr, true); })) record(t.layer, t.attr, rec);
          });
          wanted.push({ layer: V, attr: path });
        });
      });
    } finally {
      attempt(function () { setUserData(V, SLOTS_KEY, slots); });
    }
    p.trim.forEach(function (id) { attempt(function () { if (!api.get(id, "stroke.trim")) api.set(id, { "stroke.trim": true }); }); });
    rebuild(made.id, V, wanted);
    return { componentId: made.id, valuesId: V, controls: wanted.length };
  }

  return { sync: sync };
})();

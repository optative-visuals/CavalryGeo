const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { buildPanel } = require("../tools/buildlib.js");

// Objects created inside the vm sandbox (e.g. via JSON.parse in that realm) fail
// assert.deepEqual against test-realm literals because their prototypes differ
// even when their contents match. Round-tripping through JSON strips the realm.
function plain(x) { return JSON.parse(JSON.stringify(x)); }

test("the panel bundle compiles and embeds the runtime source", () => {
  const src = buildPanel();
  assert.doesNotThrow(() => new vm.Script(src, { filename: "CavalryGeo.js" }));
  assert.ok(src.includes("var GEO_RUNTIME_SRC = "));
  assert.ok(src.includes("var GEO_CURVE_SRC = "));
  assert.ok(src.includes("var GeoScene"));
  assert.ok(src.includes("ui.show()"));
});

// A minimal in-memory Cavalry stub: enough attribute storage, parenting and layer
// bookkeeping for the panel's own code (GeoScene/GeoNet/panel.js) to run against,
// without needing the real application.
function makeFakeApi() {
  var nextId = 1;
  var store = {};
  var parents = {};
  var niceNames = {};
  var moveToBackCalls = [];
  var childOrder = {};   // parentId -> ids, top of the Scene Window first (like Cavalry)
  var selection = [];
  var connections = [];
  var files = Object.create(null);
  var COMP_ID = "comp#1";
  var comp = { startFrame: 0, endFrame: 9, playbackStart: 0, playbackEnd: 9 };   // like Cavalry: frameRange follows start / end, the play range does not
  var outFrames = {};  // layerId -> out frame (a layer made in a comp ending at 9 has out frame 10)
  var frame = 0, keyframes = {}, assets = {}, nextAsset = 1;
  var timers = [];
  var promoted = {};   // componentId -> [{ attribute: "layer.attr", name, notes }]
  var userData = {};   // layerId -> { key: value }
  var attrNames = {};  // layerId -> { attr: custom name }
  var overrides = {};  // layerId -> { attr: { hardMin, ... } }
  var paints = {};     // layerId -> { fill, stroke }
  var PROMOTED_SLOT = /^promotedAttributes\.(\d+)\.(name|notes)$/;
  // Compositions: the map comp (COMP_ID, state in `comp`) plus any made with createComp. Each
  // layer remembers the comp it was created or added in; layers go into the active comp.
  var activeComp = COMP_ID, comps = {}, layerComp = {}, compRefs = {}, deletingComp = false;
  comps[COMP_ID] = comp;
  var layerTypes = [{ name: "Group", type: "group" }, { name: "Cavalry Geo Reproject", type: "cavalryGeo::reproject" }];

  function ensure(id) { if (!store[id]) store[id] = {}; return store[id]; }
  // Like Cavalry: a layer with no parent sits at the composition's top level.
  function siblingsOf(id) { var key = parents[id] || layerComp[id] || COMP_ID; return childOrder[key] || (childOrder[key] = []); }
  function leave(id) { var sib = siblingsOf(id), i = sib.indexOf(id); if (i >= 0) sib.splice(i, 1); }
  function addToComp(id) { outFrames[id] = comps[activeComp].endFrame + 1; delete parents[id]; layerComp[id] = activeComp; (childOrder[activeComp] = childOrder[activeComp] || []).unshift(id); return id; }
  // One step up (toward the top of the Scene Window) or down within the layer's container.
  function step(id, by) {
    var sib = siblingsOf(id), i = sib.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= sib.length) return;
    sib[i] = sib[j]; sib[j] = id;
  }

  return {
    // Like Cavalry, a new script layer already has one empty dynamic slot (index 0).
    create: function (type, name) {
      var id = type + "#" + (nextId++); niceNames[id] = name || type;
      if (type === "javaScript") ensure(id)["array.0"] = 0;
      if (type === "javaScriptShape") ensure(id)["generator.array.0"] = 0;
      if (type === "group") ensure(id).hidden = false;
      return addToComp(id);
    },
    // Like Cavalry: a primitive shape is a basicShape layer.
    primitive: function (kind, name) { return this.create("basicShape", name); },
    // Like Cavalry: a Basic Line's generator is swapped with setGenerator; a Bézier line has
    // start / end positions and offsets (offsets are relative to their end).
    setGenerator: function (id, attr, type) {
      if (arguments.length !== 3) throw new Error("Argument count does not match function definition. Expected 3 but got " + arguments.length);
      var o = ensure(id);
      o[attr] = type;
      if (type === "bezierLine") {
        o["generator.startPosition"] = { x: -200, y: 200 }; o["generator.endPosition"] = { x: 200, y: -200 };
        o["generator.startOffset"] = { x: 100, y: 0 }; o["generator.endOffset"] = { x: -100, y: 0 };
      }
      // Like Cavalry: a path distribution duplicator starts with 3 copies, no travel, rotations on and no path.
      if (type === "pathDistribution") { o["generator.count"] = 3; o["generator.travel"] = 0; o["generator.calculateRotations"] = true; o["generator.inputShape"] = null; }
    },
    createEditable: function (path, name) { var id = "editable#" + (nextId++); niceNames[id] = name; return addToComp(id); },
    parent: function (id, parentId) {
      if (layerComp[id] && layerComp[parentId] && layerComp[id] !== layerComp[parentId]) throw new Error("Can't parent a layer into another composition");
      leave(id);
      parents[id] = parentId;
      (childOrder[parentId] = childOrder[parentId] || []).unshift(id); // newly parented layers land on top
    },
    // Like Cavalry: moves the layer to the top level, directly below its former parent group.
    unParent: function (id) {
      var former = parents[id];
      leave(id);
      delete parents[id];
      var key = layerComp[id] || COMP_ID, top = childOrder[key] = childOrder[key] || [], at = former ? top.indexOf(former) : -1;
      if (at >= 0) top.splice(at + 1, 0, id); else top.unshift(id);
    },
    getParent: function (id) { return parents[id] || ""; },
    getInFrame: function () { return 0; },
    getOutFrame: function (id) { return outFrames[id]; },
    setOutFrame: function (id, f) { outFrames[id] = f; },
    // A composition's top-level layers are listed only while it is the active comp.
    getChildren: function (parentId) { return comps[parentId] && parentId !== activeComp ? [] : (childOrder[parentId] || []).slice(); },
    getNiceName: function (id) { return niceNames[id] || id; },
    // Frames and keyframes: get() returns the value of the latest key at or before the current frame.
    setFrame: function (f) { frame = f; },
    getFrame: function () { return frame; },
    keyframe: function (id, f, obj) {
      Object.keys(obj).forEach(function (k) { keyframes[id] = keyframes[id] || {}; keyframes[id][k] = keyframes[id][k] || {}; keyframes[id][k][f] = obj[k]; });
      return "keyframe#" + (nextId++);
    },
    getKeyframeTimes: function (id, attr) {
      var k = keyframes[id] && keyframes[id][attr];
      return k ? Object.keys(k).map(Number).sort(function (a, b) { return a - b; }) : [];
    },
    deleteKeyframe: function (id, attr, f) { if (keyframes[id] && keyframes[id][attr]) delete keyframes[id][attr][f]; },
    // Assets and footage.
    loadAsset: function (path) { var id = "asset#" + (nextAsset++); assets[id] = path; return id; },
    getAssetWindowLayers: function () { return Object.keys(assets); },
    getAssetFilePath: function (id) { return assets[id]; },
    // Like Cavalry, adding an asset to the comp selects the new footage layer.
    addAssetToComp: function (assetId) { var id = "footageShape#" + (nextId++); niceNames[id] = String(assets[assetId]).split("/").pop(); selection = [id]; return addToComp(id); },
    layerExists: function (id) { return Object.prototype.hasOwnProperty.call(niceNames, id); },
    deleteLayer: function (id) {
      // Like Cavalry: deleting a composition deletes it and its layers (never the active comp);
      // a layer can only be deleted while its own comp is active.
      if (comps[id]) {
        if (id === activeComp) throw new Error("Can't delete the active composition");
        var wasDeleting = deletingComp;
        deletingComp = true;
        try { (childOrder[id] || []).slice().forEach(function (c) { this.deleteLayer(c); }, this); } finally { deletingComp = wasDeleting; }
        delete comps[id]; delete niceNames[id]; delete childOrder[id]; delete store[id];
        return;
      }
      if (!deletingComp && layerComp[id] && layerComp[id] !== activeComp) throw new Error("Can't delete a layer of an inactive composition: " + id);
      (childOrder[id] || []).slice().forEach(function (c) { this.deleteLayer(c); }, this);
      leave(id);
      // Like Cavalry: a deleted layer's promotions and connections go with it.
      Object.keys(promoted).forEach(function (c) { promoted[c] = promoted[c].filter(function (p) { return p.attribute.indexOf(id + ".") !== 0; }); });
      delete promoted[id]; delete userData[id];
      for (var ci = connections.length - 1; ci >= 0; ci--) { if (connections[ci][0] === id || connections[ci][2] === id) connections.splice(ci, 1); }
      delete niceNames[id]; delete parents[id]; delete childOrder[id]; delete store[id]; delete layerComp[id];
    },
    addDynamic: function (id, arr) {
      var o = ensure(id), n = 0;
      while (o[arr + "." + n] !== undefined) n++;
      o[arr + "." + n] = 0;
      return arr + "." + n; // like Cavalry: the new attribute's path
    },
    rename: function (id, name) { niceNames[id] = name; },
    renameAttribute: function (id, attr, name) { (attrNames[id] = attrNames[id] || {})[attr] = name; },
    getCustomAttributeName: function (id, attr) { return (attrNames[id] || {})[attr] || ""; },
    hasAttribute: function (id, attr) { return ensure(id)[attr] !== undefined; },
    set: function (id, obj) {
      if (comps[id]) { Object.keys(obj).forEach(function (k) { if (k in comps[id]) comps[id][k] = obj[k]; }); }
      var o = ensure(id);
      Object.keys(obj).forEach(function (k) {
        // Like Cavalry: a JavaScript Utility has no transform attributes.
        if (/^javaScript#/.test(id) && /^(position|rotation|scale)\b/.test(k)) throw new Error("Attribute not found: " + k);
        var m = PROMOTED_SLOT.exec(k);
        if (m && promoted[id] && promoted[id][Number(m[1])]) { promoted[id][Number(m[1])][m[2]] = obj[k]; return; }
        o[k] = obj[k];
      });
    },
    get: function (id, attr) {
      if (id === COMP_ID && attr === "resolution") return { x: 1920, y: 1080 };
      if (comps[id] && attr === "frameRange") return { x: comps[id].startFrame, y: comps[id].endFrame };
      if (comps[id] && attr in comps[id]) return comps[id][attr];
      var pm = PROMOTED_SLOT.exec(attr);
      if (pm && promoted[id] && promoted[id][Number(pm[1])]) return promoted[id][Number(pm[1])][pm[2]];
      var k = keyframes[id] && keyframes[id][attr];
      if (k && Object.keys(k).length) {
        var fs = Object.keys(k).map(Number).sort(function (a, b) { return a - b; }), v = k[fs[0]];
        fs.forEach(function (f) { if (f <= frame) v = k[f]; });
        return v;
      }
      return ensure(id)[attr];
    },
    setFill: function (id, on) { (paints[id] = paints[id] || {}).fill = !!on; },
    setStroke: function (id, on) { (paints[id] = paints[id] || {}).stroke = !!on; },
    hasFill: function (id) { return !!(paints[id] && paints[id].fill); },
    hasStroke: function (id) { return !!(paints[id] && paints[id].stroke); },
    // Like Cavalry: connecting into a Component's "promotedAttributes" list appends a promotion.
    connect: function (a, b, c, d) {
      if (d === "promotedAttributes") { (promoted[c] = promoted[c] || []).push({ attribute: a + "." + b, name: "", notes: "" }); return; }
      // Like Cavalry: a Bounding Box's shapes list appends each connection (inputShapes.0, inputShapes.1, ...).
      if (d === "inputShapes") d = "inputShapes." + connections.filter(function (k) { return k[2] === c && /^inputShapes\.\d+$/.test(k[3]); }).length;
      // Like Cavalry: a layer's filters list appends each connection (filters.0, filters.1, ...); "filters" itself reads back as nothing.
      if (d === "filters") d = "filters." + connections.filter(function (k) { return k[2] === c && /^filters\.\d+$/.test(k[3]); }).length;
      connections.push([a, b, c, d]);
      // Like Cavalry: a layer that feeds a duplicator's shapes list is hidden.
      if (d === "shapes" && b === "id") ensure(a).hidden = true;
    },
    disconnect: function (a, b, c, d) {
      for (var i = connections.length - 1; i >= 0; i--) { var k = connections[i]; if (k[0] === a && k[1] === b && k[2] === c && k[3] === d) connections.splice(i, 1); }
    },
    getLayerType: function (id) { return String(id).split("#")[0]; },
    getInConnection: function (id, attr) {
      var m = /^promotedAttributes\.(\d+)\.attribute$/.exec(attr);
      if (m) {
        var p = (promoted[id] || [])[Number(m[1])];
        if (!p) throw new Error("Couldn't find attribute with path: " + id + "." + attr);
        return p.attribute;
      }
      for (var i = connections.length - 1; i >= 0; i--) { var k = connections[i]; if (k[2] === id && k[3] === attr) return k[0] + "." + k[1]; }
      return "";
    },
    getInConnectedAttributes: function (id) {
      var out = (promoted[id] || []).map(function (p, i) { return "promotedAttributes." + i + ".attribute"; });
      connections.forEach(function (k) { if (k[2] === id && out.indexOf(k[3]) < 0) out.push(k[3]); });
      return out;
    },
    getOutConnections: function (id, attr) {
      return connections.filter(function (k) { return k[0] === id && k[1] === attr; }).map(function (k) { return k[2] + "." + k[3]; });
    },
    // Like Cavalry: two arguments, the list item's path; later items shift down.
    removeArrayIndex: function (id, path) {
      if (arguments.length !== 2) throw new Error("Argument count does not match function definition. Expected 2 but got " + arguments.length);
      var m = /^promotedAttributes\.(\d+)$/.exec(path);
      if (m && promoted[id]) promoted[id].splice(Number(m[1]), 1);
    },
    setUserData: function (id, key, value) { (userData[id] = userData[id] || {})[key] = JSON.parse(JSON.stringify(value)); },
    getUserDataKey: function (id, key) { var v = (userData[id] || {})[key]; return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    hasUserDataKey: function (id, key) { return !!userData[id] && Object.prototype.hasOwnProperty.call(userData[id], key); },
    setAttributeDefinitionOverride: function (id, attr, key, value) { overrides[id] = overrides[id] || {}; (overrides[id][attr] = overrides[id][attr] || {})[key] = value; },
    // Like Cavalry: no arguments, acts on the selection; moves to the top of its group.
    bringToFront: function () {
      if (arguments.length) throw new Error("Argument count does not match function definition. Expected 0 but got " + arguments.length);
      selection.forEach(function (id) {
        var sib = siblingsOf(id), i = sib.indexOf(id);
        if (i >= 0) { sib.splice(i, 1); sib.unshift(id); }
      });
    },
    // Like Cavalry: no arguments, act on the selection, one step within the layer's current parent.
    bringForward: function () {
      if (arguments.length) throw new Error("Argument count does not match function definition. Expected 0 but got " + arguments.length);
      selection.forEach(function (id) { step(id, -1); });
    },
    // Test helper: drops an array's inputs from index n on (and what feeds them), like a route made by an older version.
    _truncate: function (id, arr, n) {
      var o = ensure(id);
      Object.keys(o).forEach(function (k) { var m = k.indexOf(arr + ".") === 0 && /^\d+$/.test(k.slice(arr.length + 1)); if (m && Number(k.slice(arr.length + 1)) >= n) delete o[k]; });
      for (var ci = connections.length - 1; ci >= 0; ci--) { var c = connections[ci]; if (c[2] === id && c[3].indexOf(arr + ".") === 0 && Number(c[3].slice(arr.length + 1)) >= n) connections.splice(ci, 1); }
    },
    _promoted: function (id) { return (promoted[id] || []).map(function (p) { return p.attribute; }); },
    _overrides: overrides,
    _connections: connections,
    // The active comp's layers only.
    getCompLayers: function () { return Object.keys(niceNames).filter(function (id) { return !comps[id] && (layerComp[id] || COMP_ID) === activeComp; }); },
    getActiveComp: function () { return activeComp; },
    setActiveComp: function (id) { if (!comps[id]) throw new Error("Not a composition: " + id); activeComp = id; },
    // Like Cavalry (perhaps): the new comp may become the active one; a fresh comp has its own
    // defaults (not the map comp's), so a build has to copy what it needs.
    createComp: function (name) {
      var id = "compNode#" + (nextId++);
      comps[id] = { startFrame: 0, endFrame: 99, playbackStart: 0, playbackEnd: 99, resolution: { x: 1000, y: 1000 }, fps: 30, backgroundColor: { r: 0, g: 0, b: 0, a: 255 } };
      niceNames[id] = name;
      activeComp = id;
      return id;
    },
    // A Composition Reference layer, added to the active comp.
    createCompReference: function (compId) {
      if (!comps[compId]) throw new Error("Not a composition: " + compId);
      var id = "compositionReference#" + (nextId++);
      niceNames[id] = niceNames[compId]; compRefs[id] = compId;
      return addToComp(id);
    },
    getCompFromReference: function (id) { return compRefs[id] || ""; },
    getAllLayerTypes: function () { return layerTypes.map(function (t) { return { name: t.name, type: t.type }; }); },
    _layerTypes: layerTypes,
    _comps: comps,
    _layerComp: layerComp,
    getSelection: function () { return selection.slice(); },
    select: function (ids) { selection = ids.slice(); },
    // Like Cavalry: these take no arguments and act on the selected layer.
    moveToBack: function () {
      if (arguments.length) throw new Error("Argument count does not match function definition. Expected 0 but got " + arguments.length);
      selection.forEach(function (id) {
        var sib = siblingsOf(id), i = sib.indexOf(id);
        if (i < 0) return;
        sib.splice(i, 1); sib.push(id);
        moveToBackCalls.push(id);
      });
    },
    moveBackward: function () {
      if (arguments.length) throw new Error("Argument count does not match function definition. Expected 0 but got " + arguments.length);
      selection.forEach(function (id) { step(id, 1); });
    },
    processEvents: function () {},
    filePathExists: function (p) { return Object.prototype.hasOwnProperty.call(files, p); },
    readFromFile: function (p) { return files[p]; },
    // Like Cavalry: full paths of what is directly inside the folder.
    listDirectory: function (p) {
      return Object.keys(files).filter(function (k) { return k.indexOf(p + "/") === 0 && k.indexOf("/", p.length + 1) < 0; });
    },
    writeToFile: function (p, c) { files[p] = c; },
    makeFolder: function (p) { files[p] = files[p] === undefined ? "<dir>" : files[p]; },
    getAppDataFolder: function () { return "C:/fake/AppData"; },
    Timer: function (callbacks) {
      var t = { callbacks: callbacks, active: false, interval: 0, repeating: true };
      t.start = function () { t.active = true; };
      t.stop = function () { t.active = false; };
      t.isActive = function () { return t.active; };
      t.setInterval = function (ms) { t.interval = ms; };
      t.setRepeating = function (r) { t.repeating = r; };
      timers.push(t);
      return t;
    },
    _timers: timers,
    _moveToBackCalls: moveToBackCalls,
    _files: files
  };
}

function makeFakeUi() {
  function Label(text) { this._text = text || ""; }
  Label.prototype.setText = function (t) { this._text = t; };
  Label.prototype.getText = function () { return this._text; };
  Label.prototype.setTextColor = function (c) { this._textColor = c; };
  Label.prototype.setAlignment = function (a) { this._alignment = a; };

  function Button(text) { this.onClick = null; this._text = text || ""; }
  Button.prototype.setText = function (t) { this._text = t; };
  Button.prototype.getText = function () { return this._text; };
  Button.prototype.setDrawStroke = function (s) { this._stroke = !!s; };
  Button.prototype.setImage = function (p) { this._image = p; };
  Button.prototype.setImageSize = function (w, h) { this._imageSize = [w, h]; };

  function LineEdit() { this._text = ""; }
  LineEdit.prototype.setPlaceholder = function (t) { this._placeholder = t; };
  LineEdit.prototype.getText = function () { return this._text; };
  LineEdit.prototype.setText = function (t) { this._text = t; };

  function DropDown() { this._entries = []; this._value = 0; this.onValueChanged = null; }
  DropDown.prototype.clear = function () { this._entries = []; this._value = 0; };
  DropDown.prototype.addEntry = function (e) { this._entries.push(e); };
  DropDown.prototype.getValue = function () { return this._value; };
  DropDown.prototype.setValue = function (v) { this._value = v; };

  function Checkbox(v) { this._value = !!v; }
  Checkbox.prototype.getValue = function () { return this._value; };
  Checkbox.prototype.setValue = function (v) { this._value = !!v; };

  function NumericField(v) { this._value = v || 0; }
  NumericField.prototype.setType = function () {};
  NumericField.prototype.setMin = function () {};
  NumericField.prototype.setMax = function () {};
  NumericField.prototype.getValue = function () { return this._value; };
  NumericField.prototype.setValue = function (v) { this._value = v; };

  function List() { this._model = []; }
  List.prototype.setSelectionMode = function () {};
  List.prototype.setModel = function (m) { this._model = m; };
  List.prototype.getSelection = function () { return []; };

  // Like Cavalry's PageView: holds one layout per page and shows one page at a time.
  function PageView() { this._pages = []; this._page = 0; }
  PageView.prototype.add = function (layout) { this._pages.push(layout); };
  PageView.prototype.setPage = function (i) { this._page = i; };
  PageView.prototype.currentPage = function () { return this._page; };
  PageView.prototype.pageCount = function () { return this._pages.length; };

  // Like Cavalry's FlowLayout: a row of widgets that reflows onto more rows when narrow.
  function FlowLayout(h, v) { this._items = []; this._spacing = [h, v]; }
  FlowLayout.prototype.add = function (w) { this._items.push(w); };
  FlowLayout.prototype.setSpaceBetween = function () {};
  FlowLayout.prototype.setMargins = function () {};

  function HLayout() { this._items = []; }
  HLayout.prototype.add = function (w) { this._items.push(w); };
  HLayout.prototype.setMargins = function (l, t, r, b) { this._margins = [l, t, r, b]; };
  HLayout.prototype.addStretch = function () { this._stretch = (this._stretch || 0) + 1; };

  function VLayout() { this._items = []; }
  VLayout.prototype.add = function (w) { this._items.push(w); };
  VLayout.prototype.setMargins = function (l, t, r, b) { this._margins = [l, t, r, b]; };
  VLayout.prototype.addStretch = function () { this._stretch = (this._stretch || 0) + 1; };

  HLayout.prototype.setSpaceBetween = function (s) { this._spacing = s; };
  VLayout.prototype.setSpaceBetween = function (s) { this._spacing = s; };
  // Recorded apart from the items, with the index of the item it comes before.
  VLayout.prototype.addSpacing = function (px) { (this._spacings = this._spacings || []).push({ at: this._items.length, px: px }); };
  HLayout.prototype.addSpacing = function (px) { (this._spacings = this._spacings || []).push({ at: this._items.length, px: px }); };

  // Like Cavalry's Container: a widget with a background, rounded corners and one layout.
  function Container() { this._layout = null; }
  Container.prototype.setLayout = function (l) { this._layout = l; };
  Container.prototype.setRadius = function (a, b, c, d) { this._radius = [a, b, c, d]; };

  // Like Cavalry's Draw: paths are recorded; tests fire the mouse callbacks directly.
  function Draw() { this._paths = []; this._size = [0, 0]; this._redraws = 0; }
  Draw.prototype.setSize = function (w, h) { this._size = [w, h]; };
  Draw.prototype.addPath = function (p, paint) { this._paths.push({ path: p, paint: paint }); };
  Draw.prototype.clearPaths = function () { this._paths = []; };
  Draw.prototype.redraw = function () { this._redraws++; };
  Draw.prototype.useHoverEvents = function (on) { this._hover = !!on; }; // like Cavalry: moves with no button held only fire when on
  Container.prototype.geometry = function () { return { x: 0, y: 0, width: this._width || 320, height: 24 }; };

  // No ui.Modal by default (like an older Cavalry): tests that need the dialog install one
  // with withModal().

  function ProgressBar() { this._value = 0; this._max = 100; }
  ProgressBar.prototype.setValue = function (v) { this._value = v; };
  ProgressBar.prototype.getValue = function () { return this._value; };
  ProgressBar.prototype.setMaximum = function (m) { this._max = m; };

  // Every Cavalry widget shares these.
  [Label, Button, LineEdit, DropDown, Checkbox, NumericField, List, ProgressBar, Container, Draw].forEach(function (W) {
    W.prototype.setHidden = function (h) { this._hidden = !!h; };
    W.prototype.isHidden = function () { return !!this._hidden; };
    W.prototype.setEnabled = function (e) { this._enabled = !!e; };
    W.prototype.setBackgroundColor = function (c) { this._background = c; };
    W.prototype.setToolTip = function (t) { this._toolTip = t; };
    W.prototype.setFixedWidth = function (w) { this._fixedWidth = w; };
    W.prototype.setFixedHeight = function (h) { this._fixedHeight = h; };
    W.prototype.setMinimumWidth = function (w) { this._minWidth = w; };
    W.prototype.setMinimumHeight = function (h) { this._minHeight = h; };
    W.prototype.setFontSize = function (s) { this._fontSize = s; };
  });

  var root = null;
  return {
    Label: Label, Button: Button, LineEdit: LineEdit, DropDown: DropDown, Checkbox: Checkbox,
    NumericField: NumericField, List: List, PageView: PageView, FlowLayout: FlowLayout, HLayout: HLayout, VLayout: VLayout,
    ProgressBar: ProgressBar, Container: Container, Draw: Draw,
    add: function (w) { root = w; },
    show: function () {},
    setTitle: function () {},
    _root: function () { return root; }
  };
}

function makeFakeCavalry() {
  function Path() { this._cmds = []; }
  ["moveTo", "lineTo", "close", "addEllipse", "addText", "addRect"].forEach(function (m) {
    Path.prototype[m] = function () { this._cmds.push([m].concat(Array.prototype.slice.call(arguments))); };
  });
  Path.prototype.toObject = function () { return { cmds: this._cmds.slice() }; };
  return { Path: Path };
}

// options.version: the version stamped into the bundle; options.setup(api): runs before the
// panel opens (e.g. fakeCurl, or files already on disk).
function buildSandbox(options = {}) {
  const api = makeFakeApi();
  const ui = makeFakeUi();
  const cavalry = makeFakeCavalry();
  if (options.setup) options.setup(api);
  const sandbox = { api: api, ui: ui, cavalry: cavalry, console: console };
  if (options.globals) Object.assign(sandbox, options.globals);
  const context = vm.createContext(sandbox);
  vm.runInContext(buildPanel({ version: options.version }), context, { filename: "CavalryGeo.js" });
  // The Map tab's own preview owns a redraw timer from the moment the panel opens; tests watch
  // the timers they cause (downloads, builds, a preview they create), so leave that one out
  // (found by asking the preview for its timer).
  [context.preview, context.pinsPreview, context.routesPreview].forEach((pv) => {
    const own = pv && pv._timer && pv._timer();
    if (own && api._timers.indexOf(own) >= 0) api._timers.splice(api._timers.indexOf(own), 1);
  });
  return { context: context, api: api, ui: ui };
}

function runTimers(api, max = 10000) {
  let n = 0;
  while (api._timers.some((t) => t.active) && n++ < max) api._timers.filter((t) => t.active).forEach((t) => t.callbacks.onTimeout());
}
function runTimersOnce(api) { api._timers.filter((t) => t.active).forEach((t) => t.callbacks.onTimeout()); }

// Every node under `node` (layouts' items, page views' pages, containers' layouts), depth first.
function walkUi(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  (node._items || []).forEach((n) => walkUi(n, fn));
  (node._pages || []).forEach((n) => walkUi(n, fn));
  if (node._layout) walkUi(node._layout, fn);
}

// Writes small encoded countries/lakes layers where GeoNet.neLayer looks for bundled data.
function installNe(api) {
  const C = require("../src/core/codec.js");
  const sq = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
  const layer = { kind: "polygon", features: [{ name: "Here", rings: [sq(-5, 40, 15)] }, { name: "There", rings: [sq(100, -10, 20)] }] };
  const lakes = { kind: "polygon", features: [{ name: "Lake", rings: [sq(0, 45, 3)] }] };
  const coast = { kind: "line", features: [{ name: "Coast", rings: [[[-5, 40], [10, 40], [10, 55]]] }] };
  ["110m", "50m"].forEach((s) => {
    api._files[`C:/fake/AppData/Scripts/CavalryGeo_assets/ne/${s}/coastlines.json`] = JSON.stringify(C.encodeLayer(coast));
    api._files[`C:/fake/AppData/Scripts/CavalryGeo_assets/ne/${s}/countries.json`] = JSON.stringify(C.encodeLayer(layer));
    api._files[`C:/fake/AppData/Scripts/CavalryGeo_assets/ne/${s}/lakes.json`] = JSON.stringify(C.encodeLayer(lakes));
  });
}

// A world-view map made through the panel's own map-making path (tests that just need a map).
function createWorldMap(context) { context.makeMap("Map", context.worldViewCamera(0)); }

const PARIS = { name: "Paris, Ile-de-France, France", lat: 48.8566, lon: 2.3522, bbox: { south: 48.8, north: 48.9, west: 2.2, east: 2.5 } };
const PARIS_TX = { name: "Paris, Lamar County, Texas", lat: 33.66, lon: -95.55, bbox: { south: 33.6, north: 33.7, west: -95.6, east: -95.5 } };
function searchFinds(context, found) { context.GeoNet.search = () => found.slice(); }
function mapSearch(context, q) { context.searchField.setText(q); context.searchBtn.onClick(); }

// EOX and NASA plan large images; the tile wording is tested with a custom tile link.
function useCustomTiles(context) {
  context.sourcePicker.setValue(4); // Custom tile link
  context.customUrlField.setText("https://tiles.example/{z}/{x}/{y}.png");
}

// True when `layout` (or anything under it) holds `widget`.
function holds(layout, widget) { let found = false; walkUi(layout, (n) => { if (n === widget) found = true; }); return found; }

test("buildPanel() runs against stub ui/api: a five-section tab bar above a page per section", () => {
  const { ui, context } = buildSandbox();
  const root = ui._root();
  assert.ok(root, "buildUi should have called ui.add(root)");
  const bar = root._items[0], pages = context.sectionPages;
  assert.ok(bar instanceof ui.Container, "the tab bar is a rounded box");
  assert.deepEqual(plain(context.sectionTabs.buttons.map((b) => b.getText())), ["Map", "Layers", "Imagery", "Label", "Data"]);
  assert.equal(pages.pageCount(), 5);
  assert.equal(pages.currentPage(), 0);
  assert.equal(context.sectionTabs.selected(), "Map");
  // Tab bar, the shown page only as tall as itself, a stretch, then the status line at the bottom (Tips lives on the Map tab).
  assert.equal(root._items.length, 3);
  assert.deepEqual(root._items, [context.sectionTabs.widget, pages.widget, context.statusLabel]);
  assert.ok(holds(pages.pages[0], context.tipsBtn), "Tips is held by the Map page");
  assert.equal(root._stretch, 1);
  pages.pages.forEach((layout, i) => assert.equal(pages.widget._items[i]._layout, layout, "page " + i));
  context.showSection("Imagery");
  assert.deepEqual(pages.widget._items.map((c) => c.isHidden()), [true, true, false, true, true]);
});

test("each section page holds its controls: Extract and Bake in Layers, Pins and Routes in Label", () => {
  const { ui, context } = buildSandbox();
  const pages = context.sectionPages.pages;
  assert.ok(holds(pages[0], context.searchBtn), "Map");
  assert.ok(holds(pages[1], context.addLayersBtn) && holds(pages[1], context.findBtn) && holds(pages[1], context.bakeBtn), "Layers");
  assert.ok(holds(pages[2], context.buildImageryBtn), "Imagery");
  assert.ok(holds(pages[3], context.pinHereBtn) && holds(pages[3], context.createRouteBtn) && holds(pages[3], context.pinStopsBtn), "Label");
  assert.ok(holds(pages[4], context.addDataBtn), "Data");
});

test("clicking a tab shows its page and selects only that tab", () => {
  const { context } = buildSandbox();
  const pages = context.sectionPages;
  const imagery = context.sectionTabs.buttons[2];
  imagery.onClick();
  assert.equal(pages.currentPage(), 2);
  assert.equal(context.sectionTabs.selected(), "Imagery");
  assert.equal(imagery._background, "#373737");
  context.sectionTabs.buttons.filter((b) => b !== imagery).forEach((b) => assert.equal(b._background, "#1c1c1c", b.getText()));
});

test("Label has a Pins / Routes tab bar; old section names still land in the right place", () => {
  const { context } = buildSandbox();
  const pages = context.sectionPages;
  assert.deepEqual(plain(context.labelTabs.buttons.map((b) => b.getText())), ["Pins", "Routes"]);
  assert.equal(context.labelPages.pageCount(), 2);
  assert.ok(holds(context.labelPages.pages[0], context.pinHereBtn));
  assert.ok(holds(context.labelPages.pages[1], context.createRouteBtn));
  context.labelTabs.buttons[1].onClick();
  assert.equal(context.labelPages.currentPage(), 1);
  context.showSection("Pins");
  assert.equal(pages.currentPage(), 3);
  assert.equal(context.sectionTabs.selected(), "Label");
  assert.equal(context.labelPages.currentPage(), 0);
  assert.equal(context.labelTabs.selected(), "Pins");
  context.showSection("Routes");
  assert.equal(context.labelPages.currentPage(), 1);
  context.showSection("Extract");
  assert.equal(pages.currentPage(), 1);
  assert.equal(context.sectionTabs.selected(), "Layers");
  context.showSection("Nowhere");
  assert.equal(pages.currentPage(), 1, "unknown names are ignored");
});

test("every button's onClick can be invoked against an empty scene without an error escaping guard()", () => {
  const { context } = buildSandbox();
  const buttonNames = [
    "refreshMapsBtn", "searchBtn", "jumpBtn", "flyBtn", "updateFlightBtn", "driftBtn", "tipsGotItBtn", "tipsBtn",
    "addLayersBtn", "clearCacheBtn",
    "refreshLayersBtn", "findBtn", "extractBtn", "highlightBtn", "changeEffectBtn", "bakeBtn", "refreshControlsBtn",
    "pinSearchBtn", "pinHereBtn", "labelHereBtn", "calloutHereBtn", "pinCoordBtn", "labelCoordBtn", "calloutCoordBtn", "addDayNightBtn",
    "routeSearchBtn", "addStopBtn", "removeStopBtn", "clearStopsBtn", "createRouteBtn", "addTravellerBtn", "pinStopsBtn",
    "dataLoadBtn", "addDataBtn", "refreshDataBtn",
    "buildImageryBtn", "cancelImageryBtn", "imageryAttrBtn", "clearTilesBtn"
  ];
  buttonNames.forEach(function (name) {
    const btn = context[name];
    assert.ok(btn && typeof btn.onClick === "function", name + " should exist with an onClick handler");
    assert.doesNotThrow(() => btn.onClick(), name + ".onClick() should never throw out of guard()");
  });
});

const NO_MAP = "Error: Pick a map, or search for a place first — that creates the map (Map tab).";

test("Map tab: an empty scene offers only \"New map\", and map actions say how to make one", () => {
  const { context } = buildSandbox();
  assert.deepEqual(plain(context.mapPicker._entries), ["New map"]);
  assert.equal(context.mapPicker.getValue(), 0);
  assert.equal(context.resultPicker._entries[0], "World view");
  ["jumpBtn", "flyBtn", "addLayersBtn", "buildImageryBtn", "pinCoordBtn", "createRouteBtn"].forEach((name) => {
    context.statusLabel.setText("");
    if (name === "addLayersBtn") context.checks.countries.setValue(true);
    context[name].onClick();
    assert.equal(context.statusLabel.getText(), NO_MAP, name);
  });
});

test("Map tab: \"New map\" stays last in the picker, and selecting it means no map", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  assert.deepEqual(plain(context.mapPicker._entries), ["Map", "New map"]);
  assert.equal(context.mapPicker.getValue(), 0);
  assert.equal(context.currentMap().name, "Map");
  context.mapPicker.setValue(1);
  context.jumpBtn.onClick();
  assert.equal(context.statusLabel.getText(), NO_MAP);
});

test("Map tab: picking \"New map\" in the picker is not an error: it clears the Extract list and says what to do", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  context.featureList.setModel([{ uuid: "g0", label: "France" }]);
  context.mapPicker.setValue(1);
  context.mapPicker.onValueChanged();
  assert.equal(context.statusLabel.getText(), "New map: type a place and press Search to make it.");
  assert.deepEqual(plain(context.featureList._model), []);
  assert.equal(context.groupsLayer, null);
});

test("Map tab: Create map, Drop pin and Centre camera here are gone; Jump here and Fly here remain", () => {
  const { context, ui } = buildSandbox();
  assert.equal(context.createBtn, undefined);
  assert.equal(context.pinBtn, undefined);
  assert.equal(context.centreBtn, undefined);
  const texts = [];
  (function walk(n) { if (n instanceof ui.Button) texts.push(n.getText()); (n._items || []).forEach(walk); })(context.sectionPages.pages[0]);
  assert.deepEqual(texts, ["Got it", "Refresh", "Search", "Jump here", "Fly here", "Update flight", "Drift", "Create map here", "Apply to map", "Save as style", "Delete style", "Tips"]);
});

test("Map tab: Search and Fly here buttons share the same fixed width", () => {
  const { context } = buildSandbox();
  assert.equal(context.searchBtn._fixedWidth, 84);
  assert.equal(context.flyBtn._fixedWidth, 84);
  assert.equal(context.searchBtn._fixedWidth, context.flyBtn._fixedWidth);
});

test("Map tab: Search with \"New map\" selected creates the map, named from the name field and centred on the first result", () => {
  const { context } = buildSandbox({ setup: installNe });
  searchFinds(context, [PARIS, PARIS_TX]);
  context.nameField.setText("Trip");
  context.projPicker.setValue(1);
  mapSearch(context, "Paris");
  assert.equal(context.statusLabel.getText(), "Created map \"Trip\" with countries and coastlines, centred on Paris. 2 result(s): pick one, then Jump here or Fly here.");
  assert.deepEqual(plain(context.mapPicker._entries), ["Trip", "New map"]);
  assert.equal(context.mapPicker.getValue(), 0);
  const cam = context.GeoScene.readCamera(context.currentMap().cameraId);
  const want = context.camForResult(PARIS, 1);
  assert.ok(Math.abs(cam.lat - PARIS.lat) < 1e-9 && Math.abs(cam.lon - PARIS.lon) < 1e-9);
  assert.ok(Math.abs(cam.zoom - want.zoom) < 1e-9);
  assert.equal(cam.projection, 1);
  assert.equal(context.resultPicker.getValue(), 1, "the first result is picked");
});

test("Map tab: Search names the new map after the place when the name field is blank, made unique", () => {
  const { context } = buildSandbox({ setup: installNe });
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  assert.equal(context.currentMap().name, "Paris");
  context.mapPicker.setValue(context.maps.length); // "New map"
  mapSearch(context, "Paris");
  assert.equal(context.currentMap().name, "Paris 2");
  context.mapPicker.setValue(context.maps.length);
  mapSearch(context, "Paris");
  assert.equal(context.currentMap().name, "Paris 3");
  assert.deepEqual(plain(context.mapPicker._entries).sort(), ["New map", "Paris", "Paris 2", "Paris 3"]);
  assert.match(context.statusLabel.getText(), /^Created map "Paris 3" with countries and coastlines, centred on Paris\. 1 result\(s\)/);
});

test("Map tab: Search that creates a map also adds Countries and Coastlines", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  const names = api.getChildren(context.currentMap().groupId).map((id) => api.getNiceName(id));
  assert.ok(names.includes("Paris: Countries"), names.join(", "));
  assert.ok(names.includes("Paris: Coastlines"), names.join(", "));
  assert.equal(context.statusLabel.getText(), "Created map \"Paris\" with countries and coastlines, centred on Paris. 1 result(s): pick one, then Jump here or Fly here.");
});

test("Map tab: Create map here also adds Countries and Coastlines", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  context.preview.showCamera({ lat: 35, lon: 139, zoom: 8 }, "camera");
  context.createHereBtn.onClick();
  const names = api.getChildren(context.currentMap().groupId).map((id) => api.getNiceName(id));
  assert.ok(names.includes("Map 1: Countries"), names.join(", "));
  assert.ok(names.includes("Map 1: Coastlines"), names.join(", "));
  assert.equal(context.statusLabel.getText(), "Created map \"Map 1\" with countries and coastlines at the preview frame.");
});

test("Map tab: without bundled data the map is still created and the message says why there are no starter layers", () => {
  const { context } = buildSandbox();
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  assert.equal(context.GeoScene.findMaps().length, 1);
  assert.match(context.statusLabel.getText(), /^Created map "Paris" centred on Paris\. 1 result\(s\): pick one, then Jump here or Fly here\. \(Countries and coastlines couldn't be added: .+\)$/);
  context.mapPicker.setValue(context.maps.length);
  context.preview.showCamera({ lat: 35, lon: 139, zoom: 8 }, "camera");
  context.createHereBtn.onClick();
  assert.equal(context.GeoScene.findMaps().length, 2);
  assert.match(context.statusLabel.getText(), /^Created map "Map 1" at the preview frame\. \(Countries and coastlines couldn't be added: .+\)$/);
});

test("Map tab: Search with a map selected only finds places", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const before = context.GeoScene.readCamera(context.currentMap().cameraId);
  searchFinds(context, [PARIS, PARIS_TX]);
  mapSearch(context, "Paris");
  assert.equal(context.statusLabel.getText(), "2 result(s). Pick one, then Jump here or Fly here.");
  assert.equal(context.GeoScene.findMaps().length, 1);
  assert.deepEqual(plain(context.GeoScene.readCamera(context.currentMap().cameraId)), plain(before), "the camera doesn't move");
});

test("Map tab: a Search with no results creates no map", () => {
  const { context } = buildSandbox();
  searchFinds(context, []);
  mapSearch(context, "Nowhere");
  assert.equal(context.statusLabel.getText(), "No results for \"Nowhere\".");
  assert.equal(context.GeoScene.findMaps().length, 0);
  assert.deepEqual(plain(context.mapPicker._entries), ["New map"]);
});

test("Map tab: Jump here moves the camera to the picked place, or to the world view", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  const world = context.GeoScene.readCamera(map.cameraId);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  context.jumpBtn.onClick();
  let cam = context.GeoScene.readCamera(map.cameraId);
  assert.ok(Math.abs(cam.lat - PARIS.lat) < 1e-9 && Math.abs(cam.lon - PARIS.lon) < 1e-9);
  assert.match(context.statusLabel.getText(), /^Camera jumped to Paris \(zoom \d+\.\d\)\.$/);
  context.resultPicker.setValue(0); // World view
  context.jumpBtn.onClick();
  cam = context.GeoScene.readCamera(map.cameraId);
  assert.equal(cam.lat, 20);
  assert.equal(cam.lon, 0);
  assert.ok(Math.abs(cam.zoom - world.zoom) < 1e-9, "the same world view Fly here uses");
  assert.equal(context.statusLabel.getText(), "Camera jumped to the world view.");
});

test("Map tab: a successful Search pre-fills the Pins tab, so Pin here works straight away", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  searchFinds(context, [PARIS, PARIS_TX]);
  mapSearch(context, "Paris");
  assert.equal(context.pinSearchField.getText(), "Paris");
  assert.deepEqual(plain(context.pinResultPicker._entries), [PARIS.name, PARIS_TX.name]);
  assert.equal(context.pinResultPicker.getValue(), 0);
  context.pinHereBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Pin added at Paris.");
  assert.ok(api.getCompLayers().some((id) => api.getNiceName(id) === "Pin: Paris"));
});

// Fly here's Start / End frames: a comp long enough that a flight doesn't need the extend dialog.
function longComp(api) { api.set(api.getActiveComp(), { endFrame: 500, playbackEnd: 500 }); }
function flyRange(context, start, end) { context.flyStartField.setValue(start); context.flyEndField.setValue(end); }

test("Fly to keys the camera from Start to End on the selected place", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  createWorldMap(context);
  const map = context.currentMap();
  context.results = [{ name: "Paris, France", lat: 48.8566, lon: 2.3522, bbox: { south: 48.8, north: 48.9, west: 2.2, east: 2.5 } }];
  context.refreshResultPicker();
  context.resultPicker.setValue(1);
  context.resultPicker.onValueChanged(); // the preview follows the pick, so Fly here goes there
  flyRange(context, 20, 29);
  context.flyBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Flight to Paris: frames 20–29\./);
  assert.doesNotMatch(context.statusLabel.getText(), /world view/, "the world-view note only when World view is picked");
  assert.deepEqual(plain(api.getKeyframeTimes(map.cameraId, "array.2")), [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  api.setFrame(29);
  assert.ok(Math.abs(api.get(map.cameraId, "array.0") - 48.8566) < 1e-9);
  assert.equal(api.getFrame(), 29);
  flyRange(context, 20, 20);
  context.flyBtn.onClick();
  assert.match(context.statusLabel.getText(), /Set End at least 1 frame after Start/);
});

test("Fly to the world view", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.resultPicker.setValue(0);
  context.resultPicker.onValueChanged();
  flyRange(context, 0, 4);
  context.flyBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Flight to the world view: frames 0–4\./);
  // In Cavalry this was mistaken twice for a flight to the searched place: say why.
  assert.match(context.statusLabel.getText(), /Flying to the world view — to fly somewhere else, search for a place and pick it first\./);
});

// F9: the comp's default fake frame range is 0..9; a flight from frame 0 to 14 runs past it, so
// Fly here asks before it extends the composition (the full set is in the tests below).
test("Fly to asks before a flight that ends after the composition's last frame (F9)", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  context.resultPicker.setValue(0);
  context.resultPicker.onValueChanged();
  const asked = withModal(ui, true);
  flyRange(context, 0, 14);
  context.flyBtn.onClick();
  assert.equal(asked.length, 1);
  assert.match(context.statusLabel.getText(), /The composition was extended to frame 89 \(3 seconds after the flight ends\)\./);
});

test("Fly to says nothing extra when the flight stays inside the composition (F9)", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  context.resultPicker.setValue(0);
  context.resultPicker.onValueChanged();
  const asked = withModal(ui, true);
  flyRange(context, 0, 4);
  context.flyBtn.onClick();
  assert.equal(asked.length, 0, "no dialog inside the composition");
  assert.doesNotMatch(context.statusLabel.getText(), /extended/);
  assert.equal(api.get(api.getActiveComp(), "endFrame"), 9);
});

// Fly here's Start / End frames, chaining and extending the composition.
function flyWorld(context) {
  createWorldMap(context);
  context.resultPicker.setValue(0);
  context.resultPicker.onValueChanged();
  return context.currentMap();
}
function camTimes(api, map) { return [0, 1, 2].map((i) => plain(api.getKeyframeTimes(map.cameraId, "array." + i))); }
const range = (a, b) => { const r = []; for (let f = a; f <= b; f++) r.push(f); return r; };

test("Map tab: Start begins at the playhead and End 100 frames later; From: and To: label them", () => {
  const { context, ui } = buildSandbox({ setup: (api) => api.setFrame(12) });
  assert.equal(context.flyStartField.getValue(), 12);
  assert.equal(context.flyEndField.getValue(), 112);
  assert.equal(context.fromLabel.getText(), "From:");
  assert.equal(context.toLabel.getText(), "To:");
  const rows = context.sectionPages.pages[0]._items.filter((n) => n instanceof ui.HLayout);
  const jumpRow = rows.filter((n) => holds(n, context.jumpBtn))[0];
  const flyRow = rows.filter((n) => holds(n, context.flyBtn))[0];
  assert.deepEqual(jumpRow._items, [context.jumpBtn], "Jump here has a row of its own");
  assert.deepEqual(flyRow._items, [context.flyBtn, context.fromLabel, context.flyStartBox, context.toLabel, context.flyEndBox]);
  assert.ok(holds(context.flyStartBox, context.flyStartField) && holds(context.flyEndBox, context.flyEndField), "each box holds its field");
  [context.flyStartBox, context.flyEndBox].forEach((box) => {
    const texts = []; walkUi(box, (n) => { if (n instanceof ui.Label) texts.push(n.getText()); });
    assert.deepEqual(texts, ["F"], "each box is marked with an F");
  });
  const items = context.sectionPages.pages[0]._items;
  assert.ok(items.indexOf(jumpRow) + 1 === items.indexOf(flyRow), "the Fly row follows the Jump row");
  assert.equal(context.flyStartField._fixedWidth, 48);
  assert.equal(context.flyEndField._fixedWidth, 48);
  const quiet = buildSandbox().context;
  assert.equal(quiet.flyStartField.getValue(), 0);
  assert.equal(quiet.flyEndField.getValue(), 100);
});

test("Map tab: the Start and End fields hide with Jump here and Fly here while New map is picked", () => {
  const { context } = buildSandbox();
  const widgets = ["jumpBtn", "fromLabel", "flyStartBox", "flyStartField", "toLabel", "flyEndBox", "flyEndField", "flyBtn"];
  widgets.forEach((w) => assert.equal(context[w].isHidden(), true, w + " hidden with no map"));
  createWorldMap(context);
  widgets.forEach((w) => assert.equal(context[w].isHidden(), false, w + " shown with a map"));
});

test("Map tab: the frame-field boxes follow New map: hidden with no map, shown again once a map is picked", () => {
  const { context } = buildSandbox();
  assert.equal(context.flyStartBox.isHidden(), true);
  assert.equal(context.flyEndBox.isHidden(), true);
  createWorldMap(context);
  assert.equal(context.flyStartBox.isHidden(), false);
  assert.equal(context.flyEndBox.isHidden(), false);
  context.mapPicker.setValue(context.maps.length); // New map
  context.mapPicker.onValueChanged();
  assert.equal(context.flyStartBox.isHidden(), true, "hidden again on New map");
  assert.equal(context.flyEndBox.isHidden(), true);
});

test("Map tab: a note under the Fly row says what Fly here does, and hides with the row for New map", () => {
  const { context, ui } = buildSandbox();
  assert.equal(context.flyNote.getText(), "(animates the camera to the map preview)");
  assert.equal(context.flyNote._textColor, "#8a8a8a");
  const items = context.sectionPages.pages[0]._items;
  const flyRow = items.filter((n) => n instanceof ui.HLayout && holds(n, context.flyBtn))[0];
  assert.ok(items.indexOf(flyRow) >= 0 && items[items.indexOf(flyRow) + 1] === context.flyNote, "the note sits right after the Fly row");
  assert.equal(context.flyNote.isHidden(), true, "hidden with no map");
  createWorldMap(context);
  assert.equal(context.flyNote.isHidden(), false, "shown with a map");
  context.mapPicker.setValue(context.maps.length); // New map
  context.mapPicker.onValueChanged();
  assert.equal(context.flyNote.isHidden(), true, "hidden again on New map");
});

function countingSearch(context, found) {
  const calls = [];
  context.GeoNet.search = (q) => { calls.push(q); return found.slice(); };
  return calls;
}
function mapCommit(context, q) { context.searchField.setText(q); context.searchField.onValueCommitted(); }

test("Map search box: Enter (commit) searches once, lists the results and says how to go on", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const calls = countingSearch(context, [PARIS, PARIS_TX]);
  mapCommit(context, "  Paris ");
  assert.deepEqual(calls, ["Paris"]);
  assert.equal(context.statusLabel.getText(), "2 result(s). Pick one, then Jump here or Fly here.");
  assert.equal(context.resultPicker.getValue(), 1, "the first result is picked");
  assert.equal(context.resultPicker._entries.length, 3);
  assert.equal(context.pinSearchField.getText(), "Paris", "the Pins tab is pre-filled too");
  mapCommit(context, "Paris");
  assert.equal(calls.length, 1, "the same text again does not search");
  mapCommit(context, "Rome");
  assert.equal(calls.length, 2, "new text searches");
});

test("Map search box: committing empty text does nothing, quietly", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const calls = countingSearch(context, [PARIS]);
  context.statusLabel.setText("untouched");
  mapCommit(context, "   ");
  assert.equal(calls.length, 0);
  assert.equal(context.statusLabel.getText(), "untouched");
});

test("Map search box: a commit with no results says so", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  countingSearch(context, []);
  mapCommit(context, "Nowhere");
  assert.equal(context.statusLabel.getText(), "No results for \"Nowhere\".");
});

test("Map search box: a commit never creates a map; Search then makes it from the same results without searching again", () => {
  const { context } = buildSandbox({ setup: installNe });
  const calls = countingSearch(context, [PARIS, PARIS_TX]);
  assert.equal(context.maps.length, 0);
  mapCommit(context, "Paris");
  assert.equal(context.maps.length, 0, "no map made by Enter");
  assert.equal(context.statusLabel.getText(), "2 result(s). Press Search to make the map at the first one.");
  assert.equal(calls.length, 1);
  context.searchBtn.onClick();
  assert.equal(calls.length, 1, "Search reused the results");
  assert.equal(context.maps.length, 1);
  assert.equal(context.currentMap().name, "Paris");
  assert.match(context.statusLabel.getText(), /^Created map "Paris" with countries and coastlines, centred on Paris\. 2 result\(s\)/);
  context.mapPicker.setValue(context.maps.length); // New map again
  context.mapPicker.onValueChanged();
  context.searchField.setText("Rome");
  context.searchBtn.onClick();
  assert.equal(calls.length, 2, "Search with different text searches");
  assert.deepEqual(calls, ["Paris", "Rome"]);
});

test("Map Search button: reuses the last results for the same text, searches again for new text or no results", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const calls = countingSearch(context, [PARIS, PARIS_TX]);
  mapSearch(context, "Paris");
  mapSearch(context, "Paris");
  assert.equal(calls.length, 1, "second press with the same text reuses");
  assert.equal(context.statusLabel.getText(), "2 result(s). Pick one, then Jump here or Fly here.");
  context.resultPicker.setValue(2);
  mapSearch(context, "Paris");
  assert.equal(context.resultPicker.getValue(), 1, "reusing still starts at the first result");
  const none = countingSearch(context, []);
  mapSearch(context, "Nowhere");
  mapSearch(context, "Nowhere");
  assert.equal(none.length, 2, "no results to reuse, so it searches again");
});

test("Map search box: a failing search stays inside guard() on commit", () => {
  const { context } = buildSandbox();
  context.GeoNet.search = () => { throw new Error("offline"); };
  context.searchField.setText("Paris");
  assert.doesNotThrow(() => context.searchField.onValueCommitted());
  assert.match(context.statusLabel.getText(), /offline/);
});

[["Pins", "pinSearchField", "pinSearchBtn", "pinResultPicker", "pinResults"],
 ["Routes", "routeSearchField", "routeSearchBtn", "routeResultPicker", "routeResults"]].forEach(([name, fieldName, btnName, pickerName, resultsName]) => {
  test(name + " search box: Enter searches once, the same text again does not, and the button reuses the results", () => {
    const { context } = buildSandbox();
    const calls = countingSearch(context, [PARIS, PARIS_TX]);
    const field = context[fieldName];
    field.setText("Paris ");
    field.onValueCommitted();
    assert.equal(calls.length, 1);
    assert.deepEqual(plain(context[pickerName]._entries), [PARIS.name, PARIS_TX.name]);
    assert.equal(context[resultsName].length, 2);
    field.onValueCommitted();
    assert.equal(calls.length, 1, "same text: nothing");
    context[btnName].onClick();
    assert.equal(calls.length, 1, "the button after a commit with the same text reuses the results");
    assert.equal(context[resultsName].length, 2);
    assert.match(context.statusLabel.getText(), /^2 result\(s\)\. Pick one, then /);
    field.setText("Rome");
    context[btnName].onClick();
    assert.equal(calls.length, 2, "new text searches from the button");
    field.setText("Oslo");
    field.onValueCommitted();
    assert.equal(calls.length, 3, "new text searches on commit");
  });
  test(name + " search box: committing empty text does nothing, quietly", () => {
    const { context } = buildSandbox();
    const calls = countingSearch(context, [PARIS]);
    context.statusLabel.setText("untouched");
    context[fieldName].setText("  ");
    context[fieldName].onValueCommitted();
    assert.equal(calls.length, 0);
    assert.equal(context.statusLabel.getText(), "untouched");
  });
});

test("Pins search box: after a Map search the prefilled text is already searched, so Enter there does nothing", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const calls = countingSearch(context, [PARIS]);
  mapSearch(context, "Paris");
  assert.equal(context.pinSearchField.getText(), "Paris");
  context.pinSearchField.onValueCommitted();
  assert.equal(calls.length, 1);
});

test("Fly here keys exactly Start to End, restores the playhead and moves the fields on for the next flight", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyWorld(context);
  flyRange(context, 30, 49);
  api.setFrame(7);
  context.flyBtn.onClick();
  assert.equal(context.statusLabel.getText().indexOf("Flight to the world view: frames 30–49."), 0);
  camTimes(api, map).forEach((t) => assert.deepEqual(t, range(30, 49)));
  assert.equal(api.getFrame(), 7, "the playhead goes back where it was");
  assert.equal(context.flyStartField.getValue(), 49, "Start moves to the old End");
  assert.equal(context.flyEndField.getValue(), 68, "End moves on by the same length");
});

test("Fly here starts from the camera as it is at the Start frame, not at the playhead", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyWorld(context);
  api.keyframe(map.cameraId, 0, { "array.0": 50, "array.1": 60, "array.2": 8 });
  api.keyframe(map.cameraId, 40, { "array.0": 10, "array.1": 20, "array.2": 3 });
  api.setFrame(0);
  flyRange(context, 40, 49);
  context.flyBtn.onClick();
  api.setFrame(40);
  assert.equal(api.get(map.cameraId, "array.0"), 10);
  assert.equal(api.get(map.cameraId, "array.1"), 20);
  assert.equal(api.get(map.cameraId, "array.2"), 3);
  assert.equal(plain(api.getKeyframeTimes(map.cameraId, "array.0"))[0], 0, "the earlier key stays");
});

test("Fly here refuses an End less than 1 frame after Start and changes nothing", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyWorld(context);
  [[20, 20], [20, 15]].forEach(([s, e]) => {
    flyRange(context, s, e);
    context.flyBtn.onClick();
    assert.equal(context.statusLabel.getText(), "Error: Set End at least 1 frame after Start (a flight needs 2 frames or more).");
    assert.deepEqual(camTimes(api, map), [[], [], []]);
    assert.equal(context.flyStartField.getValue(), s, "the fields stay as they were");
  });
});

test("Fly here refuses a Start before the composition's first frame", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  api.set(api.getActiveComp(), { startFrame: 5 });
  const map = flyWorld(context);
  flyRange(context, 3, 20);
  context.flyBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Start is before the composition's first frame (5).");
  assert.deepEqual(camTimes(api, map), [[], [], []]);
});

test("Fly here past the composition's end asks, and Yes extends the composition, the layers that reached its end and the play range", () => {
  const { context, api, ui } = buildSandbox();
  const map = flyWorld(context);
  const comp = api.getActiveComp();
  const atEnd = api.create("group", "Reaches the end"), atEndMinusOne = api.create("group", "Out frame 9"), trimmed = api.create("group", "Trimmed");
  api.setOutFrame(atEndMinusOne, 9);
  api.setOutFrame(trimmed, 4);
  const asked = withModal(ui, true);
  flyRange(context, 0, 14);
  context.flyBtn.onClick();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Extend the timeline");
  assert.equal(asked[0].question, "This flight ends at frame 14, after your composition's last frame (9). Fly here will extend the composition, and the layers that reach its end, to frame 89 (3 seconds after the flight ends). Continue?");
  assert.equal(api.get(comp, "endFrame"), 89);
  assert.equal(api.get(comp, "frameRange").y, 89);
  assert.equal(api.get(comp, "playbackEnd"), 89);
  assert.equal(api.getOutFrame(atEnd), 90);
  assert.equal(api.getOutFrame(atEndMinusOne), 90);
  assert.equal(api.getOutFrame(trimmed), 4, "a layer trimmed to end earlier is left alone");
  assert.equal(api.getOutFrame(map.cameraId), 90);
  camTimes(api, map).forEach((t) => assert.deepEqual(t, range(0, 14)));
  assert.equal(context.statusLabel.getText().indexOf("Flight to the world view: frames 0–14. The composition was extended to frame 89 (3 seconds after the flight ends)."), 0);
  assert.ok(context.statusLabel.getText().indexOf("Press Build imagery") > 0);
  assert.equal(context.flyStartField.getValue(), 14);
  assert.equal(context.flyEndField.getValue(), 28);
});

test("Extending pads 3 seconds at the comp's frame rate: 30 fps pads 90 frames, an unreadable rate pads 75 (25 fps)", () => {
  const a = buildSandbox();
  flyWorld(a.context);
  const layer = a.api.create("group", "Reaches the end");
  a.api.set(a.api.getActiveComp(), { fps: 30 });
  const asked = withModal(a.ui, true);
  flyRange(a.context, 0, 14);
  a.context.flyBtn.onClick();
  assert.match(asked[0].question, /to frame 104 \(3 seconds after the flight ends\)\. Continue\?$/);
  assert.equal(a.api.get(a.api.getActiveComp(), "endFrame"), 104);
  assert.equal(a.api.getOutFrame(layer), 105);
  assert.match(a.context.statusLabel.getText(), /The composition was extended to frame 104 \(3 seconds after the flight ends\)\./);
  const b = buildSandbox();
  flyWorld(b.context);
  const layerB = b.api.create("group", "Reaches the end");
  b.api.set(b.api.getActiveComp(), { fps: "unreadable" });
  withModal(b.ui, true);
  flyRange(b.context, 0, 14);
  b.context.flyBtn.onClick();
  assert.equal(b.api.get(b.api.getActiveComp(), "endFrame"), 89);
  assert.equal(b.api.getOutFrame(layerB), 90);
});

test("Fly here past the composition's end: No cancels and changes nothing", () => {
  const { context, api, ui } = buildSandbox();
  const map = flyWorld(context);
  const comp = api.getActiveComp(), layer = api.create("group", "Reaches the end");
  const asked = withModal(ui, false);
  flyRange(context, 0, 14);
  context.flyBtn.onClick();
  assert.equal(asked.length, 1);
  assert.equal(context.statusLabel.getText(), "Cancelled. Set End to 9 or earlier to stay within your composition.");
  assert.deepEqual(camTimes(api, map), [[], [], []]);
  assert.equal(api.get(comp, "endFrame"), 9);
  assert.equal(api.get(comp, "playbackEnd"), 9);
  assert.equal(api.getOutFrame(layer), 10);
  assert.equal(context.flyStartField.getValue(), 0);
  assert.equal(context.flyEndField.getValue(), 14);
});

test("Fly here past the composition's end with no dialog available refuses and never extends silently", () => {
  const { context, api } = buildSandbox();
  const map = flyWorld(context);
  const comp = api.getActiveComp(), layer = api.create("group", "Reaches the end");
  assert.equal(context.questionDialog(), null);
  flyRange(context, 0, 14);
  context.flyBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: End is after your composition's last frame (9). Set End to 9 or earlier, or lengthen the composition first.");
  assert.deepEqual(camTimes(api, map), [[], [], []]);
  assert.equal(api.get(comp, "endFrame"), 9);
  assert.equal(api.getOutFrame(layer), 10);
});

test("GeoScene.extendComp: null when the comp already reaches the frame; keeps a shorter play range", () => {
  const { context, api } = buildSandbox();
  const comp = api.getActiveComp(), layer = api.create("group", "Layer");
  assert.equal(context.GeoScene.extendComp(9), null);
  assert.equal(context.GeoScene.extendComp(3), null);
  assert.equal(api.get(comp, "endFrame"), 9);
  api.set(comp, { playbackEnd: 5 });
  const r = context.GeoScene.extendComp(20);
  assert.deepEqual(plain(r), { oldEnd: 9, newEnd: 20, layers: 1 });
  assert.equal(api.get(comp, "endFrame"), 20);
  assert.equal(api.get(comp, "playbackEnd"), 5, "a play range that stopped earlier stays");
  assert.equal(api.getOutFrame(layer), 21);
});

test("GeoScene.extendComp: one layer failing never stops the rest, and a Cavalry without out frames still extends the comp", () => {
  const { context, api } = buildSandbox();
  const comp = api.getActiveComp(), a = api.create("group", "A"), b = api.create("group", "B"), c = api.create("group", "C");
  const real = api.setOutFrame;
  api.setOutFrame = (id, f) => { if (id === b) throw new Error("locked"); real(id, f); };
  const r = context.GeoScene.extendComp(12);
  assert.equal(r.layers, 2);
  assert.equal(api.getOutFrame(a), 13);
  assert.equal(api.getOutFrame(b), 10);
  assert.equal(api.getOutFrame(c), 13);
  assert.equal(api.get(comp, "endFrame"), 12);
  delete api.setOutFrame;
  assert.equal(context.GeoScene.extendComp(15).layers, 0);
  assert.equal(api.get(comp, "endFrame"), 15);
});

test("GeoScene.extendComp: a bent imagery source comp is lengthened too, and the map comp is active again", () => {
  const { context, api, map, src } = bentFixture();
  const r = context.GeoScene.buildImagery(map, src, {}, context.GeoScene.planImagery(map, src, {}));
  const comp = context.GeoScene.findImagery(map)[0].meta.sourceComp;
  const inner = inComp(api, comp, () => api.create("group", "Tile"));
  api.setActiveComp(comp); api.set(comp, { playbackEnd: 9 }); api.setActiveComp("comp#1");
  const mapLayer = api.create("group", "Map layer");
  const ext = context.GeoScene.extendComp(20);
  assert.equal(ext.oldEnd, 9);
  assert.equal(api.getActiveComp(), "comp#1");
  assert.equal(api.get("comp#1", "endFrame"), 20);
  assert.equal(api.get(comp, "endFrame"), 20, "the source comp reaches the new end");
  assert.equal(api.get(comp, "playbackEnd"), 20, "its play range followed");
  assert.equal(api.getOutFrame(inner), 21, "its layers were extended");
  assert.equal(api.getOutFrame(mapLayer), 21);
  assert.ok(r.groupId);
});

// F13: newly added base layers must not bury an existing pin/label/extract - restack
// base layers below all overlays, ordered countries (lowest) ... cities (highest).
test("GeoScene.restackBaseLayers moves base layers to back in draw-order-descending order, never touching overlays", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene, DRAW_ORDER = context.DRAW_ORDER;
  const emptyEnc = { v: 1, kind: "polygon", f: [] };
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const countries = GeoScene.createMapLayer(map, "Countries", emptyEnc, { camera: map.cameraId, category: "countries" }, {}, {});
  const roads = GeoScene.createMapLayer(map, "Roads", { v: 1, kind: "line", f: [] }, { camera: map.cameraId, category: "roads" }, {}, {});
  const cities = GeoScene.createMapLayer(map, "Cities", { v: 1, kind: "point", f: [] }, { camera: map.cameraId, category: "cities" }, {}, {});
  const pin = GeoScene.addPin(map, "Pin", 0, 0);

  api._moveToBackCalls.length = 0;
  GeoScene.restackBaseLayers(map, DRAW_ORDER);

  assert.deepEqual(api._moveToBackCalls, [cities, roads, countries, oceanOf(api, map)], "base layers back to front, then the Ocean last");
  assert.ok(api._moveToBackCalls.indexOf(pin) < 0, "the pin (an overlay) should never be moved");
  const kids = api.getChildren(map.groupId);
  const pos = (id) => kids.indexOf(id);
  assert.ok(pos(pin) < pos(cities) && pos(cities) < pos(roads) && pos(roads) < pos(countries), "pin on top, then cities, roads, countries at the bottom");
  assert.equal(pos(countries), kids.length - 2, "countries at the bottom, just above the Ocean");
  assert.equal(pos(oceanOf(api, map)), kids.length - 1, "the Ocean stays under everything");
});

// F13: adding a base layer after imagery was built must not bury the imagery -
// restackBaseLayers sends imagery to the back after the base layers.
test("restackBaseLayers keeps imagery at the back of the map group even after a new base layer is added (F13)", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene, DRAW_ORDER = context.DRAW_ORDER;
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = GeoScene.planImagery(map, src, {});
  const built = GeoScene.buildImagery(map, src, {}, plan);
  GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  const kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 2], built.groupId, "imagery must still sit at the back of the map group, just above the Ocean");
});

test("GeoScene.restackBaseLayers is a no-op when api.moveToBack is unavailable", () => {
  const { context, api } = buildSandbox();
  delete api.moveToBack;
  const GeoScene = context.GeoScene, DRAW_ORDER = context.DRAW_ORDER;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  assert.doesNotThrow(() => GeoScene.restackBaseLayers(map, DRAW_ORDER));
});

// F14: the OSM credit text was landing partly outside the frame (centre/baseline
// anchored, default font size). It must get a smaller font size (only if the text
// layer actually has one) and sit fully inside the bottom-left corner.
test("GeoScene.createAttribution insets the position inside the frame and leaves fontSize alone when the attribute doesn't exist", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const id = GeoScene.createAttribution(map);
  // Cross-realm array from the vm sandbox: compare elements, not object identity/prototype.
  assert.deepEqual(Array.from(api.get(id, "position")), [-1920 / 2 + 200, -1080 / 2 + 40]);
  // This stub's text layers don't declare a fontSize attribute up front, matching
  // "never guess an attribute id": fontSize is only set when hasAttribute says so.
  assert.equal(api.hasAttribute(id, "fontSize"), false);
});

test("GeoScene.createAttribution sets fontSize to 24 when the text layer declares that attribute", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  // Pre-seed the next created id with a fontSize attribute by wrapping api.create once.
  const realCreate = api.create.bind(api);
  api.create = function (type, name) {
    const id = realCreate(type, name);
    api.set(id, { fontSize: 48 }); // pretend this layer type declares fontSize by default
    return id;
  };
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const id = GeoScene.createAttribution(map);
  assert.equal(api.get(id, "fontSize"), 24);
});

test("GeoScene.createLabel wires a visibility helper to the text's opacity", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 2 });
  const textId = GeoScene.createLabel(map, "Tokyo", 139.7, 35.7);
  const conns = api._connections.map((c) => Array.from(c));
  const toOpacity = conns.find((c) => c[2] === textId && c[3] === "opacity");
  const toPosition = conns.find((c) => c[2] === textId && c[3] === "position");
  assert.ok(toOpacity, "a helper drives the text's opacity");
  assert.ok(toPosition, "a helper drives the text's position");
  const vis = toOpacity[0], pos = toPosition[0];
  assert.notEqual(vis, pos);
  // The visibility helper follows the camera and reads its place from the position helper.
  for (let i = 0; i < 5; i++) assert.ok(conns.some((c) => c[0] === map.cameraId && c[1] === "array." + i && c[2] === vis && c[3] === "array." + i));
  assert.ok(conns.some((c) => c[0] === pos && c[1] === "array.5" && c[2] === vis && c[3] === "array.5"));
  assert.ok(conns.some((c) => c[0] === pos && c[1] === "array.6" && c[2] === vis && c[3] === "array.6"));
  assert.ok(String(api.get(vis, "expression")).includes("pointVisible"));
});

test("script layers get exactly one slot per input (no spare trailing slot)", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  assert.equal(api.hasAttribute(map.cameraId, "array.4"), true);
  assert.equal(api.hasAttribute(map.cameraId, "array.5"), false, "camera has 5 inputs, no n5");
  const pinId = GeoScene.addPin(map, "P", 0, 0);
  assert.equal(api.hasAttribute(pinId, "generator.array.6"), true);
  assert.equal(api.hasAttribute(pinId, "generator.array.7"), false, "map layer has 7 inputs, no n7");
});

test("default styles: countries show borders; states are border lines only", () => {
  const { context } = buildSandbox();
  const S = context.GeoScene.STYLE;
  assert.ok(S.countries.fill && S.countries.stroke && S.countries.width > 0, "countries: fill + border");
  assert.ok(!S.states.fill && S.states.stroke && S.states.width > 0, "states: lines only");
  assert.ok(S.states.width < S.countries.width, "state lines thinner than country borders");
  assert.equal(S.coastlines.width, 0.5, "coastlines default to a fine 0.5 line");
});

// The canvas uses the Map tab preview's palette, and each new map gets an Ocean layer
// (the composition background is the only "sea" otherwise).
function oceanOf(api, map) { return api.getChildren(map.groupId).find((id) => api.getNiceName(id) === "Ocean"); }

test("a new map gets an Ocean rectangle: twice the comp size, slate fill, last child of the group", () => {
  const { context, api } = buildSandbox();
  const map = context.GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const ocean = oceanOf(api, map);
  assert.ok(ocean, "an Ocean layer exists in the map group");
  assert.equal(api.getParent(ocean), map.groupId);
  assert.deepEqual(Array.from(api.get(ocean, "generator.dimensions")), [3840, 2160]);
  assert.equal(api.get(ocean, "material.materialColor"), "#1d2a33");
  const kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 1], ocean, "Ocean is at the bottom");
  assert.deepEqual(Object.keys(plain(map)).sort(), ["cameraId", "groupId", "name"], "createMap still returns just name/cameraId/groupId");
});

test("createMap skips the Ocean silently when api.primitive is missing", () => {
  const { context, api } = buildSandbox();
  delete api.primitive;
  const map = context.GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  assert.equal(oceanOf(api, map), undefined);
  assert.ok(map.groupId && map.cameraId);
});

test("the Ocean stays the last child after layers are added and restacked", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene, DRAW_ORDER = context.DRAW_ORDER;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const ocean = oceanOf(api, map);
  GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  GeoScene.addPin(map, "Pin", 0, 0);
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  let kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 1], ocean, "Ocean below the countries after a restack");
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 1], ocean, "and after another");
});

test("imagery is built above the Ocean, which stays at the very bottom", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene, DRAW_ORDER = context.DRAW_ORDER;
  const map = imageryMap(context, api, 4);
  const ocean = oceanOf(api, map);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const built = GeoScene.buildImagery(map, src, {}, GeoScene.planImagery(map, src, {}));
  let kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 1], ocean, "Ocean last after the imagery build");
  assert.equal(kids[kids.length - 2], built.groupId, "imagery sits directly above the Ocean");
  GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 1], ocean);
  assert.equal(kids[kids.length - 2], built.groupId);
});

test("default canvas styles use the preview's palette", () => {
  const { context } = buildSandbox();
  const S = context.GeoScene.STYLE;
  assert.equal(S.countries.fill, "#4a5a50");
  assert.equal(S.countries.stroke, "#2a3530");
  assert.equal(S.lakes.fill, "#1d2a33");
  assert.equal(S.rivers.stroke, "#3d6178");
  assert.equal(S.label.fill, "#e6e6e6");
  assert.equal(S.extractFill.fill, "#e4572e", "extracts keep their orange");
  assert.equal(S.extractLine.stroke, "#e4572e");
  assert.equal(S.pin.fill, "#1F8F4E", "pins use the panel's green");
  assert.equal(S.route.stroke, "#1F8F4E", "routes use the panel's green");
});

test("credit texts are light so they read on the dark map", () => {
  const { context, api } = buildSandbox();
  const map = context.GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const osm = context.GeoScene.createAttribution(map);
  const img = context.GeoScene.createImageryCredit(map, "Some credit");
  assert.equal(api.get(osm, "material.materialColor"), "#e6e6e6");
  assert.equal(api.get(img, "material.materialColor"), "#e6e6e6");
});

test("pins, route legs and route stop pins are drawn in the panel's green", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const pin = GeoScene.addPin(map, "Paris", 2.35, 48.85);
  assert.equal(api.get(pin, "material.materialColor"), "#1F8F4E");
  const r = GeoScene.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 }], { lift: 30, pins: true, labels: false });
  r.legs.forEach((leg) => assert.equal(api.get(leg, "stroke.strokeColor"), "#1F8F4E"));
  const stopPins = api.getChildren(r.groupId).filter((id) => String(api.getNiceName(id)).indexOf("Pin: ") === 0);
  assert.equal(stopPins.length, 2);
  stopPins.forEach((id) => assert.equal(api.get(id, "material.materialColor"), "#1F8F4E"));
});

// ---- Map styles: every map remembers its style and new layers follow it ----
function styledMap(context, styleName) {
  const style = context.GeoStyles.builtIn(styleName);
  return context.GeoScene.createMap("Styled", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 }, style);
}

test("map styles: a new map remembers Dark by default and its Ocean stays slate", () => {
  const { context, api } = buildSandbox();
  const map = context.GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const rec = plain(api.getUserDataKey(map.groupId, "geoStyle"));
  assert.equal(rec.name, "Dark");
  assert.equal(rec.colors.ocean, "#1d2a33");
  assert.equal(rec.widths.routes, 3);
  assert.equal(context.GeoScene.styleOf(map).name, "Dark");
});

test("map styles: a map made in Vintage draws its Ocean, pins, labels, credits and layers in Vintage", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = styledMap(context, "Vintage");
  assert.equal(api.get(oceanOf(api, map), "material.materialColor"), "#a9c4c0");
  assert.equal(api.get(G.addPin(map, "Here", 0, 0), "material.materialColor"), "#a63d2f");
  assert.equal(api.get(G.createLabel(map, "Here", 0, 0), "material.materialColor"), "#4a3423");
  assert.equal(api.get(G.createAttribution(map), "material.materialColor"), "#4a3423");
  assert.equal(api.get(G.createImageryCredit(map, "Credit"), "material.materialColor"), "#4a3423");
  const c = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  assert.equal(api.get(c, "material.materialColor"), "#e8d9b5");
  assert.equal(api.get(c, "stroke.strokeColor"), "#8b6b4a");
  assert.equal(api.get(c, "stroke.width"), 1.6);
});

test("map styles: new-style and old-style routes take the map's accent, route width and text colour", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = styledMap(context, "Blueprint");
  const r = G.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 }], { arc: 30, labels: true });
  r.legs.forEach((leg) => { assert.equal(api.get(leg, "stroke.strokeColor"), "#ffffff"); assert.equal(api.get(leg, "stroke.width"), 2); });
  r.stops.forEach((circle) => assert.equal(api.get(circle, "material.materialColor"), "#ffffff"));
  const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
  rec.stops.forEach((s) => assert.equal(api.get(s.label, "material.materialColor"), "#ffffff"));
  delete api.setGenerator;
  const old = G.createRoute(map, [{ name: "C", lon: 0, lat: 0 }, { name: "D", lon: 5, lat: 5 }], { lift: 30, pins: true, labels: false });
  old.legs.forEach((leg) => { assert.equal(api.get(leg, "stroke.strokeColor"), "#ffffff"); assert.equal(api.get(leg, "stroke.width"), 2); });
});

test("map styles: data layers take the map's text and ocean colours; bubbles keep their own", () => {
  const { context, api } = buildSandbox();
  const map = styledMap(context, "Light");
  const r = context.GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: true, labels: true, legend: true });
  assert.equal(api.get(r.layers.regions, "stroke.strokeColor"), "#cfe3ec");
  assert.equal(api.get(r.layers.regions, "stroke.width"), 0.5);
  assert.equal(api.get(r.layers.labels, "material.materialColor"), "#333333");
  assert.equal(api.get(r.layers.legend, "material.materialColor"), "#333333");
  assert.equal(api.get(r.layers.bubbles, "material.materialColor"), "#bc4749");
});

test("map styles: a map without a remembered style (made before styles) draws in Dark", () => {
  const { context, api } = buildSandbox();
  const map = styledMap(context, "Mono");
  api.setUserData(map.groupId, "geoStyle", null);
  assert.equal(context.GeoScene.styleOf(map).name, "Dark");
  assert.equal(api.get(context.GeoScene.addPin(map, "Here", 0, 0), "material.materialColor"), "#1F8F4E");
});

test("map styles: Add layers on the Layers tab draws in the picked map's style", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const map = styledMap(context, "Neon night");
  context.refreshMaps(map.cameraId);
  context.checks.countries.widget.onClick(); // ticks the Countries toggle, as the existing Add layers tests do
  context.addLayersBtn.onClick();
  const countries = context.GeoScene.findMapLayers(map).find((l) => l.meta.category === "countries");
  assert.ok(countries, context.statusLabel.getText());
  assert.equal(api.get(countries.id, "material.materialColor"), "#14142a");
  assert.equal(api.get(countries.id, "stroke.strokeColor"), "#2de2e6");
});

test("creating a map leaves the user's selection alone, even if Cavalry selects the new Ocean", () => {
  const { context, api } = buildSandbox();
  const realPrimitive = api.primitive.bind(api);
  api.primitive = function (kind, name) { const id = realPrimitive(kind, name); api.select([id]); return id; };
  api.select(["someone#1"]);
  context.GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  assert.deepEqual(Array.from(api.getSelection()), ["someone#1"]);
});

test("restacking does not touch the Ocean when it is already the last child", () => {
  const { context, api } = buildSandbox();
  const map = context.GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  api._moveToBackCalls.length = 0;
  api.select(["someone#1"]);
  context.GeoScene.restackBaseLayers(map, context.DRAW_ORDER);
  assert.deepEqual(api._moveToBackCalls, [], "no moveToBack when nothing needs moving");
  assert.deepEqual(Array.from(api.getSelection()), ["someone#1"]);
});

test("restackBaseLayers falls back to stepping backward when moveToBack does nothing, and restores the selection", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene, DRAW_ORDER = context.DRAW_ORDER;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const pin = GeoScene.addPin(map, "Pin", 0, 0);
  const countries = GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  api.moveToBack = function () {}; // pretend "to back" is a no-op
  api.select(["someone#1"]);
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  const kids = api.getChildren(map.groupId);
  assert.ok(kids.indexOf(pin) < kids.indexOf(countries), "countries stepped below the pin");
  assert.deepEqual(Array.from(api.getSelection()), ["someone#1"]);
});

test("createRoute builds a named group with one camera-linked leg per pair of stops", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const stops = [{ name: "Paris", lon: 2.35, lat: 48.85 }, { name: "Lyon", lon: 4.84, lat: 45.76 }, { name: "Marseille", lon: 5.37, lat: 43.3 }];
  const r = GeoScene.createRoute(map, stops, { lift: 40, pins: true, labels: false });
  assert.equal(api.getNiceName(r.groupId), "Route 1: Paris → Lyon → Marseille");
  assert.equal(api.getParent(r.groupId), map.groupId);
  assert.equal(r.legs.length, 2);
  assert.equal(api.getNiceName(r.legs[0]), "Leg 1: Paris → Lyon");
  assert.equal(api.getNiceName(r.legs[1]), "Leg 2: Lyon → Marseille");
  const conns = api._connections.map((c) => Array.from(c));
  r.legs.forEach((leg) => {
    assert.equal(api.getParent(leg), r.groupId);
    assert.equal(api.get(leg, "generator.array.7"), 40);
    for (let i = 0; i < 5; i++) assert.ok(conns.some((c) => c[0] === map.cameraId && c[1] === "array." + i && c[2] === leg && c[3] === "generator.array." + i));
    assert.ok(String(api.get(leg, "generator.expression")).includes("lift: _i7"));
  });
  const pins = api.getChildren(r.groupId).filter((id) => String(api.getNiceName(id)).startsWith("Pin: "));
  assert.equal(pins.length, 3);
});

test("createRoute refuses fewer than 2 stops and truncates long names", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  assert.throws(() => GeoScene.createRoute(map, [{ name: "A", lon: 0, lat: 0 }], { lift: 30 }), /at least 2 stops/);
  const long = ["Llanfairpwllgwyngyll", "Wolfeschlegelsteinhausen", "Taumatawhakatangihanga", "Bangkok"].map((n, i) => ({ name: n, lon: i, lat: i }));
  const r = GeoScene.createRoute(map, long, { lift: 30, pins: false, labels: false });
  const name = api.getNiceName(r.groupId);
  assert.ok(name.length <= 60 && name.endsWith("…"), name);
});

// F2: the sandbox has no map by default, so `currentMap()` used to throw before the
// 2-stop guard was ever reached, and the old regex also accepted "Create or pick a
// map" - meaning this test never actually exercised the guard it claimed to test.
test("Create route with fewer than 2 stops reports a clear message", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context); // so currentMap() succeeds
  context.stops.push({ name: "Paris", lon: 2.35, lat: 48.85 });
  context.refreshStops();
  context.createRouteBtn.onClick();
  assert.match(context.statusLabel.getText(), /at least 2 stops/);
  const routeGroups = api.getCompLayers().filter((id) => String(api.getNiceName(id)).indexOf("Route:") === 0);
  assert.equal(routeGroups.length, 0, "no route group should have been created");
});

test("route legs are not offered as Extract sources", () => {
  const { context } = buildSandbox();
  assert.ok(Array.from(context.NOT_EXTRACTABLE).indexOf("route") >= 0);
});

// I1: data layers are offered as Extract sources and Find/Bake on them threw a raw
// TypeError, since their GEO_DATA is {geo, series, ...}, not an encoded layer.
test("data layers are not offered as Extract sources", () => {
  const { context } = buildSandbox();
  assert.ok(Array.from(context.NOT_EXTRACTABLE).indexOf("data") >= 0);
});

test("GeoScene.bake refuses a data layer with a clear message instead of a raw TypeError", () => {
  const { context } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: false, labels: false, legend: false });
  assert.throws(() => GeoScene.bake(r.layers.regions), /Data layers can't be baked yet\./);
});

test("Bake selected layers: a mix of a real map layer and a data layer bakes the real one and skips the data layer with a status message, never a TypeError", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const countries = GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: false, labels: false, legend: false });
  api.select([countries, r.layers.regions]);
  assert.doesNotThrow(() => context.bakeBtn.onClick());
  assert.match(context.statusLabel.getText(), /Baked 1 layer/);
  assert.match(context.statusLabel.getText(), /skipped 1 data layer/i);
});

test("Bake selected layers: selecting a map group plus a real map layer bakes the layer and mentions skipping the group", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const countries = GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});

  // Select the map group and the countries layer
  api.select([map.groupId, countries]);
  assert.doesNotThrow(() => context.bakeBtn.onClick());
  assert.match(context.statusLabel.getText(), /Baked 1 layer/);
  assert.match(context.statusLabel.getText(), /Skipped 1 group\(s\) or other layer\(s\)/i);
});

test("Bake selected layers: selecting only a map group gives the appropriate error message", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });

  // Select only the map group
  api.select([map.groupId]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /Select Cavalry Geo map layers to bake \(groups and the camera can't be baked\)/);
});

test("Bake selected layers: selecting only a data layer gives the data layer error message", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: false, labels: false, legend: false });

  // Select only the data layer
  api.select([r.layers.regions]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /Data layers can't be baked yet\. Select map layers such as/i);
});

// F3: identical consecutive stops must not create an empty leg.
test("createRoute skips a leg between identical consecutive stops, no gap in numbering (F3)", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const stops = [
    { name: "Paris", lon: 2.35, lat: 48.85 },
    { name: "Paris again", lon: 2.35, lat: 48.85 },
    { name: "Lyon", lon: 4.84, lat: 45.76 }
  ];
  const r = GeoScene.createRoute(map, stops, { lift: 30 });
  assert.equal(r.legs.length, 1);
  assert.equal(api.getNiceName(r.legs[0]), "Leg 1: Paris again → Lyon");
});

test("createRoute throws when every consecutive pair of stops is identical (F3)", () => {
  const { context } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const stops = [
    { name: "Paris", lon: 2.35, lat: 48.85 },
    { name: "Paris again", lon: 2.35, lat: 48.85 }
  ];
  assert.throws(() => GeoScene.createRoute(map, stops, { lift: 30 }), /Add at least 2 different stops to make a route/);
});

test("createRoute creates at most one pin per distinct place on a round trip A -> B -> A (F3)", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const A_ = { name: "A", lon: 0, lat: 0 }, B_ = { name: "B", lon: 10, lat: 10 };
  const r = GeoScene.createRoute(map, [A_, B_, A_], { lift: 30, pins: true, labels: false });
  assert.equal(r.legs.length, 2);
  const pins = api.getChildren(r.groupId).filter((id) => String(api.getNiceName(id)).indexOf("Pin: ") === 0);
  assert.equal(pins.length, 2, "one pin at A, one at B");
});

test("createRoute creates at most one label per distinct place on a round trip A -> B -> A (F3)", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const GeoScene = context.GeoScene;
  // Force the simple (non-driver) label path so labels are plain map layers named "Label: ...".
  context.GeoAttrs.LABEL_MODE = "simple";
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const A_ = { name: "A", lon: 0, lat: 0 }, B_ = { name: "B", lon: 10, lat: 10 };
  const r = GeoScene.createRoute(map, [A_, B_, A_], { lift: 30, pins: false, labels: true });
  const labels = api.getChildren(r.groupId).filter((id) => String(api.getNiceName(id)).indexOf("Label: ") === 0);
  assert.equal(labels.length, 2, "one label at A, one at B");
});

// F3: the panel refuses adding a place identical to the current last stop.
test("Routes tab: Add stop refuses a place identical to the current last stop (F3)", () => {
  const { context } = buildSandbox();
  context.routeResults = [{ name: "Paris, France", lon: 2.35, lat: 48.85 }];
  context.routeResultPicker.setValue(0);
  context.addStopBtn.onClick();
  assert.equal(context.stops.length, 1);
  context.addStopBtn.onClick(); // same result still selected
  assert.equal(context.stops.length, 1, "duplicate stop must be refused");
  assert.equal(context.statusLabel.getText(), "That's already the last stop.");
});

function samplePrepared(context) {
  const C = context.GeoCodec;
  const geo = C.encodeLayer({ kind: "polygon", features: [{ name: "France", rank: 1, rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]], props: { iso3: "FRA", iso2: "FR", names: ["France"], label: [2.5, 46.7] } }] });
  const series = [[[2000, 60.9], [2020, 67.6]]];
  const range = { min: 60.9, max: 67.6, maxAbs: 67.6 };
  return { regions: { geo, series, range, years: [2000, 2020], title: "Population" }, points: { pts: [[2.5, 46.7, "France"]], series, range, years: [2000, 2020], title: "Population" }, matched: 1, unmatched: [], years: [2000, 2020], title: "Population" };
}

test("createDataLayers builds a group with regions, bubbles, labels and a connected legend", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: true, labels: true, legend: true, prefix: "", suffix: "M" });
  assert.equal(api.getNiceName(r.groupId), "Data: Population");
  assert.equal(api.getParent(r.groupId), map.groupId);
  const regions = r.layers.regions, legend = r.layers.legend;
  assert.equal(api.get(regions, "generator.array.7"), 2020, "year defaults to the latest year");
  assert.ok(String(api.get(regions, "generator.expression")).includes("GeoData.choropleth"));
  const conns = api._connections.map((c) => Array.from(c));
  for (let i = 0; i < 5; i++) assert.ok(conns.some((c) => c[0] === map.cameraId && c[2] === regions && c[3] === "generator.array." + i));
  const E = context.GeoExpression;
  E.LEGEND_INPUTS.forEach((inp, k) => {
    const from = "generator.array." + E.inputIndex(E.REGION_INPUTS, inp[0]);
    assert.ok(conns.some((c) => c[0] === regions && c[1] === from && c[2] === legend && c[3] === "generator.array." + k), inp[0]);
  });
  assert.equal(conns.some((c) => c[0] === map.cameraId && c[2] === legend), false, "legend is not camera-linked");
  assert.ok(String(api.get(r.layers.labels, "generator.expression")).includes('"suffix":"M"'));
  const meta = context.GeoExpression.readTag(String(api.get(regions, "generator.expression")), "GEO_META");
  assert.deepEqual(plain(meta.source), { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" });
});

// M5: the bubbles -> bubble-legend maxRadius connection used a hard-coded ".8" slot
// index; it must be derived from BUBBLE_INPUTS so it stays correct if inputs change.
test("createDataLayers connects the bubble legend's maxRadius from BUBBLE_INPUTS' actual index", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene, E = context.GeoExpression;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: false, bubbles: true, labels: false, legend: true });
  const idx = E.inputIndex(E.BUBBLE_INPUTS, "maxRadius");
  assert.equal(idx, 8);
  const conns = api._connections.map((c) => Array.from(c));
  assert.ok(conns.some((c) => c[0] === r.layers.bubbles && c[1] === "generator.array." + idx && c[2] === r.layers.legend && c[3] === "generator.array.0"));
});

test("refreshData re-downloads and rewrites the stored data, keeping inputs", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const prepared = samplePrepared(context);
  const choice = { placeColumn: "Code", placeKind: "iso3", nameColumn: "Entity", valueColumn: "Population", layout: "long", yearColumn: "Year" };
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice, scale: "50m" }, prepared, { regions: true, bubbles: false, labels: false, legend: false });
  context.GeoNet.fetchCsv = () => "Entity,Code,Year,Population\nFrance,FRA,2000,1\nFrance,FRA,2020,2\n";
  context.GeoNet.neLayer = () => prepared.regions.geo;
  api.set(r.layers.regions, { "generator.array.7": 2005 });
  const out = GeoScene.refreshData(map);
  assert.equal(out.layers, 1);
  const data = context.GeoExpression.readData(String(api.get(r.layers.regions, "generator.expression")));
  assert.deepEqual(plain(data.series[0]), [[2000, 1], [2020, 2]]);
  assert.equal(api.get(r.layers.regions, "generator.array.7"), 2005);
});

// I2: Refresh must keep places that were only found via "Look up unmatched names as
// places" - the source must remember lookup was used, and refreshData must redo the
// lookup for whatever is still unmatched after a plain prepare.
test("Refresh keeps places found by 'Look up unmatched names as places' (I2)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const geo = context.GeoCodec.encodeLayer({ kind: "polygon", features: [] });
  context.GeoNet.fetchCsv = () => "Location,Visitors\nParis,30\n";
  context.GeoNet.neLayer = () => geo;
  context.GeoNet.geocodePlaces = (names) => { const out = {}; names.forEach((n) => { if (n === "Paris") out[n] = [2.35, 48.85]; }); return out; };
  context.dataLinkField.setText("https://example.com/cities.csv");
  context.dataLoadBtn.onClick();
  context.lookupCheck.setValue(true);
  context.addDataBtn.onClick();
  assert.match(context.statusLabel.getText(), /Added/);
  const bubbles = api.getCompLayers(false).find((id) => String(api.getNiceName(id)).startsWith("Regions: ") || String(api.getNiceName(id)).startsWith("Bubbles: "));
  assert.ok(bubbles, "a data layer should have been created for the geocoded place");
  const meta = context.GeoExpression.readTag(String(api.get(bubbles, "generator.expression")), "GEO_META");
  assert.equal(meta.source.lookup, true, "the source must remember the lookup checkbox was used");

  const map = context.currentMap();
  const out = context.GeoScene.refreshData(map);
  assert.equal(out.matched, 1, "refresh should redo the lookup and keep the geocoded place");
  assert.deepEqual(Array.from(out.unmatched), []);
});

// M4: a refresh that matches nothing must not rewrite that source's layers, and must
// give a clear error naming the source url instead of silently wiping the data.
test("refreshData throws and leaves layers untouched when a source's refresh matches nothing (M4)", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("World", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const prepared = samplePrepared(context);
  const choice = { placeColumn: "Code", placeKind: "iso3", nameColumn: "Entity", valueColumn: "Population", layout: "long", yearColumn: "Year" };
  const r = GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice, scale: "50m" }, prepared, { regions: true, bubbles: false, labels: false, legend: false });
  const before = String(api.get(r.layers.regions, "generator.expression"));
  context.GeoNet.fetchCsv = () => "Entity,Code,Year,Population\nNowhere,ZZZ,2000,1\n";
  context.GeoNet.neLayer = () => prepared.regions.geo;
  assert.throws(() => GeoScene.refreshData(map), /Refresh found no matching places in https:\/\/x\/y\.csv.*nothing was changed/);
  assert.equal(String(api.get(r.layers.regions, "generator.expression")), before, "the layer's data must be untouched");
});

test("Data tab: Load detects columns and reports matches; Add to map creates layers", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const geo = context.GeoCodec.encodeLayer({ kind: "polygon", features: [{ name: "France", rank: 1, rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]], props: { iso3: "FRA", iso2: "FR", names: ["France"], label: [2.5, 46.7] } }] });
  context.GeoNet.fetchCsv = () => "Entity,Code,Year,Population\nFrance,FRA,2000,60.9\nFrance,FRA,2020,67.6\nWorld,OWID_WRL,2020,7800\n";
  context.GeoNet.neLayer = () => geo;
  context.dataLinkField.setText("https://docs.google.com/spreadsheets/d/X/edit");
  context.dataLoadBtn.onClick();
  assert.match(context.statusLabel.getText(), /3 rows, 1 place\(s\) matched, 1 unmatched/);
  context.addDataBtn.onClick();
  assert.match(context.statusLabel.getText(), /Added/);
  assert.ok(api.getCompLayers(false).some((id) => String(api.getNiceName(id)).startsWith("Regions: Population")));
});

function imageryMap(context, api, zoom) {
  const map = context.GeoScene.createMap("World", { lat: 0, lon: 0, zoom: zoom, rotation: 0, projection: 0 });
  return map;
}

// The tile path (MapTiler/Mapbox/custom) tested with EOX's tile URLs: a copy without `wms`.
function tileSource(context) { return Object.assign({}, context.GeoSources.byId("eox"), { wms: undefined }); }

test("planImagery for EOX plans large images: one per 8x8 block, cropped", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset(); // large images need background downloads
  const map = imageryMap(context, api, 4);
  const plan = context.GeoScene.planImagery(map, context.GeoSources.byId("eox"), {});
  assert.equal(plan.mode, "images");
  assert.equal(plan.tiles.length, 48);
  assert.deepEqual(plain(plan.items), plain(context.GeoBlocks.blocksForTiles(plan.tiles)));
  assert.ok(plan.items.length >= 2 && plan.items.length <= 4, String(plan.items.length));
  assert.equal(plan.missing.length, plan.items.length);
  assert.equal(context.GeoScene.itemBase(plan, plan.items[0]),
    context.GeoNet.imageBase("eox", plan.items[0]));
  assert.match(context.GeoScene.itemUrl(context.GeoSources.byId("eox"), {}, plan, plan.items[0]), /^https:\/\/tiles\.maps\.eox\.at\/wms\?/);
});

test("planImagery caps image plans by image count and by tiles' worth", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset(); // large images need background downloads
  const map = imageryMap(context, api, 4);
  const asked = [];
  context.GeoTiles.tileSet = function (samples, w, h, minZoom, maxZoom) {
    asked.push(maxZoom);
    const hi = Math.min(maxZoom, 10), tiles = [];
    for (let L = 4; L <= hi; L++) for (let i = 0; i < 400; i++) tiles.push({ z: L, x: i % 20, y: Math.floor(i / 20) });
    return { tiles, lo: 4, hi, frames: 1 };
  };
  const plan = context.GeoScene.planImagery(map, context.GeoSources.byId("eox"), {});
  assert.ok(plan.tiles.length <= context.GeoBlocks.MAX_IMAGE_TILES);
  assert.equal(plan.imageTiles, context.GeoBlocks.totalTiles(plan.items));
  assert.ok(plan.imageTiles <= context.GeoBlocks.MAX_IMAGE_TILES);
  assert.ok(plan.items.length <= context.GeoBlocks.MAX_IMAGES);
  assert.equal(plan.cappedZoom, plan.hi);
  assert.equal(plan.uncappedTiles, 2800);
});

// Images are cropped to the bounding box of the tiles they need, so sparse tiles download
// (and hold in memory) more than their count: the limit counts the pixels really fetched (F6).
test("planImagery names the tiles' worth limit, counted as the images' own tiles' worth (F6)", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset(); // large images need background downloads
  const map = imageryMap(context, api, 4);
  const tiles = [];
  for (let i = 0; i < 1200; i++) tiles.push({ z: 6, x: (i % 25) * 2, y: Math.floor(i / 25) });
  context.GeoTiles.tileSet = function () { return { tiles, lo: 6, hi: 6, frames: 1 }; };
  const worth = context.GeoBlocks.totalTiles(context.GeoBlocks.blocksForTiles(tiles));
  assert.ok(tiles.length < 2000 && worth > 2000, String(worth));
  assert.throws(() => context.GeoScene.planImagery(map, context.GeoSources.byId("eox"), {}),
    new RegExp("^Error: Too many tiles' worth of images \\(" + worth + "\\) — end the flight at a lower zoom or use a smaller composition\\.$"));
});

test("planImagery treats files left in the in-flight list as missing", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = context.GeoSources.byId("eox");
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const first = context.GeoScene.planImagery(map, src, {});
  assert.equal(first.missing.length, 0);
  context.GeoFetch.leftovers = () => [context.GeoScene.itemBase(first, first.items[0]) + ".jpg"];
  const second = context.GeoScene.planImagery(map, src, {});
  assert.deepEqual(plain(second.missing), [plain(first.items[0])]);
});

// Imagery reuse: a saved image of the same block that already covers a missing crop is used.
function savedCrop(context, api, plan, r) {
  const B = context.GeoBlocks.BLOCK, big = { z: r.z, x0: Math.floor(r.x0 / B) * B, y0: Math.floor(r.y0 / B) * B, x1: Math.floor(r.x0 / B) * B + B - 1, y1: Math.floor(r.y0 / B) * B + B - 1 };
  const base = context.GeoNet.imageBase(plan.cacheKey, big);
  api._files[base.slice(0, base.lastIndexOf("/"))] = "<dir>";
  api._files[base + ".jpg"] = "<image>";
  return big;
}

test("planImagery reuses a saved bigger crop of the block instead of downloading again", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset();
  const map = imageryMap(context, api, 4), src = context.GeoSources.byId("eox");
  const first = context.GeoScene.planImagery(map, src, {});
  const r = first.items[0], big = savedCrop(context, api, first, r);
  assert.ok(context.GeoBlocks.rectTiles(big) > context.GeoBlocks.rectTiles(r));
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.reused, 1);
  assert.deepEqual(plain(plan.items[0]), plain(big));
  assert.equal(plan.items.length, first.items.length);
  assert.equal(plan.missing.length, first.items.length - 1);
  assert.equal(plan.cached, 1);
  assert.equal(plan.imageTiles, context.GeoBlocks.totalTiles(plan.items));
  assert.ok(!plain(plan.missing).some((m) => m.x0 === big.x0 && m.y0 === big.y0 && m.z === big.z));
  // The build places the footage from the saved image's own area.
  const built = context.GeoScene.buildImagery(map, src, {}, plan);
  const level = levelGroup(api, built.groupId, big.z), kids = api.getChildren(level);
  assert.equal(kids.length, 1);
  const origin = context.GeoBlocks.levelOrigin([big]), px = context.GeoBlocks.rectPixels(big);
  assert.equal(api.get(kids[0], "position.x") + "," + api.get(kids[0], "position.y"), context.GeoBlocks.rectLocal(big, origin).join(","));
  assert.equal(api.get(kids[0], "scale.x"), (px[0] + 4) / px[0]);
  assert.equal(api.get(kids[0], "scale.y"), (px[1] + 4) / px[1]);
});

test("planImagery does not reuse a saved image still in flight, or without a folder listing", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset();
  const map = imageryMap(context, api, 4), src = context.GeoSources.byId("eox");
  const first = context.GeoScene.planImagery(map, src, {});
  const big = savedCrop(context, api, first, first.items[0]);
  context.GeoFetch.leftovers = () => [context.GeoNet.imageBase(first.cacheKey, big) + ".jpg"];
  let plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.reused, 0);
  assert.deepEqual(plain(plan.items), plain(first.items));
  context.GeoFetch.leftovers = () => [];
  delete api.listDirectory;
  plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.reused, 0);
  assert.deepEqual(plain(plan.missing), plain(first.items));
});

test("buildImagery places one footage per image at the rect centre with a 2-px seam overlap", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset(); // large images need background downloads
  const map = imageryMap(context, api, 4);
  const src = context.GeoSources.byId("eox");
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(r.tiles, plan.items.length);
  const level = levelGroup(api, r.groupId, 4);
  const origin = context.GeoBlocks.levelOrigin(plan.items);
  const kids = api.getChildren(level);
  const expected = Array.from(plan.items, (it) => context.GeoBlocks.rectLocal(it, origin).join(",")).sort();
  assert.deepEqual(kids.map((id) => api.get(id, "position.x") + "," + api.get(id, "position.y")).sort(), expected);
  kids.forEach((id) => {
    const it = plan.items.find((i) => context.GeoBlocks.rectLocal(i, origin).join(",") === api.get(id, "position.x") + "," + api.get(id, "position.y"));
    const px = context.GeoBlocks.rectPixels(it);
    assert.equal(api.get(id, "scale.x"), (px[0] + 4) / px[0]);
    assert.equal(api.get(id, "scale.y"), (px[1] + 4) / px[1]);
  });
});

// F7: sampling every frame of the comp is wasteful and wrong once the camera is only
// keyed over part of it - only the keyed range (clamped to the comp) should be sampled.
test("sampleCamera samples only the keyed camera range, clamped to the comp frame range (F7)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  api.keyframe(map.cameraId, 2, { "array.2": 4 });
  api.keyframe(map.cameraId, 5, { "array.2": 6 });
  const samples = context.GeoScene.sampleCamera(map);
  assert.equal(samples.length, 4, "frames 2, 3, 4, 5");
});

test("sampleCamera samples just the current frame when the camera has no keyframes (F7)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  api.setFrame(3);
  const samples = context.GeoScene.sampleCamera(map);
  assert.equal(samples.length, 1);
  assert.equal(api.getFrame(), 3, "playhead restored");
});

test("planImagery samples every frame and lists missing tiles", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  api.setFrame(3);
  const src = tileSource(context);
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.tiles.length, 48);
  assert.equal(plan.missing.length, 48);
  assert.equal(plan.cacheKey, "eox");
  assert.deepEqual([plan.lo, plan.hi], [4, 4]);
  assert.equal(api.getFrame(), 3, "playhead restored");
  api.set(map.cameraId, { "array.4": 1 });
  assert.equal(context.GeoScene.planImagery(map, src, {}).bent, true, "Equal Earth plans bent imagery (with the plugin)");
});

test("planImagery refuses a plan over the tile cap with the updated message (F1)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  const realTileSet = context.GeoTiles.tileSet;
  context.GeoTiles.tileSet = function () {
    var tiles = [];
    for (var i = 0; i < 301; i++) tiles.push({ z: 4, x: i, y: 0 });
    return { tiles: tiles, lo: 4, hi: 4, frames: 1 };
  };
  assert.throws(() => context.GeoScene.planImagery(map, src, {}),
    /Too many tiles \(301\) — end the flight at a lower zoom or use a smaller composition\.$/);
  context.GeoTiles.tileSet = realTileSet;
});

// A fake tile set: levels 4..min(maxZoom, 10), perLevel tiles each. Records each maxZoom asked for.
function fakeLevelTileSet(context, perLevel, asked) {
  context.GeoTiles.tileSet = function (samples, w, h, minZoom, maxZoom) {
    asked.push(maxZoom);
    var hi = Math.min(maxZoom, 10), tiles = [];
    for (var L = 4; L <= hi; L++) for (var i = 0; i < perLevel; i++) tiles.push({ z: L, x: i, y: 0 });
    return { tiles: tiles, lo: 4, hi: hi, frames: 1 };
  };
}

test("planImagery caps the sharpest level until the plan fits under the tile limit", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  const asked = [];
  fakeLevelTileSet(context, 100, asked);
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.deepEqual(asked, [15, 9, 8, 7, 6], "each retry drops one level below the last top level used");
  assert.equal(plan.tiles.length, 300);
  assert.deepEqual([plan.lo, plan.hi], [4, 6]);
  assert.equal(plan.cappedZoom, 6);
  assert.equal(plan.uncappedTiles, 700);
});

test("planImagery leaves cappedZoom unset when the plan already fits", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const plan = context.GeoScene.planImagery(map, tileSource(context), {});
  assert.equal(plan.tiles.length, 48);
  assert.equal(plan.cappedZoom, undefined);
  assert.equal(plan.uncappedTiles, undefined);
});

test("planImagery refuses when even the lowest level used alone is over the limit", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const asked = [];
  fakeLevelTileSet(context, 400, asked);
  assert.throws(() => context.GeoScene.planImagery(map, tileSource(context), {}),
    /^Error: Too many tiles \(400\) — end the flight at a lower zoom or use a smaller composition\.$/);
  assert.equal(asked[asked.length - 1], 4);
});

// A world-to-city flight keyed on every frame (the fake api holds keyed values, so key each frame).
function keyFlight(api, map, from, to, frames = 10) {
  for (let f = 0; f < frames; f++) api.keyframe(map.cameraId, f, { "array.0": 48.85, "array.1": 2.35, "array.2": from + (to - from) * f / (frames - 1) });
}

test("planImagery caps a real world-to-city flight under the tile limit", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 2);
  keyFlight(api, map, 2, 15);
  context.GeoScene.setCamera(map.cameraId, { rotation: 45 }); // a turned view needs about twice the tiles
  const plan = context.GeoScene.planImagery(map, tileSource(context), {});
  assert.ok(plan.tiles.length <= context.GeoTiles.MAX_TILES, String(plan.tiles.length));
  assert.ok(plan.uncappedTiles > context.GeoTiles.MAX_TILES, String(plan.uncappedTiles));
  assert.ok(plan.cappedZoom < 15, String(plan.cappedZoom));
  assert.equal(plan.hi, plan.cappedZoom);
});

test("buildImagery creates levels, drivers and tiles at the back of the map, and rebuild replaces it", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(r.tiles, 48);
  assert.equal(r.levels, 1);
  assert.equal(api.getNiceName(r.groupId), "Imagery: EOX Sentinel-2");
  const kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 2], r.groupId, "imagery at the back of the map group, above the Ocean");
  const level = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "z 4");
  assert.ok(level);
  assert.equal(api.getChildren(level).length, 48);
  const conns = api._connections.map((c) => Array.from(c));
  assert.ok(conns.some((c) => c[2] === r.groupId && c[3] === "rotation.z"));
  ["position", "scale", "opacity"].forEach((a) => assert.ok(conns.some((c) => c[2] === level && c[3] === a), a));
  assert.equal(context.GeoScene.findImagery(map).length, 1);
  assert.equal(api.getAssetWindowLayers().length, 48);
  const again = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(context.GeoScene.findImagery(map).length, 1, "old imagery deleted");
  assert.equal(api.layerExists(r.groupId), false);
  assert.equal(api.getAssetWindowLayers().length, 48, "assets reused");
  assert.ok(api.layerExists(again.groupId));
});

test("buildImagery uses only the levels that actually have files for the opacity fade range (F2)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4.9); // visible levels [4, 5]
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => (/\/tiles\/eox\/5\//.test(base) ? null : base + ".jpg");
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.deepEqual([plan.lo, plan.hi], [4, 5]);
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(r.levels, 1, "level 5 has no files and is skipped");
  const driver = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "Imagery driver: z 4 opacity");
  assert.ok(driver);
  const expr = String(api.get(driver, "expression"));
  assert.ok(expr.includes("GeoTiles.levelOpacity(_i2, 4, 4, 4, _i4)"), expr);
  const T = require("../src/core/tiles.js");
  assert.equal(T.levelOpacity(5.2, 4, 4, 4, 0), 100, "z 4 must stay opaque past its old fade-out point since it's now the highest built level");
});

test("512-px sources are placed at half scale; tiles without files are skipped", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = context.GeoSources.byId("maptiler");
  let n = 0;
  context.GeoNet.cachedTile = (base) => (n++ % 2 ? base + ".png" : null);
  const plan = context.GeoScene.planImagery(map, src, { key: "K", style: "streets-v2" });
  const r = context.GeoScene.buildImagery(map, src, { key: "K", style: "streets-v2" }, plan);
  assert.equal(r.tiles, 24);
  const level = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "z 4");
  const tile = api.getChildren(level)[0];
  assert.equal(api.get(tile, "scale.x"), 0.5 * 260 / 256);
});

// F11: neighbouring tiles must overlap by about 1px to avoid hairline seams, so scale
// is always set (never skipped just because the base scale is 1).
test("buildImagery scales every tile by 260/256 (times 0.5 for 512px sources) to avoid hairline seams (F11)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context); // 256px source, base scale 1
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  const level = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "z 4");
  const tile = api.getChildren(level)[0];
  assert.equal(api.get(tile, "scale.x"), 260 / 256);
  assert.equal(api.get(tile, "scale.y"), 260 / 256);
});

// Item 1 (live test): api.parent keeps the WORLD transform, so a layer must be parented
// first and its local transform set afterwards - otherwise it lands offset/rotated.
test("buildImagery parents layers before setting their local transforms (parent keeps world transform)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const realParent = api.parent.bind(api);
  api.parent = function (id, parentId) {
    const changed = api.getParent(id) !== parentId;
    realParent(id, parentId);
    if (changed && !/^javaScript/.test(String(id))) { // emulate Cavalry compensating the local transform
      api.set(id, { "position.x": (api.get(id, "position.x") || 0) + 1000, "position.y": (api.get(id, "position.y") || 0) - 700, "rotation.z": 30 });
    }
  };
  const plan = context.GeoScene.planImagery(map, src, {});
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(api.get(r.groupId, "position.x"), 0, "outer imagery group local position must be reset after parenting");
  assert.equal(api.get(r.groupId, "position.y"), 0);
  const level = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "z 4");
  assert.equal(api.get(level, "rotation.z"), 0, "level group local rotation must be reset after parenting");
  assert.equal(api.get(level, "position.x"), 0);
  assert.equal(api.get(level, "position.y"), 0);
  const tiles = plan.tiles.filter((t) => t.z === 4);
  const origin = context.GeoTiles.levelOrigin(tiles);
  const kids = api.getChildren(level);
  assert.equal(kids.length, 48);
  kids.forEach((id) => assert.equal(api.get(id, "rotation.z"), 0, "tile rotation"));
  const expected = tiles.map((t) => { const p = context.GeoTiles.tileLocal(t, origin); return p[0] + "," + p[1]; }).sort();
  const actual = kids.map((id) => api.get(id, "position.x") + "," + api.get(id, "position.y")).sort();
  assert.deepEqual(Array.from(actual), Array.from(expected));
});

// Item 3: palette PNGs load with resolution {x:0,y:0} and draw nothing.
function zeroResolutionFor(api, isBad) {
  const realAdd = api.addAssetToComp.bind(api);
  api.addAssetToComp = function (assetId) {
    const id = realAdd(assetId);
    api.set(id, { resolution: isBad(api.getAssetFilePath(assetId)) ? { x: 0, y: 0 } : { x: 256, y: 256 } });
    return id;
  };
}

test("buildImagery removes unreadable (zero-resolution) tiles and reports them as unreadable", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  const bad = plan.tiles.slice(0, 3).map((t) => context.GeoNet.tileBase(plan.cacheKey, t.z, t.x, t.y) + ".jpg");
  const deleted = [];
  const realDelete = api.deleteLayer.bind(api);
  api.deleteLayer = function (id) { deleted.push(id); return realDelete(id); };
  zeroResolutionFor(api, (p) => bad.indexOf(p) >= 0);
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(r.tiles, 45);
  assert.equal(r.unreadable, 3);
  assert.equal(deleted.length, 3, "only the unreadable footage layers are deleted");
  const level = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "z 4");
  assert.equal(api.getChildren(level).length, 45);
});

test("buildImagery's built-level range ignores a level whose tiles are all unreadable", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4.9); // visible levels [4, 5]
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.deepEqual([plan.lo, plan.hi], [4, 5]);
  zeroResolutionFor(api, (p) => /\/tiles\/eox\/5\//.test(p));
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(r.levels, 1);
  assert.ok(r.unreadable > 0);
  const driver = api.getChildren(r.groupId).find((id) => api.getNiceName(id) === "Imagery driver: z 4 opacity");
  const expr = String(api.get(driver, "expression"));
  assert.ok(expr.includes("GeoTiles.levelOpacity(_i2, 4, 4, 4, _i4)"), expr);
});

test("Imagery tab: the status line mentions tiles Cavalry couldn't read", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  zeroResolutionFor(api, () => true);
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  runTimers(api);
  assert.match(context.statusLabel.getText(), /\d+ tiles couldn't be read by Cavalry \(palette PNGs\) — choose a JPG style or link\./);
});

// F12: the nested source-identifying meta must be named 'sourceMeta', not the generic
// 'meta', to avoid ambiguity before shipping v0.4.0.
test("buildImagery's GEO_META nests the source info under 'sourceMeta' (F12)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = context.GeoSources.byId("maptiler");
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, { key: "K", style: "streets-v2" });
  context.GeoScene.buildImagery(map, src, { key: "K", style: "streets-v2" }, plan);
  const info = context.GeoScene.findImagery(map)[0];
  assert.deepEqual(plain(info.meta.sourceMeta), { source: "maptiler", style: "streets-v2" });
  assert.equal(info.meta.meta, undefined);
});

// F4: buildImagery must be atomic - a throw partway through a rebuild must not leave
// the old imagery deleted with a half-built group orphaned at the comp root.
test("buildImagery is atomic: a throw mid-rebuild leaves the old imagery intact and cleans up the failed attempt (F4)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  const first = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.ok(api.layerExists(first.groupId));

  let calls = 0;
  const realAdd = api.addAssetToComp.bind(api);
  api.addAssetToComp = function (assetId) {
    calls++;
    if (calls === 3) throw new Error("boom");
    return realAdd(assetId);
  };
  assert.throws(() => context.GeoScene.buildImagery(map, src, {}, plan), /boom/);
  assert.ok(api.layerExists(first.groupId), "old imagery group must still exist");
  const imageryGroups = api.getCompLayers(false).filter((id) => String(api.getNiceName(id)).indexOf("Imagery:") === 0);
  assert.deepEqual(imageryGroups, [first.groupId], "the failed rebuild's group must be fully cleaned up, leaving only the old one");
});

// ---- Chunked imagery build (beginImageryBuild) ----------------------------------
// A zero budget still does one unit of work per step, so these tests see every step.
function imageryFixture() {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  return { context, api, map, src, plan };
}
function imageryGroups(api) {
  return api.getCompLayers(false).filter((id) => String(api.getNiceName(id)).indexOf("Imagery:") === 0);
}
function footageCount(api) {
  return api.getCompLayers(false).filter((id) => /^footageShape#/.test(id)).length;
}
function stepToEnd(job, budget, each) {
  const out = [];
  let r;
  do { r = job.step(budget); out.push(r); if (each) each(r); } while (!r.done && out.length < 10000);
  return out;
}
function levelGroup(api, groupId, L) { return api.getChildren(groupId).find((id) => api.getNiceName(id) === "z " + L); }

test("beginImageryBuild adds one tile per zero-budget step and keeps the new group hidden until its drivers are connected", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  const first = job.step(0);
  assert.deepEqual([first.done, first.phase, first.built, first.total], [false, "tiles", 1, 48]);
  const outer = imageryGroups(api)[0];
  assert.equal(api.getParent(outer), map.groupId, "the outer group is parented into the map on the first step");
  assert.equal(api.get(outer, "hidden"), true, "half-built imagery never renders");
  let built = 1;
  const steps = stepToEnd(job, 0, (r) => {
    if (r.done) return;
    if (r.phase === "tiles") { assert.equal(r.built, ++built); assert.equal(api.get(outer, "hidden"), true); }
  });
  const last = steps[steps.length - 1];
  assert.ok(steps.length >= 48, "48 tiles over at least 48 steps");
  assert.equal(last.done, true);
  assert.equal(last.built, 48);
  assert.equal(last.total, 48);
  assert.deepEqual(plain(last.result), { groupId: outer, tiles: 48, levels: 1, unreadable: 0 });
  assert.equal(api.get(outer, "hidden"), false, "shown once the build is complete");
  assert.equal(api.getChildren(levelGroup(api, outer, 4)).length, 48);
  const kids = api.getChildren(map.groupId);
  assert.equal(kids[kids.length - 2], outer, "imagery at the back of the map group, above the Ocean");
});

// Measured in Cavalry: every step that loads an asset costs a ~3.6 s rescan afterwards,
// however many it loads, so all of a build's assets load in the first step.
test("beginImageryBuild loads every tile's asset in the first step", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const loads = [];
  const realLoad = api.loadAsset.bind(api);
  api.loadAsset = function (p, b) { loads.push(p); return realLoad(p, b); };
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  job.step(0);
  assert.equal(loads.length, 48, "all 48 assets after the first step");
  stepToEnd(job, 0);
  assert.equal(loads.length, 48, "no asset loads in later steps");
});

// Closing the panel mid-build stops its timer and abandons the job: the half-built
// group must still be findable so the next build removes it.
test("an abandoned half-built imagery group is removed by the next build", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const abandoned = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  abandoned.step(0); abandoned.step(0); abandoned.step(0);
  assert.equal(imageryGroups(api).length, 1);
  assert.equal(context.GeoScene.findImagery(map).length, 1, "the half-built group is findable");
  stepToEnd(context.GeoScene.beginImageryBuild(map, src, {}, plan), 0);
  assert.equal(imageryGroups(api).length, 1, "only the new imagery is left");
});

test("beginImageryBuild restores the user's selection when it finishes", () => {
  const { context, api, map, src, plan } = imageryFixture();
  api.select([map.cameraId]);
  stepToEnd(context.GeoScene.beginImageryBuild(map, src, {}, plan), 0);
  assert.deepEqual(Array.from(api.getSelection()), [map.cameraId]);
});

test("beginImageryBuild: an unbounded step does everything at once, like buildImagery", () => {
  const { context, map, src, plan } = imageryFixture();
  const r = context.GeoScene.beginImageryBuild(map, src, {}, plan).step(Infinity);
  assert.equal(r.done, true);
  assert.equal(r.result.tiles, 48);
});

test("cancelling mid-build discards the new imagery in steps and leaves the old imagery untouched", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const old = context.GeoScene.buildImagery(map, src, {}, plan);
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  for (let i = 0; i < 5; i++) job.step(0);
  assert.equal(footageCount(api), 53);
  job.cancel();
  const steps = stepToEnd(job, 0);
  const last = steps[steps.length - 1];
  assert.ok(steps.length > 1, "the partial imagery is deleted over several steps");
  assert.equal(last.done, true);
  assert.equal(last.cancelled, true);
  assert.equal(last.result, undefined);
  assert.deepEqual(imageryGroups(api), [old.groupId], "only the old imagery group is left");
  assert.equal(footageCount(api), 48);
  assert.equal(api.getChildren(levelGroup(api, old.groupId, 4)).length, 48);
  assert.equal(context.GeoScene.findImagery(map).length, 1);
});

test("cancelling before the first step builds nothing", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  job.cancel();
  const r = job.step(0);
  assert.equal(r.done, true);
  assert.equal(r.cancelled, true);
  assert.deepEqual(imageryGroups(api), []);
});

test("the old imagery is hidden and deleted in steps only after the new imagery is complete", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const old = context.GeoScene.buildImagery(map, src, {}, plan);
  const deleted = [];
  const realDelete = api.deleteLayer.bind(api);
  api.deleteLayer = function (id) { deleted.push(id); return realDelete(id); };
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  let sawCleanup = false, cleanupSteps = 0;
  const steps = stepToEnd(job, 0, (r) => {
    if (r.phase !== "cleanup" || r.done) {
      if (!r.done) {
        assert.equal(deleted.length, 0, "nothing of the old imagery is deleted before the new one is complete");
        assert.equal(api.getChildren(levelGroup(api, old.groupId, 4)).length, 48);
      }
      return;
    }
    cleanupSteps++;
    if (!sawCleanup) {
      sawCleanup = true;
      const fresh = imageryGroups(api).find((id) => id !== old.groupId);
      assert.equal(api.getChildren(levelGroup(api, fresh, 4)).length, 48, "new imagery complete before cleanup starts");
      assert.equal(api.get(fresh, "hidden"), false);
      assert.equal(api.get(old.groupId, "hidden"), true, "the old imagery is hidden while it is taken apart");
    }
  });
  const last = steps[steps.length - 1];
  assert.ok(sawCleanup);
  assert.ok(cleanupSteps > 10, "old tiles are deleted a few at a time, not in one call");
  assert.equal(api.layerExists(old.groupId), false);
  assert.ok(deleted.indexOf(old.groupId) >= 0);
  assert.equal(last.result.tiles, 48);
  assert.deepEqual(imageryGroups(api), [last.result.groupId]);
  assert.equal(footageCount(api), 48);
  assert.equal(context.GeoScene.findImagery(map).length, 1);
});

test("cancel during cleanup lets the cleanup finish: the new imagery is kept", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const old = context.GeoScene.buildImagery(map, src, {}, plan);
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  let r;
  do { r = job.step(0); } while (r.phase !== "cleanup");
  job.step(0);
  job.cancel();
  const steps = stepToEnd(job, 0);
  const last = steps[steps.length - 1];
  assert.equal(last.cancelled, undefined);
  assert.equal(last.result.tiles, 48);
  assert.equal(api.layerExists(old.groupId), false);
  assert.deepEqual(imageryGroups(api), [last.result.groupId]);
});

test("an error in a build step tears down the new group and keeps the old imagery", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const old = context.GeoScene.buildImagery(map, src, {}, plan);
  let calls = 0;
  const realAdd = api.addAssetToComp.bind(api);
  api.addAssetToComp = function (assetId) { if (++calls === 3) throw new Error("boom"); return realAdd(assetId); };
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  job.step(0);
  job.step(0);
  assert.throws(() => job.step(0), /boom/);
  assert.deepEqual(imageryGroups(api), [old.groupId]);
  assert.equal(footageCount(api), 48);
});

// ---- Bent imagery (globe / Equal Earth): source composition + reproject filter ----------
const PLUGIN_MISSING = "Imagery on the globe and Equal Earth needs the Cavalry Geo Reproject plugin: drag the CavalryGeo_plugin folder from the download into the Cavalry window once, then press Build imagery again.";
const VIEW_WHICH = ["position", "scale", "maskSize", "viewScale", "viewOffset"];
// A globe camera at lon 170 sees across the date line (tiles east of it are shifted by one world).
function bentFixture(cam) {
  const { context, api } = buildSandbox();
  const map = context.GeoScene.createMap("World", Object.assign({ lat: 0, lon: 170, zoom: 3, rotation: 0, projection: 2 }, cam || {}));
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  return { context, api, map, src };
}
// Runs fn with comp active, then puts the map comp back.
function inComp(api, comp, fn) {
  const was = api.getActiveComp();
  api.setActiveComp(comp);
  try { return fn(); } finally { api.setActiveComp(was); }
}
function compIds(api) { return Object.keys(api._comps).filter((id) => id !== "comp#1"); }
function inConn(api, id, attr) { return api.getInConnection(id, attr); }
function bentParts(api, im) {
  const ref = api.getChildren(im.groupId).find((id) => api.getNiceName(id) === "Imagery source");
  const filter = api._connections.find((c) => c[2] === ref && /^filters\.\d+$/.test(c[3]));
  const top = inComp(api, im.meta.sourceComp, () => api.getCompLayers(false));
  const view = top.find((id) => api.getNiceName(id) === "View");
  const mask = top.find((id) => api.getNiceName(id) === "View mask");
  return { ref, filter: filter && filter[0], view, mask, top };
}

test("Bent imagery: an all-Web-Mercator plan is not bent", () => {
  const { context, map, src } = bentFixture({ lon: 0, zoom: 4, projection: 0 });
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.bent, undefined);
  assert.equal(plan.tiles.length, 48);
});

test("Bent imagery: a globe camera plans wrapped tiles from bentTileSet and the visible region", () => {
  const { context, api, map, src } = bentFixture();
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.bent, true);
  assert.equal(plan.mode, "tiles");
  const set = context.GeoTiles.bentTileSet(context.GeoScene.sampleCamera(map), 1920, 1080, src.minZoom, src.maxZoom, context.GeoReproject.visibleRegion);
  assert.deepEqual(plain(plan.tiles), plain(set.tiles));
  assert.deepEqual([plan.lo, plan.hi], [set.lo, set.hi]);
  assert.deepEqual(plain(plan.items), plain(set.tiles.map((t) => context.GeoBlocks.wrapRect(context.GeoBlocks.tileRect(t)))));
  assert.ok(plan.items.some((r) => r.shift === 1), "tiles east of the date line are shifted one world");
  assert.ok(plan.items.every((r) => r.x0 >= 0 && r.x0 < Math.pow(2, r.z)), "canonical x");
  assert.equal(plan.missing.length, 0, "every file already downloaded");
  assert.equal(plan.cached, plan.items.length);
  assert.equal(api.getActiveComp(), "comp#1");
});

test("Bent imagery: a rect needed at two shifts is listed once in missing, and cached counts it", () => {
  const { context, map, src } = bentFixture({ lat: 80, lon: 170, zoom: 2 }); // pole in view: every longitude
  context.GeoNet.cachedTile = () => null;
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.bent, true);
  const key = (r) => context.GeoBlocks.rectKey(r);
  const keys = plan.items.map(key);
  assert.ok(keys.length > new Set(keys).size, "some rect is placed at two shifts");
  assert.equal(plan.missing.length, new Set(keys).size, "downloaded once");
  assert.equal(new Set(plan.missing.map(key)).size, plan.missing.length);
  assert.equal(plan.cached, 0);
});

test("Bent imagery: EOX large images plan from blocksForWrappedTiles", () => {
  const { context, api, map } = bentFixture();
  fakeCurl(api); context.GeoFetch._reset();
  const plan = context.GeoScene.planImagery(map, context.GeoSources.byId("eox"), {});
  assert.equal(plan.bent, true);
  assert.equal(plan.mode, "images");
  assert.deepEqual(plain(plan.items), plain(context.GeoBlocks.blocksForWrappedTiles(plan.tiles)));
  assert.ok(plan.items.some((r) => r.shift === 1));
});

test("Bent imagery: without the plugin the plan stops with the install message and nothing is made", () => {
  const { context, api, map, src } = bentFixture();
  api._layerTypes.splice(api._layerTypes.findIndex((t) => t.type === "cavalryGeo::reproject"), 1);
  const before = api.getCompLayers(false).length;
  assert.equal(context.GeoScene.reprojectAvailable(), false);
  assert.throws(() => context.GeoScene.planImagery(map, src, {}), (e) => e.message === PLUGIN_MISSING);
  assert.equal(api.getCompLayers(false).length, before);
  assert.deepEqual(compIds(api), []);
  assert.equal(api.getActiveComp(), "comp#1");
  delete api.getAllLayerTypes;
  assert.equal(context.GeoScene.reprojectAvailable(), false);
  assert.equal(context.GeoScene.REPROJECT_TYPE, "cavalryGeo::reproject");
});

test("Bent imagery: the plugin present is detected by its type", () => {
  const { context } = bentFixture();
  assert.equal(context.GeoScene.reprojectAvailable(), true);
});

test("Bent imagery: the build makes the source comp, the reference with the filter, View and mask, and drivers", () => {
  const { context, api, map, src } = bentFixture();
  api.set("comp#1", { endFrame: 50, startFrame: 2, fps: 24 });
  const plan = context.GeoScene.planImagery(map, src, {});
  const r = context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(api.getActiveComp(), "comp#1");
  const found = context.GeoScene.findImagery(map);
  assert.equal(found.length, 1);
  const im = found[0], comp = im.meta.sourceComp;
  assert.equal(im.groupId, r.groupId);
  assert.deepEqual(compIds(api), [comp]);
  assert.deepEqual(plain(im.meta), { camera: map.cameraId, category: "imagery", group: r.groupId, cacheKey: "eox",
    sourceMeta: plain(context.GeoSources.meta(src, {})), bent: true, sourceComp: comp });
  // The source composition.
  assert.equal(api.getNiceName(comp), "Imagery source: EOX Sentinel-2 · World");
  assert.deepEqual(plain(api.get(comp, "resolution")), { x: 4104, y: 4104 }, "big enough for the whole view box");
  assert.deepEqual(plain(api.get(comp, "frameRange")), { x: 2, y: 50 });
  assert.equal(api.get(comp, "fps"), 24);
  const bg = api.get(comp, "backgroundColor");
  assert.equal(typeof bg === "string" ? bg.slice(7) : bg.a, typeof bg === "string" ? "00" : 0, "transparent background");
  // The map-comp group: the reference with one filter.
  assert.equal(api.getNiceName(r.groupId), "Imagery: EOX Sentinel-2");
  assert.equal(api.getParent(r.groupId), map.groupId);
  assert.equal(api.get(r.groupId, "hidden"), false);
  const p = bentParts(api, im);
  assert.ok(p.ref, "reference layer");
  assert.equal(api.getCompFromReference(p.ref), comp);
  assert.equal(api._layerComp[p.ref], "comp#1");
  [["position.x", 0], ["position.y", 0], ["rotation.z", 0], ["scale.x", 1], ["scale.y", 1]].forEach(([a, v]) => assert.equal(api.get(p.ref, a), v, a));
  assert.equal(api._connections.filter((c) => c[2] === p.ref && /^filters\.\d+$/.test(c[3])).length, 1);
  assert.equal(api.getLayerType(p.filter), "cavalryGeo::reproject");
  assert.equal(api.getParent(p.filter), r.groupId, "the filter is kept in the Imagery group");
  assert.equal(api.get(p.filter, "allowViewportClipping"), false);
  assert.equal(api.get(p.filter, "autoPadding"), false);
  assert.equal(api.get(p.filter, "samplingQuality"), 1);
  ["camLat", "camLon", "camZoom", "camRotation", "camProjection"].forEach((a, i) => assert.equal(inConn(api, p.filter, a), map.cameraId + ".array." + i, a));
  // View drivers in the map comp, parented to the group.
  const size = { width: 1920, height: 1080 };
  const targets = { position: [p.view, "position"], scale: [p.view, "scale"], maskSize: [p.mask, "generator.dimensions"], viewScale: [p.filter, "viewScale"], viewOffset: [p.filter, "viewOffset"] };
  VIEW_WHICH.forEach((which) => {
    const from = inConn(api, targets[which][0], targets[which][1]);
    assert.ok(from, which + " is driven");
    const d = from.split(".")[0];
    assert.equal(from, d + ".id");
    assert.equal(api.getParent(d), r.groupId, which);
    assert.equal(api._layerComp[d], "comp#1");
    const meta = d === im.driverId ? plain(im.meta) : undefined;
    assert.equal(api.get(d, "expression"), context.GeoExpression.imageryViewExpression(context.GEO_REPROJECT_SRC, which, size, meta), which);
    [0, 1, 2, 3, 4].forEach((i) => assert.equal(inConn(api, d, "array." + i), map.cameraId + ".array." + i));
  });
  assert.equal(inConn(api, p.view, "position"), im.driverId + ".id", "the tagged driver is the View position one");
  // In the source comp: View masked by View mask, level groups with tiles and level drivers.
  assert.ok(p.view && p.mask);
  assert.equal(api._layerComp[p.view], comp);
  assert.ok(api._connections.some((c) => c[0] === p.mask && c[1] === "id" && c[2] === p.view && c[3] === "masks"));
  const kids = inComp(api, comp, () => api.getChildren(p.view));
  const levels = kids.filter((id) => /^z \d+$/.test(api.getNiceName(id)));
  assert.deepEqual(levels.map((id) => api.getNiceName(id)).sort(), Array.from(new Set(plan.items.map((it) => "z " + it.z))).sort());
  const drivers = kids.filter((id) => /^Imagery driver: /.test(api.getNiceName(id)));
  assert.equal(drivers.length, 3 * levels.length);
  drivers.forEach((d) => {
    assert.equal(api._layerComp[d], comp);
    [0, 1, 2].forEach((i) => assert.equal(inConn(api, d, "array." + i), map.cameraId + ".array." + i));
    [3, 4].forEach((i) => { assert.equal(inConn(api, d, "array." + i), ""); assert.equal(api.get(d, "array." + i), 0); });
  });
  levels.forEach((lg) => ["position", "scale", "opacity"].forEach((a) => assert.ok(drivers.includes(inConn(api, lg, a).split(".")[0]), a)));
  const everything = api.getCompLayers(false).concat(inComp(api, comp, () => api.getCompLayers(false)));
  assert.ok(!everything.some((id) => /rotation/.test(api.getNiceName(id))), "no rotation driver");
  // Footage placed at the unwrapped (shifted) rects.
  let shifted = 0;
  levels.forEach((lg) => {
    const L = Number(api.getNiceName(lg).slice(2)), its = plan.items.filter((it) => it.z === L);
    const origin = context.GeoBlocks.levelOrigin(its.map((it) => context.GeoBlocks.placedRect(it)));
    const expected = Array.from(its, (it) => context.GeoBlocks.rectLocal(context.GeoBlocks.placedRect(it), origin).join(",")).sort();
    const tiles = inComp(api, comp, () => api.getChildren(lg));
    tiles.forEach((t) => assert.equal(api._layerComp[t], comp));
    assert.deepEqual(tiles.map((t) => api.get(t, "position.x") + "," + api.get(t, "position.y")).sort(), expected);
    its.filter((it) => it.shift === 1).forEach((it) => {
      const pos = context.GeoBlocks.rectLocal(context.GeoBlocks.placedRect(it), origin);
      assert.equal(pos[0], context.GeoBlocks.rectLocal(it, origin)[0] + Math.pow(2, L) * 256, "n tiles east");
      shifted++;
    });
  });
  assert.ok(shifted > 0);
  assert.equal(r.tiles, plan.items.length);
  assert.equal(api.getCompLayers(false).filter((id) => /^footageShape#/.test(id)).length, 0, "no footage in the map comp");
});

test("Bent imagery: a second bent build replaces the first, layer by layer, then deletes its source comp", () => {
  const { context, api, map, src } = bentFixture();
  const plan = context.GeoScene.planImagery(map, src, {});
  const first = context.GeoScene.buildImagery(map, src, {}, plan);
  const oldComp = context.GeoScene.findImagery(map)[0].meta.sourceComp;
  const deleted = [];
  const realDelete = api.deleteLayer.bind(api);
  api.deleteLayer = function (id) { deleted.push([id, api.getActiveComp(), api._layerComp[id]]); return realDelete(id); };
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  const steps = stepToEnd(job, 0, () => assert.equal(api.getActiveComp(), "comp#1", "map comp active after every step"));
  const last = steps[steps.length - 1];
  assert.equal(last.done, true);
  const found = context.GeoScene.findImagery(map);
  assert.equal(found.length, 1);
  assert.equal(found[0].groupId, last.result.groupId);
  assert.notEqual(found[0].meta.sourceComp, oldComp);
  assert.deepEqual(compIds(api), [found[0].meta.sourceComp]);
  assert.equal(api.layerExists(first.groupId), false);
  assert.ok(steps.filter((s) => s.phase === "cleanup").length > 10, "old tiles deleted a few at a time");
  assert.deepEqual(deleted[deleted.length - 1].slice(0, 2), [oldComp, "comp#1"], "the old source comp goes last");
  const groupAt = deleted.findIndex((d) => d[0] === first.groupId);
  const sourceDeletes = deleted.filter((d) => d[2] === oldComp);
  assert.ok(sourceDeletes.length > 10, "source layers deleted one by one");
  sourceDeletes.forEach((d) => assert.equal(d[1], oldComp, "with the source comp active"));
  assert.ok(deleted.findIndex((d) => d[2] === oldComp) < groupAt && deleted.map((d) => d[2]).lastIndexOf(oldComp) < groupAt, "source layers before the map-comp group");
});

test("Bent imagery: flat and bent builds of the same source replace each other", () => {
  const { context, api, map, src } = bentFixture({ lon: 0, zoom: 4, projection: 0 });
  const flat = context.GeoScene.buildImagery(map, src, {}, context.GeoScene.planImagery(map, src, {}));
  assert.equal(context.GeoScene.findImagery(map)[0].meta.bent, undefined);
  api.set(map.cameraId, { "array.4": 2 });
  const bent = context.GeoScene.buildImagery(map, src, {}, context.GeoScene.planImagery(map, src, {}));
  let found = context.GeoScene.findImagery(map);
  assert.equal(found.length, 1);
  assert.equal(found[0].groupId, bent.groupId);
  assert.equal(found[0].meta.bent, true);
  assert.equal(api.layerExists(flat.groupId), false);
  const comp = found[0].meta.sourceComp;
  api.set(map.cameraId, { "array.4": 0 });
  const flat2 = context.GeoScene.buildImagery(map, src, {}, context.GeoScene.planImagery(map, src, {}));
  found = context.GeoScene.findImagery(map);
  assert.equal(found.length, 1);
  assert.equal(found[0].groupId, flat2.groupId);
  assert.equal(api.layerExists(bent.groupId), false);
  assert.deepEqual(compIds(api), [], "the bent source comp is deleted");
  assert.equal(api._comps[comp], undefined);
  assert.equal(api.getActiveComp(), "comp#1");
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "cavalryGeo::reproject").length, 0, "the filter is gone");
});

test("Bent imagery: cancel during tiles discards the new group and deletes the new source comp", () => {
  const { context, api, map, src } = bentFixture();
  const plan = context.GeoScene.planImagery(map, src, {});
  const old = context.GeoScene.buildImagery(map, src, {}, plan);
  const oldComp = context.GeoScene.findImagery(map)[0].meta.sourceComp;
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  for (let i = 0; i < 4; i++) { const s = job.step(0); assert.equal(s.phase, "tiles"); }
  assert.equal(compIds(api).length, 2);
  assert.equal(job.cancel(), true);
  const steps = stepToEnd(job, 0, () => assert.equal(api.getActiveComp(), "comp#1"));
  const last = steps[steps.length - 1];
  assert.equal(last.cancelled, true);
  assert.ok(steps.length > 1);
  assert.deepEqual(compIds(api), [oldComp]);
  assert.deepEqual(imageryGroups(api), [old.groupId]);
  assert.equal(context.GeoScene.findImagery(map).length, 1);
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "cavalryGeo::reproject").length, 1, "only the old filter is left");
});

test("Bent imagery: a throw mid-build leaves no new source comp and the map comp active", () => {
  const { context, api, map, src } = bentFixture();
  const plan = context.GeoScene.planImagery(map, src, {});
  let calls = 0;
  const realAdd = api.addAssetToComp.bind(api);
  api.addAssetToComp = function (assetId) { if (++calls === 3) throw new Error("boom"); return realAdd(assetId); };
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  job.step(0); job.step(0);
  assert.equal(api.getActiveComp(), "comp#1");
  assert.throws(() => job.step(0), /boom/);
  assert.equal(api.getActiveComp(), "comp#1");
  assert.deepEqual(compIds(api), []);
  assert.deepEqual(imageryGroups(api), []);
  assert.equal(context.GeoScene.findImagery(map).length, 0);
});

test("Bent imagery: a throw after the source comp exists deletes it and leaves the map comp active", () => {
  const { context, api, map, src } = bentFixture();
  const plan = context.GeoScene.planImagery(map, src, {});
  const before = api.getCompLayers(false).slice().sort();
  api.createCompReference = function () { throw new Error("no reference"); };
  const job = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  assert.throws(() => job.step(0), /no reference/);
  assert.equal(api.getActiveComp(), "comp#1");
  assert.deepEqual(compIds(api), [], "the new source comp is deleted");
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before, "nothing left in the map comp");
  assert.equal(context.GeoScene.findImagery(map).length, 0);
});

test("Bent imagery: an abandoned half-built bent group is found and removed by the next build", () => {
  const { context, api, map, src } = bentFixture();
  const plan = context.GeoScene.planImagery(map, src, {});
  const abandoned = context.GeoScene.beginImageryBuild(map, src, {}, plan);
  abandoned.step(0); abandoned.step(0);
  assert.equal(context.GeoScene.findImagery(map).length, 1, "findable from the first step");
  context.GeoScene.buildImagery(map, src, {}, plan);
  assert.equal(context.GeoScene.findImagery(map).length, 1);
  assert.equal(compIds(api).length, 1);
  assert.equal(imageryGroups(api).length, 1);
});

// F10: a tile marked empty (404/204 on a previous download) must not show up as
// missing again on the next plan, or it gets re-downloaded forever.
test("planImagery excludes tiles marked empty from missing (F10)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  const empties = [];
  context.GeoNet.isEmptyTile = (base) => empties.indexOf(base) >= 0;
  const plan1 = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan1.missing.length, 48);
  const t = plan1.missing[0];
  empties.push(context.GeoNet.tileBase(plan1.cacheKey, t.z, t.x0, t.y0));
  const plan2 = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan2.missing.length, 47, "the marked-empty tile is no longer missing");
});

test("flyCamera keys lat, lon and zoom per frame and replaces keys in that range", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 2);
  api.keyframe(map.cameraId, 5, { "array.2": 9 });
  api.keyframe(map.cameraId, 50, { "array.2": 7 });
  const pts = Array.from({ length: 10 }, (_, k) => ({ lat: k, lon: 2 * k, zoom: 3 + k / 10 }));
  const r = context.GeoScene.flyCamera(map, pts, 2);
  assert.deepEqual(plain(r), { start: 2, end: 11 });
  api.setFrame(5);
  assert.equal(api.get(map.cameraId, "array.0"), 3);
  assert.equal(api.get(map.cameraId, "array.2"), 3.3, "old key at frame 5 replaced");
  assert.deepEqual(plain(api.getKeyframeTimes(map.cameraId, "array.2")).filter((f) => f > 11), [50], "keys outside the range kept");
});

// F5: createAttribution is the OSM credit only; a separate createImageryCredit takes
// custom text so the imagery credit never collides with the OSM one.
test("createImageryCredit accepts custom text; createAttribution always uses the OSM credit text (F5)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 2);
  const imgId = context.GeoScene.createImageryCredit(map, "NASA Blue Marble");
  assert.equal(api.get(imgId, "text"), "NASA Blue Marble");
  const osmId = context.GeoScene.createAttribution(map);
  assert.equal(api.get(osmId, "text"), "© OpenStreetMap contributors");
});

test("createImageryCredit coexists with the OSM credit under different names and positions (F5)", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const osmId = GeoScene.createAttribution(map);
  const imgId = GeoScene.createImageryCredit(map, "EOxCloudless credit");
  assert.notEqual(osmId, imgId);
  assert.equal(api.getNiceName(osmId), "OpenStreetMap credit");
  assert.equal(api.getNiceName(imgId), "Imagery credit");
  assert.deepEqual(Array.from(api.get(osmId, "position")), [-1920 / 2 + 200, -1080 / 2 + 40]);
  assert.deepEqual(Array.from(api.get(imgId, "position")), [-1920 / 2 + 200, -1080 / 2 + 80]);
});

test("hasAttribution stays false after only the imagery credit is added (F5)", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  GeoScene.createImageryCredit(map, "Some credit");
  assert.equal(GeoScene.hasAttribution(map), false);
});

test("createImageryCredit updates an existing imagery credit instead of adding another", () => {
  const { context, api } = buildSandbox();
  const GeoScene = context.GeoScene;
  const map = GeoScene.createMap("Test", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const first = GeoScene.createImageryCredit(map, "First credit");
  const second = GeoScene.createImageryCredit(map, "Second credit");
  assert.equal(first, second, "the same layer should be reused");
  assert.equal(api.get(first, "text"), "Second credit");
  const credits = api.getChildren(map.groupId).filter((id) => api.getNiceName(id) === "Imagery credit");
  assert.equal(credits.length, 1);
});

// F5: pressing "Add attribution" (Imagery tab) twice must not pile up duplicate credits.
test("Imagery tab: Add attribution twice keeps one 'Imagery credit' layer (F5)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.sourcePicker.setValue(0); // EOX
  context.imageryAttrBtn.onClick();
  context.imageryAttrBtn.onClick();
  const map = context.currentMap();
  const credits = api.getChildren(map.groupId).filter((id) => api.getNiceName(id) === "Imagery credit");
  assert.equal(credits.length, 1);
});

function fakeTileDownloads(context, api, status) {
  context.GeoNet.downloadTile = (url, base) => {
    if (status && status !== 200) return { status: status };
    api.writeToFile(base + ".jpg", "<tile>");
    return { status: 200, path: base + ".jpg" };
  };
}

// A fake `curl --parallel -K cfg ... --stderr status`: reads the config the panel wrote and,
// when `deliver()` is called, writes each output file and appends
// "<code> <exit code> <content type> <path>\n" lines. codeFor(url) returns an HTTP code, or
// { code, exit, type, write } to say exactly what curl reports and writes (write: null = no file).
// A batch whose config has been deleted is treated as a curl that is gone.
function fakeCurl(api, codeFor = () => 200, version = "curl 8.4.0 (x86_64-pc-win32)") {
  const calls = [];
  api.runProcess = (cmd, args) => ({ output: cmd === "curl" && args[0] === "--version" ? version : "", error: "" });
  api.runDetachedProcess = (cmd, args) => { calls.push({ cmd, args }); };
  api.deleteFilePath = (p) => { delete api._files[p]; };
  function outcome(url) {
    const got = codeFor(url), o = typeof got === "object" ? got : { code: got }, code = o.code;
    return {
      code,
      exit: o.exit !== undefined ? o.exit : code === 200 ? 0 : code === 0 ? 7 : code >= 400 ? 22 : 0,
      type: o.type !== undefined ? o.type : code === 200 ? "image/jpeg" : code === 0 ? "" : "text/html",
      write: o.write !== undefined ? o.write : code === 200 ? "<image>" : null
    };
  }
  function deliver(max = Infinity) {
    calls.forEach((c) => {
      const cfg = api._files[c.args[c.args.indexOf("-K") + 1]];
      if (cfg === undefined) return;
      const status = c.args[c.args.indexOf("--stderr") + 1];
      const un = (v) => v.replace(/\\(.)/g, "$1");
      const pairs = [...cfg.matchAll(/url = "((?:[^"\\]|\\.)*)"\noutput = "((?:[^"\\]|\\.)*)"/g)].map((m) => ({ url: un(m[1]), path: un(m[2]) }));
      let n = 0;
      pairs.forEach((p) => {
        if (n >= max || (api._files[status] || "").includes(" " + p.path + "\n")) return;
        const o = outcome(p.url);
        if (o.write !== null) api._files[p.path] = o.write;
        api._files[status] = (api._files[status] || "") + String(o.code).padStart(3, "0") + " " + o.exit + " " + o.type + " " + p.path + "\n";
        n++;
      });
    });
  }
  return { calls, deliver };
}

test("GeoFetch.available needs runDetachedProcess, runProcess and curl 7.75 or newer", () => {
  const { context, api } = buildSandbox();
  assert.equal(context.GeoFetch.available(), false, "no runDetachedProcess in the plain fake");
  fakeCurl(api); context.GeoFetch._reset();
  assert.equal(context.GeoFetch.available(), true);
  fakeCurl(api, undefined, "curl 7.55.1 (Windows)"); context.GeoFetch._reset();
  assert.equal(context.GeoFetch.available(), false, "too old for --parallel");
  fakeCurl(api, undefined, "curl 7.74.0 (Windows)"); context.GeoFetch._reset();
  assert.equal(context.GeoFetch.available(), false, "too old for %{exitcode}");
  fakeCurl(api, undefined, "curl 7.75.0 (Windows)"); context.GeoFetch._reset();
  assert.equal(context.GeoFetch.available(), true);
});

test("GeoFetch.available is false when the assets folder path isn't plain ASCII (F4)", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset();
  api.getAppDataFolder = () => "C:/Users/üser/AppData"; // any non-ASCII folder name
  assert.equal(context.GeoFetch.available(), false);
});

test("planImagery plans EOX as large images only when background downloads work, else as tiles (F4)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = context.GeoSources.byId("eox");
  const plan = context.GeoScene.planImagery(map, src, {});
  assert.equal(plan.mode, "tiles", "one-at-a-time WMS images would freeze Cavalry ~15 s each");
  assert.match(context.GeoScene.itemUrl(src, {}, plan, plan.items[0]), /\/wmts\//);
  fakeCurl(api); context.GeoFetch._reset();
  assert.equal(context.GeoScene.planImagery(map, src, {}).mode, "images");
  context.GeoFetch.disable();
  assert.equal(context.GeoFetch.available(), false);
  assert.equal(context.GeoScene.planImagery(map, src, {}).mode, "tiles");
});

test("GeoFetch.poll reads code, exit code and content type; ok needs 200, exit 0, a JPEG/PNG type and the file (F1)", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset();
  const paths = ["C:/x/a b/1.jpg", "C:/x/2.jpg", "C:/x/3.jpg", "C:/x/4.jpg", "C:/x/5.jpg", "C:/x/6.png", "C:/x/7.jpg", "C:/x/8.jpg"];
  const batch = context.GeoFetch.start(paths.map((p, i) => ({ url: "https://a.example/" + i, path: p })));
  paths.forEach((p) => { api._files[p] = "<x>"; });
  delete api._files["C:/x/7.jpg"];
  api._files[batch.status] = [
    "200 0 image/jpeg C:/x/a b/1.jpg", "200 56 image/jpeg C:/x/2.jpg", "200 0 text/xml C:/x/3.jpg",
    "200 0  C:/x/4.jpg\r", "200 0 text/html; charset=utf-8 C:/x/5.jpg", "200 0 IMAGE/PNG C:/x/6.png",
    "200 0 image/jpeg C:/x/7.jpg", "200 0 image/jpg C:/x/8.jpg"].join("\n") + "\n";
  const r = context.GeoFetch.poll(batch);
  assert.deepEqual(plain(r.results.map((x) => [x.path, x.status, x.exit, x.type, x.ok])), [
    ["C:/x/a b/1.jpg", 200, 0, "image/jpeg", true],
    ["C:/x/2.jpg", 200, 56, "image/jpeg", false],
    ["C:/x/3.jpg", 200, 0, "text/xml", false],
    ["C:/x/4.jpg", 200, 0, "", false],
    ["C:/x/5.jpg", 200, 0, "text/html; charset=utf-8", false],
    ["C:/x/6.png", 200, 0, "IMAGE/PNG", true],
    ["C:/x/7.jpg", 200, 0, "image/jpeg", false],
    ["C:/x/8.jpg", 200, 0, "image/jpg", true]]); // M3: the type the one-at-a-time path accepts
  assert.equal(r.done, true);
});

test("GeoFetch.poll counts distinct job paths, not lines (F7)", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset();
  const batch = context.GeoFetch.start([{ url: "https://a.example/1", path: "C:/x/1.jpg" }, { url: "https://a.example/2", path: "C:/x/2.jpg" }]);
  api._files[batch.status] = "200 0 image/jpeg C:/x/1.jpg\n200 0 image/jpeg C:/x/1.jpg\n200 0 image/jpeg C:/x/other.jpg\n";
  const r = context.GeoFetch.poll(batch);
  assert.equal(r.results.length, 1);
  assert.equal(r.count, 1);
  assert.equal(r.done, false);
  assert.equal(batch.seen, 3, "every line read is counted as seen");
});

test("GeoFetch starts one detached curl batch and reports each file as its status line arrives", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api, (url) => (/missing/.test(url) ? 404 : 200));
  context.GeoFetch._reset();
  const dir = "C:/fake/AppData/Scripts/CavalryGeo_assets/cache/images/eox/4";
  const jobs = [{ url: "https://a.example/1?x=\"q\"", path: dir + "/1.jpg" }, { url: "https://a.example/missing", path: dir + "/2.jpg" }];
  const batch = context.GeoFetch.start(jobs);
  assert.equal(curl.calls.length, 1);
  assert.equal(curl.calls[0].cmd, "curl");
  const a = curl.calls[0].args;
  assert.deepEqual(plain(a.slice(0, 11)), ["--parallel", "--parallel-max", "4", "-s", "-L", "--fail", "--create-dirs", "--retry", "2", "--max-time", "120"]);
  assert.equal(a[a.indexOf("-w") + 1], "%{stderr}%{http_code} %{exitcode} %{content_type} %{filename_effective}\\n");
  assert.match(api._files[a[a.indexOf("-K") + 1]], /url = "https:\/\/a\.example\/1\?x=\\"q\\""\noutput = ".*\/1\.jpg"\n/);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), jobs.map((j) => j.path), "in-flight list written before curl starts");
  let r = context.GeoFetch.poll(batch);
  assert.deepEqual([r.results.length, r.done, r.stalled], [0, false, false]);
  curl.deliver(1);
  r = context.GeoFetch.poll(batch);
  assert.deepEqual(plain(r.results), [{ path: dir + "/1.jpg", status: 200, exit: 0, type: "image/jpeg", ok: true }]);
  curl.deliver();
  r = context.GeoFetch.poll(batch);
  assert.deepEqual(plain(r.results), [{ path: dir + "/2.jpg", status: 404, exit: 22, type: "text/html", ok: false }]);
  assert.equal(r.done, true);
  context.GeoFetch.finish(batch);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), [], "finished files leave the in-flight list");
});

test("GeoFetch.poll ignores a half-written last line and reports a stall after STALL_MS", () => {
  const { context, api } = buildSandbox();
  fakeCurl(api); context.GeoFetch._reset();
  const batch = context.GeoFetch.start([{ url: "https://a.example/1", path: "C:/x/1.jpg" }]);
  api._files[batch.status] = "200 C:/x/1.j";
  assert.equal(context.GeoFetch.poll(batch).results.length, 0);
  batch.lastProgress -= context.GeoFetch.STALL_MS + 1;
  assert.equal(context.GeoFetch.poll(batch).stalled, true);
});

const INFLIGHT = "C:/fake/AppData/Scripts/CavalryGeo_assets/cache/downloads/inflight.json";
function job(n) { return { url: "https://a.example/" + n, path: "C:/x/" + n + ".jpg" }; }
function cfgPaths(api, call) { return [...api._files[call.args[call.args.indexOf("-K") + 1]].matchAll(/output = "([^"]*)"/g)].map((m) => m[1]); }

test("GeoFetch waits 400 s for a stall, 90 s for a first line, and drops batches after 20 min (F2)", () => {
  const { context } = buildSandbox();
  assert.deepEqual([context.GeoFetch.STALL_MS, context.GeoFetch.FIRST_LINE_MS, context.GeoFetch.MAX_BATCH_MS], [400000, 90000, 1200000]);
});

test("GeoFetch.finish takes only reported files off the in-flight list (F2)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api); context.GeoFetch._reset();
  const batch = context.GeoFetch.start([job(1), job(2)]);
  curl.deliver(1);
  context.GeoFetch.poll(batch);
  context.GeoFetch.finish(batch);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), ["C:/x/2.jpg"]);
  assert.ok(api._files[batch.cfg] !== undefined, "the batch is kept while curl may still write a file");
});

test("GeoFetch.start adopts files a live earlier batch is still fetching: curl runs only for the rest (F3)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api); context.GeoFetch._reset();
  const a = context.GeoFetch.start([job(1), job(2)]);
  context.GeoFetch.start([job(1)]);
  assert.equal(curl.calls.length, 1, "nothing new to fetch: no second curl");
  const b = context.GeoFetch.start([job(2), job(3)]);
  assert.equal(curl.calls.length, 2);
  assert.deepEqual(cfgPaths(api, curl.calls[1]), ["C:/x/3.jpg"], "the second curl never writes a file the first one owns");
  assert.deepEqual(plain(context.GeoFetch.leftovers()).sort(), ["C:/x/1.jpg", "C:/x/2.jpg", "C:/x/3.jpg"]);
  curl.deliver();
  const r = context.GeoFetch.poll(b);
  assert.deepEqual(plain(r.results.map((x) => x.path)).sort(), ["C:/x/2.jpg", "C:/x/3.jpg"], "the adopted batch's lines count for this stage");
  assert.equal(r.done, true);
  context.GeoFetch.finish(b);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), ["C:/x/1.jpg"]);
  const c = context.GeoFetch.start([job(1)]);
  assert.equal(curl.calls.length, 2, "already reported by the first batch: not fetched again");
  assert.deepEqual(plain(context.GeoFetch.poll(c).results.map((x) => [x.path, x.ok])), [["C:/x/1.jpg", true]]);
  assert.equal(api._files[a.cfg], undefined, "a batch with nothing left is dropped with its config");
  assert.equal(api._files[a.status], undefined);
});

test("GeoFetch.start fetches again a file an earlier batch reported as failed, deleting the bad file (F3)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api, (url) => (/2$/.test(url) ? { code: 200, exit: 28, type: "image/jpeg", write: "<partial>" } : 200));
  context.GeoFetch._reset();
  context.GeoFetch.start([job(1), job(2), job(3)]);
  curl.deliver();
  api._files["C:/x/3.jpg"] = "<partial>"; // reported fine, but not part of the next stage
  api._files["C:/x/1.jpg"] = "<partial>"; // reported fine, so it stays
  const fake = api._files[curl.calls[0].args[curl.calls[0].args.indexOf("--stderr") + 1]];
  api._files[curl.calls[0].args[curl.calls[0].args.indexOf("--stderr") + 1]] = fake.replace(/200 0 image\/jpeg C:\/x\/3\.jpg/, "000 7  C:/x/3.jpg");
  const b = context.GeoFetch.start([job(1), job(2)]);
  assert.equal(api._files["C:/x/3.jpg"], undefined, "a failed file outside this stage is deleted too");
  assert.equal(api._files["C:/x/2.jpg"], undefined);
  assert.deepEqual(cfgPaths(api, curl.calls[1]), ["C:/x/2.jpg"]);
  assert.deepEqual(plain(context.GeoFetch.poll(b).results.map((x) => x.path)), ["C:/x/1.jpg"]);
});

test("GeoFetch.start drops a batch older than 20 minutes: its config and status go, its unreported files are fetched again (F3)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api); context.GeoFetch._reset();
  const a = context.GeoFetch.start([job(1), job(2)]);
  api._files[a.status] = "200 0 image/jpeg C:/x/1.jpg\n";
  api._files["C:/x/1.jpg"] = "<image>";
  api._files["C:/x/2.jpg"] = "<half written>";
  const state = JSON.parse(api._files[INFLIGHT]);
  state.batches[0].started -= context.GeoFetch.MAX_BATCH_MS + 1;
  state.batches[0].lastLine = state.batches[0].started;
  state.batches[0].lines = 1; // its line was already seen back then
  api._files[INFLIGHT] = JSON.stringify(state);
  const b = context.GeoFetch.start([job(1), job(2)]);
  assert.equal(api._files[a.cfg], undefined);
  assert.equal(api._files[a.status], undefined);
  assert.equal(api._files["C:/x/2.jpg"], undefined, "an unreported file may be half written");
  assert.equal(curl.calls.length, 2);
  assert.deepEqual(cfgPaths(api, curl.calls[1]), ["C:/x/2.jpg"]);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), ["C:/x/2.jpg"]);
  assert.deepEqual(plain(context.GeoFetch.poll(b).results.map((x) => x.path)), ["C:/x/1.jpg"]);
});

test("GeoFetch measures a batch's 20 minutes from its last status line, not its start (M2)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api); context.GeoFetch._reset();
  const a = context.GeoFetch.start([job(1), job(2)]);
  curl.deliver(1);
  context.GeoFetch.poll(a);
  let state = JSON.parse(api._files[INFLIGHT]);
  assert.equal(state.batches[0].lines, 1, "poll records the lines it has seen");
  assert.ok(Date.now() - state.batches[0].lastLine < 1000);
  state.batches[0].started -= context.GeoFetch.MAX_BATCH_MS + 1;
  state.batches[0].lastLine = Date.now() - 1000; // a long download that wrote a line just now
  api._files[INFLIGHT] = JSON.stringify(state);
  context.GeoFetch.start([job(2)]);
  assert.equal(curl.calls.length, 1, "still live: adopted, not dropped and fetched again");
  assert.ok(api._files[a.status] !== undefined);
  // A line written since the last look also counts as progress, whenever the batch started.
  state = JSON.parse(api._files[INFLIGHT]);
  state.batches[0].started = 0; state.batches[0].lastLine = 0;
  api._files[INFLIGHT] = JSON.stringify(state);
  api._files[a.status] += "500 22 text/html C:/x/9.jpg\n";
  context.GeoFetch.start([job(2)]);
  assert.equal(curl.calls.length, 1);
});

test("GeoFetch.abandon keeps the batch's unreported files in flight; a later start reconciles and expires it (I1)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api); context.GeoFetch._reset();
  const a = context.GeoFetch.start([job(1), job(2)]);
  context.GeoFetch.abandon(a);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), ["C:/x/1.jpg", "C:/x/2.jpg"], "curl may still be writing them");
  assert.equal(api._files[a.cfg], undefined, "the config (which may hold a key) is deleted");
  assert.ok(api._files[a.status] !== undefined, "the status file stays for a later reconcile");
  // curl was only slow: it finishes file 1 later.
  api._files["C:/x/1.jpg"] = "<image>";
  api._files["C:/x/2.jpg"] = "<half written>";
  api._files[a.status] = "200 0 image/jpeg C:/x/1.jpg\n";
  const b = context.GeoFetch.start([job(1), job(2)]);
  assert.equal(curl.calls.length, 1, "file 1 was reported and file 2 is adopted");
  assert.deepEqual(plain(context.GeoFetch.poll(b).results.map((x) => [x.path, x.ok])), [["C:/x/1.jpg", true]]);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), ["C:/x/2.jpg"]);
  const state = JSON.parse(api._files[INFLIGHT]);
  state.batches[0].lastLine -= context.GeoFetch.MAX_BATCH_MS + 1;
  api._files[INFLIGHT] = JSON.stringify(state);
  context.GeoFetch.start([job(2)]);
  assert.equal(api._files[a.status], undefined, "expired: dropped with its status file");
  assert.equal(api._files["C:/x/2.jpg"], undefined, "its unreported file may be half written");
  assert.deepEqual(cfgPaths(api, curl.calls[1]), ["C:/x/2.jpg"]);
});

test("GeoFetch reads the old plain-list inflight.json as one long-gone batch (F3)", () => {
  const { context, api } = buildSandbox();
  const curl = fakeCurl(api); context.GeoFetch._reset();
  api._files[INFLIGHT] = JSON.stringify(["C:/x/1.jpg"]);
  api._files["C:/x/1.jpg"] = "<half written>";
  assert.deepEqual(plain(context.GeoFetch.leftovers()), ["C:/x/1.jpg"]);
  context.GeoFetch.start([job(1)]);
  assert.equal(api._files["C:/x/1.jpg"], undefined);
  assert.deepEqual(cfgPaths(api, curl.calls[0]), ["C:/x/1.jpg"]);
  assert.equal(JSON.parse(api._files[INFLIGHT]).batches.length, 1);
});

test("beginImageryBuild skips files still on the in-flight list (F2)", () => {
  const { context, api } = buildSandbox();
  const map = imageryMap(context, api, 4);
  const src = tileSource(context);
  context.GeoNet.cachedTile = (base) => base + ".jpg";
  const plan = context.GeoScene.planImagery(map, src, {});
  context.GeoFetch.leftovers = () => [context.GeoScene.itemBase(plan, plan.items[0]) + ".jpg"];
  assert.equal(context.GeoScene.buildImagery(map, src, {}, plan).tiles, plan.items.length - 1);
});

test("Imagery tab: after a stall, a file curl never reported is not built and stays in flight (F2)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const curl = fakeCurl(api); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  const plan = context.imageryState.plan;
  const paths = plan.missing.map((r) => context.GeoScene.itemBase(plan, r) + ".jpg");
  context.buildImageryBtn.onClick();
  curl.deliver(1);
  api._files[paths[1]] = "<half written>";
  runTimersOnce(api);
  context.imageryState.batch.lastProgress -= context.GeoFetch.STALL_MS + 1;
  runTimers(api);
  assert.match(context.statusLabel.getText(), new RegExp("^Imagery built: 1 images in 1 level\\(s\\) \\(0 missing, " + (paths.length - 1) + " failed\\)"));
  assert.equal(footageCount(api), 1);
  assert.ok(context.GeoFetch.leftovers().includes(paths[1]));
  assert.ok(!context.GeoFetch.leftovers().includes(paths[0]));
});

test("Imagery tab: Cancel, then Build again while curl is still running, adopts its files instead of starting a second curl (F3)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const curl = fakeCurl(api); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  curl.deliver(1);
  runTimersOnce(api);
  context.cancelImageryBtn.onClick();
  context.buildImageryBtn.onClick(); // plans again: files still in flight count as missing
  const plan = context.imageryState.plan;
  assert.equal(plan.missing.length, plan.items.length);
  context.buildImageryBtn.onClick();
  assert.equal(curl.calls.length, 1, "no second curl writes the same files");
  curl.deliver();
  runTimers(api);
  assert.match(context.statusLabel.getText(), new RegExp("^Imagery built: " + plan.items.length + " images in \\d+ level\\(s\\) \\(0 missing, 0 failed\\)"));
  assert.deepEqual(plain(context.GeoFetch.leftovers()), []);
});

const CURL_BROKEN = "Background downloads aren't working on this computer — press Build imagery to plan again with map tiles.";

test("Imagery tab: no status line within 90 s turns background downloads off, and EOX then plans tiles (F4)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeCurl(api); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  const plan = context.imageryState.plan;
  context.buildImageryBtn.onClick();
  runTimersOnce(api);
  assert.match(context.statusLabel.getText(), /^Downloading images/);
  context.imageryState.batch.started -= context.GeoFetch.FIRST_LINE_MS + 1;
  runTimers(api);
  assert.equal(context.statusLabel.getText(), CURL_BROKEN);
  assert.equal(context.buildImageryBtn.getText(), "Build imagery", "the plan is reset");
  assert.equal(context.GeoFetch.available(), false);
  assert.equal(context.GeoFetch.leftovers().length, plan.missing.length, "a slow curl may still write them: they stay in flight (I1)");
  context.buildImageryBtn.onClick();
  assert.equal(context.imageryState.plan.mode, "tiles");
});

test("Imagery tab: a batch whose every file failed with 000 turns background downloads off (F4)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const curl = fakeCurl(api, () => 0); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  curl.deliver();
  runTimers(api);
  assert.equal(context.statusLabel.getText(), CURL_BROKEN);
  assert.equal(context.GeoFetch.available(), false);
  assert.equal(imageryGroups(api).length, 0, "nothing is built");
  context.buildImageryBtn.onClick();
  assert.equal(context.imageryState.plan.mode, "tiles");
});

test("Imagery tab: Clear download cache is refused while imagery downloads (F5)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeCurl(api); context.GeoFetch._reset();
  let cleared = 0;
  context.GeoNet.clearCache = () => { cleared++; return { files: 0, bytes: 0, fallback: false }; };
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  context.clearCacheBtn.onClick();
  assert.equal(cleared, 0);
  assert.equal(context.statusLabel.getText(), "Error: The download cache can't be cleared while imagery is downloading or building — wait, or press Cancel first.");
});

test("Imagery tab: one-at-a-time downloads take their files off the in-flight list, so the build uses them (F2)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  const plan = context.imageryState.plan;
  const path = context.GeoScene.itemBase(plan, plan.missing[0]) + ".jpg";
  api._files[INFLIGHT] = JSON.stringify({ batches: [{ id: "1", cfg: null, status: null, paths: [path], started: Date.now() }] });
  context.buildImageryBtn.onClick();
  runTimers(api);
  assert.match(context.statusLabel.getText(), new RegExp("^Imagery built: " + plan.items.length + " tiles"));
  assert.deepEqual(plain(context.GeoFetch.leftovers()), []);
});

test("image cache paths, and Clear imagery tiles clears images too while Clear download cache keeps them", () => {
  const { context, api } = buildSandbox();
  const base = context.GeoNet.imageBase("eox", { z: 4, x0: 8, y0: 5, x1: 11, y1: 7 });
  assert.equal(base, "C:/fake/AppData/Scripts/CavalryGeo_assets/cache/images/eox/4/8_5_11_7");
  const root = "C:/fake/AppData/Scripts/CavalryGeo_assets/cache";
  [root, root + "/tiles", root + "/images"].forEach((d) => { api._files[d] = "<dir>"; });
  const files = [root + "/images/eox/4/8_5_11_7.jpg", root + "/tiles/eox/4/8/5.jpg", root + "/downloads/inflight.json", root + "/ne/countries.json"];
  files.forEach((f) => { api._files[f] = "x"; });
  api.listDirectoryRecursive = (dir) => Object.keys(api._files).filter((p) => p.indexOf(dir + "/") === 0);
  api.isDirectory = () => false;
  api.deleteFilePath = (p) => { delete api._files[p]; };
  context.GeoNet.clearCache();
  assert.deepEqual(files.map((f) => !!api._files[f]), [true, true, true, false], "the in-flight list and batch files survive (F5)");
  context.GeoNet.clearTiles();
  assert.deepEqual(files.map((f) => !!api._files[f]), [false, false, true, false]);
});

test("Imagery tab: first press plans, second press downloads in timer steps then builds", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  context.customAttrField.setText("© Example");
  context.buildImageryBtn.onClick();
  assert.match(context.statusLabel.getText(), /tiles needed \(0 already downloaded/);
  assert.match(context.buildImageryBtn.getText(), /^Download \d+ tiles$/);
  context.buildImageryBtn.onClick();
  assert.equal(api._timers.length, 1);
  assert.equal(api._timers[0].active, true);
  runTimers(api);
  assert.match(context.statusLabel.getText(), /^Imagery built: \d+ tiles in \d+ level/);
  assert.match(context.statusLabel.getText(), /Credit: © Example$/);
  assert.equal(context.buildImageryBtn.getText(), "Build imagery");
  assert.ok(context.imageryProgress._value > 0);
  context.buildImageryBtn.onClick(); // a new plan must not keep showing the last build's 100%
  assert.equal(context.imageryProgress._value, 0);
  assert.ok(api.getCompLayers(false).some((id) => String(api.getNiceName(id)).startsWith("Imagery: ")));
  const settings = JSON.parse(api._files["C:/fake/AppData/Scripts/CavalryGeo_assets/settings.json"]);
  assert.equal(settings.source, "custom");
});

// Installs a ui.Modal (newer Cavalry) whose showQuestion answers `answer` and records
// each question asked, so Build imagery asks once instead of needing a second press.
function withModal(ui, answer) {
  const asked = [];
  ui.Modal = function () {};
  ui.Modal.prototype.showQuestion = function (title, question) { asked.push({ title: title, question: question }); return answer; };
  return asked;
}

test("Imagery tab with the dialog: one press asks with the plan, and Yes downloads then builds", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  const asked = withModal(ui, true);
  context.buildImageryBtn.onClick();
  const plan = context.imageryState.plan;
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Build imagery");
  assert.match(asked[0].question, new RegExp("^" + plan.items.length + " tiles needed \\(0 already downloaded, about [\\d.]+ [KM]B to download\\)\\.\n\nDownload and build now\\?$"));
  assert.equal(context.buildImageryBtn.getText(), "Build imagery", "no \"Download N\" state with the dialog");
  assert.equal(api._timers.length, 1);
  assert.equal(api._timers[0].active, true, "downloading started from the one press");
  runTimers(api);
  assert.match(context.statusLabel.getText(), new RegExp("^Imagery built: " + plan.items.length + " tiles in \\d+ level\\(s\\) \\(0 missing, 0 failed\\)"));
  assert.equal(context.buildImageryBtn.getText(), "Build imagery");
});

test("Imagery tab with the dialog: with everything already downloaded, one press builds without asking", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  const asked = withModal(ui, true);
  context.buildImageryBtn.onClick();
  runTimers(api);
  let downloads = 0;
  context.GeoNet.downloadTile = () => { downloads++; return { status: 200 }; };
  context.buildImageryBtn.onClick();
  assert.equal(asked.length, 1, "no second question");
  assert.equal(context.buildImageryBtn.getText(), "Build imagery");
  const timer = api._timers[api._timers.length - 1];
  assert.equal(timer.active, true);
  assert.equal(timer.interval, 20, "straight to building");
  runTimers(api);
  assert.equal(downloads, 0);
  assert.match(context.statusLabel.getText(), /^Imagery built: \d+ tiles/);
  assert.equal(imageryGroups(api).length, 1);
});

test("Imagery tab with the dialog: No downloads nothing and resets the plan", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  let downloads = 0;
  context.GeoNet.downloadTile = () => { downloads++; return { status: 200 }; };
  useCustomTiles(context);
  const asked = withModal(ui, false);
  context.buildImageryBtn.onClick();
  assert.equal(asked.length, 1);
  assert.equal(context.statusLabel.getText(), "Nothing downloaded.");
  assert.equal(context.imageryState.plan, null);
  assert.equal(context.buildImageryBtn.getText(), "Build imagery");
  assert.equal(api._timers.length, 0);
  assert.equal(downloads, 0);
  context.buildImageryBtn.onClick();
  assert.equal(asked.length, 2, "the next press plans and asks again");
});

test("Imagery tab with the dialog: the question carries the slower and limited-detail notes", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  keyFlight(api, context.currentMap(), 2, 15);
  context.GeoScene.setCamera(context.currentMap().cameraId, { rotation: 45 });
  useCustomTiles(context);
  const asked = withModal(ui, false);
  context.buildImageryBtn.onClick();
  assert.equal(asked.length, 1);
  const q = asked[0].question;
  assert.ok(q.includes(" — this may make Cavalry slower."), q);
  assert.ok(q.includes(" Sharpest detail is limited to zoom "), q);
  assert.ok(q.endsWith(" — imagery gets softer as the flight zooms in further.\n\nDownload and build now?"), q);
  assert.ok(!q.includes("Press"), q);
});

test("Imagery tab: a ui.Modal without showQuestion keeps the two-press flow", () => {
  const { context, api, ui } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  ui.Modal = function () {};
  context.buildImageryBtn.onClick();
  assert.match(context.buildImageryBtn.getText(), /^Download \d+ tiles$/);
  assert.match(context.statusLabel.getText(), /Press "Download \d+ tiles"\./);
  assert.equal(api._timers.length, 0);
  context.buildImageryBtn.onClick();
  runTimers(api);
  assert.match(context.statusLabel.getText(), /^Imagery built: \d+ tiles/);
});

// Makes the panel's build job do one unit of work per timer tick, so tests can watch it.
function oneUnitPerTick(context) {
  const real = context.GeoScene.beginImageryBuild;
  context.GeoScene.beginImageryBuild = function () {
    const job = real.apply(null, arguments);
    return { step: () => job.step(0), cancel: () => job.cancel() };
  };
}

test("Imagery tab: downloads tick every 60 ms, then the same timer builds in 20 ms steps with progress", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  oneUnitPerTick(context);
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  const total = context.imageryState.plan.items.length;
  context.buildImageryBtn.onClick();
  const timer = api._timers[0];
  assert.equal(timer.interval, 60, "a gap between blocking downloads keeps the UI responsive");
  for (let i = 0; i < total; i++) timer.callbacks.onTimeout();
  assert.equal(timer.active, true, "the same timer keeps running to build");
  assert.equal(timer.interval, 20);
  assert.equal(context.imageryProgress._max, total);
  timer.callbacks.onTimeout();
  assert.equal(context.statusLabel.getText(), "Building imagery: 1 / " + total + " tiles…");
  assert.equal(context.imageryProgress._value, 1);
  context.buildImageryBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Error: Imagery is already being built — press Cancel to stop\.$/);
  runTimers(api);
  assert.equal(api._timers.length, 1);
  assert.match(context.statusLabel.getText(), /^Imagery built: \d+ tiles in \d+ level/);
  assert.doesNotMatch(context.statusLabel.getText(), /pause/);
  assert.equal(context.imageryProgress._value, total, "the progress bar reaches the total");
});

test("Imagery tab: says when it is removing the old imagery after a rebuild", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  runTimers(api);
  oneUnitPerTick(context);
  context.buildImageryBtn.onClick(); // plans again: everything is cached now
  assert.match(context.buildImageryBtn.getText(), /^Build \d+ tiles$/);
  context.buildImageryBtn.onClick(); // nothing to download: builds straight away, on a timer
  const timer = api._timers[api._timers.length - 1];
  assert.equal(timer.active, true);
  assert.equal(timer.interval, 20);
  const seen = [];
  while (timer.active) { timer.callbacks.onTimeout(); seen.push(context.statusLabel.getText()); }
  assert.ok(seen.includes("Removing the old imagery…"), seen.slice(-5).join(" | "));
  assert.match(seen[seen.length - 1], /^Imagery built:/);
  assert.equal(imageryGroups(api).length, 1);
});

test("Imagery tab: Cancel during the build discards the new imagery", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  oneUnitPerTick(context);
  context.sourcePicker.setValue(0); // EOX
  context.buildImageryBtn.onClick();
  const total = context.imageryState.plan.items.length;
  context.buildImageryBtn.onClick();
  const timer = api._timers[0];
  // All downloads, then one build tick (one tile per tick), so the build is still part-way.
  for (let i = 0; i < total + 1; i++) timer.callbacks.onTimeout();
  assert.ok(imageryGroups(api).length === 1, "a partial group exists");
  context.cancelImageryBtn.onClick();
  assert.equal(timer.active, true, "keeps ticking to delete the partial imagery");
  runTimers(api);
  assert.equal(context.statusLabel.getText(), "Cancelled — no imagery was built.");
  assert.deepEqual(imageryGroups(api), []);
  assert.equal(footageCount(api), 0);
  assert.equal(context.buildImageryBtn.getText(), "Build imagery");
});

test("Imagery tab: Cancel stops the download and builds nothing", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  api._timers[0].callbacks.onTimeout();
  context.cancelImageryBtn.onClick();
  assert.equal(api._timers[0].active, false);
  assert.match(context.statusLabel.getText(), /Download cancelled/);
  assert.equal(api.getCompLayers(false).some((id) => String(api.getNiceName(id)).startsWith("Imagery:")), false);
});

// F3: a saved plan must go stale after the camera animation changes underneath it,
// whether from Fly to or a direct keyframe edit - otherwise Build imagery downloads
// or builds tiles for a camera path that no longer matches the scene.
test("Build imagery re-plans (does not start downloading a stale plan) after Fly to changes the camera (F3)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  context.buildImageryBtn.onClick(); // plans
  assert.match(context.buildImageryBtn.getText(), /tiles$/);
  flyRange(context, 0, 4);
  context.flyBtn.onClick();
  context.buildImageryBtn.onClick(); // must re-plan, not start downloading the stale plan
  assert.match(context.statusLabel.getText(), /tiles needed/);
  assert.equal(api._timers.length, 0, "no timer should have started from a stale plan");
});

test("Build imagery re-plans after a camera keyframe changes (F3)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  useCustomTiles(context);
  context.buildImageryBtn.onClick(); // plans
  assert.match(context.buildImageryBtn.getText(), /tiles$/);
  api.keyframe(map.cameraId, 3, { "array.2": 10 });
  context.buildImageryBtn.onClick(); // must re-plan, not start downloading the stale plan
  assert.match(context.statusLabel.getText(), /tiles needed/);
  assert.equal(api._timers.length, 0, "no timer should have started from a stale plan");
});

// F6: pressing "Clear imagery tiles" must report what it freed and drop any active
// plan, since the tiles a plan counted as already-downloaded may now be gone.
test("Imagery tab: Clear imagery tiles reports what it freed and resets the plan (F6)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  useCustomTiles(context);
  context.buildImageryBtn.onClick(); // plans, so imageryState.plan is set
  assert.match(context.buildImageryBtn.getText(), /tiles$/, "a plan should be active");
  let cleared = 0;
  context.GeoNet.clearTiles = () => { cleared++; return { files: 5, bytes: 12345, fallback: false }; };
  context.clearTilesBtn.onClick();
  assert.equal(cleared, 0, "the first press only asks for confirmation");
  assert.match(context.statusLabel.getText(), /Press "Confirm: clear imagery tiles" to delete/);
  assert.equal(context.clearTilesBtn.getText(), "Confirm: clear imagery tiles");
  context.clearTilesBtn.onClick();
  assert.equal(cleared, 1);
  assert.match(context.statusLabel.getText(), /^Imagery tiles cleared: 5 file\(s\), .* freed\. Imagery already built from them will show missing images until you rebuild\.$/);
  assert.equal(context.clearTilesBtn.getText(), "Clear imagery tiles");
  assert.equal(context.buildImageryBtn.getText(), "Build imagery", "the stale plan must be reset");
});

// In Cavalry a Cancel click landed on Clear imagery tiles (just below it) mid-build and
// deleted 998 tiles: it now needs a confirming second press, any other imagery button
// disarms it, and it refuses while a download or build is running.
test("Imagery tab: Clear imagery tiles is disarmed by another button and refused while busy", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api);
  context.sourcePicker.setValue(0); // EOX
  let cleared = 0;
  context.GeoNet.clearTiles = () => { cleared++; return { files: 1, bytes: 1, fallback: false }; };
  context.clearTilesBtn.onClick();
  context.buildImageryBtn.onClick(); // plans, and disarms the clear
  assert.equal(context.clearTilesBtn.getText(), "Clear imagery tiles");
  context.clearTilesBtn.onClick();
  assert.equal(cleared, 0, "a press after another button only asks again");
  context.buildImageryBtn.onClick(); // starts downloading (timer running)
  assert.equal(context.clearTilesBtn.getText(), "Clear imagery tiles");
  context.clearTilesBtn.onClick();
  context.clearTilesBtn.onClick();
  assert.equal(cleared, 0, "never while downloading or building");
  assert.match(context.statusLabel.getText(), /downloading or building/);
});

// F10: the panel's download timer must mark 404/204 tiles empty as they come in.
test("Imagery tab: 404/204 downloads mark the tile empty (F10)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const marked = [];
  context.GeoNet.downloadTile = () => ({ status: 404 });
  context.GeoNet.markEmptyTile = (base) => marked.push(base);
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  const total = context.imageryState.plan.missing.length;
  context.buildImageryBtn.onClick();
  runTimers(api);
  assert.equal(marked.length, total, "every 404'd tile should be marked empty");
  assert.ok(total > 0);
  assert.match(context.statusLabel.getText(), /^Imagery built: 0 tiles in 0 level/);
});

test("Imagery tab: a capped plan says the sharpest detail is limited", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  keyFlight(api, context.currentMap(), 2, 15);
  context.GeoScene.setCamera(context.currentMap().cameraId, { rotation: 45 }); // a turned view needs about twice the tiles
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  const z = context.imageryState.plan.cappedZoom;
  assert.ok(z > 0);
  const text = context.statusLabel.getText();
  assert.ok(text.endsWith(" Sharpest detail is limited to zoom " + z + " to stay under 300 tiles — imagery gets softer as the flight zooms in further."), text);
});

test("Imagery tab: EOX plans and builds images, downloading in the background with one curl batch", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const curl = fakeCurl(api); context.GeoFetch._reset();
  context.sourcePicker.setValue(0); // EOX
  context.buildImageryBtn.onClick();
  const plan = context.imageryState.plan;
  assert.equal(plan.mode, "images");
  assert.match(context.statusLabel.getText(), new RegExp("^" + plan.items.length + " images needed \\(" + context.GeoBlocks.totalTiles(plan.items) + " tiles' worth, 0 already downloaded, about "));
  assert.equal(plan.imageTiles, context.GeoBlocks.totalTiles(plan.items));
  assert.equal(context.buildImageryBtn.getText(), "Download " + plan.items.length + " images");
  context.buildImageryBtn.onClick();
  assert.equal(curl.calls.length, 1, "one background curl for the whole stage");
  runTimersOnce(api);
  assert.match(context.statusLabel.getText(), /^Downloading images: 0 \/ \d+…$/);
  curl.deliver();
  runTimers(api);
  assert.match(context.statusLabel.getText(), /^Imagery built: \d+ images in \d+ level\(s\) \(0 missing, 0 failed\)\. Credit: EOxCloudless/);
  assert.deepEqual(plain(context.GeoFetch.leftovers()), []);
});

test("Imagery tab: background 404s mark the image empty, other codes count as failed, 401 stops", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  let n = 0;
  const curl = fakeCurl(api, () => (n++ === 0 ? 404 : 500)); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  curl.deliver();
  runTimers(api);
  assert.match(context.statusLabel.getText(), /\(1 missing, \d+ failed\)\. Press Build again to retry\./);
  const { context: c2, api: a2 } = buildSandbox();
  createWorldMap(c2);
  const curl2 = fakeCurl(a2, () => 401); c2.GeoFetch._reset();
  c2.sourcePicker.setValue(0);
  c2.buildImageryBtn.onClick();
  const total = c2.imageryState.plan.missing.length;
  c2.buildImageryBtn.onClick();
  curl2.deliver(1);
  runTimers(a2);
  assert.equal(c2.statusLabel.getText(), "EOX refused the request (HTTP 401) — try again later or choose another source.", "EOX has no key (F8)");
  assert.equal(c2.GeoFetch.leftovers().length, total - 1, "only the reported file leaves the in-flight list");
});

// Builds EOX imagery in the background with curl reporting `outcomes[i]` for the i-th image
// (200 for the rest); returns the planned paths in download order.
function eoxWithOutcomes(context, api, outcomes) {
  createWorldMap(context);
  let n = 0;
  const curl = fakeCurl(api, () => (n < outcomes.length ? outcomes[n++] : 200)); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  const plan = context.imageryState.plan;
  const paths = plan.missing.map((r) => context.GeoScene.itemBase(plan, r) + ".jpg");
  context.buildImageryBtn.onClick();
  curl.deliver();
  runTimers(api);
  return { paths, plan, curl };
}

test("Imagery tab: a 200 whose transfer broke off (curl exit 56) counts as failed, and its partial file is deleted and re-planned (F1)", () => {
  const { context, api } = buildSandbox();
  const { paths, plan } = eoxWithOutcomes(context, api, [{ code: 200, exit: 56, type: "image/jpeg", write: "<partial>" }]);
  assert.match(context.statusLabel.getText(), new RegExp("^Imagery built: " + (plan.items.length - 1) + " images in \\d+ level\\(s\\) \\(0 missing, 1 failed\\)\\. Press Build again to retry\\."));
  assert.equal(api._files[paths[0]], undefined, "the partial file is deleted");
  assert.ok(api._files[paths[1]], "whole files are kept");
  assert.deepEqual(plain(context.GeoFetch.leftovers()), []);
  context.buildImageryBtn.onClick(); // plans again
  assert.deepEqual(plain(context.imageryState.plan.missing), [plain(plan.missing[0])]);
});

test("Imagery tab: a 401 still deletes the bad files reported in the same poll before stopping (M1)", () => {
  const { context, api } = buildSandbox();
  const { paths } = eoxWithOutcomes(context, api, [401, { code: 200, exit: 56, type: "image/jpeg", write: "<partial>" }]);
  assert.equal(context.statusLabel.getText(), "EOX refused the request (HTTP 401) — try again later or choose another source.");
  assert.equal(api._files[paths[1]], undefined, "the partial file is not left to look cached");
  assert.deepEqual(plain(context.GeoFetch.leftovers()), []);
  context.buildImageryBtn.onClick(); // plans again
  assert.ok(context.imageryState.plan.missing.length >= 2);
});

test("Imagery tab: a 200 that isn't a JPEG/PNG (an XML error, or no type) counts as failed and is deleted (F1)", () => {
  const { context, api } = buildSandbox();
  const { paths } = eoxWithOutcomes(context, api, [
    { code: 200, exit: 0, type: "text/xml", write: "<ServiceException/>" },
    { code: 200, exit: 0, type: "", write: "<?>" }]);
  assert.match(context.statusLabel.getText(), /\(0 missing, 2 failed\)\. Press Build again to retry\./);
  assert.equal(api._files[paths[0]], undefined);
  assert.equal(api._files[paths[1]], undefined);
});

test("Imagery tab: a stalled background batch counts the rest as failed and still builds", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeCurl(api); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  runTimersOnce(api);
  context.imageryState.batch.lastProgress -= context.GeoFetch.STALL_MS + 1;
  runTimers(api);
  assert.match(context.statusLabel.getText(), /^Imagery built: 0 images in 0 level\(s\) \(0 missing, \d+ failed\)/);
});

test("Imagery tab: Cancel during a background download keeps the in-flight list", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeCurl(api); context.GeoFetch._reset();
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  context.cancelImageryBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Download cancelled. Files still downloading in the background are kept; nothing was built.");
  assert.ok(context.GeoFetch.leftovers().length > 0);
});

test("Imagery tab: a source without a key that answers 403 is said to have refused the request (F8)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  fakeTileDownloads(context, api, 403);
  useCustomTiles(context);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  runTimers(api);
  assert.equal(context.statusLabel.getText(), "The tile server refused the request (HTTP 403) — try again later or choose another source.");
});

test("Imagery tab: images Cavalry can't read are reported as skipped images (F8)", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const curl = fakeCurl(api); context.GeoFetch._reset();
  zeroResolutionFor(api, () => true);
  context.sourcePicker.setValue(0);
  context.buildImageryBtn.onClick();
  const n = context.imageryState.plan.items.length;
  context.buildImageryBtn.onClick();
  curl.deliver();
  runTimers(api);
  const text = context.statusLabel.getText();
  assert.ok(text.includes(" " + n + " image(s) couldn't be read by Cavalry and were skipped."), text);
  assert.ok(!/palette/.test(text), text);
});

test("Imagery tab: missing and rejected keys", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.sourcePicker.setValue(2); // MapTiler
  context.buildImageryBtn.onClick();
  assert.match(context.statusLabel.getText(), /Paste your MapTiler key first/);
  context.maptilerKeyField.setText("bad");
  fakeTileDownloads(context, api, 403);
  context.buildImageryBtn.onClick();
  context.buildImageryBtn.onClick();
  runTimers(api);
  assert.match(context.statusLabel.getText(), /MapTiler rejected your key/);
  assert.equal(context.buildImageryBtn.getText(), "Build imagery");
});

// ---- Update check -------------------------------------------------------------------
const UPDATE_DIR = "C:/fake/AppData/Scripts/CavalryGeo_assets";
const SETTINGS = UPDATE_DIR + "/settings.json";
const REPLY = UPDATE_DIR + "/cache/downloads/latest-release.json";
const NEWER = "Cavalry Geo v0.5.0 is available (you have v0.4.1). Download: https://github.com/optative-visuals/CavalryGeo/releases/latest";
function readSettings(api) { return JSON.parse(api._files[SETTINGS] || "{}"); }
// A panel opened as version 0.4.1 with curl available and `settings` already on disk.
function openForUpdate(settings) {
  let curl;
  const sandbox = buildSandbox({ version: "0.4.1", setup: (api) => {
    curl = fakeCurl(api);
    if (settings) api._files[SETTINGS] = JSON.stringify(settings);
  } });
  return { ...sandbox, curl };
}

test("the bundle stamps package.json's version, which the user agent carries", () => {
  const version = require("../package.json").version;
  assert.ok(buildPanel().includes("var GEO_VERSION = " + JSON.stringify(version) + ";"));
  const { context } = buildSandbox({ version: "9.8.7" });
  assert.match(context.GeoNet.USER_AGENT, /^CavalryGeo\/9\.8\.7 /);
});

test("update check: asks GitHub in the background once, then tells the user about a newer release", () => {
  const { context, api, curl } = openForUpdate();
  assert.equal(curl.calls.length, 1);
  const args = curl.calls[0].args;
  assert.equal(args[args.length - 1], "https://api.github.com/repos/optative-visuals/CavalryGeo/releases/latest");
  assert.equal(args[args.indexOf("-o") + 1], REPLY);
  assert.ok(readSettings(api).updateCheckedAt > 0, "the check is recorded before the reply comes");
  runTimersOnce(api);
  assert.notEqual(context.statusLabel.getText(), NEWER, "nothing until the reply arrives");
  api._files[REPLY] = JSON.stringify({ tag_name: "v0.5.0", draft: false, prerelease: false });
  runTimersOnce(api);
  assert.equal(context.statusLabel.getText(), NEWER);
  assert.equal(readSettings(api).latestVersion, "0.5.0");
  assert.equal(api._files[REPLY], undefined, "the reply file is cleaned up");
  assert.ok(api._timers.every((t) => !t.active));
});

test("update check: a remembered newer release is shown on open without asking GitHub again", () => {
  const { context, curl } = openForUpdate({ updateCheckedAt: Date.now() - 3600000, latestVersion: "0.5.0" });
  assert.equal(curl.calls.length, 0);
  assert.equal(context.statusLabel.getText(), NEWER);
});

test("update check: a day later it asks again, and the same answer isn't shown twice", () => {
  const { context, api, curl } = openForUpdate({ updateCheckedAt: Date.now() - 25 * 3600000, latestVersion: "0.5.0", apiKey: "kept" });
  assert.equal(curl.calls.length, 1);
  context.statusLabel.setText("Ready.");
  api._files[REPLY] = JSON.stringify({ tag_name: "v0.5.0" });
  runTimers(api);
  assert.equal(context.statusLabel.getText(), "Ready.");
  assert.equal(readSettings(api).apiKey, "kept", "other settings survive");
});

test("update check: silent when up to date, switched off, or GitHub never answers", () => {
  let s = openForUpdate();
  s.api._files[REPLY] = JSON.stringify({ tag_name: "v0.4.1" });
  runTimers(s.api);
  assert.doesNotMatch(s.context.statusLabel.getText(), /available/);
  assert.equal(readSettings(s.api).latestVersion, "0.4.1");

  s = openForUpdate({ checkForUpdates: false, latestVersion: "0.5.0" });
  assert.equal(s.curl.calls.length, 0);
  assert.doesNotMatch(s.context.statusLabel.getText(), /available/);

  s = openForUpdate();
  runTimers(s.api);
  assert.ok(s.api._timers.every((t) => !t.active), "it gives up");
  assert.doesNotMatch(s.context.statusLabel.getText(), /available/);
  assert.equal(readSettings(s.api).latestVersion, undefined);
});

test("update check: no curl means no check (opening the panel never waits on the network)", () => {
  const { context, api } = buildSandbox({ version: "0.4.1" });
  assert.equal(api._files[SETTINGS], undefined);
  assert.doesNotMatch(context.statusLabel.getText(), /available/);
});

// ---- Style kit -------------------------------------------------------------------
test("GeoStyle.color reads Cavalry's theme, with fallbacks when it has none", () => {
  const { context, ui } = buildSandbox();
  assert.equal(context.GeoStyle.color("Base"), "#373737", "fallback without getThemeColor");
  ui.getThemeColor = (n) => ({ Base: "#404040" })[n] || "";
  assert.equal(context.GeoStyle.color("Base"), "#404040");
  assert.equal(context.GeoStyle.color("Shadow"), "#1c1c1c", "fallback when the theme returns nothing");
  assert.equal(context.GeoStyle.GREEN, "#33CE70", "the tick colour");
  assert.equal(context.GeoStyle.PRIMARY, "#1F8F4E");
});

test("GeoStyle.heading is a small light-grey sentence-case label followed by a thin line", () => {
  const { context, ui } = buildSandbox();
  const h = context.GeoStyle.heading("Search");
  assert.ok(h instanceof ui.HLayout);
  assert.equal(h._spacing, 6, "tight row");
  const [label, line] = h._items;
  assert.equal(label.getText(), "Search");
  assert.equal(label._fontSize, 11);
  assert.equal(label._textColor, "#a6a6a6");
  assert.equal(context.GeoStyle.HEADING_COLOR, "#a6a6a6");
  assert.equal(label._fixedHeight, 16);
  assert.ok(context.GeoStyle.isHeading(h));
  assert.ok(!context.GeoStyle.isHeading(new ui.HLayout()), "a plain row is not a heading");
  assert.ok(!context.GeoStyle.isHeading(label));
  assert.ok(line instanceof ui.Container);
  assert.equal(line._fixedHeight, 1);
  assert.equal(line._background, "#3a3a3a");
  const n = context.GeoStyle.note("Free for non-commercial use");
  assert.equal(n._fontSize, 11);
  assert.equal(n._textColor, "#8a8a8a");
});

test("GeoStyle.heading with a hint adds a grey hint label between the heading and its line", () => {
  const { context, ui } = buildSandbox();
  const h = context.GeoStyle.heading("Preview", "drag to move · double-click or + / − to zoom");
  assert.equal(h._items.length, 3);
  const [label, hint, line] = h._items;
  assert.equal(label.getText(), "Preview");
  assert.equal(label._textColor, "#a6a6a6");
  assert.ok(hint instanceof ui.Label);
  assert.equal(hint.getText(), "drag to move · double-click or + / − to zoom");
  assert.equal(hint._textColor, "#8a8a8a");
  assert.equal(hint._fontSize, 11);
  assert.ok(line instanceof ui.Container);
  assert.ok(context.GeoStyle.isHeading(h));
  const plainHeading = context.GeoStyle.heading("Search");
  assert.equal(plainHeading._items.length, 2, "a heading without a hint is unchanged");
  assert.equal(plainHeading._items[0].getText(), "Search");
  assert.ok(plainHeading._items[1] instanceof ui.Container);
});

test("Map tab: the Preview heading reads Preview (drag to move)", () => {
  const { context } = buildSandbox();
  const row = context.sectionPages.pages[0]._items.filter((n) => context.GeoStyle.isHeading(n) && n._items[0].getText() === "Preview (drag to move)")[0];
  assert.ok(row, "found the Preview heading");
  assert.equal(row._items.length, 2, "heading with no hint has 2 items: label and line");
  assert.equal(row._items[0].getText(), "Preview (drag to move)");
  assert.equal(row._items[0]._textColor, "#a6a6a6");
});

test("GeoStyle.frameField is a rounded dark box holding a grey F and the field", () => {
  const { context, ui } = buildSandbox();
  const field = new ui.NumericField(5);
  field.setFixedWidth(48);
  const box = context.GeoStyle.frameField(field);
  assert.ok(box instanceof ui.Container);
  assert.equal(box._background, "#282828");
  assert.deepEqual(plain(box._radius), [3, 3, 3, 3]);
  const row = box._layout;
  assert.ok(row instanceof ui.HLayout);
  assert.deepEqual(plain(row._margins), [4, 0, 0, 0]);
  assert.equal(row._spacing, 2);
  assert.equal(row._items.length, 2);
  const [f, held] = row._items;
  assert.ok(f instanceof ui.Label);
  assert.equal(f.getText(), "F");
  assert.equal(f._textColor, "#8a8a8a");
  assert.equal(f._fontSize, undefined);
  assert.equal(held, field);
  assert.equal(field._fixedWidth, 48, "the field keeps its width");
});

test("GeoStyle.frameField without ui.Container is a row of the F and the field", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.Container;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  const field = new ui.NumericField(5);
  const row = context.GeoStyle.frameField(field);
  assert.ok(row instanceof ui.HLayout);
  assert.equal(row._items.length, 2);
  assert.equal(row._items[0].getText(), "F");
  assert.equal(row._items[1], field);
});

test("GeoStyle.heading without ui.Container is just the label", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.Container;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  const h = context.GeoStyle.heading("Search");
  assert.equal(h._items.length, 1);
  assert.equal(h._items[0].getText(), "Search");
});

test("GeoStyle buttons: deep green main actions, quiet housekeeping, all 26 tall", () => {
  const { context } = buildSandbox();
  const p = context.GeoStyle.primaryButton("Search");
  assert.equal(p.getText(), "Search");
  assert.equal(p._background, "#1F8F4E");
  assert.equal(p._fixedHeight, 24);
  const q = context.GeoStyle.quietButton("Clear download cache");
  assert.equal(q._background, undefined, "no background, so the native hover stays");
  assert.equal(q._stroke, undefined);
  assert.equal(q._fixedHeight, 24);
  const b = context.GeoStyle.button("Jump here");
  assert.equal(b.getText(), "Jump here");
  assert.equal(b._background, undefined);
  assert.equal(b._fixedHeight, 24);
});

const ICONS = "C:/fake/AppData/Scripts/CavalryGeo_assets/icons/";
const withIcons = (api) => { api._files[ICONS + "toggle-on.png"] = "<png>"; api._files[ICONS + "toggle-off.png"] = "<png>"; };

test("GeoStyle.toggle is a native button with a tick icon, flips on click and reads like a checkbox", () => {
  const { context } = buildSandbox({ setup: withIcons });
  const t = context.GeoStyle.toggle("Countries", false), seen = [];
  assert.equal(t.getValue(), false);
  assert.equal(t.widget.getText(), " Countries", "a leading space gives a gap after the icon");
  assert.equal(t.widget._image, ICONS + "toggle-off.png");
  assert.deepEqual(plain(t.widget._imageSize), [16, 16]);
  assert.equal(t.widget._fixedHeight, 24);
  t.onValueChanged = (v) => seen.push(v);
  t.widget.onClick();
  assert.equal(t.getValue(), true);
  assert.equal(t.widget._image, ICONS + "toggle-on.png");
  assert.deepEqual(plain(t.widget._imageSize), [16, 16]);
  t.widget.onClick();
  assert.equal(t.getValue(), false);
  assert.equal(t.widget._image, ICONS + "toggle-off.png");
  assert.deepEqual(seen, [true, false]);
  t.setValue(true);
  assert.equal(t.getValue(), true);
  assert.equal(t.widget._image, ICONS + "toggle-on.png");
  assert.deepEqual(seen, [true, false], "setValue doesn't fire onValueChanged");
  assert.equal(t.widget.getText(), " Countries", "the text doesn't change when the icon is there");
  assert.equal(t.widget._background, undefined, "never painted, so the native hover stays");
  assert.equal(context.GeoStyle.toggle("Legend", true).widget._image, ICONS + "toggle-on.png");
});

test("GeoStyle.toggle sets the icon size once, before the first icon, so nothing shifts on the first click", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  withIcons(api);
  const calls = [];
  const setImage = ui.Button.prototype.setImage, setImageSize = ui.Button.prototype.setImageSize;
  ui.Button.prototype.setImage = function (p) { calls.push("image"); setImage.call(this, p); };
  ui.Button.prototype.setImageSize = function (w, h) { calls.push("size"); setImageSize.call(this, w, h); };
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  calls.length = 0;
  const t = context.GeoStyle.toggle("Countries", false);
  assert.deepEqual(plain(t.widget._imageSize), [16, 16], "from creation");
  t.widget.onClick();
  t.widget.onClick();
  assert.deepEqual(calls, ["size", "image", "image", "image"]);
});

test("GeoStyle.toggle without its icon files shows the state in the text", () => {
  const { context } = buildSandbox();
  const t = context.GeoStyle.toggle("Countries", false);
  assert.equal(t.widget.getText(), "Countries");
  assert.equal(t.widget._image, undefined);
  t.widget.onClick();
  assert.equal(t.widget.getText(), "✓ Countries");
  t.widget.onClick();
  assert.equal(t.widget.getText(), "Countries");
  assert.equal(context.GeoStyle.toggle("Legend", true).widget.getText(), "✓ Legend");
  assert.equal(t.widget._background, undefined);
});

test("GeoStyle.toggle without Button.setImage falls back to the text too", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  withIcons(api);
  delete ui.Button.prototype.setImage;
  delete ui.Button.prototype.setImageSize;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  const t = context.GeoStyle.toggle("Bubbles", true);
  assert.equal(t.widget.getText(), "✓ Bubbles");
  t.setValue(false);
  assert.equal(t.widget.getText(), "Bubbles");
});

test("GeoStyle.toggleGrid lays toggles out in rows of N", () => {
  const { context, ui } = buildSandbox();
  const ts = ["A", "B", "C", "D", "E"].map((n) => context.GeoStyle.toggle(n, false));
  const grid = context.GeoStyle.toggleGrid(ts, 3);
  assert.ok(grid instanceof ui.VLayout);
  assert.deepEqual(grid._items.map((r) => r._items.map((w) => w.getText())), [["A", "B", "C"], ["D", "E"]]);
});

test("GeoStyle.pageStack: containers in a VLayout, only the shown page takes space", () => {
  const { context, ui } = buildSandbox();
  const stack = context.GeoStyle.pageStack();
  assert.ok(stack.widget instanceof ui.VLayout);
  const layouts = [new ui.VLayout(), new ui.VLayout(), new ui.VLayout()];
  layouts.forEach((l) => stack.add(l));
  assert.equal(stack.pageCount(), 3);
  assert.equal(stack.currentPage(), 0);
  layouts.forEach((l, i) => assert.equal(stack.pages[i], l));
  assert.equal(stack.widget._items.length, 3);
  stack.widget._items.forEach((c, i) => {
    assert.ok(c instanceof ui.Container);
    assert.equal(c._layout, layouts[i]);
  });
  assert.deepEqual(stack.widget._items.map((c) => c.isHidden()), [false, true, true]);
  stack.setPage(2);
  assert.equal(stack.currentPage(), 2);
  assert.deepEqual(stack.widget._items.map((c) => c.isHidden()), [true, true, false]);
  stack.setPage(7);
  stack.setPage(-1);
  assert.equal(stack.currentPage(), 2, "out-of-range pages are ignored");
  assert.deepEqual(stack.widget._items.map((c) => c.isHidden()), [true, true, false]);
  stack.setPage(0);
  assert.deepEqual(stack.widget._items.map((c) => c.isHidden()), [false, true, true]);
});

test("GeoStyle.pageStack without ui.Container falls back to a real PageView", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.Container;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  const stack = context.GeoStyle.pageStack();
  assert.ok(stack.widget instanceof ui.PageView);
  const a = new ui.VLayout(), b = new ui.VLayout();
  stack.add(a);
  stack.add(b);
  assert.equal(stack.pageCount(), 2);
  assert.equal(stack.pages[0], a);
  assert.equal(stack.pages[1], b);
  assert.equal(stack.currentPage(), 0);
  stack.setPage(1);
  assert.equal(stack.widget.currentPage(), 1, "setPage reaches the PageView");
  assert.equal(stack.currentPage(), 1);
  stack.setPage(5);
  assert.equal(stack.currentPage(), 1, "out-of-range pages are ignored");
});

test("GeoStyle.tabBar: buttons in a dark rounded box, the selected one lighter", () => {
  const { context, ui } = buildSandbox();
  const picked = [];
  const bar = context.GeoStyle.tabBar(["Pins", "Routes"], (name, i) => picked.push(name + ":" + i));
  assert.ok(bar.widget instanceof ui.Container);
  assert.equal(bar.widget._background, "#1c1c1c");
  assert.deepEqual(plain(bar.widget._radius), [6, 6, 6, 6]);
  assert.deepEqual(plain(bar.buttons.map((b) => b.getText())), ["Pins", "Routes"]);
  bar.buttons.forEach((b) => assert.equal(b._stroke, false));
  bar.buttons.forEach((b) => assert.equal(b._fixedHeight, 24));
  assert.equal(bar.selected(), "Pins");
  assert.deepEqual(plain(bar.buttons.map((b) => b._background)), ["#373737", "#1c1c1c"]);
  bar.buttons[1].onClick();
  assert.equal(bar.selected(), "Routes");
  assert.deepEqual(plain(bar.buttons.map((b) => b._background)), ["#1c1c1c", "#373737"]);
  assert.deepEqual(plain(picked), ["Routes:1"]);
  bar.select("Pins");
  assert.equal(bar.selected(), "Pins");
  assert.deepEqual(plain(picked), ["Routes:1"], "select() only repaints");
});

// ---- Restyled sections -------------------------------------------------------------
test("main actions are deep green and housekeeping buttons quiet; every panel button is 26 tall", () => {
  const { context } = buildSandbox();
  const primary = ["searchBtn", "pinSearchBtn", "routeSearchBtn", "flyBtn", "addLayersBtn", "buildImageryBtn", "tipsGotItBtn",
    "pinHereBtn", "labelHereBtn", "calloutHereBtn", "createRouteBtn", "addDataBtn", "addDayNightBtn"];
  const quiet = ["clearCacheBtn", "clearTilesBtn", "tipsBtn"];
  const plainBtns = ["jumpBtn", "updateFlightBtn", "driftBtn", "refreshMapsBtn", "findBtn", "extractBtn", "highlightBtn", "changeEffectBtn", "bakeBtn", "cancelImageryBtn", "dataLoadBtn",
    "refreshLayersBtn", "pinCoordBtn", "labelCoordBtn", "calloutCoordBtn", "addStopBtn", "removeStopBtn", "clearStopsBtn", "addTravellerBtn", "refreshDataBtn", "imageryAttrBtn"];
  primary.forEach((n) => assert.equal(context[n]._background, "#1F8F4E", n));
  quiet.concat(plainBtns).forEach((n) => {
    assert.equal(context[n]._background, undefined, n + " keeps the native hover");
    assert.equal(context[n]._stroke, undefined, n);
  });
  primary.concat(quiet, plainBtns).forEach((n) => assert.equal(context[n]._fixedHeight, 24, n));
});

test("every section page packs its controls at the top; nested layouts get no stretch", () => {
  const { ui, context } = buildSandbox();
  const pages = context.sectionPages.pages;
  assert.equal(pages.length, 5);
  // Label's page is the outer column (tab bar + a PageView of two stretched columns).
  pages.forEach((p, i) => {
    if (i === 3) {
      assert.equal(p._stretch, undefined, "the Label wrapper has none");
      assert.equal(p._items[1], context.labelPages.widget);
      context.labelPages.pages.forEach((c) => assert.equal(c._stretch, 1));
    } else assert.equal(p._stretch, 1, "page " + i);
  });
  walkUi(pages[1], (n) => { if (n instanceof ui.VLayout && n !== pages[1]) assert.equal(n._stretch, undefined, "toggle grid"); });
});

test("each section has grey headings in order", () => {
  const { context } = buildSandbox();
  const pages = context.sectionPages.pages;
  const headings = (layout) => { const out = []; walkUi(layout, (n) => { if (n._textColor === "#a6a6a6" && n._fontSize === 11) out.push(n.getText()); }); return out; };
  assert.deepEqual(headings(pages[0]), ["Start here", "Search", "Preview (drag to move)", "Style"]);
  assert.deepEqual(headings(pages[1]), ["World · Natural Earth", "Streets · OpenStreetMap", "Extract", "Bake", "Controls", "Map furniture"]);
  assert.deepEqual(headings(pages[2]), ["Source", "Build"]);
  assert.deepEqual(headings(pages[3]), ["Place", "Preview (click to set the spot, drag to move)", "At coordinates", "Day & night", "Stops", "Preview (click to add a stop, drag to move)", "Style"]);
  assert.deepEqual(headings(pages[4]), ["Sheet", "Columns", "Show", "Unmatched rows"]);
});

// ---- Label previews ----
function lookupGives(context, name) { const asked = []; context.GeoNet.reverse = (lat, lon, zoom) => { asked.push([lat, lon, zoom]); return name; }; return asked; }
function clickAt(pv, x, y) { pv._draw.onMousePress({ x, y }, "left"); pv._draw.onMouseRelease({ x, y }, "left"); }

test("Label previews: Pins and Routes each get a preview under its heading, with double-click zoom off", () => {
  const { context } = buildSandbox();
  const pages = context.sectionPages.pages;
  assert.ok(holds(pages[3], context.pinsPreview.layout) && holds(pages[3], context.routesPreview.layout));
  assert.equal(context.pinsPreview._draw._toolTip, "Click to set the spot · drag to move · middle-drag or + / − to zoom");
  assert.equal(context.routesPreview._draw._toolTip, "Click to add a stop · drag to move · middle-drag or + / − to zoom");
});

test("Pins preview: a click fills Lat / Lon, sets the ring, and puts the looked-up name in the empty text box", () => {
  const { context } = buildSandbox();
  const asked = lookupGives(context, "Gare du Nord");
  clickAt(context.pinsPreview, 100, 60);
  assert.equal(asked.length, 1);
  const lat = context.latField.getValue(), lon = context.lonField.getValue();
  assert.equal(Math.round(lat * 1e4) / 1e4, lat, "4 decimals");
  assert.equal(context.labelText.getText(), "Gare du Nord");
  assert.equal(context.statusLabel.getText(), "Spot set: Gare du Nord. Press Pin at coordinates or Label at coordinates.");
  lookupGives(context, "Gare de l'Est");
  clickAt(context.pinsPreview, 120, 70);
  assert.equal(context.labelText.getText(), "Gare de l'Est", "an earlier click's name is replaced");
  context.labelText.setText("My cafe");
  lookupGives(context, "Somewhere");
  clickAt(context.pinsPreview, 130, 70);
  assert.equal(context.labelText.getText(), "My cafe", "typed text is never overwritten");
});

test("Pins preview: a failed lookup says the coordinates and clears a stale looked-up name", () => {
  const { context } = buildSandbox();
  lookupGives(context, "Gare du Nord");
  clickAt(context.pinsPreview, 100, 60);
  lookupGives(context, null);
  clickAt(context.pinsPreview, 140, 80);
  assert.equal(context.labelText.getText(), "");
  assert.equal(context.statusLabel.getText(), "Spot set: " + context.coordName() + ". Press Pin at coordinates or Label at coordinates.");
});

test("Pins preview: Pin at coordinates after a click pins the looked-up name there, and the previews redraw with it", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  lookupGives(context, "Here");
  clickAt(context.pinsPreview, 100, 60);
  context.pinCoordBtn.onClick();
  const pins = context.GeoScene.previewModel(context.currentMap()).pins;
  assert.equal(pins.length, 1);
  assert.ok(Math.abs(pins[0].lat - context.latField.getValue()) < 1e-9);
  [context.preview, context.pinsPreview, context.routesPreview].forEach((pv) => {
    pv._render();
    assert.ok(fills(pv._draw, "#1F8F4E").length >= 1, "each preview draws the new pin");
  });
  assert.ok(api);
});

test("Routes preview: each click adds a looked-up stop and the draft is drawn; a failed lookup names it by coordinates", () => {
  const { context } = buildSandbox({ setup: installNe });
  lookupGives(context, "Paris");
  clickAt(context.routesPreview, 100, 60);
  lookupGives(context, "Lyon");
  clickAt(context.routesPreview, 140, 100);
  assert.deepEqual(plain(context.stops.map((s) => s.name)), ["Paris", "Lyon"]);
  assert.equal(context.statusLabel.getText(), "Added stop 2: Lyon.");
  lookupGives(context, null);
  clickAt(context.routesPreview, 180, 120);
  const s = context.stops[2];
  assert.equal(s.name, s.lat.toFixed(4) + ", " + s.lon.toFixed(4));
  context.routesPreview._render();
  assert.ok(strokes(context.routesPreview._draw, "#1F8F4E").length >= 1, "the dashed draft line");
  assert.equal(context.stopsList._model.length, 3);
});

test("Routes preview: the same spot as the last stop is refused without a lookup; a double-click adds once and doesn't zoom", () => {
  const { context } = buildSandbox();
  const asked = lookupGives(context, "Paris");
  clickAt(context.routesPreview, 100, 60);
  const z = context.routesPreview.frameCamera().zoom;
  clickAt(context.routesPreview, 100, 60);
  context.routesPreview._draw.onMouseDoubleClick({ x: 100, y: 60 }, "left");
  assert.equal(context.stops.length, 1);
  assert.equal(asked.length, 1);
  assert.equal(context.statusLabel.getText(), "That's already the last stop.");
  assert.equal(context.routesPreview.frameCamera().zoom, z);
});

test("Routes preview: a click during a lookup is ignored with a status, so stops stay in click order", () => {
  const { context } = buildSandbox();
  let nestedStatus = null, fired = false;
  context.GeoNet.reverse = () => {
    if (!fired) { fired = true; clickAt(context.routesPreview, 140, 100); nestedStatus = context.statusLabel.getText(); return "A"; }
    return "C";
  };
  clickAt(context.routesPreview, 100, 60);
  assert.equal(nestedStatus, "Still looking up the last place…");
  assert.deepEqual(plain(context.stops.map((s) => s.name)), ["A"], "only the first click was added");
  assert.equal(context.statusLabel.getText(), "Added stop 1: A.");
  context.GeoNet.reverse = () => "B";
  clickAt(context.routesPreview, 140, 100);
  assert.deepEqual(plain(context.stops.map((s) => s.name)), ["A", "B"], "clicks work again afterwards");
});

test("Pins preview: a click during a lookup is ignored, so spot, ring and name all belong to the first click", () => {
  const { context } = buildSandbox({ setup: installNe });
  let nestedStatus = null, fired = false;
  context.GeoNet.reverse = () => {
    if (!fired) { fired = true; clickAt(context.pinsPreview, 140, 100); nestedStatus = context.statusLabel.getText(); return "First"; }
    return "Second";
  };
  clickAt(context.pinsPreview, 100, 60);
  assert.equal(nestedStatus, "Still looking up the last place…");
  const v = context.pinsPreview._view(), want = context.GeoPreview.fromPx(v, 100, v.height - 60); // the Label previews are y-up
  assert.ok(Math.abs(context.lonField.getValue() - want.lon) < 1e-3 && Math.abs(context.latField.getValue() - want.lat) < 1e-3, "Lat / Lon are the first click's");
  assert.equal(context.labelText.getText(), "First");
  context.pinsPreview._render();
  const rings = ellipseCmds(strokes(context.pinsPreview._draw, "#ffffff"));
  assert.equal(rings.length, 1);
  assert.ok(Math.abs(rings[0][1] - 100) < 0.5, "the ring is at the first click");
  assert.equal(context.statusLabel.getText(), "Spot set: First. Press Pin at coordinates or Label at coordinates.");
});

test("Previews follow the map: picking a map centres the Label previews on its camera; Create route redraws them", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const cam = context.GeoScene.readCamera(context.currentMap().cameraId);
  [context.pinsPreview, context.routesPreview].forEach((pv) => {
    assert.ok(Math.abs(pv.frameCamera().lat - cam.lat) < 1e-6 && Math.abs(pv.frameCamera().lon - cam.lon) < 1e-6);
  });
  lookupGives(context, "A"); clickAt(context.routesPreview, 100, 60);
  lookupGives(context, "B"); clickAt(context.routesPreview, 200, 120);
  context.createRouteBtn.onClick();
  const m = context.GeoScene.previewModel(context.currentMap());
  assert.equal(m.routes.length, 1);
  context.pinsPreview._render();
  assert.ok(strokes(context.pinsPreview._draw, "#1F8F4E").length >= 2, "legs and stop circles on the Pins preview too");
});

test("Pins search shows its results on the Pins preview; clicking a result dot picks it", () => {
  const { context } = buildSandbox();
  searchFinds(context, [PARIS, PARIS_TX]);
  context.pinSearchField.setText("Paris");
  context.pinSearchBtn.onClick();
  const pv = context.pinsPreview;
  const f = pv.frameCamera();
  assert.ok(Math.abs(f.lat - PARIS.lat) < 1e-6 && Math.abs(f.lon - PARIS.lon) < 1e-6, "centred on the picked result");
  assert.equal(context.pinResultPicker.getValue(), 0);
});

test("every page column packs items 4 apart and puts 4 before each heading that isn't first", () => {
  const { context } = buildSandbox();
  // The Label section's page is just the tab bar over the two Label pages, which are the columns.
  const labelSection = context.sectionPages.pages.find((p) => holds(p, context.labelPages.widget));
  const columns = context.sectionPages.pages.filter((p) => p !== labelSection).concat(context.labelPages.pages);
  assert.equal(columns.length, 6);
  let headingCount = 0;
  columns.forEach((col, c) => {
    assert.equal(col._spacing, 4, "column " + c);
    const spacings = col._spacings || [];
    col._items.forEach((item, i) => {
      const isHeading = item._items && item._items[0] && item._items[0]._textColor === "#a6a6a6" && item._items[0]._fontSize === 11;
      const mine = spacings.filter((s) => s.at === i);
      if (!isHeading) return assert.equal(mine.length, 0, "column " + c + " item " + i + " is not a heading");
      headingCount++;
      if (i === 0) assert.equal(mine.length, 0, "column " + c + ": a first heading gets no space before it");
      else assert.deepEqual(plain(mine), [{ at: i, px: 4 }], "column " + c + " heading at " + i);
    });
  });
  assert.ok(headingCount >= 14, "headings were found");
});

test("content sits on one left edge: page columns have only a top margin and content rows have none", () => {
  const { context, ui } = buildSandbox();
  const labelSection = context.sectionPages.pages.find((p) => holds(p, context.labelPages.widget));
  const columns = context.sectionPages.pages.filter((p) => p !== labelSection).concat(context.labelPages.pages);
  assert.equal(columns.length, 6);
  let rows = 0;
  const visit = (node, c) => {
    if (!node || typeof node !== "object" || node instanceof ui.Container) return; // tab bar / heading rule keep their own padding
    if (node instanceof ui.HLayout && !context.GeoStyle.isHeading(node)) {
      rows++;
      assert.deepEqual(plain(node._margins), [0, 0, 0, 0], "a content row in column " + c);
    }
    (node._items || []).forEach((n) => visit(n, c));
  };
  columns.forEach((col, c) => {
    assert.deepEqual(plain(col._margins), [0, 6, 0, 0], "column " + c);
    visit(col, c);
  });
  assert.ok(rows > 10, "content rows were found");
});

test("layer categories and data Show options are toggle buttons; yes/no settings stay checkboxes", () => {
  const { context, ui } = buildSandbox({ setup: withIcons });
  const pages = context.sectionPages.pages;
  const toggleTexts = (layout) => { const out = []; walkUi(layout, (n) => { if (n instanceof ui.Button && n._image) out.push(n.getText()); }); return out; };
  assert.deepEqual(toggleTexts(pages[1]),
    [" Countries", " States", " Coastlines", " Lakes", " Rivers", " Cities", " Buildings", " Roads", " Water", " Parks", " Railways"]);
  assert.deepEqual(toggleTexts(pages[4]), [" Coloured regions", " Bubbles", " Value labels", " Legend"]);
  assert.equal(context.regionsCheck.getValue(), true);
  assert.equal(context.legendCheck.getValue(), true);
  assert.equal(context.bubblesCheck.getValue(), false);
  [context.creditCheck, context.lookupCheck, context.labelsAtStops].forEach((c) => assert.ok(c instanceof ui.Checkbox));
});

test("Add layers reads the toggles, and asks to turn one on when none are", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  context.addLayersBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Turn on at least one layer.");
  context.checks.countries.widget.onClick();
  assert.equal(context.checks.countries.getValue(), true);
  // The fake has no bundled Natural Earth files, so loading may fail later on — but not on
  // the "nothing picked" check: the toggle was read.
  context.statusLabel.setText("");
  context.addLayersBtn.onClick();
  assert.notEqual(context.statusLabel.getText(), "Error: Turn on at least one layer.");
});

test("Map: the map name and projection only show while \"New map\" is picked", () => {
  const { context } = buildSandbox();
  assert.equal(context.nameField.isHidden(), false, "empty scene: New map is picked");
  assert.equal(context.projPicker.isHidden(), false);
  createWorldMap(context);
  assert.equal(context.nameField.isHidden(), true, "a map is picked after making one");
  assert.equal(context.projPicker.isHidden(), true);
  context.mapPicker.setValue(1);
  context.mapPicker.onValueChanged();
  assert.equal(context.nameField.isHidden(), false);
  context.mapPicker.setValue(0);
  context.mapPicker.onValueChanged();
  assert.equal(context.nameField.isHidden(), true);
});

test("Map tab: without setHidden on LineEdit and DropDown, Search with \"New map\" still creates the map", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.LineEdit.prototype.setHidden;
  delete ui.DropDown.prototype.setHidden;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  assert.ok(!/^Error:/.test(context.statusLabel.getText()), context.statusLabel.getText());
  assert.deepEqual(plain(context.mapPicker._entries), ["Paris", "New map"]);
});

test("Pin here and Add stop with no search say where to search", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  context.pinHereBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Search for a place under Label → Pins first.");
  context.addStopBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Search for a stop under Label → Routes first.");
});

test("GeoStyle.tabBar without ui.Container is a plain HLayout of the buttons, and clicking still selects", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.Container;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  const picked = [];
  const bar = context.GeoStyle.tabBar(["Pins", "Routes"], (name, i) => picked.push(name + ":" + i));
  assert.ok(bar.widget instanceof ui.HLayout);
  assert.equal(bar.widget._items.length, 2);
  bar.buttons.forEach((b, i) => assert.equal(bar.widget._items[i], b));
  bar.buttons[1].onClick();
  assert.equal(bar.selected(), "Routes");
  assert.deepEqual(plain(picked), ["Routes:1"]);
});

// ---- Map preview widget ------------------------------------------------------------
function makePreview(context, opts = {}) {
  const picks = [];
  const p = context.GeoPreviewPanel.create(Object.assign({ compSize: () => ({ width: 1920, height: 1080 }), onPick: (i) => picks.push(i), yUp: false, dim: true, redraw: "timer" }, opts));
  return { p, picks };
}
const fills = (draw, color) => draw._paths.filter((x) => x.paint.color === color && !x.paint.stroke);
const strokes = (draw, color) => draw._paths.filter((x) => x.paint.color === color && x.paint.stroke);

test("preview: draws land as one fill plus one border, the frame, and sizes to 16:9", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  assert.equal(p.available(), true);
  p.setWidth(320);
  assert.deepEqual(plain(p._draw._size), [320, 180]);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._render();
  assert.equal(fills(p._draw, "#4a5a50").length, 1, "one land fill");
  assert.equal(strokes(p._draw, "#2a3530").length, 1, "one border path");
  assert.equal(strokes(p._draw, "#33CE70").length, 1, "the green frame");
  assert.equal(p._draw._background, "#1d2a33");
  const f = p.frameCamera();
  assert.ok(Math.abs(f.zoom - 5) < 1e-9 && Math.abs(f.lat - 45) < 1e-9 && Math.abs(f.lon - 2) < 1e-9);
  assert.equal(p.source(), "camera");
});

test("preview: the Draw gets a small minimum size so the panel can shrink back", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  assert.equal(p._draw._minWidth, 120);
  assert.equal(p._draw._minHeight, 180);
  p.setWidth(320);
  assert.equal(p._draw._minWidth, 120);
  assert.equal(p._draw._minHeight, 180);
  p.setWidth(480);
  assert.equal(p._draw._minWidth, 120);
  assert.equal(p._draw._minHeight, 270);
});

test("preview: two near-identical places draw one dot, and a click reports the picked place's index", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p, picks } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 48.86, lon: 2.35, zoom: 8 }, "result");
  const count = (list) => list.reduce((n, x) => n + x.path.cmds.filter((c) => c[0] === "addEllipse").length, 0);
  const ellipses = () => count(fills(p._draw, "#33CE70")) + count(strokes(p._draw, "#33CE70"));
  p.setPlaces([{ lat: 48.8566, lon: 2.3522, name: "Paris" }, { lat: 48.86, lon: 2.35, name: "Paris, Ile-de-France" }], 1);
  p._render();
  assert.equal(ellipses(), 1, "one dot for one place");
  p._draw.onMousePress({ x: 160, y: 90 }, "left");
  assert.deepEqual(picks, [1], "the original index of the kept (picked) place");
  p.setPlaces([{ lat: 48.8566, lon: 2.3522, name: "Paris" }, { lat: 48.86, lon: 2.35, name: "Paris, Ile-de-France" }], 0);
  p._render();
  assert.equal(ellipses(), 1);
  p.setPlaces([{ lat: 48.8566, lon: 2.3522, name: "Paris" }, { lat: 51.5, lon: -0.12, name: "London" }], 0);
  p._render();
  assert.equal(ellipses(), 2, "far apart places keep both dots");
});

const ellipseCmds = (list) => list.reduce((a, x) => a.concat(x.path.cmds.filter((c) => c[0] === "addEllipse")), []);
const textCmds = (list) => list.reduce((a, x) => a.concat(x.path.cmds.filter((c) => c[0] === "addText")), []);
const PARIS_DOT = { lat: 48.8566, lon: 2.3522, name: "Paris, Ile-de-France, France" };
const TEXAS_DOT = { lat: 33.66, lon: -95.55, name: "Paris, Texas, United States" };

test("preview: the picked place is a solid dot with a white name, the others are labelled green rings", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 40, lon: -45, zoom: 1 }, "result");
  p.setPlaces([PARIS_DOT, TEXAS_DOT], 0);
  p._render();
  const solid = fills(p._draw, "#33CE70");
  assert.equal(solid.length, 1, "one solid green fill");
  assert.equal(ellipseCmds(solid).length, 1, "only the picked dot");
  assert.equal(ellipseCmds(solid)[0][3], 4);
  const rings = strokes(p._draw, "#33CE70").filter((x) => ellipseCmds([x]).length);
  assert.equal(rings.length, 1, "one hollow ring path");
  assert.equal(rings[0].paint.strokeWidth, 1.2);
  assert.equal(ellipseCmds(rings).length, 1);
  assert.equal(ellipseCmds(rings)[0][3], 3, "ring radius 3");
  const white = textCmds(fills(p._draw, "#ffffff"));
  assert.equal(white.length, 1);
  assert.equal(white[0][1], "Paris");
  const grey = textCmds(fills(p._draw, "#a6a6a6"));
  assert.equal(grey.length, 1);
  assert.equal(grey[0][1], "Paris, Texas");
  assert.equal(grey[0][2], 10, "grey label is 10 px");
  // the ring's label sits right of the ring like the picked label does
  assert.equal(grey[0][3], ellipseCmds(rings)[0][1] + 7);
  assert.equal(grey[0][4], ellipseCmds(rings)[0][2] - 4);
});

test("preview: a one-part name gives a one-part grey label", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 40, lon: -45, zoom: 1 }, "result");
  p.setPlaces([PARIS_DOT, { lat: 33.66, lon: -95.55, name: "Texasville" }], 0);
  p._render();
  assert.equal(textCmds(fills(p._draw, "#a6a6a6"))[0][1], "Texasville");
});

test("preview: with nothing picked every place is a green ring", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 40, lon: -45, zoom: 1 }, "result");
  p.setPlaces([PARIS_DOT, TEXAS_DOT], -1);
  p._render();
  assert.equal(ellipseCmds(fills(p._draw, "#33CE70")).length, 0, "no solid dot");
  assert.equal(ellipseCmds(strokes(p._draw, "#33CE70")).length, 2, "two rings");
  assert.equal(textCmds(fills(p._draw, "#ffffff")).length, 0);
  assert.equal(textCmds(fills(p._draw, "#a6a6a6")).length, 2);
});

test("preview: clicking a ring picks that place with its own index", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p, picks } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 40, lon: -45, zoom: 1 }, "result");
  p.setPlaces([PARIS_DOT, TEXAS_DOT], 0);
  p._render();
  const ring = ellipseCmds(strokes(p._draw, "#33CE70"))[0];
  p._draw.onMousePress({ x: ring[1], y: ring[2] }, "left");
  assert.deepEqual(picks, [1]);
});

test("preview: dragging pans the map, marks the source as moved, and redraws on the timer", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "result");
  const before = p.frameCamera();
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMouseMove({ x: 140, y: 100 });
  p._draw.onMouseRelease({ x: 140, y: 100 }, "left");
  assert.ok(p.frameCamera().lon < before.lon, "dragging right moves the frame west");
  assert.equal(p.source(), null);
  const redraws = p._draw._redraws;
  runTimersOnce(api);
  assert.ok(p._draw._redraws > redraws);
});

test("preview: y-up Draw coordinates are flipped", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context, { yUp: true });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const before = p.frameCamera();
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMouseMove({ x: 100, y: 130 }); // up the screen in y-up coordinates
  assert.ok(p.frameCamera().lat < before.lat, "dragging the map up moves the frame south");
});

test("preview: double-click and +/- zoom; zoom stays within camera 0–18", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._draw.onMouseDoubleClick({ x: 160, y: 90 }, "left");
  assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9);
  p.zoomBy(-3);
  assert.ok(Math.abs(p.frameCamera().zoom - 3) < 1e-9);
  p.zoomBy(50);
  assert.ok(Math.abs(p.frameCamera().zoom - 18) < 1e-9);
});

test("preview: clicking a place dot picks it instead of dragging", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p, picks } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setPlaces([{ lat: 45, lon: 2, name: "Here" }, { lat: 46, lon: 4, name: "Nearby" }], 0);
  const before = p.frameCamera();
  p._draw.onMousePress({ x: 161, y: 89 }, "left");
  assert.deepEqual(picks, [0]);
  assert.deepEqual(plain(p.frameCamera()), plain(before), "the press doesn't pan");
  p._draw.onMouseMove({ x: 200, y: 120 }); // no drag started, so moving doesn't pan either
  assert.deepEqual(plain(p.frameCamera()), plain(before), "nor does a move before release");
  p._render();
  assert.equal(fills(p._draw, "#33CE70").length >= 1, true, "dots drawn");
});

test("preview: the current camera shows as a dashed frame", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setCurrentCamera({ lat: 45, lon: 2, zoom: 4 });
  p._render();
  assert.equal(strokes(p._draw, "#e6e6e6").length, 1);
});

// ---- Preview overlay: the zoom readout and − / + are drawn inside the map -----------------
const PILL = "#000000a6", GLYPH = "#e6e6e6";
const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
// View coordinates (y down) to the Draw's: flipped when it is y-up, like the preview does.
const drawPos = (p, r, yUp) => { const c = centreOf(r); return { x: c.x, y: yUp ? p._draw._size[1] - c.y : c.y }; };

test("preview overlay: three dark pills and the light glyphs and readout text are drawn last", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setCurrentCamera({ lat: 45, lon: 2, zoom: 4 });
  p.setPlaces([{ lat: 45, lon: 2, name: "Here" }], 0);
  p._render();
  const pills = fills(p._draw, PILL);
  assert.equal(pills.length, 3, "readout, minus, plus");
  const glyphs = fills(p._draw, GLYPH);
  assert.equal(textCmds(glyphs).length, 1, "the readout text");
  assert.equal(glyphs.reduce((n, x) => n + x.path.cmds.filter((c) => c[0] === "moveTo").length, 0), 3, "a bar for minus and two for plus");
  assert.equal(strokes(p._draw, GLYPH).length, 1, "only the camera's dashed frame is stroked in that colour");
  assert.equal(strokes(p._draw, "#33CE70").length >= 1, true);
  const last = p._draw._paths.slice(-5);
  assert.ok(last.every((x) => (x.paint.color === PILL || x.paint.color === GLYPH) && !x.paint.stroke), "the overlay is the last thing drawn");
});

test("preview overlay: rectangles sit 8 px in from the bottom corners, 20 px high, 4 px apart", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  const o = p._overlay();
  assert.equal(o.plus.w, 20); assert.equal(o.plus.h, 20);
  assert.equal(o.minus.w, 20); assert.equal(o.minus.h, 20);
  assert.equal(o.plus.x + o.plus.w, 320 - 8);
  assert.equal(o.plus.y + o.plus.h, 180 - 8);
  assert.equal(o.minus.y, o.plus.y);
  assert.equal(o.plus.x - (o.minus.x + o.minus.w), 4, "minus is left of plus");
  assert.equal(o.readout.x, 8);
  assert.equal(o.readout.y + o.readout.h, 180 - 8);
  assert.equal(o.readout.h, 20);
  assert.ok(o.readout.w > 30 && o.readout.x + o.readout.w < o.minus.x, "wide enough for its text, clear of the buttons");
});

test("preview overlay: the readout says the frame's zoom and follows it", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._render();
  const text = () => textCmds(fills(p._draw, GLYPH));
  assert.equal(text()[0][1], "Zoom 5.0");
  assert.equal(text()[0][2], 10, "10 px text");
  p.zoomBy(1);
  p._render();
  assert.equal(text()[0][1], "Zoom 6.0");
});

test("preview overlay: glyphs are bars centred in their squares (10 by 2, plus 2 by 10)", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p._render();
  const o = p._overlay(), m = centreOf(o.minus), q = centreOf(o.plus);
  const bars = fills(p._draw, GLYPH).filter((x) => !textCmds([x]).length).reduce((a, x) => a.concat(x.path.cmds), []);
  const rects = [];
  for (let i = 0; i < bars.length; i += 5) {
    const pts = bars.slice(i, i + 4).map((c) => [c[1], c[2]]);
    const xs = pts.map((t) => t[0]), ys = pts.map((t) => t[1]);
    rects.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  assert.equal(rects.length, 3);
  const has = (cx, cy, w, h) => rects.some((r) => Math.abs((r.x0 + r.x1) / 2 - cx) < 1e-9 && Math.abs((r.y0 + r.y1) / 2 - cy) < 1e-9 && Math.abs(r.x1 - r.x0 - w) < 1e-9 && Math.abs(r.y1 - r.y0 - h) < 1e-9);
  assert.ok(has(m.x, m.y, 10, 2), "minus bar");
  assert.ok(has(q.x, q.y, 10, 2), "plus horizontal bar");
  assert.ok(has(q.x, q.y, 2, 10), "plus vertical bar");
});

test("preview overlay: with a y-up Draw the pills are flipped like everything else", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context, { yUp: true });
  p.setWidth(320);
  p._render();
  const o = p._overlay();
  const plusPill = fills(p._draw, PILL)[2].path.cmds;
  const ys = plusPill.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => c[2]);
  assert.equal(Math.min(...ys), 180 - (o.plus.y + o.plus.h), "the plus pill's bottom edge is at the bottom in y-up coordinates");
  assert.equal(Math.max(...ys), 180 - o.plus.y);
});

[false, true].forEach((yUp) => {
  test("preview overlay: pressing + or - zooms by one and starts no drag (y-up " + yUp + ")", () => {
    const { context } = buildSandbox({ setup: installNe });
    const { p, picks } = makePreview(context, { yUp: yUp });
    p.setWidth(320);
    p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
    p.setPlaces([{ lat: 45, lon: 2, name: "Here" }], -1);
    const o = p._overlay();
    p._draw.onMousePress(drawPos(p, o.plus, yUp), "left");
    assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9, "+ zooms in");
    const at = p.frameCamera();
    p._draw.onMouseMove({ x: 10, y: 10 });
    assert.deepEqual(plain(p.frameCamera()), plain(at), "no drag started");
    p._draw.onMouseRelease({ x: 10, y: 10 }, "left");
    p._draw.onMousePress(drawPos(p, o.minus, yUp), "left");
    p._draw.onMousePress(drawPos(p, o.minus, yUp), "left");
    assert.ok(Math.abs(p.frameCamera().zoom - 4) < 1e-9, "- zooms out, once per press");
    assert.deepEqual(picks, [], "and picks nothing");
  });
});

test("preview overlay: a press on the readout does nothing, and a press elsewhere still drags", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const before = p.frameCamera();
  p._draw.onMousePress(drawPos(p, p._overlay().readout, false), "left");
  p._draw.onMouseMove({ x: 200, y: 120 });
  assert.deepEqual(plain(p.frameCamera()), plain(before), "the readout is no drag handle");
  p._draw.onMouseRelease({ x: 200, y: 120 }, "left");
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMouseMove({ x: 140, y: 100 });
  assert.ok(p.frameCamera().lon < before.lon, "elsewhere it drags");
});

test("preview overlay: a double-click on a button or the readout is ignored", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const o = p._overlay();
  ["plus", "minus", "readout"].forEach((k) => {
    p._draw.onMouseDoubleClick(drawPos(p, o[k], false), "left");
    assert.ok(Math.abs(p.frameCamera().zoom - 5) < 1e-9, k + " double-click leaves the zoom");
  });
  p._draw.onMouseDoubleClick({ x: 160, y: 90 }, "left");
  assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9, "elsewhere it still zooms in");
});

[false, true].forEach((yUp) => {
  test("preview: middle-drag up zooms in one level per 100 px, anchored at the press (y-up " + yUp + ")", () => {
    const { context, api } = buildSandbox({ setup: installNe });
    const { p, picks } = makePreview(context, { yUp: yUp, onClick() { throw new Error("a middle press is no click"); } });
    p.setWidth(320);
    p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
    p.setPlaces([{ lat: 45, lon: 2, name: "Here" }], -1);
    const h = p._draw._size[1], at = (viewY) => ({ x: 250, y: yUp ? h - viewY : viewY });
    const anchor = context.GeoPreview.fromPx(p._view(), 250, 40);
    p._draw.onMousePress(at(40), "middle");
    p._draw.onMouseMove(at(40 - 100));
    assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9, "100 px up is one level in");
    const back = context.GeoPreview.toPx(p._view(), anchor.lon, anchor.lat);
    assert.ok(Math.abs(back[0] - 250) < 1e-6 && Math.abs(back[1] - 40) < 1e-6, "the point under the press stays put");
    assert.equal(p.source(), null, "a manual view");
    p._draw.onMouseRelease(at(40 - 100), "middle");
    assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9);
    // after the release, moving does nothing
    p._draw.onMouseMove(at(0));
    assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9, "released");
    // down zooms out, measured from the press, not the last move
    p._draw.onMousePress(at(40), "middle");
    p._draw.onMouseMove(at(40 + 50));
    p._draw.onMouseMove(at(40 + 100));
    assert.ok(Math.abs(p.frameCamera().zoom - 5) < 1e-9, "100 px down is one level out");
    p._draw.onMouseRelease(at(40 + 100), "middle");
    assert.deepEqual(picks, [], "never picks a place");
  });
});

test("preview: a middle double-click leaves the zoom alone and a following move zooms from there", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._draw.onMousePress({ x: 250, y: 40 }, "middle");
  p._draw.onMouseRelease({ x: 250, y: 40 }, "middle");
  p._draw.onMouseDoubleClick({ x: 250, y: 40 }, "middle");
  assert.ok(Math.abs(p.frameCamera().zoom - 5) < 1e-9, "no zoom step");
  p._draw.onMouseMove({ x: 250, y: 40 - 100 });
  assert.ok(Math.abs(p.frameCamera().zoom - 6) < 1e-9, "the drag that follows zooms");
  p._draw.onMouseRelease({ x: 250, y: 40 - 100 }, "middle");
  p._draw.onMouseDoubleClick({ x: 250, y: 40 }, "left");
  assert.ok(Math.abs(p.frameCamera().zoom - 7) < 1e-9, "a left double-click still zooms in");
});

test("preview: a middle press never pans or picks, and without movement changes nothing; left-drag still pans", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const clicks = [];
  const { p, picks } = makePreview(context, { onClick(lon, lat) { clicks.push([lon, lat]); } });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setPlaces([{ lat: 45, lon: 2, name: "Here" }], -1);
  const before = p.frameCamera();
  p._draw.onMousePress({ x: 160, y: 90 }, "middle"); // right on the place's dot
  p._draw.onMouseRelease({ x: 160, y: 90 }, "middle");
  assert.deepEqual(plain(p.frameCamera()), plain(before), "press and release in place changes nothing");
  assert.deepEqual(picks, [], "no place picked");
  assert.deepEqual(clicks, [], "no click");
  assert.equal(p.source(), "camera", "the source is kept");
  p._draw.onMousePress({ x: 100, y: 100 }, "middle");
  p._draw.onMouseMove({ x: 140, y: 100 }); // sideways only
  assert.deepEqual(plain(p.frameCamera()), plain(before), "a sideways middle-drag does not pan");
  p._draw.onMouseRelease({ x: 140, y: 100 }, "middle");
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMouseMove({ x: 140, y: 100 });
  p._draw.onMouseRelease({ x: 140, y: 100 }, "left");
  assert.ok(p.frameCamera().lon < before.lon, "a left drag pans as before");
  assert.ok(Math.abs(p.frameCamera().zoom - before.zoom) < 1e-9, "and does not zoom");
  // a middle press cancels a left drag that never released
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMousePress({ x: 100, y: 100 }, "middle");
  const at = p.frameCamera();
  p._draw.onMouseMove({ x: 100, y: 100 });
  assert.deepEqual(plain(p.frameCamera()), plain(at));
});

test("preview: a middle-drag draws low detail while it moves and full detail after release", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  runTimersOnce(api);
  runTimersOnce(api);
  p._draw.onMousePress({ x: 160, y: 90 }, "middle");
  p._draw.onMouseMove({ x: 160, y: 60 });
  const before = p._draw._redraws;
  runTimersOnce(api);
  assert.equal(p._draw._redraws, before + 1, "redrawn while dragging");
  p._draw.onMouseRelease({ x: 160, y: 60 }, "middle");
  runTimersOnce(api);
  assert.equal(p._draw._redraws, before + 2, "and once more on release");
});

test("preview overlay: the Draw says how to use it, and the old note row and native buttons are gone", () => {
  const { context, ui } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  assert.equal(p._draw._toolTip, "Drag to move · middle-drag, double-click or + / − to zoom");
  assert.deepEqual(p.layout._items.filter((n) => n instanceof ui.HLayout), [], "nothing but the map under the heading");
  assert.equal(p.layout._items[0], p._draw);
  const texts = [];
  walkUi(p.layout, (n) => { if (n.getText) texts.push(n.getText()); });
  assert.ok(!texts.some((t) => /Zoom|drag/i.test(t)), "no note text");
  const noTip = makeFakeUi();
  delete noTip.Draw.prototype.setToolTip;
  const ctx2 = vm.createContext({ api: makeFakeApi(), ui: noTip, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), ctx2, { filename: "CavalryGeo.js" });
  assert.equal(ctx2.preview.available(), true, "a Draw without setToolTip is fine");
});

test("preview: without ui.Draw, or with the data missing, it says so and is unavailable", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.Draw;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  const a = context.GeoPreviewPanel.create({ compSize: () => ({ width: 1920, height: 1080 }), onPick() {}, yUp: false, dim: true, redraw: "timer" });
  assert.equal(a.available(), false);
  const { context: c2 } = buildSandbox(); // no bundled data installed
  const { p } = makePreview(c2);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._render();
  assert.equal(p.available(), false);
});

test("preview: a Draw missing a method doesn't break the panel; the preview says so and is unavailable", () => {
  const api = makeFakeApi(), ui = makeFakeUi();
  ui.Draw.prototype.setBackgroundColor = undefined;
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  assert.ok(ui._root(), "the panel was built");
  assert.equal(context.sectionTabs.selected(), "Map");
  assert.equal(context.preview.available(), false);
  let message = null;
  walkUi(context.preview.layout, (n) => { if (n.getText && /Map preview unavailable/.test(n.getText())) message = n.getText(); });
  assert.ok(message, "the preview's note explains");
  assert.equal(context.createHereBtn.isHidden(), true, "no frame to make a map from");
});

test("preview: setWidth ignores an un-laid-out width of 0 and keeps the view", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(0);
  p.setWidth(-5);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setWidth(320);
  const f = p.frameCamera();
  assert.ok(Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.zoom), JSON.stringify(f));
  assert.ok(Math.abs(f.zoom - 5) < 1e-9 && Math.abs(f.lat - 45) < 1e-9 && Math.abs(f.lon - 2) < 1e-9);
  assert.deepEqual(plain(p._draw._size), [320, 180]);
});

test("preview: the redraw timer is tracked by the widget (no isActive), started once and stopped when idle", () => {
  const { context, api } = buildSandbox({ setup: (a) => {
    installNe(a);
    const T = a.Timer;
    let starts = 0;
    a.Timer = function (cb) { const t = T(cb); delete t.isActive; const s = t.start; t.start = function () { starts++; s(); }; a._starts = () => starts; return t; };
  } });
  const startsBefore = api._starts(); // the panel's own preview has already started its timer
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMouseMove({ x: 110, y: 100 });
  p._draw.onMouseMove({ x: 120, y: 100 });
  assert.equal(api._starts() - startsBefore, 1, "start() once while running");
  assert.equal(api._timers.filter((t) => t.active).length, 1);
  const redraws = p._draw._redraws;
  runTimersOnce(api);
  assert.ok(p._draw._redraws > redraws, "rendered");
  p._draw.onMouseRelease({ x: 120, y: 100 }, "left");
  runTimersOnce(api);
  runTimersOnce(api);
  runTimersOnce(api);
  assert.equal(api._timers.filter((t) => t.active).length, 0, "idle: stopped");
  p.zoomBy(1);
  assert.equal(api._timers.filter((t) => t.active).length, 1, "a change starts it again");
  assert.equal(api._starts() - startsBefore, 2);
});

test("preview: an onPick that throws does not take the preview down", () => {
  const { context } = buildSandbox({ setup: installNe });
  const log = context.console.log;
  context.console = { log() {} };
  const { p } = makePreview(context, { onPick() { throw new Error("boom"); } });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setPlaces([{ lat: 45, lon: 2, name: "Here" }], -1);
  p._draw.onMousePress({ x: 160, y: 90 }, "left");
  assert.equal(p.available(), true);
  p._render();
  assert.equal(p.available(), true);
});

test("preview: a drag that paused before release renders full detail once, not twice", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  runTimersOnce(api);
  runTimersOnce(api);
  const realNow = vm.runInContext("Date.now", context);
  try {
    p._draw.onMousePress({ x: 100, y: 100 }, "left");
    p._draw.onMouseMove({ x: 120, y: 100 });
    const t0 = realNow();
    vm.runInContext("Date.now = function () { return " + (t0 + 500) + "; }", context);
    p._draw.onMouseRelease({ x: 120, y: 100 }, "left");
    const before = p._draw._redraws;
    runTimersOnce(api);
    assert.equal(p._draw._redraws, before + 1, "the release render");
    runTimersOnce(api);
    assert.equal(p._draw._redraws, before + 1, "no redundant second render");
  } finally {
    context.__now = realNow;
    vm.runInContext("Date.now = __now", context);
  }
});

const OVERLAY = {
  colors: { accent: "#a63d2f", text: "#4a3423" },
  pins: [{ lon: 2, lat: 45 }],
  labels: [{ lon: 3, lat: 46, text: "Here" }],
  routes: [{ stops: [{ lon: 0, lat: 44 }, { lon: 4, lat: 44 }], legs: [{ from: { lon: 0, lat: 44 }, to: { lon: 4, lat: 44 }, arc: 30, lean: 0, flip: false }] }]
};
const texts = (draw, color) => draw._paths.filter((x) => x.paint.color === color && (x.path.cmds || []).some((c) => c[0] === "addText"));

test("preview overlay: pins, labels, route legs and stops in the overlay's colours", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setOverlay(OVERLAY);
  p._render();
  assert.equal(fills(p._draw, "#a63d2f").length, 1, "pins: one fill path");
  assert.equal(strokes(p._draw, "#a63d2f").length, 2, "legs + stop circles");
  assert.equal(texts(p._draw, "#4a3423").length, 1, "labels");
  p.setOverlay(null);
  p._render();
  assert.equal(fills(p._draw, "#a63d2f").length + strokes(p._draw, "#a63d2f").length, 0);
});

test("preview overlay: a shape-1 route leg is drawn differently from a shape-0 one", () => {
  const legPath = (shape) => {
    const { context } = buildSandbox({ setup: installNe });
    const { p } = makePreview(context);
    p.setWidth(320);
    p.showCamera({ lat: 45, lon: 2, zoom: 1 }, "camera");
    const leg = { from: { lon: -60, lat: 40 }, to: { lon: 60, lat: 40 }, arc: 0, lean: 0, flip: false, shape };
    p.setOverlay(Object.assign({}, OVERLAY, { routes: [{ stops: [leg.from, leg.to], legs: [leg] }] }));
    p._render();
    return JSON.stringify(strokes(p._draw, "#a63d2f")[0].path);
  };
  assert.notEqual(legPath(1), legPath(0));
});

test("preview draft and spot: dashed accent line with dots, and a white ring", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setOverlay(OVERLAY);
  p.setDraft([{ lon: 1, lat: 45 }, { lon: 3, lat: 45 }]);
  p.setSpot({ lon: 2, lat: 44 });
  p._render();
  assert.equal(fills(p._draw, "#a63d2f").length, 2, "pins + draft dots");
  assert.equal(strokes(p._draw, "#a63d2f").length, 3, "legs + stop circles + dashed draft line");
  assert.equal(strokes(p._draw, "#ffffff").length, 1, "the spot ring");
});

test("preview click: a short press and release reports the place; a drag doesn't", () => {
  const { context } = buildSandbox({ setup: installNe });
  const clicks = [];
  const { p } = makePreview(context, { onClick: (lon, lat) => clicks.push([lon, lat]) });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const before = p.frameCamera();
  p._draw.onMousePress({ x: 100, y: 60 }, "left");
  p._draw.onMouseMove({ x: 102, y: 61 });
  p._draw.onMouseRelease({ x: 102, y: 61 }, "left");
  assert.equal(clicks.length, 1);
  const want = context.GeoPreview.fromPx({ lat: 45, lon: 2, zoom: p._view().zoom, width: 320, height: 180 }, 100, 60);
  assert.ok(Math.abs(clicks[0][0] - want.lon) < 1e-6 && Math.abs(clicks[0][1] - want.lat) < 1e-6, "the press point's place");
  assert.equal(p.frameCamera().lon, before.lon, "a click doesn't pan");
  p._draw.onMousePress({ x: 100, y: 60 }, "left");
  p._draw.onMouseMove({ x: 140, y: 60 });
  p._draw.onMouseRelease({ x: 140, y: 60 }, "left");
  assert.equal(clicks.length, 1, "a drag isn't a click");
  assert.notEqual(p.frameCamera().lon, before.lon, "the drag panned");
});

test("preview click: − / + and result dots keep their meaning; no onClick means no click", () => {
  const { context } = buildSandbox({ setup: installNe });
  const clicks = [];
  const { p, picks } = makePreview(context, { onClick: (lon, lat) => clicks.push([lon, lat]) });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const o = p._overlay();
  p._draw.onMousePress({ x: o.plus.x + 5, y: o.plus.y + 5 }, "left");
  p._draw.onMouseRelease({ x: o.plus.x + 5, y: o.plus.y + 5 }, "left");
  p.setPlaces([{ lat: 45, lon: 2, name: "Dot" }], -1);
  p._draw.onMousePress({ x: 160, y: 90 }, "left");
  p._draw.onMouseRelease({ x: 160, y: 90 }, "left");
  assert.equal(clicks.length, 0);
  assert.deepEqual(plain(picks), [0]);
  const plainPreview = makePreview(context).p; // no onClick
  plainPreview.setWidth(320);
  plainPreview._draw.onMousePress({ x: 100, y: 60 }, "left");
  plainPreview._draw.onMouseRelease({ x: 100, y: 60 }, "left"); // must not throw
});

test("preview click: a missed release never turns the next press on + into a click at the old spot", () => {
  const { context } = buildSandbox({ setup: installNe });
  const clicks = [];
  const { p } = makePreview(context, { onClick: (lon, lat) => clicks.push([lon, lat]) });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const z = p.frameCamera().zoom, o = p._overlay();
  p._draw.onMousePress({ x: 100, y: 60 }, "left"); // the release never arrives
  p._draw.onMousePress({ x: o.plus.x + 5, y: o.plus.y + 5 }, "left");
  p._draw.onMouseRelease({ x: o.plus.x + 5, y: o.plus.y + 5 }, "left");
  assert.equal(clicks.length, 0);
  assert.ok(p.frameCamera().zoom > z, "the + still zoomed");
});

test("preview click: a missed release never turns the next press on a result dot into a click at the old spot", () => {
  const { context } = buildSandbox({ setup: installNe });
  const clicks = [];
  const { p, picks } = makePreview(context, { onClick: (lon, lat) => clicks.push([lon, lat]) });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setPlaces([{ lat: 45, lon: 2, name: "Dot" }], -1);
  p._draw.onMousePress({ x: 20, y: 20 }, "left"); // the release never arrives
  p._draw.onMousePress({ x: 160, y: 90 }, "left");
  p._draw.onMouseRelease({ x: 160, y: 90 }, "left");
  assert.equal(clicks.length, 0);
  assert.deepEqual(plain(picks), [0], "the dot was picked");
});

test("preview options: double-click zoom can be turned off; frame off hides the green frame; hint sets the tooltip", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context, { doubleClickZoom: false, frame: false, dim: false, hint: "Click to add a stop · drag to move · middle-drag or + / − to zoom" });
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  const z = p.frameCamera().zoom;
  p._draw.onMouseDoubleClick({ x: 160, y: 90 }, "left");
  assert.equal(p.frameCamera().zoom, z);
  p._render();
  assert.equal(strokes(p._draw, "#33CE70").length, 0, "no green frame");
  assert.equal(p._draw._toolTip, "Click to add a stop · drag to move · middle-drag or + / − to zoom");
});

// ---- Preview in the Map tab ----------------------------------------------------------
function mapPageHas(context, widget) { return holds(context.sectionPages.pages[0], widget); }

test("Map tab: the preview sits between Search and the Jump here row, with no Camera heading", () => {
  const { context } = buildSandbox({ setup: installNe });
  const items = context.sectionPages.pages[0]._items;
  const texts = items.map((w) => (w._items && w._items[0] && w._items[0].getText ? w._items[0].getText() : null));
  const iSearch = texts.indexOf("Search"), iPreview = texts.indexOf("Preview (drag to move)");
  const iJump = items.findIndex((w) => holds(w, context.jumpBtn));
  assert.ok(iSearch >= 0 && iSearch < iPreview && iPreview < iJump);
  assert.equal(texts.indexOf("Camera"), -1, "no Camera heading");
  assert.ok(items.indexOf(context.preview.layout) === iPreview + 1 && iJump === iPreview + 2, "the Jump here row follows the preview directly");
  assert.ok(mapPageHas(context, context.preview._draw));
});

test("Map tab: a search centres the preview on the first result and shows the results as dots", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  searchFinds(context, [PARIS, PARIS_TX]);
  mapSearch(context, "Paris");
  const f = context.preview.frameCamera();
  assert.ok(Math.abs(f.lat - PARIS.lat) < 1e-6 && Math.abs(f.lon - PARIS.lon) < 1e-6);
  assert.equal(context.preview.source(), "result");
});

test("Map tab: picking a map centres the preview on its camera and shows the dashed frame", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  context.mapPicker.setValue(0);
  context.mapPicker.onValueChanged();
  const cam = context.GeoScene.readCamera(context.currentMap().cameraId);
  const f = context.preview.frameCamera();
  assert.ok(Math.abs(f.zoom - cam.zoom) < 1e-6);
  assert.equal(context.preview.source(), "camera");
});

test("Map tab: after moving the preview, Jump here goes to the green frame", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  context.preview.showCamera({ lat: 10, lon: 20, zoom: 6 }, "camera");
  context.preview.zoomBy(1); // the user moved it: source becomes null
  context.jumpBtn.onClick();
  const cam = context.GeoScene.readCamera(context.currentMap().cameraId);
  assert.ok(Math.abs(cam.lat - 10) < 1e-6 && Math.abs(cam.lon - 20) < 1e-6 && Math.abs(cam.zoom - 7) < 1e-6);
  assert.match(context.statusLabel.getText(), /the preview frame/);
});

test("Map tab: while the preview follows a result, Jump here still names the place", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  context.jumpBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Camera jumped to Paris/);
});

test("Map tab: Create map here appears only for New map and makes a map at the frame", () => {
  const { context } = buildSandbox({ setup: installNe });
  assert.equal(context.createHereBtn.isHidden(), false, "empty scene: New map");
  assert.equal(context.jumpBtn.isHidden(), true);
  context.preview.showCamera({ lat: 35, lon: 139, zoom: 8 }, "camera");
  context.createHereBtn.onClick();
  const map = context.currentMap(), cam = context.GeoScene.readCamera(map.cameraId);
  assert.ok(Math.abs(cam.lat - 35) < 1e-6 && Math.abs(cam.lon - 139) < 1e-6 && Math.abs(cam.zoom - 8) < 1e-6);
  assert.equal(map.name, "Map 1");
  assert.equal(context.createHereBtn.isHidden(), true, "a map is picked now");
  assert.equal(context.jumpBtn.isHidden(), false);
});

test("Map tab: with the preview unavailable, Jump here and Fly here work as before", () => {
  const { context } = buildSandbox(); // no bundled data → preview fails on first render
  context.preview._render();
  assert.equal(context.preview.available(), false);
  createWorldMap(context);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  context.jumpBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Camera jumped to Paris/);
});

test("Map tab: an empty search clears the preview's dots and it follows the World view again", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  context.preview._render();
  const withDots = fills(context.preview._draw, "#33CE70").length;
  assert.ok(withDots > 0, "a result dot is drawn");
  searchFinds(context, []);
  mapSearch(context, "Nowhere");
  context.preview._render();
  assert.equal(fills(context.preview._draw, "#33CE70").length, 0, "no dots left");
  assert.equal(context.preview.source(), "world");
  context.preview._draw.onMousePress({ x: 160, y: 90 }, "left"); // a stale dot would have been clickable
  assert.equal(context.resultPicker.getValue(), 0);
});

test("Map tab: clicking a preview dot that is not one of the results is ignored", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  const f = context.preview.frameCamera();
  // two extra dots the results don't have; the second sits at the centre of the view
  context.preview.setPlaces([{ lat: PARIS.lat, lon: PARIS.lon, name: "a" }, { lat: 0, lon: 0, name: "b" }, { lat: f.lat, lon: f.lon, name: "c" }], 0);
  context.preview._draw.onMousePress({ x: 160, y: 90 }, "left");
  assert.equal(context.resultPicker.getValue(), 1);
  assert.equal(context.preview.source(), "result");
  assert.match(context.statusLabel.getText(), /result\(s\)/);
});

test("Map tab: with New map picked and the preview unavailable, Create map here is hidden", () => {
  const { context } = buildSandbox();
  assert.equal(context.createHereBtn.isHidden(), false, "shown while the preview works");
  context.preview._render(); // no bundled data: the preview fails, and hides the button itself
  assert.equal(context.preview.available(), false);
  assert.equal(context.createHereBtn.isHidden(), true);
  assert.equal(context.jumpBtn.isHidden(), true);
});

test("Map tab: after moving the preview, Fly here goes to the green frame", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const map = context.currentMap();
  context.preview.showCamera({ lat: 10, lon: 20, zoom: 6 }, "camera");
  context.preview.zoomBy(1);
  longComp(api);
  flyRange(context, 20, 29);
  context.flyBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Flight to the preview frame: frames 20–29\./);
  api.setFrame(29);
  assert.ok(Math.abs(api.get(map.cameraId, "array.0") - 10) < 1e-6);
  assert.ok(Math.abs(api.get(map.cameraId, "array.1") - 20) < 1e-6);
  assert.ok(Math.abs(api.get(map.cameraId, "array.2") - 7) < 1e-6);
});

test("Map tab: with the preview unavailable, Fly here still names the picked result", () => {
  const { context, api } = buildSandbox();
  context.preview._render();
  createWorldMap(context);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  longComp(api);
  flyRange(context, 20, 29);
  context.flyBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Flight to Paris: frames 20–29\./);
});

const close = (a, b) => Math.abs(a - b) < 1e-9;
function sameCam(a, b) { return close(a.lat, b.lat) && close(a.lon, b.lon) && close(a.zoom, b.zoom); }

test("Map tab: opening on a scene with a map, Jump here goes to the green frame, which is on the map's camera", () => {
  const { context } = buildSandbox({ setup: installNe });
  context.makeMap("Map", { lat: 35, lon: 139, zoom: 8, rotation: 0, projection: 0 });
  context.refreshMaps(); context.previewFollowPicked(); context.previewShowMap(); // the panel's startup hooks
  const map = context.currentMap(), before = context.GeoScene.readCamera(map.cameraId);
  context.jumpBtn.onClick();
  assert.ok(sameCam(context.GeoScene.readCamera(map.cameraId), before), "the camera stays where it was");
  assert.match(context.statusLabel.getText(), /^Camera jumped to the preview frame \(zoom 8\.0\)\.$/);
});

test("Map tab: Jump here twice after moving the frame goes to the same frame both times", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const map = context.currentMap();
  context.preview.zoomBy(2);
  const frame = context.preview.frameCamera();
  context.jumpBtn.onClick();
  const first = context.GeoScene.readCamera(map.cameraId);
  assert.ok(sameCam(first, frame), "the first Jump goes to the frame");
  context.jumpBtn.onClick();
  assert.ok(sameCam(context.GeoScene.readCamera(map.cameraId), first), "the second Jump doesn't move the camera");
  assert.match(context.statusLabel.getText(), /the preview frame/);
});

test("Map tab: Jump here and Fly here leave the preview where it is and only move the dashed frame", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const map = context.currentMap();
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  const frame = context.preview.frameCamera();
  context.jumpBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Camera jumped to Paris/);
  assert.deepEqual(plain(context.preview.frameCamera()), plain(frame), "no recentre after Jump");
  assert.equal(context.preview.source(), "result", "still following the result");
  context.preview._render();
  assert.equal(strokes(context.preview._draw, "#e6e6e6").length, 1, "the dashed frame shows the camera");
  context.resultPicker.setValue(0);
  context.resultPicker.onValueChanged();
  const world = context.preview.frameCamera();
  flyRange(context, 0, 4);
  context.flyBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Flight to the world view/);
  assert.deepEqual(plain(context.preview.frameCamera()), plain(world), "no recentre after Fly");
  assert.equal(context.preview.source(), "world");
});

test("Map tab: picking a result centres the preview on it; picking World view follows the world view", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  searchFinds(context, [PARIS, PARIS_TX]);
  mapSearch(context, "Paris");
  context.resultPicker.setValue(2);
  context.resultPicker.onValueChanged();
  let f = context.preview.frameCamera();
  assert.ok(Math.abs(f.lat - PARIS_TX.lat) < 1e-6 && Math.abs(f.lon - PARIS_TX.lon) < 1e-6);
  assert.equal(context.preview.source(), "result");
  context.resultPicker.setValue(0);
  context.resultPicker.onValueChanged();
  f = context.preview.frameCamera();
  assert.ok(Math.abs(f.lat - 20) < 1e-6 && Math.abs(f.lon) < 1e-6);
  assert.equal(context.preview.source(), "world");
});

test("Map tab: the preview follows the tab bar's width when the panel is resized", () => {
  const { context, ui } = buildSandbox({ setup: installNe });
  assert.equal(typeof ui.onResize, "function");
  context.sectionTabs.widget._width = 480;
  ui.onResize();
  assert.deepEqual(plain(context.preview._draw._size), [480, 270]);
  context.sectionTabs.widget._width = 300;
  ui.onResize();
  assert.deepEqual(plain(context.preview._draw._size), [300, 169]);
});

test("Map tab: the preview shrinks back when the panel gets narrower", () => {
  const { context, ui } = buildSandbox({ setup: installNe });
  context.sectionTabs.widget._width = 480;
  ui.onResize();
  assert.deepEqual(plain(context.preview._draw._size), [480, 270]);
  context.sectionTabs.widget._width = 260;
  ui.onResize();
  assert.deepEqual(plain(context.preview._draw._size), [260, 146]);
});

test("Map tab: Refresh shows the picked map's camera as the dashed frame", () => {
  const { context } = buildSandbox({ setup: installNe });
  context.GeoScene.createMap("Map", { lat: 35, lon: 139, zoom: 8, rotation: 0, projection: 0 }); // made outside the panel
  context.preview._render();
  assert.equal(strokes(context.preview._draw, "#e6e6e6").length, 0);
  context.refreshMapsBtn.onClick();
  context.preview._render();
  assert.equal(strokes(context.preview._draw, "#e6e6e6").length, 1);
});

// ---- Map tab: Style section ----
const SETTINGS_FILE = "C:/fake/AppData/Scripts/CavalryGeo_assets/settings.json";
function settingsOf(api) { return JSON.parse(api._files[SETTINGS_FILE] || "{}"); }
function pickStyle(context, name) {
  const i = context.mapStylePicker._entries.indexOf(name);
  assert.ok(i >= 0, name + " is listed");
  context.mapStylePicker.setValue(i);
  context.mapStylePicker.onValueChanged();
}

test("Map tab Style: the section sits at the bottom of the Map tab, built-ins listed in order, Dark picked", () => {
  const { context, ui } = buildSandbox();
  assert.deepEqual(context.mapStylePicker._entries, ["Dark", "Light", "Blueprint", "Vintage", "Mono", "Neon night"]);
  assert.equal(context.mapStylePicker.getValue(), 0);
  const items = context.sectionPages.pages[0]._items;
  const last = items.slice(-4, -1); // the Tips row closes the tab
  assert.ok(context.GeoStyle.isHeading(last[0]));
  assert.ok(holds(last[1], context.mapStylePicker) && holds(last[1], context.applyStyleBtn));
  assert.ok(holds(last[2], context.styleNameField) && holds(last[2], context.saveStyleBtn) && holds(last[2], context.deleteStyleBtn));
  assert.ok(ui);
});

test("Map tab Style: Apply and Save hide while New map is picked; Delete and the name box stay", () => {
  const { context } = buildSandbox();
  assert.equal(context.newMapSelected(), true);
  assert.equal(context.applyStyleBtn.isHidden(), true);
  assert.equal(context.saveStyleBtn.isHidden(), true);
  assert.equal(context.deleteStyleBtn.isHidden(), false);
  assert.equal(context.styleNameField.isHidden(), false);
  createWorldMap(context);
  assert.equal(context.applyStyleBtn.isHidden(), false);
  assert.equal(context.saveStyleBtn.isHidden(), false);
});

test("Map tab Style: the picked style is remembered in settings.json and used for the next new map", () => {
  const { context, api } = buildSandbox();
  pickStyle(context, "Vintage");
  assert.equal(settingsOf(api).mapStyle, "Vintage");
  createWorldMap(context);
  const map = context.currentMap();
  assert.equal(plain(api.getUserDataKey(map.groupId, "geoStyle")).name, "Vintage");
  const again = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mono", source: "eox" }); } });
  assert.equal(again.context.mapStylePicker._entries[again.context.mapStylePicker.getValue()], "Mono");
});

test("Map tab Style: picking a style sets the preview's background to its water colour", () => {
  const { context } = buildSandbox();
  pickStyle(context, "Light");
  assert.equal(context.preview._draw._background, "#cfe3ec");
});

test("preview: setColors redraws land, borders and water in the given colours", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p.setColors({ water: "#cfe3ec", land: "#f2efe6", border: "#b9b4a6" });
  p._render();
  assert.equal(p._draw._background, "#cfe3ec");
  assert.equal(fills(p._draw, "#f2efe6").length, 1, "land in the new colour");
  assert.equal(strokes(p._draw, "#b9b4a6").length, 1, "borders in the new colour");
  assert.equal(fills(p._draw, "#4a5a50").length, 0, "no old land colour left");
  assert.equal(strokes(p._draw, "#33CE70").length, 1, "the green frame keeps its colour");
});

test("Map tab Style: Apply restyles the picked map and says so", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  pickStyle(context, "Blueprint");
  context.applyStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Applied Blueprint to Map.");
  assert.equal(api.get(oceanOf(api, map), "material.materialColor"), "#123a6b");
});

test("Map tab Style: Apply reports colours it left alone", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  api.keyframe(oceanOf(api, map), 0, { "material.materialColor": "#000000" });
  pickStyle(context, "Mono");
  context.applyStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Applied Mono to Map. 1 animated or connected colour was left alone.");
});

test("Map tab Style: Save as style saves the map's colours, lists and picks the new style, keeping other settings", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ source: "eox", maptilerKey: "k" }); } });
  createWorldMap(context);
  const map = context.currentMap();
  api.set(oceanOf(api, map), { "material.materialColor": "#010203" });
  context.styleNameField.setText("  Mine ");
  context.saveStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Saved style \"Mine\" from Map.");
  const s = settingsOf(api);
  assert.equal(s.source, "eox");
  assert.equal(s.maptilerKey, "k");
  assert.equal(s.mapStyle, "Mine");
  assert.equal(s.mapStyles.length, 1);
  assert.equal(s.mapStyles[0].name, "Mine");
  assert.equal(s.mapStyles[0].colors.ocean, "#010203");
  assert.deepEqual(context.mapStylePicker._entries.slice(-1), ["Mine"]);
  assert.equal(context.mapStylePicker._entries[context.mapStylePicker.getValue()], "Mine");
  assert.equal(plain(api.getUserDataKey(map.groupId, "geoStyle")).name, "Mine");
});

test("Map tab Style: Save refuses an empty name and a built-in's name", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  context.styleNameField.setText("  ");
  context.saveStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Type a name for the style first.");
  context.styleNameField.setText("blueprint");
  context.saveStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Blueprint is a built-in style — pick another name.");
});

test("Map tab Style: saving over a saved name asks first; No keeps the old one", () => {
  const { context, api, ui } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyles: [{ name: "Mine", colors: { ocean: "#111111" } }] }); } });
  createWorldMap(context);
  const asked = withModal(ui, false);
  context.styleNameField.setText("mine");
  context.saveStyleBtn.onClick();
  assert.equal(asked.length, 1);
  assert.match(asked[0].question, /Replace the saved style Mine\?/);
  assert.equal(settingsOf(api).mapStyles[0].colors.ocean, "#111111");
  assert.equal(context.statusLabel.getText(), "Nothing was saved.");
  withModal(ui, true);
  context.saveStyleBtn.onClick();
  assert.equal(settingsOf(api).mapStyles.length, 1);
  assert.equal(settingsOf(api).mapStyles[0].colors.ocean, "#1d2a33");
});

test("Map tab Style: saving over a saved name with no dialog refuses", () => {
  const { context } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyles: [{ name: "Mine" }] }); } });
  createWorldMap(context);
  context.styleNameField.setText("Mine");
  context.saveStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: \"Mine\" is already saved — pick another name.");
});

test("Map tab Style: Delete removes the picked saved style and refuses built-ins", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mine", mapStyles: [{ name: "Mine" }, { name: "Other" }] }); } });
  assert.equal(context.mapStylePicker._entries[context.mapStylePicker.getValue()], "Mine");
  context.deleteStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Deleted style \"Mine\".");
  assert.deepEqual(settingsOf(api).mapStyles.map((s) => s.name), ["Other"]);
  assert.equal(settingsOf(api).mapStyle, "Dark");
  assert.equal(context.mapStylePicker._entries[context.mapStylePicker.getValue()], "Dark");
  context.deleteStyleBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Built-in styles can't be deleted.");
});

test("Map tab Style: a broken styles entry in settings.json never stops the panel", () => {
  const { context } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: 42, mapStyles: "junk" }); } });
  assert.equal(context.mapStylePicker._entries.length, 6);
  assert.equal(context.mapStylePicker.getValue(), 0);
});

test("Imagery settings are merged into settings.json, never replacing other keys", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ style: "basic", mapStyle: "Mono", mapStyles: [{ name: "Mine" }], updateCheckedAt: 5 }); } });
  context.saveImagerySettings();
  const s = settingsOf(api);
  assert.equal(s.mapStyle, "Mono");
  assert.equal(s.mapStyles[0].name, "Mine");
  assert.equal(s.updateCheckedAt, 5);
  assert.ok("source" in s);
});

// ---- Map controls ------------------------------------------------------------------
function controlsMap(context) { createWorldMap(context); return context.GeoScene.findMaps()[0]; }
// Cavalry keeps non-breaking spaces in a script input's name but strips plain ones, so the
// plugin writes U+00A0 there; tests compare names with plain spaces.
const NBSP = "\u00a0";
function plainSpaces(name) { return String(name).split(NBSP).join(" "); }
function promotedNames(api, comp) {
  return api._promoted(comp).map((s) => { const d = s.indexOf("."); return plainSpaces(api.getCustomAttributeName(s.slice(0, d), s.slice(d + 1))); });
}
// The map's Controls component for a group: main has no geoControlsGroup key.
function controlsOf(api, map, group) {
  return api.getCompLayers(false).find((id) => api.getLayerType(id) === "component" && api.hasUserDataKey(id, "geoControls") && api.getUserDataKey(id, "geoControls") === map.cameraId &&
    ((group || "main") === "main" ? !api.hasUserDataKey(id, "geoControlsGroup") : api.getUserDataKey(id, "geoControlsGroup") === group));
}
function siblingsOfLayer(api, id) { const p = api.getParent(id); return api.getChildren(p || api.getActiveComp()); }
// Whether `id` sits directly above `below` in the same parent.
function directlyAbove(api, id, below) {
  const sib = siblingsOfLayer(api, below), i = sib.indexOf(id);
  return i >= 0 && i === sib.indexOf(below) - 1;
}
function slotsOf(api, valuesId) { return plain(api.getUserDataKey(valuesId, "geoSlots")); }
const CAMERA_NAMES = ["Camera · Zoom", "Camera · Centre latitude", "Camera · Centre longitude", "Camera · Rotation", "Camera · Projection (0 flat · 1 Equal Earth · 2 globe)"];

function fullControlsMap(context) {
  const map = controlsMap(context), G = context.GeoScene, C = require("../src/core/codec.js");
  const poly = C.encodeLayer({ kind: "polygon", features: [{ name: "France", rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]] }] });
  G.createMapLayer(map, "Map: Countries", poly, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  G.createMapLayer(map, "France", poly, { camera: map.cameraId, category: "extract", source: "countries" }, G.layerStyle(map, "extractFill"), {});
  G.addPin(map, "Here", 1, 1);
  G.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 5, lat: 5 }], { arc: 30 });
  G.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context), { regions: true, bubbles: false, labels: false, legend: false });
  G.addScaleBar(map);
  return map;
}

test("controls split: four components stacked main, overlay, data, extract directly above the map group, each with its rows", () => {
  const { context, api } = buildSandbox();
  const map = fullControlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  const ids = ["main", "overlay", "data", "extract"].map((g) => r.components[g]);
  ids.forEach((id) => assert.ok(id, "made"));
  assert.equal(r.componentId, r.components.main);
  ["main", "overlay", "data", "extract"].forEach((g) => assert.equal(controlsOf(api, map, g), r.components[g]));
  assert.equal(api.getNiceName(r.components.overlay), "Map Overlay controls");
  assert.equal(api.getNiceName(r.components.data), "Map Data controls");
  assert.equal(api.getNiceName(r.components.extract), "Map Extract controls");
  const sib = api.getChildren(api.getParent(map.groupId) || api.getActiveComp()), g = sib.indexOf(map.groupId);
  assert.deepEqual(ids.map((id) => sib.indexOf(id)), [g - 4, g - 3, g - 2, g - 1], "stacked in order right above the group");
  const names = (id) => plain(promotedNames(api, id));
  assert.ok(names(r.components.main).includes("Camera · Zoom") && names(r.components.main).includes("Countries · Hide"));
  assert.ok(!names(r.components.main).some((n) => /^(Pins|Data|France|Scale bar|Route)/.test(n)), "main holds only the base map");
  assert.ok(names(r.components.overlay).includes("Pins · Colour") && names(r.components.overlay).includes("Scale bar · Hide") && names(r.components.overlay).includes("Route 1 · Travel %"));
  assert.ok(names(r.components.data).includes("Data · Year"));
  assert.ok(names(r.components.extract).includes("France · Hide"));
  assert.deepEqual(api.getChildren(r.components.overlay), [], "the values utility stays in main");
  assert.ok(api.getChildren(r.components.main).includes(r.valuesId));
});

test("controls split: a plain map has only the main component", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(r.components), { main: r.componentId, overlay: null, data: null, extract: null, time: null });
  assert.equal(controlsOf(api, map, "overlay"), undefined);
});

// What the previous version left: every row in main, the group components gone. Returns the
// direct rows (not from the values utility) that had been in a group component.
function combineIntoMain(api, r) {
  const direct = [];
  ["overlay", "data", "extract"].forEach((g) => {
    const comp = r.components[g];
    if (!comp) return;
    api._promoted(comp).forEach((a) => {
      const d = a.indexOf(".");
      if (a.slice(0, d) !== r.valuesId) direct.push(a);
      api.connect(a.slice(0, d), a.slice(d + 1), r.componentId, "promotedAttributes");
    });
    api.deleteLayer(comp);
  });
  api.setUserData(r.componentId, "geoPromoted", plain(api._promoted(r.componentId)));
  return direct;
}

test("controls split: an old combined Controls is split by one sync, keeping the user's own promotion in main", () => {
  const { context, api } = buildSandbox();
  const map = fullControlsMap(context);
  const r1 = context.GeoControlPanel.sync(map);
  const direct = combineIntoMain(api, r1);
  const has = (suffix) => direct.some((a) => a.endsWith("." + suffix));
  assert.ok(has("hidden") && has("material.materialColor") && has("opacity"), "the fixture holds direct rows: scale bar, extract layer");
  const mine = api.create("basicShape", "Mine");
  api.connect(mine, "opacity", r1.componentId, "promotedAttributes");
  api.set(r1.componentId, { ["promotedAttributes." + (api._promoted(r1.componentId).length - 1) + ".name"]: "My opacity" });
  const r2 = context.GeoControlPanel.sync(map);
  const main = plain(api._promoted(r2.componentId));
  assert.ok(main.includes(mine + ".opacity"), "the user's own promotion stays in main");
  assert.equal(api.get(r2.componentId, "promotedAttributes." + main.indexOf(mine + ".opacity") + ".name"), "My opacity", "with its name");
  const groups = ["overlay", "data", "extract"].map((g) => plain(api._promoted(r2.components[g])));
  direct.forEach((a) => {
    assert.ok(!main.includes(a), a + " left main");
    assert.equal(groups.reduce((n, list) => n + list.filter((x) => x === a).length, 0), 1, a + " is in exactly one new component");
  });
  assert.ok(plain(promotedNames(api, r2.components.overlay)).includes("Pins · Colour"), "values rows are in the new Overlay controls");
  assert.ok(plain(promotedNames(api, r2.components.extract)).includes("France · Hide"));
});

test("controls split: a name typed on a plugin row in the old Controls survives the move into its new component", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  G.addPin(map, "Here", 1, 1);
  const r1 = context.GeoControlPanel.sync(map);
  combineIntoMain(api, r1);
  const slot = r1.valuesId + "." + slotsOf(api, r1.valuesId)["pins:color"];
  const at = plain(api._promoted(r1.componentId)).indexOf(slot);
  assert.ok(at >= 0);
  api.set(r1.componentId, { ["promotedAttributes." + at + ".name"]: "My pins", ["promotedAttributes." + at + ".notes"]: "brand green" });
  const r2 = context.GeoControlPanel.sync(map);
  const to = plain(api._promoted(r2.components.overlay)).indexOf(slot);
  assert.ok(to >= 0, "moved into Overlay controls");
  assert.equal(api.get(r2.components.overlay, "promotedAttributes." + to + ".name"), "My pins");
  assert.equal(api.get(r2.components.overlay, "promotedAttributes." + to + ".notes"), "brand green");
  const other = plain(api._promoted(r2.components.overlay)).indexOf(r1.valuesId + "." + slotsOf(api, r1.valuesId)["pins:hidden"]);
  assert.equal(api.get(r2.components.overlay, "promotedAttributes." + other + ".name"), "", "a row nobody renamed stays unnamed");
});

test("controls split: an overlay component left empty is removed; one holding a user promotion stays", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const pin = G.addPin(map, "Here", 1, 1);
  const r1 = context.GeoControlPanel.sync(map);
  assert.ok(r1.components.overlay);
  api.deleteLayer(pin);
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.components.overlay, null);
  assert.equal(api.layerExists(r1.components.overlay), false);
  const pin2 = G.addPin(map, "Again", 2, 2);
  const r3 = context.GeoControlPanel.sync(map);
  const mine = api.create("basicShape", "Mine");
  api.connect(mine, "opacity", r3.components.overlay, "promotedAttributes");
  api.deleteLayer(pin2);
  const r4 = context.GeoControlPanel.sync(map);
  assert.equal(api.layerExists(r3.components.overlay), true, "kept: it has the user's promotion");
  assert.equal(r4.components.overlay, r3.components.overlay);
});

test("controls split: overlay value rows source from the values utility inside main and still drive the layers", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const pin = G.addPin(map, "Here", 1, 1);
  const r = context.GeoControlPanel.sync(map);
  const slot = slotsOf(api, r.valuesId)["pins:color"];
  assert.ok(plain(api._promoted(r.components.overlay)).includes(r.valuesId + "." + slot));
  assert.equal(api.getInConnection(pin, "material.materialColor"), r.valuesId + "." + slot);
});

const overlaysOf = (api, map) => api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component" && api.hasUserDataKey(id, "geoControls") && api.getUserDataKey(id, "geoControls") === map.cameraId && api.hasUserDataKey(id, "geoControlsGroup") && api.getUserDataKey(id, "geoControlsGroup") === "overlay");

test("controls split: an Overlay component the user moved into another group is found again, not duplicated", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  G.addPin(map, "Here", 1, 1);
  const r1 = context.GeoControlPanel.sync(map);
  const home = api.create("group", "My controls");
  api.parent(r1.components.overlay, home);
  G.addPin(map, "Again", 2, 2);
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.components.overlay, r1.components.overlay, "the same component");
  assert.equal(api.getParent(r2.components.overlay), home, "not moved");
  assert.deepEqual(overlaysOf(api, map), [r1.components.overlay], "exactly one Overlay component");
  assert.ok(plain(promotedNames(api, r2.components.overlay)).includes("Pins · Colour"), "still kept up to date");
});

test("controls split: an untagged component named like the Overlay controls is adopted and tagged", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const mine = api.create("component", "Map Overlay controls");
  G.addPin(map, "Here", 1, 1);
  const r = context.GeoControlPanel.sync(map);
  assert.equal(r.components.overlay, mine, "adopted, not a second one made");
  assert.equal(api.getUserDataKey(mine, "geoControls"), map.cameraId);
  assert.equal(api.getUserDataKey(mine, "geoControlsGroup"), "overlay");
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component" && api.getNiceName(id) === "Map Overlay controls").length, 1);
  assert.ok(plain(promotedNames(api, mine)).includes("Pins · Colour"));
});

test("controls split: an untagged component named like a group is left alone when that group isn't needed", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const mine = api.create("component", "Map Data controls");
  context.GeoControlPanel.sync(map);
  assert.equal(api.layerExists(mine), true, "not adopted and deleted as empty");
  assert.equal(api.hasUserDataKey(mine, "geoControls"), false, "untouched");
});

test("controls split: when the promotions can't be read, a group component with nothing wanted is not deleted", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const pin = G.addPin(map, "Here", 1, 1);
  const r1 = context.GeoControlPanel.sync(map);
  api.deleteLayer(pin);
  const real = api.getInConnectedAttributes;
  api.getInConnectedAttributes = (id) => { if (id === r1.components.overlay) throw new Error("boom"); return real.call(api, id); };
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(api.layerExists(r1.components.overlay), true, "kept: its list couldn't be read");
  assert.equal(r2.components.overlay, r1.components.overlay);
  api.getInConnectedAttributes = real;
  const r3 = context.GeoControlPanel.sync(map);
  assert.equal(api.layerExists(r1.components.overlay), false, "removed once it reads as empty");
  assert.equal(r3.components.overlay, null);
});

test("controls split: a renamed Overlay component is still found by its tag, not duplicated", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  G.addPin(map, "Here", 1, 1);
  const r1 = context.GeoControlPanel.sync(map);
  const realName = api.getNiceName;
  api.getNiceName = (id) => id === r1.components.overlay ? "My pin settings" : realName.call(api, id);
  G.addPin(map, "Again", 2, 2);
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.components.overlay, r1.components.overlay);
  assert.deepEqual(overlaysOf(api, map), [r1.components.overlay], "exactly one Overlay component");
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component").length, 2, "main and Overlay only");
});

test("controls split: a group holding the Overlay controls counts as part of the map", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  context.GeoScene.addPin(map, "Here", 1, 1);
  const r = context.GeoControlPanel.sync(map);
  const home = api.create("group", "My controls");
  api.parent(r.components.overlay, home);
  assert.equal(context.GeoScene.isMapPart(map, home), true);
  assert.equal(context.GeoScene.isMapPart(map, api.create("group", "Unrelated")), false);
});

test("controls: a sync puts \"<Map> Controls\" just above the map group with the camera and Ocean", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  const kids = api.getChildren(map.groupId);
  assert.ok(directlyAbove(api, r.componentId, map.groupId), "directly above the group");
  assert.equal(api.getParent(r.componentId), "", "at the composition's top level");
  assert.equal(kids.indexOf(r.componentId), -1, "not inside the group");
  assert.equal(api.getLayerType(r.componentId), "component");
  assert.equal(api.getNiceName(r.componentId), "Map Map controls");
  assert.deepEqual(api.getChildren(r.componentId), [r.valuesId]);
  assert.equal(api.getNiceName(r.valuesId), "Map control values");
  assert.equal(api.get(r.valuesId, "expression"), "0;");
  const c = map.cameraId, ocean = kids.find((id) => api.getNiceName(id) === "Ocean");
  assert.deepEqual(plain(api._promoted(r.componentId)), [c + ".array.2", c + ".array.0", c + ".array.1", c + ".array.3", c + ".array.4", ocean + ".material.materialColor", ocean + ".hidden"]);
  assert.deepEqual(plain(promotedNames(api, r.componentId)), CAMERA_NAMES.concat(["Ocean · Colour", "Ocean · Hide"]));
  assert.deepEqual(plain(api._overrides[c]["array.4"]), { hardMin: 0, hardMax: 2, step: 1 });
  assert.equal(r.controls, 7);
});

test("controls: a map layer gets direct rows and a Detail value that drives the layer", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const C = require("../src/core/codec.js");
  const enc = C.encodeLayer({ kind: "polygon", features: [{ name: "Here", rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }] });
  const id = context.GeoScene.createMapLayer(map, "Map: Countries", enc, { camera: map.cameraId, category: "countries" }, context.GeoScene.STYLE.countries, {});
  const r = context.GeoControlPanel.sync(map);
  const detail = slotsOf(api, r.valuesId)["layer:" + id + ":detail"];
  assert.deepEqual(plain(api._promoted(r.componentId)).slice(7), [id + ".hidden", id + ".opacity", id + ".material.materialColor", id + ".stroke.strokeColor", id + ".stroke.width", r.valuesId + "." + detail]);
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), ["Countries · Hide", "Countries · Opacity", "Countries · Fill colour", "Countries · Outline colour", "Countries · Outline width", "Countries · Detail"]);
  assert.equal(api.getInConnection(id, "generator.array.5"), r.valuesId + "." + detail);
  assert.equal(api.get(r.valuesId, detail), 100, "starts with the layer's own Detail");
  assert.equal(api.getCustomAttributeName(id, "generator.array.5"), "detail", "the layer's own input keeps its name");
});

test("controls: pins share one Hide, Colour and Size, and a later pin links too", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  const a = S.addPin(map, "A", 0, 0), b = S.addPin(map, "B", 10, 10);
  let r = context.GeoControlPanel.sync(map);
  const color = slotsOf(api, r.valuesId)["pins:color"];
  [a, b].forEach((id) => assert.equal(api.getInConnection(id, "material.materialColor"), r.valuesId + "." + color));
  assert.equal(api.getCustomAttributeName(r.valuesId, color), "Pins" + NBSP + "·" + NBSP + "Colour");
  assert.equal(api.get(r.valuesId, color), "#1F8F4E", "starts with the pins' colour");
  assert.deepEqual(plain(promotedNames(api, r.components.overlay)), ["Pins · Hide", "Pins · Colour", "Pins · Size"]);
  const c = S.addPin(map, "C", 20, 20);
  r = context.GeoControlPanel.sync(map);
  assert.equal(api.getInConnection(c, "material.materialColor"), r.valuesId + "." + color);
  assert.ok(directlyAbove(api, r.components.overlay, map.groupId) && directlyAbove(api, r.componentId, r.components.overlay), "the components stay where they were");
  assert.equal(plain(api._promoted(r.components.overlay)).filter((s) => s === r.valuesId + "." + color).length, 1);
});

test("controls: a pin the user disconnected stays unlinked", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  const a = S.addPin(map, "A", 0, 0), b = S.addPin(map, "B", 10, 10);
  let r = context.GeoControlPanel.sync(map);
  const color = slotsOf(api, r.valuesId)["pins:color"];
  api.disconnect(r.valuesId, color, b, "material.materialColor");
  r = context.GeoControlPanel.sync(map);
  assert.equal(api.getInConnection(b, "material.materialColor"), "");
  assert.equal(api.getInConnection(a, "material.materialColor"), r.valuesId + "." + color);
});

test("controls: on the first sync a pin coloured differently keeps its colour and stays unlinked", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene, C = "material.materialColor";
  const a = S.addPin(map, "A", 0, 0), b = S.addPin(map, "B", 10, 10), c = S.addPin(map, "C", 20, 20); // c is on top: the first target
  api.set(a, { [C]: "#FF0000" });
  api.set(b, { [C]: { r: 31, g: 143, b: 78, a: 255 } }); // the same green as c, read as an object
  let r = context.GeoControlPanel.sync(map);
  const color = slotsOf(api, r.valuesId)["pins:color"];
  assert.equal(api.get(r.valuesId, color), "#1F8F4E", "seeded from the first target");
  assert.equal(api.getInConnection(c, C), r.valuesId + "." + color);
  assert.equal(api.getInConnection(b, C), r.valuesId + "." + color);
  assert.equal(api.getInConnection(a, C), "", "the red pin is left alone");
  assert.equal(api.get(a, C), "#FF0000");
  assert.equal(plain(api.getUserDataKey(a, "geoLinks"))[C], context.GeoControls.recordFor(r.valuesId, "pins:color"));
  assert.equal(api.getInConnection(a, "hidden"), r.valuesId + "." + slotsOf(api, r.valuesId)["pins:hidden"], "its other settings still link");
  r = context.GeoControlPanel.sync(map);
  assert.equal(api.getInConnection(a, C), "", "a later sync still leaves it alone");
});

test("controls: pins added one at a time, with a sync after each, all end up linked", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene, C = "material.materialColor";
  const pins = [];
  let r;
  ["A", "B", "C"].forEach((name, i) => {
    pins.push(S.addPin(map, name, i * 10, i * 10));
    if (i === 2) api.set(pins[2], { [C]: "#0000FF" }); // the input already exists: it links as usual
    r = context.GeoControlPanel.sync(map);
  });
  const color = slotsOf(api, r.valuesId)["pins:color"];
  pins.forEach((id) => assert.equal(api.getInConnection(id, C), r.valuesId + "." + color));
});

test("controls: the user's own promotions stay, after the plugin's, with their names", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  let r = context.GeoControlPanel.sync(map);
  const other = api.create("basicShape", "Other");
  api.connect(other, "position", r.componentId, "promotedAttributes");
  const n = api._promoted(r.componentId).length - 1;
  api.set(r.componentId, { ["promotedAttributes." + n + ".name"]: "My position" });
  S.addPin(map, "A", 0, 0);
  r = context.GeoControlPanel.sync(map);
  const p = plain(api._promoted(r.componentId)), last = p.length - 1;
  assert.equal(p[last], other + ".position");
  assert.equal(api.get(r.componentId, "promotedAttributes." + last + ".name"), "My position");
  assert.ok(plain(api._promoted(r.components.overlay)).includes(r.valuesId + "." + slotsOf(api, r.valuesId)["pins:color"]), "the pin rows are in Overlay controls");
  assert.ok(p.indexOf(map.cameraId + ".array.2") >= 0 && p.indexOf(map.cameraId + ".array.2") < last, "after the plugin's own main rows");
});

test("controls: the user's promotions of this map's own layers stay too (a pin's and the Ocean's position)", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  const pin = S.addPin(map, "A", 0, 0);
  let r = context.GeoControlPanel.sync(map);
  const ocean = oceanOf(api, map);
  api.connect(pin, "position", r.componentId, "promotedAttributes");
  api.set(r.componentId, { ["promotedAttributes." + (api._promoted(r.componentId).length - 1) + ".name"]: "Pin position" });
  api.connect(ocean, "position", r.componentId, "promotedAttributes");
  api.set(r.componentId, { ["promotedAttributes." + (api._promoted(r.componentId).length - 1) + ".name"]: "Ocean position" });
  S.createLabel(map, "Paris", 2.35, 48.85); // adds rows after the pins, so the list is rebuilt
  S.addPin(map, "B", 10, 10);
  r = context.GeoControlPanel.sync(map);
  const p = plain(api._promoted(r.componentId)), n = p.length;
  assert.deepEqual(p.slice(n - 2), [pin + ".position", ocean + ".position"]);
  assert.equal(api.get(r.componentId, "promotedAttributes." + (n - 2) + ".name"), "Pin position");
  assert.equal(api.get(r.componentId, "promotedAttributes." + (n - 1) + ".name"), "Ocean position");
  assert.ok(promotedNames(api, r.components.overlay).indexOf("Labels · Colour") >= 0);
});

test("controls: the Controls component remembers which promotions are the plugin's", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(api.getUserDataKey(r.componentId, "geoPromoted")), plain(api._promoted(r.componentId)));
  // An older component without the record gets it on a sync that changes nothing.
  api.setUserData(r.componentId, "geoPromoted", null);
  context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(api.getUserDataKey(r.componentId, "geoPromoted")), plain(api._promoted(r.componentId)));
});

test("controls: a plugin row that is no longer wanted is removed (a layer whose fill was turned off)", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const C = require("../src/core/codec.js");
  const enc = C.encodeLayer({ kind: "polygon", features: [{ name: "Here", rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }] });
  const id = context.GeoScene.createMapLayer(map, "Map: Countries", enc, { camera: map.cameraId, category: "countries" }, context.GeoScene.STYLE.countries, {});
  let r = context.GeoControlPanel.sync(map);
  assert.ok(api._promoted(r.componentId).indexOf(id + ".material.materialColor") >= 0);
  api.setFill(id, false);
  r = context.GeoControlPanel.sync(map);
  assert.equal(api._promoted(r.componentId).indexOf(id + ".material.materialColor"), -1);
});

test("controls: only the changed tail of the list is removed and added again", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  S.addPin(map, "A", 0, 0);
  S.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 5, lat: 5 }], { arc: 30, labels: false });
  let r = context.GeoControlPanel.sync(map);
  const before = plain(api._promoted(r.components.overlay)), n = before.length;
  assert.ok(n > 3);
  const removed = [], realRemove = api.removeArrayIndex;
  api.removeArrayIndex = function (id, path) { removed.push(path); return realRemove.apply(this, arguments); };
  S.createLabel(map, "Paris", 2.35, 48.85); // the labels' rows go in after the pins' and before the route's
  r = context.GeoControlPanel.sync(map);
  assert.deepEqual(removed, before.slice(3).map((x, i) => "promotedAttributes." + (n - 1 - i)));
  const after = plain(api._promoted(r.components.overlay));
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  assert.deepEqual(after.slice(6), before.slice(3));
  assert.deepEqual(plain(promotedNames(api, r.components.overlay)).slice(0, 6), ["Pins · Hide", "Pins · Colour", "Pins · Size", "Labels · Hide", "Labels · Colour", "Labels · Size"]);
  removed.length = 0;
  context.GeoControlPanel.sync(map);
  assert.deepEqual(removed, [], "a second sync removes nothing");
});

test("controls: if the old list can't be cleared, sync stops instead of growing the list", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  S.createLabel(map, "Paris", 2.35, 48.85);
  let r = context.GeoControlPanel.sync(map);
  const before = plain(api._promoted(r.componentId));
  api.removeArrayIndex = function () { throw new Error("nope"); };
  S.addPin(map, "A", 0, 0);
  assert.throws(() => context.GeoControlPanel.sync(map), /^Error: Couldn't clear the old controls list\.$/);
  assert.deepEqual(plain(api._promoted(r.componentId)), before);
  assert.throws(() => context.GeoControlPanel.sync(map), /Couldn't clear the old controls list\./);
  assert.deepEqual(plain(api._promoted(r.componentId)), before, "still not grown on a second try");
});

test("controls: the promotion count comes from the highest promotedAttributes slot", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  const real = api.getInConnectedAttributes;
  // Other inputs whose names merely start with "promotedAttributes." must not count as slots.
  api.getInConnectedAttributes = function (id) { return real.call(this, id).concat(id === r.componentId ? ["promotedAttributes.extra", "promotedAttributesX.1.attribute"] : []); };
  const removed = [], realRemove = api.removeArrayIndex;
  api.removeArrayIndex = function (id, path) { removed.push(path); return realRemove.apply(this, arguments); };
  context.GeoControlPanel.sync(map);
  assert.deepEqual(removed, []);
  assert.equal(api._promoted(r.componentId).length, 7);
});

test("controls: syncing again changes nothing", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  context.GeoScene.addPin(map, "A", 0, 0);
  const r1 = context.GeoControlPanel.sync(map);
  const before = { promoted: plain(api._promoted(r1.componentId)), slots: slotsOf(api, r1.valuesId), conns: api._connections.length };
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.componentId, r1.componentId);
  assert.equal(r2.valuesId, r1.valuesId);
  assert.deepEqual(plain(api._promoted(r2.componentId)), before.promoted);
  assert.deepEqual(slotsOf(api, r2.valuesId), before.slots);
  assert.equal(api._connections.length, before.conns);
});

test("controls: a deleted Controls component is made again and relinks the pins", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  const a = S.addPin(map, "A", 0, 0), b = S.addPin(map, "B", 10, 10);
  const r1 = context.GeoControlPanel.sync(map);
  api.deleteLayer(r1.componentId);
  const r2 = context.GeoControlPanel.sync(map);
  assert.notEqual(r2.valuesId, r1.valuesId);
  assert.ok(directlyAbove(api, r2.componentId, r2.components.overlay) && directlyAbove(api, r2.components.overlay, map.groupId), "the new component is placed above the rest of the stack");
  const color = slotsOf(api, r2.valuesId)["pins:color"];
  [a, b].forEach((id) => assert.equal(api.getInConnection(id, "material.materialColor"), r2.valuesId + "." + color));
});

test("controls: labels share Hide, Colour and Size", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const t = context.GeoScene.createLabel(map, "Paris", 2.35, 48.85);
  assert.deepEqual(plain(context.GeoScene.findLabels(map)), [t]);
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(promotedNames(api, r.components.overlay)), ["Labels · Hide", "Labels · Colour", "Labels · Size"]);
  assert.equal(api.getInConnection(t, "fontSize"), r.valuesId + "." + slotsOf(api, r.valuesId)["labels:size"]);
});

test("controls: an old-style route gets Travel %, Arc height, Colour and Width; Travel drives each leg's draw helper", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const map = controlsMap(context);
  const route = context.GeoScene.createRoute(map, [{ name: "Paris", lon: 2.35, lat: 48.85 }, { name: "London", lon: -0.12, lat: 51.5 }, { name: "Rome", lon: 12.5, lat: 41.9 }], { lift: 30, pins: false, labels: false });
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(promotedNames(api, r.components.overlay)), ["Route 1 · Travel %", "Route 1 · Arc height", "Route 1 · Colour", "Route 1 · Width"]);
  const travel = slotsOf(api, r.valuesId)["route:" + route.groupId + ":travel"];
  context.GeoScene.routeDraws(route.groupId).forEach((d) => assert.equal(api.getInConnection(d, "array.0"), r.valuesId + "." + travel));
  route.legs.forEach((leg) => assert.equal(api.get(leg, "stroke.trim"), true));
  const lift = slotsOf(api, r.valuesId)["route:" + route.groupId + ":lift"];
  route.legs.forEach((leg) => assert.equal(api.getInConnection(leg, "generator.array.7"), r.valuesId + "." + lift));
  assert.equal(api.get(r.valuesId, lift), 30);
});

test("controls: one failing control row no longer stops the rest", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  S.addPin(map, "A", 0, 0); S.addPin(map, "B", 10, 10);
  const realAdd = api.addDynamic.bind(api);
  let calls = 0;
  api.addDynamic = function () { calls++; if (calls === 2) throw new Error("boom"); return realAdd.apply(null, arguments); };
  let r;
  assert.doesNotThrow(() => { r = context.GeoControlPanel.sync(map); });
  const slots1 = slotsOf(api, r.valuesId);
  assert.ok(slots1["pins:hidden"] && slots1["pins:size"], "the inputs made before and after the failure are recorded");
  assert.equal(slots1["pins:color"], undefined, "the failed row has no input yet");
  const pinRows = () => plain(promotedNames(api, r.components.overlay)).filter((n) => /^Pins · /.test(n));
  assert.deepEqual(pinRows(), ["Pins · Hide", "Pins · Size"]);
  api.addDynamic = realAdd;
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.valuesId, r.valuesId);
  const slots2 = slotsOf(api, r.valuesId);
  assert.equal(slots2["pins:hidden"], slots1["pins:hidden"], "the same input is reused");
  assert.equal(slots2["pins:size"], slots1["pins:size"], "the same input is reused");
  assert.ok(slots2["pins:color"]);
  assert.equal(new Set(Object.keys(slots2).map((k) => slots2[k])).size, Object.keys(slots2).length, "no input is added twice");
  assert.deepEqual(pinRows(), ["Pins · Hide", "Pins · Colour", "Pins · Size"]);
});

test("controls: the user's selection is restored, even when Cavalry selects the layers sync makes", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  const pin = S.addPin(map, "A", 0, 0);
  const realCreate = api.create;
  api.create = function () { const id = realCreate.apply(this, arguments); api.select([id]); return id; };
  api.select([pin]);
  context.GeoControlPanel.sync(map); // makes the component and its values layer
  assert.deepEqual(api.getSelection(), [pin]);
  S.addPin(map, "B", 10, 10);
  api.select([pin]);
  context.GeoControlPanel.sync(map);
  assert.deepEqual(api.getSelection(), [pin]);
});

test("controls: data layers share Data · Year, and each set gets its colours and sizes", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const d = context.GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: true, labels: true, legend: true, prefix: "", suffix: "" });
  const r = context.GeoControlPanel.sync(map);
  const slots = slotsOf(api, r.valuesId), year = slots["data:year"];
  ["regions", "bubbles", "labels"].forEach((k) => assert.equal(api.getInConnection(d.layers[k], "generator.array.7"), r.valuesId + "." + year, k));
  assert.equal(api.get(r.valuesId, year), 2020, "starts at the layers' year");
  assert.deepEqual(plain(promotedNames(api, r.components.data)), [
    "Data · Year", "Data 1 · Low colour", "Data 1 · High colour", "Data 1 · No-data colour",
    "Data 1 · Bubble size", "Data 1 · Bubble colour", "Data 1 · Label size"
  ]);
  assert.equal(api.getInConnection(d.layers.regions, "generator.array.8"), r.valuesId + "." + slots["data:" + d.groupId + ":low"]);
});

test("controls: a regions layer whose Use middle can't be read still gets its other rows", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), E = context.GeoExpression;
  const d = context.GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: false, labels: false, legend: false });
  const useMiddle = "generator.array." + E.inputIndex(E.REGION_INPUTS, "useMiddle"), realGet = api.get;
  api.get = function (id, attr) { if (id === d.layers.regions && attr === useMiddle) throw new Error("no"); return realGet.apply(this, arguments); };
  let r;
  assert.doesNotThrow(() => { r = context.GeoControlPanel.sync(map); });
  assert.deepEqual(plain(promotedNames(api, r.components.data)), ["Data · Year", "Data 1 · Low colour", "Data 1 · High colour", "Data 1 · No-data colour"]);
});

test("controls: a label helper whose connections can't be read skips only its own label", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), S = context.GeoScene;
  const t1 = S.createLabel(map, "Paris", 2.35, 48.85), t2 = S.createLabel(map, "Rome", 12.5, 41.9);
  const real = api.getOutConnections;
  let calls = 0;
  api.getOutConnections = function () { if (calls++ === 0) throw new Error("no"); return real.apply(this, arguments); };
  const found = plain(S.findLabels(map));
  assert.equal(found.length, 1);
  assert.ok(found[0] === t1 || found[0] === t2);
});

test("controls: a leg whose name doesn't say its number still gets its own draw helper in order", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const map = controlsMap(context);
  const route = context.GeoScene.createRoute(map, [{ name: "Paris", lon: 2.35, lat: 48.85 }, { name: "London", lon: -0.12, lat: 51.5 }, { name: "Rome", lon: 12.5, lat: 41.9 }], { lift: 30, pins: false, labels: false });
  const realName = api.getNiceName;
  api.getNiceName = function (id) { return id === route.legs[1] ? "Last hop" : realName.apply(this, arguments); };
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(promotedNames(api, r.components.overlay)), ["Route 1 · Travel %", "Route 1 · Arc height", "Route 1 · Colour", "Route 1 · Width"]);
  const travel = slotsOf(api, r.valuesId)["route:" + route.groupId + ":travel"], draws = context.GeoScene.routeDraws(route.groupId);
  assert.equal(draws.length, 2);
  draws.forEach((d, k) => { assert.equal(api.getInConnection(d, "array.0"), r.valuesId + "." + travel); assert.equal(api.get(d, "array.1"), k, "each helper keeps its leg's place"); });
});

test("controls: sync never looks inside imagery groups (they hold thousands of tiles)", () => {
  const { context, api, map, src, plan } = imageryFixture();
  const im = context.GeoScene.buildImagery(map, src, {}, plan);
  const inside = new Set();
  (function walk(id) { inside.add(id); api.getChildren(id).forEach(walk); })(im.groupId);
  const asked = [], real = api.getChildren;
  api.getChildren = function (id) { asked.push(id); return real.apply(this, arguments); };
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(asked.filter((id) => inside.has(id)), []);
  assert.ok(promotedNames(api, r.componentId).indexOf("Imagery: EOX Sentinel-2 · Opacity") >= 0);
});

test("controls: without getLayerType, sync says this Cavalry can't do it", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  delete api.getLayerType;
  assert.throws(() => context.GeoControlPanel.sync(map), /This version of Cavalry can't update a map's Controls\./);
});

test("controls: Bake updates the picked map's Controls, and doesn't need a picked map", () => {
  const { context, api } = buildSandbox();
  const calls = [];
  context.GeoControlPanel.sync = (m) => { calls.push(m.cameraId); return { controls: 0 }; };
  const loose = context.GeoScene.createMap("Loose", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 }); // not in the picker
  const a = context.GeoScene.createMapLayer(loose, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: loose.cameraId, category: "countries" }, {}, {});
  api.select([a]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Baked 1 layer(s) at the current frame. Baked shapes no longer follow the camera.");
  assert.deepEqual(calls, [], "no map picked: nothing to sync");
  createWorldMap(context);
  const map = context.GeoScene.findMaps().find((m) => m.name === "Map");
  assert.equal(context.mapPicker.getValue(), context.GeoScene.findMaps().findIndex((m) => m.cameraId === map.cameraId), "the new map is picked");
  const b = context.GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  api.select([b]);
  context.bakeBtn.onClick();
  assert.deepEqual(calls, [map.cameraId]);
  context.GeoControlPanel.sync = () => { throw new Error("boom"); };
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Baked 1 layer\(s\) .*\. Its controls couldn't be updated: boom\. Press Refresh controls \(Layers tab\) to try again\.$/);
});

test("controls: without user data, sync says this Cavalry can't do it", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  delete api.setUserData;
  assert.throws(() => context.GeoControlPanel.sync(map), /This version of Cavalry can't update a map's Controls\./);
});

test("controls: a map made by Search gets its Controls component straight away", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  const map = context.GeoScene.findMaps()[0];
  const top = controlsOf(api, map);
  assert.equal(api.getLayerType(top), "component");
  assert.equal(api.getNiceName(top), map.name + " Map controls");
  assert.ok(directlyAbove(api, top, map.groupId));
  assert.ok(promotedNames(api, top).indexOf("Countries · Fill colour") >= 0, "starter layers are in it");
});

test("controls: adding a pin updates the Controls", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.lonField.setValue(2.35); context.latField.setValue(48.85);
  context.pinCoordBtn.onClick();
  const map = context.GeoScene.findMaps()[0];
  const comp = controlsOf(api, map, "overlay");
  assert.ok(promotedNames(api, comp).indexOf("Pins · Colour") >= 0);
  assert.ok(!/couldn't/.test(context.statusLabel.getText()), context.statusLabel.getText());
});

test("controls: a failed update keeps the action and says how to retry", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.GeoControlPanel.sync = () => { throw new Error("boom"); };
  context.pinCoordBtn.onClick();
  const map = context.GeoScene.findMaps()[0];
  assert.equal(context.GeoScene.findMapLayers(map).filter((l) => l.meta.category === "pin").length, 1);
  assert.match(context.statusLabel.getText(), /^Pin added at .*\. Its controls couldn't be updated: boom\. Press Refresh controls \(Layers tab\) to try again\.$/);
});

test("controls: Refresh controls lives on the Layers tab and (re)builds the Controls", () => {
  const { context, api } = buildSandbox();
  assert.ok(holds(context.sectionPages.pages[1], context.refreshControlsBtn));
  context.refreshControlsBtn.onClick();
  assert.equal(context.statusLabel.getText(), NO_MAP);
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  context.refreshControlsBtn.onClick();
  const comp = controlsOf(api, map);
  assert.equal(api.getLayerType(comp), "component");
  assert.equal(context.statusLabel.getText(), "Controls updated: " + api._promoted(comp).length + " settings in Map Map controls.");
  context.GeoScene.addPin(map, "Here", 1, 1);
  context.refreshControlsBtn.onClick();
  const total = api._promoted(comp).length + api._promoted(controlsOf(api, map, "overlay")).length;
  assert.equal(context.statusLabel.getText(), "Controls updated: " + total + " settings across Map Map controls and Overlay controls.");
});

test("controls rename: a new map's main component is named \"<Map> Map controls\"", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  assert.equal(api.getNiceName(r.componentId), "Map Map controls");
});

test("controls rename: a main component still named the old default is renamed on sync; the user's own name stays", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r1 = context.GeoControlPanel.sync(map);
  api.rename(r1.componentId, "Map Controls");
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.componentId, r1.componentId);
  assert.equal(api.getNiceName(r1.componentId), "Map Map controls", "renamed");
  api.rename(r1.componentId, "My controls");
  context.GeoControlPanel.sync(map);
  assert.equal(api.getNiceName(r1.componentId), "My controls", "the user's name is kept");
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component").length, 1, "no second main component");
});

test("controls rename: sync works when the API has no rename", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r1 = context.GeoControlPanel.sync(map);
  api.rename(r1.componentId, "Map Controls");
  delete api.rename;
  assert.doesNotThrow(() => context.GeoControlPanel.sync(map));
  assert.equal(api.getNiceName(r1.componentId), "Map Controls");
});

test("controls rename: an untagged component named \"<Map> Controls\" or \"<Map> Map controls\" is adopted as main", () => {
  ["Map Controls", "Map Map controls"].forEach((name) => {
    const { context, api } = buildSandbox();
    const map = controlsMap(context);
    const mine = api.create("component", name);
    const r = context.GeoControlPanel.sync(map);
    assert.equal(r.componentId, mine, name + ": adopted");
    assert.equal(api.getUserDataKey(mine, "geoControls"), map.cameraId);
    assert.equal(api.getNiceName(mine), "Map Map controls");
    assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component").length, 1, "no second main made");
  });
});

test("controls rename: Refresh controls names the components that exist, singular for one setting", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  context.GeoScene.addPin(map, "Here", 1, 1);
  context.refreshControlsBtn.onClick();
  let n = ["main", "overlay"].reduce((t, g) => t + api._promoted(controlsOf(api, map, g)).length, 0);
  assert.equal(context.statusLabel.getText(), "Controls updated: " + n + " settings across Map Map controls and Overlay controls.");
  context.GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context), { regions: true, bubbles: false, labels: false, legend: false });
  context.refreshControlsBtn.onClick();
  n = ["main", "overlay", "data"].reduce((t, g) => t + api._promoted(controlsOf(api, map, g)).length, 0);
  assert.equal(context.statusLabel.getText(), "Controls updated: " + n + " settings across Map Map controls, Overlay controls and Data controls.");
  const full = buildSandbox();
  const fmap = fullControlsMap(full.context);
  full.context.refreshControlsBtn.onClick();
  assert.match(full.context.statusLabel.getText(), /^Controls updated: \d+ settings across Map Map controls, Overlay controls, Data controls and Extract controls\.$/);
  assert.ok(fmap);
});

test("controls rename: Refresh controls says \"1 setting\" for a single setting", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  context.GeoControlPanel.sync = () => ({ controls: 1, components: { main: "c", overlay: null, data: null, extract: null } });
  context.refreshControlsBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Controls updated: 1 setting in Map Map controls.");
});

// ---- Map controls: where the component sits, selection, readable names ------------------
test("controls: a new map's Controls sits directly above its group at the top level, with its values layer inside", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  const top = api.getChildren(api.getActiveComp());
  assert.ok(top.indexOf(r.componentId) >= 0);
  assert.equal(top.indexOf(r.componentId), top.indexOf(map.groupId) - 1);
  assert.equal(api.getChildren(map.groupId).indexOf(r.componentId), -1);
  assert.deepEqual(api.getChildren(r.componentId), [r.valuesId]);
  assert.equal(api.getParent(r.valuesId), r.componentId);
});

test("controls: with two maps, each Controls sits directly above its own group", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.makeMap("Second", context.worldViewCamera(0));
  const maps = context.GeoScene.findMaps();
  assert.equal(maps.length, 2);
  const rs = maps.map((m) => context.GeoControlPanel.sync(m));
  maps.forEach((m, i) => {
    assert.ok(directlyAbove(api, rs[i].componentId, m.groupId), m.name);
    assert.equal(api.getNiceName(rs[i].componentId), m.name + " Map controls");
  });
  assert.notEqual(rs[0].componentId, rs[1].componentId);
});

test("controls: adding a pin and syncing leaves the component where it is", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r1 = context.GeoControlPanel.sync(map);
  const before = api.getChildren(api.getActiveComp());
  context.GeoScene.addPin(map, "A", 0, 0);
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.componentId, r1.componentId);
  assert.deepEqual(api.getChildren(api.getActiveComp()).filter((id) => id !== r2.components.overlay), before, "only the new Overlay controls was added");
  assert.ok(directlyAbove(api, r2.components.overlay, map.groupId) && directlyAbove(api, r2.componentId, r2.components.overlay));
});

test("controls: a Controls component made inside the group by the earlier build is moved out, keeping its id and promotions", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const old = api.create("component", "My old controls");
  api.parent(old, map.groupId);
  api.setUserData(old, "geoControls", map.cameraId);
  const other = api.create("basicShape", "Other");
  api.parent(other, map.groupId);
  api.connect(other, "position", old, "promotedAttributes");
  api.set(old, { "promotedAttributes.0.name": "My position" });
  assert.ok(api.getChildren(map.groupId).indexOf(old) >= 0);
  const r = context.GeoControlPanel.sync(map);
  assert.equal(r.componentId, old, "the same component");
  assert.equal(api.getChildren(map.groupId).indexOf(old), -1, "no longer in the group");
  assert.ok(directlyAbove(api, old, map.groupId));
  assert.equal(api.getParent(old), "");
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component").length, 1, "no second component");
  const p = plain(api._promoted(old));
  assert.equal(p[p.length - 1], other + ".position", "the user's promotion is kept");
  assert.equal(api.get(old, "promotedAttributes." + (p.length - 1) + ".name"), "My position");
});

test("controls: a Controls component the user moved into another group is found and left there", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r1 = context.GeoControlPanel.sync(map);
  const home = api.create("group", "My controls");
  api.parent(r1.componentId, home);
  context.GeoScene.addPin(map, "A", 0, 0);
  const r2 = context.GeoControlPanel.sync(map);
  assert.equal(r2.componentId, r1.componentId);
  assert.equal(api.getParent(r2.componentId), home, "not moved");
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component" && !api.hasUserDataKey(id, "geoControlsGroup")).length, 1, "no second main component");
  assert.equal(overlaysOf(api, map).length, 1, "and no duplicate Overlay component");
  assert.ok(promotedNames(api, r2.components.overlay).indexOf("Pins · Colour") >= 0, "still kept up to date");
});

test("controls: a Controls component the user nudged elsewhere in the top level is left where it is", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r1 = context.GeoControlPanel.sync(map);
  api.create("group", "Other stuff");
  api.select([r1.componentId]);
  api.moveBackward(); // one step down: no longer directly above its group
  const before = api.getChildren(api.getActiveComp());
  context.GeoControlPanel.sync(map);
  assert.deepEqual(api.getChildren(api.getActiveComp()), before);
});

test("controls: a map made by Search ends with its Controls selected; a pin doesn't select it", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  const map = context.GeoScene.findMaps()[0];
  assert.deepEqual(plain(api.getSelection()), [controlsOf(api, map)]);
  api.select([map.groupId]);
  context.lonField.setValue(2.35); context.latField.setValue(48.85);
  context.pinCoordBtn.onClick();
  assert.deepEqual(plain(api.getSelection()), [map.groupId], "the pin leaves the user's selection alone");
});

test("controls: Create map here selects the new map's Controls", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  context.preview.available = () => true;
  context.preview.frameCamera = () => ({ lat: 10, lon: 20, zoom: 3 });
  context.createHereBtn.onClick();
  const map = context.GeoScene.findMaps()[0];
  assert.ok(map, context.statusLabel.getText());
  const comp = controlsOf(api, map);
  assert.ok(comp);
  assert.deepEqual(plain(api.getSelection()), [comp]);
});

test("controls: script inputs get non-breaking spaces in their names, built-in attributes keep plain spaces", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  context.GeoScene.addPin(map, "A", 0, 0);
  const r = context.GeoControlPanel.sync(map);
  const cam = api.getCustomAttributeName(map.cameraId, "array.2");
  assert.equal(cam.indexOf(" "), -1, "no plain space on the camera's input");
  assert.equal(cam, "Camera" + NBSP + "·" + NBSP + "Zoom");
  const val = api.getCustomAttributeName(r.valuesId, slotsOf(api, r.valuesId)["pins:color"]);
  assert.equal(val.indexOf(" "), -1, "no plain space on a values-layer input");
  assert.ok(val.indexOf(NBSP) >= 0);
  assert.equal(api.getCustomAttributeName(oceanOf(api, map), "material.materialColor"), "Ocean · Colour", "built-in attributes keep plain spaces");
});

test("controls: without unParent or the step calls, sync still makes the component and leaves it where it landed", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  delete api.unParent; delete api.bringForward; delete api.moveBackward;
  let r;
  assert.doesNotThrow(() => { r = context.GeoControlPanel.sync(map); });
  assert.equal(api.getLayerType(r.componentId), "component");
  assert.ok(promotedNames(api, r.componentId).length > 0);
});

test("controls: two maps with the same name each keep their own Controls (never claimed by name)", () => {
  const { context, api } = buildSandbox();
  const S = context.GeoScene, cam = { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 };
  const m1 = S.createMap("Twin", cam);
  const r1 = context.GeoControlPanel.sync(m1);
  api.connect(api.create("basicShape", "Other"), "position", r1.componentId, "promotedAttributes");
  const promoted = plain(api._promoted(r1.componentId));
  const m2 = S.createMap("Twin", cam); // a duplicated group: same name, new camera
  assert.notEqual(m2.cameraId, m1.cameraId);
  const r2 = context.GeoControlPanel.sync(m2);
  assert.notEqual(r2.componentId, r1.componentId);
  assert.notEqual(r2.valuesId, r1.valuesId);
  assert.equal(api.getUserDataKey(r1.componentId, "geoControls"), m1.cameraId);
  assert.equal(api.getUserDataKey(r2.componentId, "geoControls"), m2.cameraId);
  assert.equal(api.getUserDataKey(r1.valuesId, "geoValues"), m1.cameraId);
  assert.deepEqual(plain(api._promoted(r1.componentId)), promoted, "the first map's Controls is untouched");
  assert.equal(controlsOf(api, m1), r1.componentId);
  assert.ok(directlyAbove(api, r1.componentId, m1.groupId));
  assert.ok(directlyAbove(api, r2.componentId, m2.groupId));
  assert.equal(context.GeoControlPanel.sync(m1).componentId, r1.componentId, "and a later sync still finds its own");
});

// ---- Routes remake --------------------------------------------------------------------
const GeoCurveT = require("../src/core/curve.js");
const GeoExpressionT = require("../src/core/expression.js");
const GeoProjT = require("../src/core/projection.js");
function routeMap(context) { createWorldMap(context); return context.GeoScene.findMaps()[0]; }
const ABC = [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 }, { name: "C", lon: 20, lat: 0 }];
function routeData(api, groupId) { return plain(api.getUserDataKey(groupId, "geoRoute")); }

test("routes: Create route builds stops, Bézier legs and helpers, top to bottom", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  assert.equal(api.getNiceName(r.groupId), "Route 1: A → B → C");
  assert.equal(api.getParent(r.groupId), map.groupId);
  assert.deepEqual(api.getChildren(r.groupId).map((id) => api.getNiceName(id)), ["Stop: A", "Stop: B", "Stop: C", "Leg 2: B → C", "Leg 1: A → B", "Route helpers"]);
  const d = routeData(api, r.groupId);
  assert.equal(d.camera, map.cameraId);
  assert.deepEqual(d.stops.map((s) => s.name), ["A", "B", "C"]);
  assert.deepEqual(d.legs.map((l) => [l.number, l.from, l.to]), [[1, 0, 1], [2, 1, 2]]);
  assert.deepEqual(plain(r.legs), d.legs.map((l) => l.line));
  assert.deepEqual(plain(r.stops), d.stops.map((s) => s.circle));
  d.stops.forEach((s) => {
    assert.equal(api.getParent(s.circle), s.holder);
    assert.equal(api.getNiceName(s.circle), s.name);
    [s.position, s.visibility, s.endPoint].forEach((id) => assert.equal(api.getParent(id), d.helpers));
  });
  d.legs.forEach((l) => {
    assert.equal(api.getLayerType(l.line), "basicLine");
    assert.equal(api.get(l.line, "generator"), "bezierLine");
    [l.startHandle, l.endHandle, l.fade].forEach((id) => assert.equal(api.getParent(id), d.helpers));
  });
  assert.equal(api.getNiceName(d.legs[0].startHandle), "Leg 1: A → B start handle");
  assert.equal(api.getNiceName(d.stops[1].endPoint), "B end point");
});

test("routes: stops ride with the camera and legs are wired to them", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  const d = routeData(api, r.groupId), [a, b] = d.stops, leg = d.legs[0];
  const IN = (id, attr) => api.getInConnection(id, attr);
  for (let i = 0; i < 5; i++) assert.equal(IN(a.position, "array." + i), map.cameraId + ".array." + i);
  assert.equal(api.get(a.position, "array.5"), 0); assert.equal(api.get(b.position, "array.6"), 10);
  assert.match(api.get(a.position, "expression"), /"category":"stopDriver"/);
  assert.equal(IN(a.holder, "position"), a.position + ".id");
  assert.equal(IN(a.holder, "opacity"), a.visibility + ".id");
  assert.equal(IN(a.visibility, "array.5"), a.position + ".array.5");
  assert.deepEqual([0, 1, 2, 3].map((i) => IN(a.endPoint, "array." + i)), [a.holder + ".position.x", a.holder + ".position.y", a.circle + ".position.x", a.circle + ".position.y"]);
  assert.equal(IN(leg.line, "generator.startPosition"), a.endPoint + ".id");
  assert.equal(IN(leg.line, "generator.endPosition"), b.endPoint + ".id");
  assert.equal(IN(leg.line, "generator.startOffset"), leg.startHandle + ".id");
  assert.equal(IN(leg.line, "generator.endOffset"), leg.endHandle + ".id");
  assert.equal(IN(leg.line, "opacity"), leg.fade + ".id");
  assert.deepEqual([IN(leg.fade, "array.0"), IN(leg.fade, "array.1")], [a.holder + ".opacity", b.holder + ".opacity"]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => IN(leg.startHandle, "array." + i)),
    [a.holder + ".position.x", a.holder + ".position.y", a.circle + ".position.x", a.circle + ".position.y", b.holder + ".position.x", b.holder + ".position.y", b.circle + ".position.x", b.circle + ".position.y"]);
  assert.match(api.get(leg.startHandle, "expression"), /GeoCurve\.handles[\s\S]*\.start\)\);/);
  assert.match(api.get(leg.endHandle, "expression"), /\.end\)\);/);
});

const HIN = (name) => "array." + GeoExpressionT.inputIndex(GeoExpressionT.HANDLE_INPUTS, name);
const LONDON = { name: "London", lon: -0.12, lat: 51.5 }, TOKYO = { name: "Tokyo", lon: 139.7, lat: 35.7 };

test("routes: shape 1 makes handle helpers with 24 inputs, the camera and both stops' places wired in", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, [LONDON, TOKYO, { name: "Cairo", lon: 31.2, lat: 30 }], { arc: 30, labels: false, shape: 1 });
  const d = routeData(api, r.groupId), IN = (id, attr) => api.getInConnection(id, attr);
  assert.equal(d.legs.length, 2);
  d.legs.forEach((l) => {
    const a = d.stops[l.from], b = d.stops[l.to];
    [l.startHandle, l.endHandle].forEach((h) => {
      assert.equal(api.hasAttribute(h, "array.23"), true);
      assert.equal(api.hasAttribute(h, "array.24"), false);
      assert.equal(api.get(h, HIN("shape")), 1);
      ["camLat", "camLon", "camZoom", "camRotation", "camProjection"].forEach((n, i) => assert.equal(IN(h, HIN(n)), map.cameraId + ".array." + i, n));
      assert.equal(IN(h, HIN("aLon")), a.position + ".array.5");
      assert.equal(IN(h, HIN("aLat")), a.position + ".array.6");
      assert.equal(IN(h, HIN("bLon")), b.position + ".array.5");
      assert.equal(IN(h, HIN("bLat")), b.position + ".array.6");
      assert.match(api.get(h, "expression"), /greatCircleHandles/);
    });
  });
});

test("routes: shape defaults to 0 (Arc)", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  routeData(api, r.groupId).legs.forEach((l) => [l.startHandle, l.endHandle].forEach((h) => assert.equal(api.get(h, HIN("shape")), 0)));
});

test("prepareRoutes: an older route's handle helpers gain the new inputs (connected, shape 0), keep their offsets, and a second refresh changes nothing", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  const d = routeData(api, r.groupId), hs = [];
  d.legs.forEach((l) => hs.push(l.startHandle, l.endHandle));
  api.set(d.legs[0].startHandle, { [HIN("lean")]: 25, [HIN("flip")]: 1, [HIN("handX")]: 3, [HIN("handY")]: -4 });
  const old = hs.map((h) => { const o = {}; for (let i = 0; i < 14; i++) o[i] = api.get(h, "array." + i); return o; });
  hs.forEach((h) => { api._truncate(h, "array", 14); api.set(h, { expression: "OLD" }); });
  hs.forEach((h) => assert.equal(api.hasAttribute(h, "array.14"), false));
  context.GeoScene.prepareRoutes(map);
  const IN = (id, attr) => api.getInConnection(id, attr);
  d.legs.forEach((l) => {
    const a = d.stops[l.from], b = d.stops[l.to];
    [[l.startHandle, "start"], [l.endHandle, "end"]].forEach(([h, which]) => {
      assert.equal(api.hasAttribute(h, "array.23"), true);
      assert.equal(api.get(h, HIN("shape")), 0);
      assert.equal(IN(h, HIN("camLon")), map.cameraId + ".array.1");
      assert.equal(IN(h, HIN("camProjection")), map.cameraId + ".array.4");
      assert.equal(IN(h, HIN("aLon")), a.position + ".array.5");
      assert.equal(IN(h, HIN("bLat")), b.position + ".array.6");
      const expr = api.get(h, "expression");
      assert.ok(expr.indexOf("greatCircleHandles") >= 0 && new RegExp("\\." + which + "\\)\\);\\s*$").test(expr), which + " handle expression");
    });
  });
  hs.forEach((h, k) => { for (let i = 0; i < 14; i++) assert.equal(api.get(h, "array." + i), old[k][i], "input " + i + " of helper " + k); });
  const snap = () => JSON.stringify([api._connections, hs.map((h) => [api.get(h, "expression"), Array.from({ length: 24 }, (_, i) => api.get(h, "array." + i))])]);
  const before = snap();
  context.GeoScene.prepareRoutes(map);
  assert.equal(snap(), before, "a second refresh changes nothing");
});

test("controls: the Shape row's value drives every handle helper's shape input", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  const s = context.GeoControlPanel.sync(map);
  const slot = slotsOf(api, s.valuesId)["route:" + r.groupId + ":shape"];
  assert.ok(slot, "a shape slot");
  routeData(api, r.groupId).legs.forEach((l) => [l.startHandle, l.endHandle].forEach((h) => assert.equal(api.getInConnection(h, HIN("shape")), s.valuesId + "." + slot)));
  assert.equal(api.get(s.valuesId, slot), 0);
  assert.ok(plain(promotedNames(api, s.components.overlay)).indexOf("Route 1 · Shape (0 arc · 1 great circle)") >= 0);
});

test("previewModel reports a leg's shape", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  context.GeoScene.createRoute(map, [LONDON, TOKYO], { arc: 40, labels: false, shape: 1 });
  assert.equal(plain(context.GeoScene.previewModel(map)).routes[0].legs[0].shape, 1);
});

test("routes: styles, trim, starting arc and hand values seeded with the plugin's shape", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  const d = routeData(api, r.groupId), leg = d.legs[0];
  d.stops.forEach((s) => { assert.deepEqual(plain(api.get(s.circle, "generator.radius")), [8, 8]); assert.equal(api.get(s.circle, "material.materialColor"), "#1F8F4E"); assert.equal(api.hasFill(s.circle), true); assert.equal(api.hasStroke(s.circle), false); });
  assert.equal(api.get(leg.line, "stroke.strokeColor"), "#1F8F4E");
  assert.equal(api.get(leg.line, "stroke.width"), 3);
  assert.equal(api.get(leg.line, "stroke.trim"), true);
  assert.equal(api.get(leg.line, "stroke.trimEnd"), 100);
  assert.equal(api.hasFill(leg.line), false);
  assert.equal(api.get(leg.startHandle, "array.8"), 40);
  assert.equal(api.get(leg.startHandle, "array.11"), 0);
  const cam = context.GeoScene.readCamera(map.cameraId);
  const pa = GeoProjT.makeProjector(cam), A = [0, 0], B = [0, 0];
  pa(0, 0, A); pa(10, 10, B);
  const want = GeoCurveT.handles(A, B, { arc: 40, lean: 0, flip: false });
  assert.ok(Math.abs(api.get(leg.startHandle, "array.12") - want.start[0]) < 1e-9 && Math.abs(api.get(leg.startHandle, "array.13") - want.start[1]) < 1e-9);
  assert.ok(Math.abs(api.get(leg.endHandle, "array.12") - want.end[0]) < 1e-9 && Math.abs(api.get(leg.endHandle, "array.13") - want.end[1]) < 1e-9);
});

test("routes: labels at stops sit inside their circles; a round trip has one stop per place", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, [ABC[0], ABC[1], ABC[0]], { arc: 30, labels: true });
  const d = routeData(api, r.groupId);
  assert.equal(d.stops.length, 2);
  assert.deepEqual(d.legs.map((l) => [l.from, l.to]), [[0, 1], [1, 0]]);
  d.stops.forEach((s) => {
    assert.equal(api.getParent(s.label), s.circle);
    assert.equal(api.get(s.label, "text"), s.name);
  });
});

test("routes: every new layer is reset to an identity transform after parenting (api.parent keeps the world transform)", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: true });
  const d = routeData(api, r.groupId);
  const xy = (id) => [api.get(id, "position.x"), api.get(id, "position.y")];
  const identity = (id, what) => {
    assert.deepEqual(xy(id), [0, 0], what + " position");
    assert.equal(api.get(id, "rotation.z"), 0, what + " rotation");
    assert.deepEqual([api.get(id, "scale.x"), api.get(id, "scale.y")], [1, 1], what + " scale");
  };
  identity(r.groupId, "route group");
  identity(d.helpers, "Route helpers");
  d.stops.forEach((s) => {
    identity(s.circle, "circle " + s.name);
    assert.equal(api.get(s.holder, "rotation.z"), 0, "holder rotation");
    assert.deepEqual([api.get(s.holder, "scale.x"), api.get(s.holder, "scale.y")], [1, 1], "holder scale");
    assert.equal(api.get(s.holder, "position"), undefined, "the holder's position is only the driver's");
    assert.equal(api.get(s.holder, "position.x"), undefined);
    assert.equal(api.get(s.label, "rotation.z"), 0, "label rotation");
    assert.deepEqual([api.get(s.label, "scale.x"), api.get(s.label, "scale.y")], [1, 1], "label scale");
    assert.deepEqual(plain(api.get(s.label, "position")), [14, 14]);
  });
  d.legs.forEach((l) => identity(l.line, "leg " + l.number));
});

test("routes: a build that fails part-way leaves nothing behind", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const before = api.getCompLayers(false).slice().sort();
  const real = api.setGenerator; let n = 0;
  api.setGenerator = function () { if (++n === 2) throw new Error("boom"); return real.apply(this, arguments); };
  assert.throws(() => context.GeoScene.createRoute(map, ABC, { arc: 30, labels: true }), /boom/);
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
});

test("routes: without Bézier lines, Create route makes old-style legs", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  delete api.setGenerator;
  const r = context.GeoScene.createRoute(map, ABC, { arc: 25, labels: false });
  const legs = context.GeoScene.findMapLayers(map).filter((l) => l.meta.category === "route");
  assert.equal(legs.length, 2);
  assert.equal(api.get(legs[0].id, "generator.array.7"), 25);
  assert.equal(api.hasUserDataKey(r.groupId, "geoRoute"), false);
  assert.equal(context.GeoScene.findMapLayers(map).filter((l) => l.meta.category === "pin").length, 3, "stops become pins on the fallback");
});

test("routes: without primitive shapes or user data, Create route also makes old-style legs", () => {
  ["primitive", "setUserData"].forEach((fn) => {
    const { context, api } = buildSandbox();
    const map = routeMap(context);
    delete api[fn];
    const r = context.GeoScene.createRoute(map, ABC, { arc: 25, labels: false });
    assert.equal(context.GeoScene.findMapLayers(map).filter((l) => l.meta.category === "route").length, 2, fn);
    assert.equal(api.hasUserDataKey(r.groupId, "geoRoute"), false, fn);
    assert.equal(r.stops, undefined, fn);
    assert.deepEqual([api.get(r.groupId, "position.x"), api.get(r.groupId, "position.y"), api.get(r.groupId, "rotation.z")], [0, 0, 0], fn + ": the route group is reset too");
  });
});

test("routes: findRoutes finds new routes and skips deleted parts", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  let found = plain(context.GeoScene.findRoutes(map));
  assert.equal(found.length, 1);
  assert.equal(found[0].groupId, r.groupId);
  assert.equal(found[0].legs.length, 2);
  api.deleteLayer(found[0].legs[1].line);
  found = plain(context.GeoScene.findRoutes(map));
  assert.deepEqual(found[0].legs.map((l) => l.number), [1]);
  createWorldMap(context);
  const other = context.GeoScene.findMaps().find((m) => m.cameraId !== map.cameraId);
  assert.deepEqual(plain(context.GeoScene.findRoutes(other)), []);
});

test("routes: Pin here turns a dragged stop into its new place and zeroes the drag", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: true });
  const s = routeData(api, r.groupId).stops[0];
  const cam = { lat: 48, lon: 2, zoom: 5, rotation: 10, projection: 0 };
  api.set(s.position, { "array.0": cam.lat, "array.1": cam.lon, "array.2": cam.zoom, "array.3": cam.rotation, "array.4": cam.projection });
  api.set(s.holder, { position: { x: 100, y: 50, z: 0 } });   // what the position driver computed
  api.set(s.circle, { position: { x: 20, y: -10, z: 0 } });   // the user's drag
  const res = plain(context.GeoScene.pinStops(map, [s.label]));
  assert.deepEqual(res, { pinned: 1, offGlobe: [] });
  const want = GeoProjT.unproject(cam, 120, 40);
  assert.ok(Math.abs(api.get(s.position, "array.5") - want.lon) < 1e-9 && Math.abs(api.get(s.position, "array.6") - want.lat) < 1e-9);
  const p = api.get(s.circle, "position");
  assert.deepEqual([p.x !== undefined ? p.x : p[0], p.y !== undefined ? p.y : p[1]], [0, 0]);
});

test("routes: Pin here keeps a stop dragged off the globe's edge, and ignores other layers", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const s = routeData(api, r.groupId).stops[1];
  api.set(s.position, { "array.0": 0, "array.1": 0, "array.2": 2, "array.3": 0, "array.4": 2 });
  api.set(s.holder, { position: { x: 0, y: 0, z: 0 } });
  api.set(s.circle, { position: { x: 100000, y: 0, z: 0 } });
  assert.deepEqual(plain(context.GeoScene.pinStops(map, [s.circle, map.cameraId])), { pinned: 0, offGlobe: ["B"] });
  assert.equal(api.get(s.position, "array.5"), 10);
  assert.deepEqual(plain(context.GeoScene.pinStops(map, [map.cameraId])), { pinned: 0, offGlobe: [] });
});

test("routes: Pin here treats a stop whose camera inputs aren't numbers as off the map's edge, and writes no NaN", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const s = routeData(api, r.groupId).stops[0];
  api.set(s.holder, { position: { x: 0, y: 0, z: 0 } });
  api.set(s.circle, { position: { x: 10, y: 10, z: 0 } });
  api.set(s.position, { "array.0": 0, "array.1": 0, "array.2": undefined, "array.3": 0, "array.4": 0 });
  assert.deepEqual(plain(context.GeoScene.pinStops(map, [s.circle])), { pinned: 0, offGlobe: ["A"] });
  assert.equal(api.get(s.position, "array.5"), 0, "the stop keeps its place");
  assert.deepEqual(plain(api.get(s.circle, "position")), { x: 10, y: 10, z: 0 }, "and its drag");
});

test("controls: a new route gets its four rows beside the stop rows; Arc height drives every handle", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: true });
  const s = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, s.components.overlay));
  assert.deepEqual(names.slice(0, 6), ["Labels · Hide", "Labels · Colour", "Labels · Size", "Stops · Hide", "Stops · Colour", "Stops · Size"]);
  assert.deepEqual(names.slice(6), ["Route 1 · Travel %", "Route 1 · Arc height", "Route 1 · Shape (0 arc · 1 great circle)", "Route 1 · Colour", "Route 1 · Width"]);
  const d = routeData(api, r.groupId), slots = slotsOf(api, s.valuesId);
  const arc = slots["route:" + r.groupId + ":arc"];
  d.legs.forEach((l) => [l.startHandle, l.endHandle].forEach((h) => assert.equal(api.getInConnection(h, "array.8"), s.valuesId + "." + arc)));
  assert.equal(api.get(s.valuesId, arc), 40);
  const size = slots["stops:size"];
  d.stops.forEach((st) => ["generator.radius.x", "generator.radius.y"].forEach((a) => assert.equal(api.getInConnection(st.circle, a), s.valuesId + "." + size)));
  assert.ok(!Object.keys(slots).some((k) => k.indexOf("leg:") === 0 || /:(lean|flip)$/.test(k)), "no per-leg or Lean / Flip rows");
});

test("Routes tab: Arc height %, Labels at stops and Pin here; no Pins at stops", () => {
  const { context } = buildSandbox();
  const page = context.labelPages.pages[1];
  assert.ok(holds(page, context.arcField) && holds(page, context.pinStopsBtn) && holds(page, context.createRouteBtn));
  assert.equal(context.pinsAtStops, undefined);
  assert.equal(context.liftField, undefined);
  let label = null;
  walkUi(page, (n) => { if (n._text === "Arc height %") label = n; });
  assert.ok(label, "an 'Arc height %' label");
});

test("Create route passes Arc height % and makes a new-style route", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.stops.push({ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 });
  context.arcField.setValue(55);
  context.createRouteBtn.onClick();
  const map = context.GeoScene.findMaps()[0];
  const found = plain(context.GeoScene.findRoutes(map));
  assert.equal(found.length, 1);
  assert.equal(api.get(found[0].legs[0].startHandle, "array.8"), 55);
  assert.match(context.statusLabel.getText(), /^Route created: 1 leg\(s\)\. Drag its stops in the viewer, then Pin here to keep them there; animate its Travel % in the map's Controls\./);
});

test("Bake selected layers: a new route's legs and stops are skipped, with a message of their own", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: true });
  const d = routeData(api, r.groupId);
  api.select([d.legs[0].line]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Route legs and stops are already Cavalry shapes, so there's nothing to bake.");
  api.select([d.stops[0].circle, d.stops[0].holder, d.stops[0].label, d.legs[0].startHandle, d.helpers]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Error: Route legs and stops are already Cavalry shapes/);
  const countries = context.GeoScene.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  api.select([countries, d.legs[0].line, d.stops[1].circle]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Baked 1 layer\(s\) at the current frame\./);
  assert.match(context.statusLabel.getText(), / Skipped 2 route part\(s\) — they're already Cavalry shapes\./);
  assert.doesNotMatch(context.statusLabel.getText(), /group\(s\) or other/);
});

test("Pin here: needs a selected stop, then pins it", () => {
  const { context, api } = buildSandbox();
  context.pinStopsBtn.onClick();
  assert.equal(context.statusLabel.getText(), NO_MAP);
  createWorldMap(context);
  api.select([]);
  context.pinStopsBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Select one or more route stops (the circles) first.");
  const map = context.GeoScene.findMaps()[0];
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const st = routeData(api, r.groupId).stops[0];
  api.set(st.holder, { position: { x: 0, y: 0, z: 0 } });
  api.set(st.circle, { position: { x: 10, y: 10, z: 0 } });
  api.select([st.circle]);
  context.pinStopsBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Pinned 1 stop\(s\)\./);
  api.set(st.position, { "array.4": 2, "array.2": 2 });
  api.set(st.circle, { position: { x: 100000, y: 0, z: 0 } });
  context.pinStopsBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Pinned 0 stop\(s\)\. A is past the map's edge, so it kept its place\./);
});

function stubFind(context) {
  const calls = [];
  context.GeoScene.findMapLayers = () => [{ id: 1, name: "Streets", meta: { category: "streets" } }];
  context.GeoScene.readLayerData = () => "enc";
  context.GeoCodec.findByName = (enc, q) => { calls.push(q); return [{ name: "Rue de Rivoli", indices: [0] }]; };
  return calls;
}

test("Extract Find box: Enter (commit) with new text runs Find once, the same text again does nothing, blank runs it", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const calls = stubFind(context);
  context.featureQuery.setText("Rivoli ");
  context.featureQuery.onValueCommitted();
  assert.deepEqual(calls, ["Rivoli"]);
  assert.equal(context.statusLabel.getText(), "1 match(es). Select some, then Extract.");
  assert.deepEqual(plain(context.featureList._model), [{ uuid: "g0", label: "Rue de Rivoli" }]);
  context.featureQuery.onValueCommitted();
  assert.equal(calls.length, 1, "same text: nothing");
  context.featureQuery.setText("");
  context.featureQuery.onValueCommitted();
  assert.deepEqual(calls, ["Rivoli", ""], "a change to blank runs Find (blank = all named)");
  context.featureQuery.onValueCommitted();
  assert.equal(calls.length, 2);
});

test("Extract Find box: the Find button always runs, and the text it ran counts as already found", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  const calls = stubFind(context);
  context.featureQuery.setText("Rivoli");
  context.findBtn.onClick();
  context.findBtn.onClick();
  assert.equal(calls.length, 2, "the button always runs");
  context.featureQuery.onValueCommitted();
  assert.equal(calls.length, 2, "Enter after the button with the same text does nothing");
  context.featureQuery.setText("Louvre");
  context.featureQuery.onValueCommitted();
  assert.deepEqual(calls, ["Rivoli", "Rivoli", "Louvre"]);
});

function findFrance(context) {
  const C = require("../src/core/codec.js"), map = controlsMap(context), G = context.GeoScene;
  const poly = C.encodeLayer({ kind: "polygon", features: [{ name: "France", rank: 1, rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]], props: {} }] });
  G.createMapLayer(map, "Map: Countries", poly, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  context.featureQuery.setText("France");
  context.findBtn.onClick();
  context.featureList.getSelection = () => ["g0"];
  return map;
}

test("Highlight selected: extracts a feature not yet extracted, then highlights it with the picked effect and timing", () => {
  const { context, api } = buildSandbox();
  const map = findFrance(context), G = context.GeoScene;
  context.highlightEffectPicker.setValue(1);          // Outline draw-on
  context.highlightStartField.setValue(12);
  context.highlightLengthField.setValue(8);
  context.highlightBtn.onClick();
  const extracts = G.findMapLayers(map).filter((l) => l.meta.category === "extract");
  assert.equal(extracts.length, 1);
  const hs = G.findHighlights(map);
  assert.equal(hs.length, 1); assert.equal(hs[0].effect, "outline"); assert.equal(hs[0].extract, extracts[0].id);
  assert.deepEqual(plain(api.getKeyframeTimes(hs[0].shape, "stroke.trimEnd")), [12, 20]);
  assert.match(context.statusLabel.getText(), /^Highlighted 1 feature\(s\) with Outline draw-on\. Animate or re-time its Amount % keys on the timeline\./);
  assert.equal(context.highlightStartField.getValue(), 20, "Start moves on so the next highlight follows");
});

test("Highlight selected: reuses the feature's existing extract", () => {
  const { context } = buildSandbox();
  const map = findFrance(context), G = context.GeoScene;
  context.extractBtn.onClick();
  context.highlightBtn.onClick();
  context.highlightBtn.onClick();
  assert.equal(G.findMapLayers(map).filter((l) => l.meta.category === "extract").length, 1);
  assert.equal(G.findHighlights(map).length, 2);
});

test("Highlight selected: asks for Find first, then for a selection", () => {
  const { context } = buildSandbox();
  context.highlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Click Find first (Layers tab).");
  findFrance(context);
  context.featureList.getSelection = () => [];
  context.highlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Select some features in the list first.");
});

test("Highlight row sits in the Layers tab's Extract section; highlights are not Extract sources; Bake skips them", () => {
  const { context, api } = buildSandbox();
  const map = findFrance(context);
  assert.deepEqual(plain(context.highlightEffectPicker._entries), ["Fill in", "Outline draw-on", "Pulse", "Glow"]);
  assert.ok(holds(context.sectionPages.pages[1], context.highlightBtn), "Layers page");
  context.highlightBtn.onClick();
  context.findBtn.onClick();
  assert.ok(!context.sourceLayers.some((l) => l.meta.category === "highlight"));
  const h = context.GeoScene.findHighlights(map)[0];
  api.select([h.shape]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights can't be baked.");
});

function stubLoad(context) {
  const fetched = [];
  context.GeoNet.fetchCsv = (url) => { fetched.push(url); return "Location,Visitors\nParis,30\n"; };
  context.GeoNet.neLayer = () => context.GeoCodec.encodeLayer({ kind: "polygon", features: [] });
  return fetched;
}

test("Data link box: Enter (commit) with a new link loads once, the same link again does nothing, empty does nothing", () => {
  const { context } = buildSandbox();
  const fetched = stubLoad(context);
  context.dataLinkField.setText(" https://example.com/a.csv ");
  context.dataLinkField.onValueCommitted();
  assert.deepEqual(fetched, ["https://example.com/a.csv"]);
  assert.match(context.statusLabel.getText(), /^1 rows, /);
  context.dataLinkField.onValueCommitted();
  assert.equal(fetched.length, 1, "same link: nothing");
  context.dataLinkField.setText("   ");
  context.statusLabel.setText("untouched");
  context.dataLinkField.onValueCommitted();
  assert.equal(fetched.length, 1, "empty: nothing");
  assert.equal(context.statusLabel.getText(), "untouched");
  context.dataLinkField.setText("https://example.com/b.csv");
  context.dataLinkField.onValueCommitted();
  assert.deepEqual(fetched, ["https://example.com/a.csv", "https://example.com/b.csv"]);
});

test("Data link box: the Load button with the same link still loads again", () => {
  const { context } = buildSandbox();
  const fetched = stubLoad(context);
  context.dataLinkField.setText("https://example.com/a.csv");
  context.dataLinkField.onValueCommitted();
  context.dataLoadBtn.onClick();
  assert.equal(fetched.length, 2, "the button reloads");
  context.dataLinkField.onValueCommitted();
  assert.equal(fetched.length, 2, "Enter after the button with the same link does nothing");
});


// ---- Route travellers ---------------------------------------------------------------
function travData(api, groupId) { const d = api.getUserDataKey(groupId, "geoTraveller"); return d ? plain(d) : null; }

test("travellers: a plane rides each leg — one-copy duplicator per leg, tip and show helpers wired", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const res = plain(context.GeoScene.addTraveller(map, r.groupId, "plane"));
  assert.deepEqual(res, { routeName: "A → B → C", replaced: false });
  const t = travData(api, r.groupId), legs = routeData(api, r.groupId).legs;
  assert.equal(t.kind, "plane"); assert.equal(t.userSource, false); assert.equal(t.camera, map.cameraId);
  assert.equal(api.getNiceName(t.source), "Traveller: Plane");
  assert.equal(api.get(t.source, "hidden"), true, "Cavalry hides a duplicator's source");
  assert.equal(api.get(t.source, "material.materialColor"), "#1F8F4E");
  assert.deepEqual(t.legs.map((l) => [l.number, l.line]), legs.map((l) => [l.number, l.line]));
  t.legs.forEach((l, i) => {
    assert.equal(api.getNiceName(l.dup), "Leg " + l.number + " traveller");
    assert.equal(api.get(l.dup, "generator"), "pathDistribution");
    assert.equal(api.get(l.dup, "generator.count"), 1);
    assert.equal(api.get(l.dup, "generator.calculateRotations"), true);
    assert.equal(api.getInConnection(l.dup, "generator.inputShape"), l.line + ".id");
    assert.equal(api.getInConnection(l.dup, "generator.travel"), l.tip + ".id");
    assert.equal(api.getInConnection(l.dup, "opacity"), l.show + ".id");
    assert.equal(api.getInConnection(l.tip, "array.0"), l.line + ".stroke.trimEnd");
    assert.equal(api.getInConnection(l.show, "array.0"), l.line + ".stroke.trimEnd");
    assert.equal(api.getInConnection(l.show, "array.1"), l.line + ".opacity");
    const later = t.legs.slice(i + 1);
    later.forEach((m, k) => assert.equal(api.getInConnection(l.show, "array." + (k + 2)), m.line + ".stroke.trimEnd"));
    assert.ok(api._connections.some((c) => c[0] === t.source && c[1] === "id" && c[2] === l.dup && c[3] === "shapes"));
  });
});

function checkScaleWiring(api, groupId, src) {
  const t = travData(api, groupId);
  assert.ok(t.scale && api.layerExists(t.scale), "the record names the scale helper");
  assert.equal(api.getNiceName(t.scale), "Traveller scale");
  assert.equal(api.getInConnection(t.scale, "array.1"), src + ".scale.x");
  assert.equal(api.getInConnection(t.scale, "array.2"), src + ".scale.y");
  assert.equal(api.get(t.scale, "array.0"), 1, "size starts at 1");
  t.legs.forEach((l) => {
    assert.equal(api.getInConnection(l.dup, "shapeScale"), t.scale + ".id");
    assert.equal(api.getInConnection(l.dup, "shapeRotation"), src + ".rotation.z");
  });
  return t;
}

test("travellers: your scaled and rotated layer's copies follow its scale and rotation", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const logo = api.create("textShape", "Logo");
  api.set(logo, { "scale.x": 0.134, "scale.y": 0.134, "rotation.z": 30 });
  context.GeoScene.addTraveller(map, r.groupId, "layer", logo);
  const t = checkScaleWiring(api, r.groupId, logo);
  assert.equal(api.getParent(t.scale), routeData(api, r.groupId).helpers, "in the route's helpers group");
  assert.equal(plain(context.GeoScene.findTravellers(map))[0].scale, t.scale);
  assert.equal(context.GeoScene.removeTraveller(map, r.groupId), true);
  assert.ok(!api.layerExists(t.scale), "the helper goes with the traveller");
  assert.ok(api.layerExists(logo), "your layer is never deleted");
  assert.equal(api.get(logo, "hidden"), false);
});

test("travellers: a plugin marker has the same scale and rotation wiring", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  const t = checkScaleWiring(api, r.groupId, travData(api, r.groupId).source);
  assert.equal(context.GeoScene.removeTraveller(map, r.groupId), true);
  assert.ok(!api.layerExists(t.scale));
});

test("travellers: a failed build deletes the scale helper too", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const logo = api.create("textShape", "Logo");
  const before = api.getCompLayers(false).slice().sort();
  const real = api.setGenerator; let n = 0;
  api.setGenerator = function () { if (++n === 2) throw new Error("boom"); return real.apply(this, arguments); };
  assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "layer", logo), /boom/);
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
});

test("travellers: the scale helper belongs to its route when selecting", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "dot");
  assert.equal(context.GeoScene.routeOfSelection(map, [travData(api, r.groupId).scale]), r.groupId);
});

test("travellers: copies sit above the legs and below the stops", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "dot");
  const names = api.getChildren(r.groupId).map((id) => api.getNiceName(id));
  const lastStop = Math.max(...names.map((n, i) => (n.startsWith("Stop: ") ? i : -1)));
  const firstLeg = names.findIndex((n) => /^Leg \d+: /.test(n));
  const travs = names.map((n, i) => (/ traveller$/.test(n) ? i : -1)).filter((i) => i >= 0);
  assert.equal(travs.length, 2);
  travs.forEach((i) => assert.ok(i > lastStop && i < firstLeg, JSON.stringify(names)));
});

test("travellers: your own layer travels, stays where it is, and comes back when removed", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const logo = api.create("textShape", "Logo");
  context.GeoScene.addTraveller(map, r.groupId, "layer", logo);
  const t = travData(api, r.groupId);
  assert.equal(t.source, logo); assert.equal(t.userSource, true);
  assert.equal(api.get(logo, "hidden"), true);
  assert.equal(api.getParent(logo), "", "left where it was");
  assert.equal(context.GeoScene.removeTraveller(map, r.groupId), true);
  assert.ok(api.layerExists(logo), "never deleted");
  assert.equal(api.get(logo, "hidden"), false);
  t.legs.forEach((l) => [l.dup, l.tip, l.show].forEach((id) => assert.ok(!api.layerExists(id))));
  assert.equal(travData(api, r.groupId), null);
  assert.equal(context.GeoScene.removeTraveller(map, r.groupId), false);
});

test("travellers: adding again replaces; the old plugin marker is deleted", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  const first = travData(api, r.groupId);
  assert.deepEqual(plain(context.GeoScene.addTraveller(map, r.groupId, "arrow")), { routeName: "A → B → C", replaced: true });
  assert.ok(!api.layerExists(first.source));
  assert.equal(api.getNiceName(travData(api, r.groupId).source), "Traveller: Arrow");
  assert.equal(plain(context.GeoScene.findTravellers(map)).length, 1);
});

test("travellers: map parts can't be your own traveller; route parts point to their route", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const d = routeData(api, r.groupId);
  assert.equal(context.GeoScene.isMapPart(map, d.legs[0].line), true);
  assert.equal(context.GeoScene.isMapPart(map, map.cameraId), true);
  assert.equal(context.GeoScene.isMapPart(map, api.create("textShape", "Free")), false);
  assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "layer", d.legs[0].line), /Select the layer to send along the route first\./);
  [r.groupId, d.helpers, d.stops[0].circle, d.legs[1].line].forEach((id) => assert.equal(context.GeoScene.routeOfSelection(map, [id]), r.groupId));
  assert.equal(context.GeoScene.routeOfSelection(map, [map.cameraId]), null);
  context.GeoScene.addTraveller(map, r.groupId, "dot");
  assert.equal(context.GeoScene.routeOfSelection(map, [travData(api, r.groupId).legs[0].dup]), r.groupId);
});

test("travellers: old-style routes get one too", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const realSetGenerator = api.setGenerator;
  delete api.setGenerator;
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  api.setGenerator = realSetGenerator;
  const legIds = context.GeoScene.findMapLayers(map).filter((l) => l.meta.category === "route").map((l) => l.id);
  assert.equal(context.GeoScene.routeOfSelection(map, [legIds[0]]), r.groupId);
  context.GeoScene.addTraveller(map, r.groupId, "arrow");
  const t = travData(api, r.groupId);
  assert.equal(t.legs.length, 2);
  assert.deepEqual(t.legs.map((l) => l.number), [1, 2]);
  t.legs.forEach((l) => assert.equal(api.getInConnection(l.dup, "generator.inputShape"), l.line + ".id"));
});

test("travellers: a build that fails part-way leaves nothing and restores your layer", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const logo = api.create("textShape", "Logo");
  const before = api.getCompLayers(false).slice().sort();
  const real = api.setGenerator; let n = 0;
  api.setGenerator = function () { if (++n === 2) throw new Error("boom"); return real.apply(this, arguments); };
  assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "layer", logo), /boom/);
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
  assert.equal(api.get(logo, "hidden"), false);
  assert.equal(travData(api, r.groupId), null);
});

test("travellers: stacking the copies is best-effort — without moveBackward the traveller is still built", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  delete api.moveBackward;
  assert.deepEqual(plain(context.GeoScene.addTraveller(map, r.groupId, "dot")), { routeName: "A → B → C", replaced: false });
  const t = travData(api, r.groupId);
  assert.equal(t.legs.length, 2);
  t.legs.forEach((l) => {
    assert.ok(api.layerExists(l.dup));
    assert.equal(api.getInConnection(l.dup, "generator.travel"), l.tip + ".id");
    assert.equal(api.getParent(l.dup), r.groupId);
  });
});

test("controls: a traveller gets its rows and one Size drives the scale helper", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  const s = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, s.components.overlay));
  ["Route 1 · Traveller hide", "Route 1 · Traveller size", "Route 1 · Traveller colour", "Route 1 · Traveller faces direction"].forEach((n) => assert.ok(names.indexOf(n) >= 0, n));
  const size = slotsOf(api, s.valuesId)["trav:" + r.groupId + ":size"];
  assert.equal(api.getInConnection(travData(api, r.groupId).scale, "array.0"), s.valuesId + "." + size);
});

test("Routes tab: Traveller picker and Add to route", () => {
  const { context } = buildSandbox();
  const page = context.labelPages.pages[1];
  assert.ok(holds(page, context.travellerPicker) && holds(page, context.addTravellerBtn));
  assert.deepEqual(plain(context.travellerPicker._entries), ["None", "Plane", "Arrow", "Dot", "Selected layer"]);
  assert.equal(context.travellerPicker.getValue(), 0);
});

test("Create route with a Plane adds a traveller; with Selected layer and nothing usable it refuses before making the route", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  context.stops.push({ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 });
  context.travellerPicker.setValue(1);
  context.createRouteBtn.onClick();
  assert.equal(plain(context.GeoScene.findTravellers(map)).length, 1);
  assert.match(context.statusLabel.getText(), /^Route created: 1 leg\(s\)\./);
  context.travellerPicker.setValue(4);
  api.select([]);
  const before = plain(context.GeoScene.findRoutes(map)).length;
  context.createRouteBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Select the layer to send along the route first.");
  assert.equal(plain(context.GeoScene.findRoutes(map)).length, before);
});

test("Add to route: adds, replaces, removes with None, and explains what to select", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  api.select([]);
  context.travellerPicker.setValue(2);
  context.addTravellerBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Select a route (any part of it) first.");
  api.select([routeData(api, r.groupId).legs[0].line]);
  context.addTravellerBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Traveller added to A → B → C\./);
  context.travellerPicker.setValue(3);
  context.addTravellerBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Traveller replaced on A → B → C\./);
  const logo = api.create("textShape", "Logo");
  context.travellerPicker.setValue(4);
  api.select([routeData(api, r.groupId).stops[0].circle, logo]);
  context.addTravellerBtn.onClick();
  assert.equal(travData(api, r.groupId).source, logo);
  context.travellerPicker.setValue(0);
  context.addTravellerBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Traveller removed from A → B → C\./);
  context.addTravellerBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: This route has no traveller to remove.");
});

test("Create route: if the traveller can't be added the route still stands and the status says why", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  context.stops.push({ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 });
  context.travellerPicker.setValue(2);
  delete api.setGenerator; // an older Cavalry: old-style route, and no duplicators for the traveller
  context.createRouteBtn.onClick();
  assert.equal(context.GeoScene.findMapLayers(map).filter((l) => l.meta.category === "route").length, 1, "the old-style leg was made");
  assert.equal(plain(context.GeoScene.findTravellers(map)).length, 0);
  assert.match(context.statusLabel.getText(), /^Route created: 1 leg\(s\).*The traveller couldn't be added: .+\.$/);
});

// ---- Route travellers: final-review fixes ---------------------------------------------
test("travellers: a layer shared by two routes stays hidden until the last route lets it go", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r1 = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const r2 = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const logo = api.create("textShape", "Logo");
  context.GeoScene.addTraveller(map, r1.groupId, "layer", logo);
  context.GeoScene.addTraveller(map, r2.groupId, "layer", logo);
  assert.equal(context.GeoScene.removeTraveller(map, r1.groupId), true);
  assert.equal(api.get(logo, "hidden"), true, "route 2 still sends it");
  assert.equal(context.GeoScene.removeTraveller(map, r2.groupId), true);
  assert.equal(api.get(logo, "hidden"), false);
});

test("travellers: replacing your layer with the same one, or a failed build, never un-hides it for another route", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r1 = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const r2 = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const logo = api.create("textShape", "Logo");
  context.GeoScene.addTraveller(map, r1.groupId, "layer", logo);
  const real = api.setGenerator; let n = 0;
  api.setGenerator = function () { if (++n === 2) throw new Error("boom"); return real.apply(this, arguments); };
  assert.throws(() => context.GeoScene.addTraveller(map, r2.groupId, "layer", logo), /boom/);
  assert.equal(api.get(logo, "hidden"), true, "route 1 still sends it");
  api.setGenerator = real;
  context.GeoScene.addTraveller(map, r1.groupId, "dot");
  assert.equal(api.get(logo, "hidden"), false, "nothing sends it now");
});

test("travellers: a group that contains the map or its Controls isn't a selectable traveller layer", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const wrap = api.create("group", "Wrapper");
  api.parent(map.groupId, wrap);
  assert.equal(context.GeoScene.isMapPart(map, wrap), true);
  assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "layer", wrap), /Select the layer to send along the route first\./);
  const { context: c2, api: a2 } = buildSandbox();
  const map2 = routeMap(c2);
  const s = c2.GeoControlPanel.sync(map2);
  const wrap2 = a2.create("group", "Controls wrapper");
  a2.parent(s.componentId, wrap2);
  assert.equal(c2.GeoScene.isMapPart(map2, wrap2), true);
  assert.equal(c2.GeoScene.isMapPart(map2, a2.create("group", "Unrelated")), false);
});

test("travellers: an older Cavalry gets a plain message, not a raw error", () => {
  ["setGenerator", "createEditable", "primitive", "setUserData"].forEach((name) => {
    const { context, api } = buildSandbox();
    const map = routeMap(context);
    const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
    delete api[name];
    assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "dot"), /^Error: This version of Cavalry can't add travellers\.$/, name);
  });
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  delete context.cavalry.Path;
  assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "plane"), /^Error: This version of Cavalry can't add travellers\.$/);
  assert.equal(plain(context.GeoScene.findTravellers(map)).length, 0);
});

test("travellers: a route with no usable legs is refused", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  const d = routeData(api, r.groupId); d.legs = [];
  api.setUserData(r.groupId, "geoRoute", d);
  assert.throws(() => context.GeoScene.addTraveller(map, r.groupId, "dot"), /Select a route \(any part of it\) first\./);
  assert.equal(travData(api, r.groupId), null);
});

test("Add to route: a replace that fails part-way leaves the Controls without the old traveller's rows", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  api.select([routeData(api, r.groupId).legs[0].line]);
  context.travellerPicker.setValue(1);
  context.addTravellerBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Traveller added to/);
  const comp = controlsOf(api, map, "overlay");
  assert.ok(plain(promotedNames(api, comp)).some((n) => / · Traveller size$/.test(n)), "the Plane's rows are there");
  const real = api.setGenerator;
  api.setGenerator = function () { throw new Error("boom"); };
  context.travellerPicker.setValue(2);
  context.addTravellerBtn.onClick();
  api.setGenerator = real;
  assert.equal(context.statusLabel.getText(), "Error: boom");
  assert.equal(travData(api, r.groupId), null, "the old traveller was replaced away");
  assert.ok(!plain(promotedNames(api, controlsOf(api, map, "overlay"))).some((n) => / · Traveller /.test(n)), "no rows left pointing at deleted layers");
});

test("Bake: a traveller's copies, helpers and plugin marker are skipped as route parts", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.GeoScene.findMaps()[0];
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  const t = travData(api, r.groupId);
  [t.legs[0].dup, t.legs[0].tip, t.legs[0].show, t.scale, t.source].forEach((id) => {
    api.select([id]);
    context.bakeBtn.onClick();
    assert.equal(context.statusLabel.getText(), "Error: Route legs and stops are already Cavalry shapes, so there's nothing to bake.", id);
  });
});

test("controls: a deleted plugin marker keeps the traveller's other rows", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  api.deleteLayer(travData(api, r.groupId).source);
  const s = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, s.components.overlay));
  ["Route 1 · Traveller hide", "Route 1 · Traveller size", "Route 1 · Traveller faces direction"].forEach((n) => assert.ok(names.indexOf(n) >= 0, n));
  assert.ok(names.indexOf("Route 1 · Traveller colour") < 0, "nothing left to recolour");
});

test("controls: a traveller without a scale helper (older record) gets no size row", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  const rec = travData(api, r.groupId); delete rec.scale;
  api.setUserData(r.groupId, "geoTraveller", rec);
  const names = plain(promotedNames(api, context.GeoControlPanel.sync(map).components.overlay));
  assert.ok(names.indexOf("Route 1 · Traveller size") < 0);
  assert.ok(names.indexOf("Route 1 · Traveller hide") >= 0);
});

test("map styles: Apply recolours every part of a map and remembers the style", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = context.GeoScene.createMap("Paris", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const countries = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  const roads = G.createMapLayer(map, "Roads", { v: 1, kind: "line", f: [] }, { camera: map.cameraId, category: "roads" }, G.layerStyle(map, "roads"), {});
  const pin = G.addPin(map, "Here", 0, 0);
  const label = G.createLabel(map, "Here", 0, 0);
  const credit = G.createAttribution(map);
  const route = G.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 }], { arc: 30 });
  G.addTraveller(map, route.groupId, "dot");
  const marker = plain(api.getUserDataKey(route.groupId, "geoTraveller")).source;
  const r = G.applyMapStyle(map, context.GeoStyles.builtIn("Blueprint"));
  assert.equal(r.skipped, 0);
  assert.equal(api.get(oceanOf(api, map), "material.materialColor"), "#123a6b");
  assert.equal(api.get(countries, "material.materialColor"), "#1a4a85");
  assert.equal(api.get(countries, "stroke.strokeColor"), "#cfe3ff");
  assert.equal(api.get(countries, "stroke.width"), 0.6);
  assert.equal(api.get(roads, "stroke.strokeColor"), "#cfe3ff");
  assert.equal(api.get(roads, "stroke.width"), 1.2);
  assert.equal(api.get(pin, "material.materialColor"), "#ffffff");
  assert.equal(api.get(label, "material.materialColor"), "#ffffff");
  assert.equal(api.get(credit, "material.materialColor"), "#ffffff");
  route.legs.forEach((leg) => { assert.equal(api.get(leg, "stroke.strokeColor"), "#ffffff"); assert.equal(api.get(leg, "stroke.width"), 2); });
  route.stops.forEach((c) => assert.equal(api.get(c, "material.materialColor"), "#ffffff"));
  assert.equal(api.get(marker, "material.materialColor"), "#ffffff");
  assert.equal(plain(api.getUserDataKey(map.groupId, "geoStyle")).name, "Blueprint");
  assert.equal(api.get(G.addPin(map, "Later", 1, 1), "material.materialColor"), "#ffffff", "later pins follow the applied style");
});

test("map styles: Apply sets a Controls-shared colour through its control value, and skips animated or wired colours", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = controlsMap(context);
  const a = G.addPin(map, "A", 0, 0), b = G.addPin(map, "B", 1, 1);
  const c = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  const sync = context.GeoControlPanel.sync(map);
  const slot = slotsOf(api, sync.valuesId)["pins:color"];
  assert.equal(api.getInConnection(a, "material.materialColor"), sync.valuesId + "." + slot);
  api.keyframe(c, 0, { "material.materialColor": "#000000" });
  const other = api.create("javaScript", "elsewhere");
  api.connect(other, "array.0", c, "stroke.width");
  const r = G.applyMapStyle(map, context.GeoStyles.builtIn("Vintage"));
  assert.equal(api.get(sync.valuesId, slot), "#a63d2f", "the shared Pins colour changed");
  assert.notEqual(api.get(a, "material.materialColor"), "#a63d2f", "the pin itself wasn't overwritten (it is driven)");
  assert.equal(api.get(c, "material.materialColor"), "#000000", "animated colour left alone");
  assert.equal(api.get(c, "stroke.strokeColor"), "#8b6b4a", "the rest of the layer restyled");
  assert.equal(r.skipped, 2);
  assert.equal(api.getInConnection(b, "material.materialColor"), sync.valuesId + "." + slot, "the second pin is driven by the same slot");
});

test("map styles: an animated Controls value shared by two pins is skipped once, and neither pin is written", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = controlsMap(context);
  const a = G.addPin(map, "A", 0, 0), b = G.addPin(map, "B", 1, 1);
  const sync = context.GeoControlPanel.sync(map);
  const slot = slotsOf(api, sync.valuesId)["pins:color"];
  api.keyframe(sync.valuesId, 0, { [slot]: "#000000" });
  const before = [api.get(a, "material.materialColor"), api.get(b, "material.materialColor")];
  const r = G.applyMapStyle(map, context.GeoStyles.builtIn("Vintage"));
  assert.equal(r.skipped, 1, "one animated value, counted once");
  assert.equal(api.get(a, "material.materialColor"), before[0], "pin A not written");
  assert.equal(api.get(b, "material.materialColor"), before[1], "pin B not written");
  assert.equal(api.get(sync.valuesId, slot), "#000000", "the animated value not written");
});

test("map styles: a Controls value wired from another layer is skipped and not written", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = controlsMap(context);
  G.addPin(map, "A", 0, 0);
  const sync = context.GeoControlPanel.sync(map);
  const slot = slotsOf(api, sync.valuesId)["pins:color"];
  const other = api.create("javaScript", "elsewhere");
  api.connect(other, "array.0", sync.valuesId, slot);
  const before = api.get(sync.valuesId, slot);
  const r = G.applyMapStyle(map, context.GeoStyles.builtIn("Vintage"));
  assert.equal(r.skipped, 1);
  assert.equal(api.get(sync.valuesId, slot), before, "the connected value not written");
});

test("map styles: Apply recolours a plugin traveller marker through the Controls Traveller colour value", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = controlsMap(context);
  const route = G.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 }], { arc: 30 });
  G.addTraveller(map, route.groupId, "dot");
  const sync = context.GeoControlPanel.sync(map);
  const slot = slotsOf(api, sync.valuesId)["trav:" + route.groupId + ":color"];
  assert.ok(slot, "the traveller colour is a Controls value");
  const marker = plain(api.getUserDataKey(route.groupId, "geoTraveller")).source;
  assert.equal(api.getInConnection(marker, "material.materialColor"), sync.valuesId + "." + slot);
  const r = G.applyMapStyle(map, context.GeoStyles.builtIn("Blueprint"));
  assert.equal(r.skipped, 0);
  assert.equal(api.get(sync.valuesId, slot), "#ffffff");
});

test("map styles: Extract on a Vintage map draws in Vintage's extract colour", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = styledMap(context, "Vintage");
  const enc = context.GeoCodec.encodeLayer({ kind: "polygon", features: [{ name: "France", rank: 1, rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]], props: {} }] });
  const id = G.extract(map, { meta: { category: "countries" } }, enc, { name: "France", indices: [0] });
  assert.equal(api.get(id, "material.materialColor"), "#c76b29");
});

test("map styles: the preview opens in the style remembered in settings.json", () => {
  const { context } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mono" }); } });
  assert.equal(context.preview._draw._background, "#111111");
});

test("settings: a settings.json that won't parse is copied to settings.json.bak before it is replaced", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = "{not json"; } });
  pickStyle(context, "Vintage");
  assert.equal(api._files[SETTINGS_FILE + ".bak"], "{not json");
  assert.equal(settingsOf(api).mapStyle, "Vintage");
});

test("settings: a settings.json holding an array or a number is treated as empty, and backed up when replaced", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = "[1,2]"; } });
  assert.deepEqual(plain(context.GeoNet.loadSettings()), {});
  pickStyle(context, "Light");
  assert.equal(api._files[SETTINGS_FILE + ".bak"], "[1,2]");
  assert.equal(settingsOf(api).mapStyle, "Light");
});

test("settings: a good settings.json is never backed up", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ apiKey: "k" }); } });
  pickStyle(context, "Light");
  assert.equal(api._files[SETTINGS_FILE + ".bak"], undefined);
  assert.equal(settingsOf(api).apiKey, "k");
});

test("Map tab Style: refilling the picker never counts as picking, even if the dropdown fires on programmatic changes", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const picker = context.mapStylePicker;
  ["clear", "addEntry", "setValue"].forEach((m) => {
    const orig = picker[m];
    picker[m] = function () { const r = orig.apply(this, arguments); if (picker.onValueChanged) picker.onValueChanged(); return r; };
  });
  const written = [], paintedAs = [], realUpdate = context.GeoNet.updateSettings, realColors = context.preview.setColors;
  context.GeoNet.updateSettings = function (patch) { if (patch && patch.mapStyle) written.push(patch.mapStyle); return realUpdate.apply(this, arguments); };
  context.preview.setColors = function (c) { paintedAs.push(c.water); return realColors.apply(this, arguments); };
  api.set(oceanOf(api, context.currentMap()), { "material.materialColor": "#010203" });
  context.styleNameField.setText("Mine");
  context.saveStyleBtn.onClick();
  assert.deepEqual(written, ["Mine"], "only the saved name was written, never a half-filled picker's value");
  assert.deepEqual(paintedAs, ["#010203"], "the preview was painted once, in the saved style");
  assert.equal(settingsOf(api).mapStyle, "Mine");
  assert.equal(context.preview._draw._background, "#010203");
  assert.equal(picker._entries[picker.getValue()], "Mine");
});

test("map styles: Save reads a map's colours back (through Controls values) and Apply on another map gives the same look", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = controlsMap(context);
  G.addPin(map, "A", 0, 0);
  const c = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  const sync = context.GeoControlPanel.sync(map);
  api.set(sync.valuesId, { [slotsOf(api, sync.valuesId)["pins:color"]]: "#123456" });
  api.set(c, { "material.materialColor": "#654321", "stroke.width": 4 });
  const saved = G.readMapStyle(map, "Mine");
  assert.equal(saved.name, "Mine");
  assert.equal(saved.colors.accent, "#123456");
  assert.equal(saved.colors.land, "#654321");
  assert.equal(saved.widths.borders, 4);
  assert.equal(saved.colors.roads, "#8a948e", "a role the map lacks comes from its remembered style (Dark)");
  const other = G.createMap("Other", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const pin = G.addPin(other, "B", 0, 0);
  G.applyMapStyle(other, saved);
  assert.equal(api.get(pin, "material.materialColor"), "#123456");
  assert.equal(plain(api.getUserDataKey(other.groupId, "geoStyle")).name, "Mine");
});

test("map styles: Apply recolours data region outlines and value labels but never data colours or bubbles", () => {
  const { context, api } = buildSandbox();
  const map = context.GeoScene.createMap("Data", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const d = context.GeoScene.createDataLayers(map, { url: "https://x/y.csv", choice: { valueColumn: "Population" }, scale: "50m" }, samplePrepared(context),
    { regions: true, bubbles: true, labels: true, legend: true });
  const low = "generator.array." + context.GeoExpression.inputIndex(context.GeoExpression.REGION_INPUTS, "low");
  const before = api.get(d.layers.regions, low);
  context.GeoScene.applyMapStyle(map, context.GeoStyles.builtIn("Light"));
  assert.equal(api.get(d.layers.regions, "stroke.strokeColor"), "#cfe3ec");
  assert.equal(api.get(d.layers.labels, "material.materialColor"), "#333333");
  assert.equal(api.get(d.layers.legend, "material.materialColor"), "#333333");
  assert.equal(api.get(d.layers.bubbles, "material.materialColor"), "#bc4749");
  assert.deepEqual(api.get(d.layers.regions, low), before);
});

// ---- Previews: what the panel previews draw for a map ----
test("previewModel: pins, labels and a new-style route with its curve settings, in the map's style colours", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("P", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 }, context.GeoStyles.builtIn("Vintage"));
  G.addPin(map, "Here", 2.35, 48.85);
  G.createLabel(map, "Lisbon", -9.14, 38.72);
  const r = G.createRoute(map, [{ name: "A", lon: 0, lat: 10 }, { name: "B", lon: 20, lat: 10 }, { name: "C", lon: 20, lat: 30 }], { arc: 40 });
  const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
  const lean = "array." + context.GeoExpression.inputIndex(context.GeoExpression.HANDLE_INPUTS, "lean");
  const flip = "array." + context.GeoExpression.inputIndex(context.GeoExpression.HANDLE_INPUTS, "flip");
  api.set(rec.legs[1].startHandle, { [lean]: 25, [flip]: 1 });
  const m = plain(G.previewModel(map));
  assert.deepEqual(m.colors, { accent: "#a63d2f", text: "#4a3423" });
  assert.deepEqual(m.pins, [{ lon: 2.35, lat: 48.85 }]);
  assert.deepEqual(m.labels, [{ lon: -9.14, lat: 38.72, text: "Lisbon" }]);
  assert.equal(m.routes.length, 1);
  assert.deepEqual(m.routes[0].stops, [{ lon: 0, lat: 10 }, { lon: 20, lat: 10 }, { lon: 20, lat: 30 }]);
  assert.deepEqual(m.routes[0].legs[0], { from: { lon: 0, lat: 10 }, to: { lon: 20, lat: 10 }, arc: 40, lean: 0, flip: false, shape: 0 });
  assert.deepEqual(m.routes[0].legs[1], { from: { lon: 20, lat: 10 }, to: { lon: 20, lat: 30 }, arc: 40, lean: 25, flip: true, shape: 0 });
});

test("previewModel: a stop's place follows Pin here (its position helper), and a curve setting driven by the Controls is read through", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = controlsMap(context);
  const r = G.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 0 }], { arc: 30 });
  const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
  api.set(rec.stops[1].position, { "array.5": 12, "array.6": 3 });
  const sync = context.GeoControlPanel.sync(map);
  const arcSlot = slotsOf(api, sync.valuesId)["route:" + r.groupId + ":arc"];
  api.set(sync.valuesId, { [arcSlot]: 70 });
  const m = plain(G.previewModel(map));
  assert.deepEqual(m.routes[0].stops[1], { lon: 12, lat: 3 });
  assert.equal(m.routes[0].legs[0].arc, 70);
});

test("previewModel: an old-style route gives its legs (arc from Arc height) and stops; nothing breaks on a deleted part", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;
  const G = context.GeoScene;
  const map = G.createMap("Old", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const r = G.createRoute(map, [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 5 }], { lift: 45, pins: true, labels: false });
  const m = plain(G.previewModel(map));
  assert.equal(m.routes.length, 1);
  assert.deepEqual(m.routes[0].legs[0], { from: { lon: 0, lat: 0 }, to: { lon: 10, lat: 5 }, arc: 45, lean: 0, flip: false });
  assert.deepEqual(m.routes[0].stops, [{ lon: 0, lat: 0 }, { lon: 10, lat: 5 }]);
  assert.equal(m.pins.length, 2, "an old route's stop pins are pins");
  api.deleteLayer(r.legs[0]);
  assert.equal(plain(G.previewModel(map)).routes.length, 0);
});

test("findLabels still finds driver labels (now through labelDrivers)", () => {
  const { context } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("L", { lat: 0, lon: 0, zoom: 2, rotation: 0, projection: 0 });
  const id = G.createLabel(map, "Here", 1, 2);
  assert.deepEqual(plain(G.findLabels(map)), [id]);
});

test("Map styles: picking a style recolours the Label previews too", () => {
  const { context } = buildSandbox();
  pickStyle(context, "Light");
  [context.preview, context.pinsPreview, context.routesPreview].forEach((pv) => assert.equal(pv._draw._background, "#cfe3ec"));
});

test("previewStreets lists roads, railways, water, parks and extracts with their style colours; buildings and data are left out", () => {
  const { context } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("S", { lat: 0, lon: 0, zoom: 12, rotation: 0, projection: 0 }, context.GeoStyles.builtIn("Light"));
  const C = require("../src/core/codec.js");
  const line = C.encodeLayer({ kind: "line", features: [{ name: "Road", rings: [[[0, 0], [0.01, 0.01]]] }] });
  const area = C.encodeLayer({ kind: "polygon", features: [{ name: "Park", rings: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]]] }] });
  const add = (cat, enc) => G.createMapLayer(map, cat, enc, { camera: map.cameraId, category: cat }, G.layerStyle(map, cat), {});
  const roads = add("roads", line), parks = add("parks", area);
  add("buildings", area);
  const list = plain(G.previewStreets(map));
  assert.deepEqual(list.map((s) => [s.id, s.kind, s.color]).sort(), [[parks, "fill", "#d5e6c8"], [roads, "line", "#c9c2b2"]].sort());
  assert.equal(G.readPreviewLayer(roads).features[0].name, "Road");
});

test("preview streets: drawn within the budget, and not while dragging", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 0.005, lon: 0.005, zoom: 14 }, "camera");
  const prepared = context.GeoPreview.prepare({ features: [{ name: "Road", rings: [[[0, 0], [0.01, 0.01]]] }] });
  p.setStreets([{ kind: "line", color: "#c9c2b2", prepared }]);
  p._render();
  assert.equal(strokes(p._draw, "#c9c2b2").length, 1);
  p._draw.onMousePress({ x: 100, y: 60 }, "left");
  p._draw.onMouseMove({ x: 140, y: 60 });
  p._render();
  assert.equal(strokes(p._draw, "#c9c2b2").length, 0, "hidden while dragging");
});

test("preview streets: the budget is worked out once per view and street list, not on every redraw", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 0.005, lon: 0.005, zoom: 14 }, "camera");
  const prepared = context.GeoPreview.prepare({ features: [{ name: "Road", rings: [[[0, 0], [0.01, 0.01]]] }] });
  const real = context.GeoPreview.budget;
  let calls = 0;
  context.GeoPreview.budget = function () { calls++; return real.apply(this, arguments); };
  p.setStreets([{ kind: "line", color: "#c9c2b2", prepared }]);
  p._render(); p._render();
  assert.equal(calls, 1, "same view, same streets: one budget");
  assert.equal(strokes(p._draw, "#c9c2b2").length, 1, "still drawn from the cache");
  p.zoomBy(1);
  p._render();
  assert.equal(calls, 2, "a new view recomputes");
  p.setStreets([{ kind: "line", color: "#c9c2b2", prepared }]);
  p._render();
  assert.equal(calls, 3, "a new street list recomputes");
});

test("refreshPreviews hands the map's street layers to every preview (read once, then cached)", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const map = context.currentMap(), G = context.GeoScene;
  const C = require("../src/core/codec.js");
  const road = C.encodeLayer({ kind: "line", features: [{ name: "Road", rings: [[[0, 0], [0.01, 0.01]]] }] });
  const id = G.createMapLayer(map, "Map: Roads", road, { camera: map.cameraId, category: "roads" }, G.layerStyle(map, "roads"), {});
  let reads = 0;
  const real = G.readPreviewLayer;
  G.readPreviewLayer = (x) => { reads++; return real(x); };
  context.refreshPreviews();
  context.refreshPreviews();
  assert.equal(reads, 1, "decoded once");
  [context.preview, context.pinsPreview, context.routesPreview].forEach((pv) => {
    pv.showCamera({ lat: 0.005, lon: 0.005, zoom: 14 }, "camera");
    pv._render();
    assert.equal(strokes(pv._draw, "#8a948e").length, 1, "Dark roads colour");
  });
  assert.ok(api && id);
});

function streetFixture(context) {
  const G = context.GeoScene, map = context.currentMap(), C = require("../src/core/codec.js");
  const enc = (n) => C.encodeLayer({ kind: "line", features: [{ name: "Road", rings: [[[0, 0], ...Array.from({ length: n }, (_, i) => [0.001 * (i + 1), 0.001 * (i + 1)])]] }] });
  const add = (cat, e, meta = {}) => G.createMapLayer(map, "Map: " + cat, e, Object.assign({ camera: map.cameraId, category: cat }, meta), G.layerStyle(map, cat), {});
  return { G, map, enc, add };
}

test("previewStreets lists layers bottom first: parks, water, railways, roads, extracts", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const { G, map, enc, add } = streetFixture(context);
  const ex = G.createMapLayer(map, "Map: extract", enc(2), { camera: map.cameraId, category: "extract", source: "rivers" }, G.layerStyle(map, "extractLine"), {}), roads = add("roads", enc(2)), parks = add("parks", enc(2)), rail = add("railways", enc(2)), water = add("water", enc(2));
  assert.deepEqual(plain(G.previewStreets(map).map((s) => s.id)), [parks, water, rail, roads, ex]);
});

test("street cache: changed data under the same id is re-read, and removed layers are pruned", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const { G, map, enc, add } = streetFixture(context);
  const a = add("roads", enc(2)), b = add("rail" + "ways", enc(2));
  let reads = [];
  const real = G.readPreviewLayer;
  G.readPreviewLayer = (x) => { reads.push(x); return real(x); };
  context.refreshPreviews();
  context.refreshPreviews();
  assert.deepEqual(reads.slice().sort(), [a, b].sort(), "each read once");
  const other = add("roads", enc(6));
  api.set(a, { "generator.expression": api.get(other, "generator.expression") });
  api.deleteLayer(other);
  reads = [];
  context.refreshPreviews();
  assert.deepEqual(reads, [a], "only the changed layer is re-read");
  api.deleteLayer(b);
  context.refreshPreviews();
  reads = [];
  add("railways", enc(2)); // a new layer
  context.refreshPreviews();
  assert.equal(reads.length, 1, "only the new layer is read; the removed layer left no stale entry");
  assert.ok(map);
});

test("refreshPreviews scans the comp's layers once for pins, routes and streets together", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const { G, enc, add } = streetFixture(context);
  const road = add("roads", enc(2));
  context.refreshPreviews(); // decodes and caches
  const realGet = api.get.bind(api), realFind = G.findMapLayers;
  let exprReads = 0, finds = 0;
  api.get = (id, attr) => { if (id === road && attr === "generator.expression") exprReads++; return realGet(id, attr); };
  G.findMapLayers = (m) => { finds++; return realFind(m); };
  context.refreshPreviews();
  assert.equal(finds, 1);
  assert.equal(exprReads, 1, "the layer's expression is read once per refresh");
});

test("a street layer that fails to read doesn't stop the overlay or the other streets", () => {
  const { context } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const { G, enc, add } = streetFixture(context);
  const bad = add("parks", enc(2)), good = add("roads", enc(2));
  const real = G.readPreviewLayer;
  G.readPreviewLayer = (x) => { if (x === bad) throw new Error("boom"); return real(x); };
  let overlays = 0;
  const pv = context.pinsPreview, realSet = pv.setOverlay;
  pv.setOverlay = (m) => { overlays++; return realSet(m); };
  context.refreshPreviews();
  assert.equal(overlays, 1, "overlay refreshed");
  [context.preview, context.pinsPreview, context.routesPreview].forEach((p) => {
    p.showCamera({ lat: 0.003, lon: 0.003, zoom: 14 }, "camera");
    p._render();
    assert.equal(strokes(p._draw, "#8a948e").length, 1, "the good street layer still draws");
  });
  assert.ok(good);
});

// ---- Map furniture ----
test("Add scale bar: a camera-linked script layer in the text colour, with a fade utility on its opacity", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("F", { lat: 48.85, lon: 2.35, zoom: 12, rotation: 0, projection: 0 }, context.GeoStyles.builtIn("Vintage"));
  const id = G.addScaleBar(map);
  assert.equal(api.getNiceName(id), "Scale bar");
  assert.equal(api.getParent(id), map.groupId);
  assert.equal(api.get(id, "material.materialColor"), "#4a3423");
  assert.equal(api.getInConnection(id, "generator.array.2"), map.cameraId + ".array.2");
  const SB = context.GeoExpression.SCALE_BAR_INPUTS, at = (n) => "generator.array." + context.GeoExpression.inputIndex(SB, n);
  assert.equal(api.get(id, at("compW")), 1920);
  assert.equal(api.get(id, at("raise")), 0);
  const f = G.findFurniture(map);
  assert.equal(f.scaleBar, id);
  assert.equal(api.getNiceName(f.fade), "Scale bar fade");
  assert.equal(api.getInConnection(id, "opacity"), f.fade + ".id");
  assert.equal(api.getInConnection(f.fade, "array.0"), map.cameraId + ".array.2");
  assert.throws(() => G.addScaleBar(map), /This map already has a scale bar\./);
});

test("Add scale bar sits above the OpenStreetMap credit; Add north arrow defaults to top-right", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("F", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 });
  G.createAttribution(map);
  const id = G.addScaleBar(map);
  const at = (inputs, n) => "generator.array." + context.GeoExpression.inputIndex(inputs, n);
  assert.equal(api.get(id, at(context.GeoExpression.SCALE_BAR_INPUTS, "raise")), 40);
  const na = G.addNorthArrow(map);
  assert.equal(api.getNiceName(na), "North arrow");
  assert.equal(api.get(na, at(context.GeoExpression.NORTH_ARROW_INPUTS, "corner")), 1);
  assert.throws(() => G.addNorthArrow(map), /This map already has a north arrow\./);
});

test("fitFurniture follows a resized composition; Apply style recolours the furniture", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("F", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 });
  const sb = G.addScaleBar(map), na = G.addNorthArrow(map);
  const realGet = api.get;
  api.get = function (id, attr) { if (id === api.getActiveComp() && attr === "resolution") return { x: 1080, y: 1080 }; return realGet.apply(this, arguments); };
  G.fitFurniture(map);
  const at = (inputs, n) => "generator.array." + context.GeoExpression.inputIndex(inputs, n);
  assert.equal(api.get(sb, at(context.GeoExpression.SCALE_BAR_INPUTS, "compW")), 1080);
  assert.equal(api.get(na, at(context.GeoExpression.NORTH_ARROW_INPUTS, "compH")), 1080);
  G.applyMapStyle(map, context.GeoStyles.builtIn("Blueprint"));
  assert.equal(api.get(sb, "material.materialColor"), "#ffffff");
  assert.equal(api.get(na, "material.materialColor"), "#ffffff");
});

test("controls: a map with a scale bar and north arrow gets their rows, choice limits on the values inputs", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  context.GeoScene.addScaleBar(map);
  context.GeoScene.addNorthArrow(map);
  const r = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, r.components.overlay));
  ["Scale bar · Hide", "Scale bar · Units (0 metric · 1 imperial · 2 both)", "Scale bar · Hide below zoom", "North arrow · Size"].forEach((n) => assert.ok(names.includes(n), n));
  const slot = slotsOf(api, r.valuesId)["furn:scale:units"];
  assert.deepEqual(plain(api._overrides[r.valuesId][slot]), { hardMin: 0, hardMax: 2, step: 1 });
  const f = context.GeoScene.findFurniture(map);
  assert.equal(api.getInConnection(f.fade, "array.1"), r.valuesId + "." + slotsOf(api, r.valuesId)["furn:scale:hide"]);
});

test("Layers tab: Map furniture buttons add a scale bar and a north arrow, once each", () => {
  const { context } = buildSandbox();
  createWorldMap(context);
  assert.ok(holds(context.sectionPages.pages[1], context.addScaleBarBtn) && holds(context.sectionPages.pages[1], context.addNorthArrowBtn));
  context.addScaleBarBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Scale bar added to Map.");
  context.addScaleBarBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: This map already has a scale bar.");
  context.addNorthArrowBtn.onClick();
  assert.equal(context.statusLabel.getText(), "North arrow added to Map.");
  const f = context.GeoScene.findFurniture(context.currentMap());
  assert.ok(f.scaleBar && f.northArrow && f.fade);
});

test("Bake skips the scale bar and north arrow; only furniture selected says why", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  createWorldMap(context);
  const map = context.currentMap(), G = context.GeoScene;
  const sb = G.addScaleBar(map), na = G.addNorthArrow(map);
  api.select([sb, na]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: The scale bar and north arrow follow the camera, so they can't be baked.");
  const C = require("../src/core/codec.js");
  const c = G.createMapLayer(map, "Map: Countries", C.encodeLayer({ kind: "polygon", features: [{ name: "X", rings: [[[0, 0], [5, 0], [5, 5], [0, 0]]] }] }), { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  api.select([sb, c]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /Skipped the scale bar \/ north arrow \(they follow the camera\)\./);
});

test("Extract never lists the scale bar or north arrow; any panel action fits them to a resized comp", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  const sb = context.GeoScene.addScaleBar(map);
  context.refreshSourceLayers();
  assert.ok(!context.sourceLayers.some((l) => l.id === sb));
  const realGet = api.get;
  api.get = function (id, attr) { if (id === api.getActiveComp() && attr === "resolution") return { x: 1080, y: 1920 }; return realGet.apply(this, arguments); };
  context.syncControls(map);
  const at = "generator.array." + context.GeoExpression.inputIndex(context.GeoExpression.SCALE_BAR_INPUTS, "compH");
  assert.equal(api.get(sb, at), 1920);
});

test("a deleted scale bar's leftover fade is cleaned up when a bar is added again and never hijacks Hide below zoom", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const fadesOf = () => api.getCompLayers(false).filter((id) => api.getNiceName(id) === "Scale bar fade");
  const first = G.addScaleBar(map), old = G.findFurniture(map).fade;
  api.deleteLayer(first); // the fade stays behind, driving nothing
  assert.deepEqual(fadesOf(), [old]);
  assert.equal(G.findFurniture(map).fade, null, "no bar, so no fade is looked for");
  const bar = G.addScaleBar(map);
  assert.equal(fadesOf().length, 1, "exactly one fade for the map");
  const f = G.findFurniture(map);
  assert.equal(f.scaleBar, bar);
  assert.notEqual(f.fade, old);
  assert.equal(api.getInConnection(bar, "opacity"), f.fade + ".id");
  const r = context.GeoControlPanel.sync(map);
  assert.equal(api.getInConnection(f.fade, "array.1"), r.valuesId + "." + slotsOf(api, r.valuesId)["furn:scale:hide"]);
});

test("findFurniture takes the fade from the bar: other wiring or another map's fade is ignored", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const bar = G.addScaleBar(map), fade = G.findFurniture(map).fade;
  assert.equal(G.findFurniture(map).fade, fade);
  api.disconnect(fade, "id", bar, "opacity");
  assert.equal(G.findFurniture(map).fade, null, "bar's opacity driven by nothing");
  const stranger = api.create("javaScript", "Something else");
  api.connect(stranger, "id", bar, "opacity", true);
  assert.equal(G.findFurniture(map).fade, null, "bar's opacity driven by a layer that isn't a scale bar fade");
});

test("a panel action scans the comp's layers no more often than before the furniture existed", () => {
  const measure = (withFurniture) => {
    const { context, api } = buildSandbox();
    const map = controlsMap(context), G = context.GeoScene;
    if (withFurniture) { G.addScaleBar(map); G.addNorthArrow(map); }
    context.syncControls(map); // settle: the first sync adds the rows
    let finds = 0, scans = 0;
    const realFind = G.findMapLayers, realScan = api.getCompLayers;
    G.findMapLayers = function () { finds++; return realFind.apply(this, arguments); };
    api.getCompLayers = function () { scans++; return realScan.apply(this, arguments); };
    const realGet = api.get;
    api.get = function (id, attr) { if (id === api.getActiveComp() && attr === "resolution") return { x: 1080, y: 1080 }; return realGet.apply(this, arguments); };
    context.syncControls(map);
    api.get = realGet; G.findMapLayers = realFind; api.getCompLayers = realScan;
    if (withFurniture) {
      const f = G.findFurniture(map), at = (inputs, n) => "generator.array." + context.GeoExpression.inputIndex(inputs, n);
      assert.equal(api.get(f.scaleBar, at(context.GeoExpression.SCALE_BAR_INPUTS, "compW")), 1080, "the comp size still follows");
      assert.equal(api.get(f.northArrow, at(context.GeoExpression.NORTH_ARROW_INPUTS, "compH")), 1080);
      const r = context.GeoControlPanel.sync(map);
      assert.equal(api.getInConnection(f.fade, "array.1"), r.valuesId + "." + slotsOf(api, r.valuesId)["furn:scale:hide"], "Hide below zoom still links");
    }
    return { finds, scans };
  };
  const plainMap = measure(false), furnished = measure(true);
  assert.ok(furnished.finds <= 2, "findMapLayers calls: " + furnished.finds);
  assert.ok(plainMap.scans <= 9, "before the furniture branch one sync made 8 comp scans (9 with the group-controls lookup), now " + plainMap.scans);
  assert.equal(furnished.scans, plainMap.scans, "comp scans: " + furnished.scans + " vs " + plainMap.scans);
});

// ---- Simpler route controls: numbers, titles, Travel % helpers ----
const STOPS3 = [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 5, lat: 5 }, { name: "C", lon: 10, lat: 0 }];
function drawsOf(api, G, groupId) { return plain(G.routeDraws(groupId)); }
const CLIPDRAW = "array." + GeoExpressionT.inputIndex(GeoExpressionT.CLIP_INPUTS, "draw");
// What drives a leg's trim end: the draw helper's "id" output, directly (old-style legs) or through the leg's clip end helper.
function trimChain(api, line) {
  const from = String(api.getInConnection(line, "stroke.trimEnd") || ""), id = from.split(".")[0];
  if (id && /"category":"legClip"/.test(String(api.get(id, "expression")))) return api.getInConnection(id, CLIPDRAW);
  return from;
}

test("new routes are numbered, titled Route n, and each leg gets a draw helper on its trim end", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("R", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 });
  const r1 = G.createRoute(map, STOPS3, { arc: 30 });
  assert.equal(G.routeNumber(r1.groupId), 1);
  assert.equal(api.getNiceName(r1.groupId), "Route 1: A → B → C");
  const draws = drawsOf(api, G, r1.groupId);
  assert.equal(draws.length, 2);
  draws.forEach((d, k) => {
    assert.equal(api.getNiceName(d), "Leg " + (k + 1) + " draw");
    assert.equal(trimChain(api, r1.legs[k]), d + ".id");
    assert.equal(api.get(d, "array.1"), k);
    assert.equal(api.get(d, "array.2"), 2);
    assert.equal(api.get(d, "array.0"), 100);
  });
  const rec = plain(api.getUserDataKey(r1.groupId, "geoRoute"));
  assert.deepEqual(rec.legs.map((l) => l.draw), draws);
  const r2 = G.createRoute(map, [{ name: "D", lon: 1, lat: 1 }, { name: "E", lon: 2, lat: 2 }], { arc: 30 });
  assert.equal(G.routeNumber(r2.groupId), 2);
  assert.equal(G.stripRoute(api.getNiceName(r2.groupId)), "D → E");
  assert.equal(G.stripRoute("Route: X → Y"), "X → Y");
});

test("old-style routes are numbered too and record their draw helpers in geoRouteTravel", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;
  const G = context.GeoScene;
  const map = G.createMap("O", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 });
  const r = G.createRoute(map, STOPS3, { lift: 30, pins: true, labels: false });
  assert.equal(G.routeNumber(r.groupId), 1);
  assert.equal(api.getNiceName(r.groupId), "Route 1: A → B → C");
  const travel = plain(api.getUserDataKey(r.groupId, "geoRouteTravel"));
  assert.deepEqual(travel.legs.map((l) => l.line), plain(r.legs));
  travel.legs.forEach((l) => assert.equal(api.getInConnection(l.line, "stroke.trimEnd"), l.draw + ".id"));
  assert.deepEqual(drawsOf(api, G, r.groupId), travel.legs.map((l) => l.draw));
});

test("prepareRoutes numbers existing unnumbered routes in Scene Window order, renames only default titles, and adds helpers except on animated or wired legs", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("P", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 });
  const a = G.createRoute(map, STOPS3, { arc: 30 }), b = G.createRoute(map, [{ name: "D", lon: 1, lat: 1 }, { name: "E", lon: 2, lat: 2 }], { arc: 30 });
  // Make them look like routes from before this feature: no number, old title, no helpers.
  [a, b].forEach((r) => {
    G.routeDraws(r.groupId).forEach((d) => api.deleteLayer(d));
    const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
    rec.legs.forEach((l) => delete l.draw);
    api.setUserData(r.groupId, "geoRoute", rec);
    api.setUserData(r.groupId, "geoRouteNumber", null);
  });
  api.rename(a.groupId, "Route: A → B → C");
  api.rename(b.groupId, "My trip");
  api.keyframe(a.legs[0], 0, { "stroke.trimEnd": 0 });
  G.prepareRoutes(map);
  const kids = api.getChildren(map.groupId), first = a, second = b;
  assert.ok(kids.indexOf(b.groupId) < kids.indexOf(a.groupId), "the newer route sits higher in the Scene Window");
  assert.equal(G.routeNumber(first.groupId), 1, "bottom of the Scene Window (the oldest) first");
  assert.equal(G.routeNumber(second.groupId), 2);
  assert.equal(api.getNiceName(a.groupId), "Route " + G.routeNumber(a.groupId) + ": A → B → C");
  assert.equal(api.getNiceName(b.groupId), "My trip", "a user name is kept");
  const drawsA = drawsOf(api, G, a.groupId);
  assert.equal(drawsA.length, 1, "the animated first leg gets no helper");
  assert.equal(trimChain(api, a.legs[1]), drawsA[0] + ".id");
  assert.equal(api.get(drawsA[0], "array.1"), 1, "index keeps the leg's place in the route");
  assert.equal(drawsOf(api, G, b.groupId).length, 1);
  G.prepareRoutes(map);
  assert.equal(drawsOf(api, G, a.groupId).length, 1, "running again adds nothing");
  assert.equal(G.routeNumber(first.groupId), 1);
});

test("the traveller still rides: its tip reads the leg's trim end, now driven by the draw helper", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene;
  const map = G.createMap("T", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 });
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  G.addTraveller(map, r.groupId, "dot");
  const t = plain(api.getUserDataKey(r.groupId, "geoTraveller"));
  assert.equal(api.getInConnection(t.legs[0].tip, "array.0"), r.legs[0] + ".stroke.trimEnd");
  assert.equal(trimChain(api, r.legs[0]), G.routeDraws(r.groupId)[0] + ".id");
});

test("controls: a route shows Travel %, Arc height, Colour and Width in the Overlay controls, with the stops as notes; Travel drives every leg", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  const s = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, s.components.overlay));
  ["Route 1 · Travel %", "Route 1 · Arc height", "Route 1 · Colour", "Route 1 · Width"].forEach((n) => assert.ok(names.includes(n), n));
  assert.ok(!names.some((n) => /draw on|Lean|Flip|hand|handle/.test(n)));
  const list = api._promoted(s.components.overlay), i = names.indexOf("Route 1 · Travel %");
  assert.equal(api.get(s.components.overlay, "promotedAttributes." + i + ".notes"), "A → B → C");
  const slot = slotsOf(api, s.valuesId)["route:" + r.groupId + ":travel"];
  G.routeDraws(r.groupId).forEach((d) => assert.equal(api.getInConnection(d, "array.0"), s.valuesId + "." + slot));
  assert.equal(list[i], s.valuesId + "." + slot, "the Travel % row is the travel input");
});

test("controls: a refresh numbers an old route and gives it Travel %; notes the user typed are kept", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  G.routeDraws(r.groupId).forEach((d) => api.deleteLayer(d));
  const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
  rec.legs.forEach((l) => delete l.draw);
  api.setUserData(r.groupId, "geoRoute", rec);
  api.setUserData(r.groupId, "geoRouteNumber", null);
  api.rename(r.groupId, "Route: A → B → C");
  const s1 = context.GeoControlPanel.sync(map);
  assert.equal(api.getNiceName(r.groupId), "Route 1: A → B → C");
  assert.equal(G.routeDraws(r.groupId).length, 2);
  const names = plain(promotedNames(api, s1.components.overlay)), i = names.indexOf("Route 1 · Colour");
  api.set(s1.components.overlay, { ["promotedAttributes." + i + ".notes"]: "my note" });
  const s2 = context.GeoControlPanel.sync(map);
  const j = plain(promotedNames(api, s2.components.overlay)).indexOf("Route 1 · Colour");
  assert.equal(api.get(s2.components.overlay, "promotedAttributes." + j + ".notes"), "my note");
});

// ---- Simpler route controls: final review fixes ----
const STOPS_DE = [{ name: "D", lon: 1, lat: 1 }, { name: "E", lon: 2, lat: 2 }];
const STOPS_FG = [{ name: "F", lon: 3, lat: 3 }, { name: "G", lon: 4, lat: 4 }];
function routeMap(context, name) { return context.GeoScene.createMap(name || "P", { lat: 0, lon: 0, zoom: 4, rotation: 0, projection: 0 }); }
// Makes a new-style route look like one from before route numbers: no number, no draw helpers
// (and, when given, the old default title).
function unnumber(api, G, r, title) {
  G.routeDraws(r.groupId).forEach((d) => api.deleteLayer(d));
  const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
  rec.legs.forEach((l) => delete l.draw);
  api.setUserData(r.groupId, "geoRoute", rec);
  api.setUserData(r.groupId, "geoRouteNumber", null);
  if (title) api.rename(r.groupId, title);
}
function handleInput(context, name) { return "array." + context.GeoExpression.inputIndex(context.GeoExpression.HANDLE_INPUTS, name); }
function drawHelpers(api) { return api.getCompLayers(false).filter((id) => / draw$/.test(api.getNiceName(id))); }
function notesAt(api, comp, label) {
  const i = plain(promotedNames(api, comp)).indexOf(label);
  assert.ok(i >= 0, label + " is promoted");
  return api.get(comp, "promotedAttributes." + i + ".notes");
}

test("controls upgrade: an older map's leg draw on %, Lean, Flip side and shape-by-hand rows are retired on sync", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  const r1 = context.GeoControlPanel.sync(map), V = r1.valuesId;
  unnumber(api, G, r, "Route: A → B → C");
  const legs = plain(api.getUserDataKey(r.groupId, "geoRoute")).legs.sort((x, y) => x.number - y.number), handles = [];
  legs.forEach((l) => handles.push(l.startHandle, l.endHandle));
  const LEAN = handleInput(context, "lean"), FLIP = handleInput(context, "flip"), HAND = handleInput(context, "hand");
  // The old rows: leg 1's draw on % promoted straight from its (animated) trim end...
  api.keyframe(legs[0].line, 0, { "stroke.trimEnd": 0 });
  api.keyframe(legs[0].line, 10, { "stroke.trimEnd": 100 });
  api.connect(legs[0].line, "stroke.trimEnd", r1.componentId, "promotedAttributes");
  // ...and values inputs for Lean (not animated), leg 2's shape by hand (not animated) and Flip side (animated).
  const slots = slotsOf(api, V);
  function oldSlot(key, value, targets) {
    const path = api.addDynamic(V, "array");
    api.set(V, { [path]: value });
    targets.forEach(([h, attr]) => api.connect(V, path, h, attr, true));
    api.connect(V, path, r1.componentId, "promotedAttributes");
    slots[key] = path;
    return path;
  }
  const lean = oldSlot("route:" + r.groupId + ":lean", 15, handles.map((h) => [h, LEAN]));
  const hand = oldSlot("leg:" + legs[1].line + ":hand", true, [[legs[1].startHandle, HAND], [legs[1].endHandle, HAND]]);
  const flip = oldSlot("route:" + r.groupId + ":flip", false, handles.map((h) => [h, FLIP]));
  api.keyframe(V, 0, { [flip]: false });
  api.keyframe(V, 10, { [flip]: true });
  api.setUserData(V, "geoSlots", slots);
  combineIntoMain(api, r1); // the old single Controls: every row in main, stored as the plugin's (geoPromoted)
  const old = [legs[0].line + ".stroke.trimEnd", V + "." + lean, V + "." + hand, V + "." + flip];
  old.forEach((a) => assert.ok(plain(api._promoted(r1.componentId)).includes(a), a + " starts promoted"));

  const r2 = context.GeoControlPanel.sync(map);
  const all = ["main", "overlay", "data", "extract"].map((g) => r2.components[g]).filter(Boolean).flatMap((c) => plain(api._promoted(c)));
  old.forEach((a) => assert.ok(!all.includes(a), a + " is no longer promoted"));
  const names = plain(promotedNames(api, r2.components.overlay));
  ["Route 1 · Travel %", "Route 1 · Arc height", "Route 1 · Colour", "Route 1 · Width"].forEach((n) => assert.ok(names.includes(n), n));
  // The animated leg keeps its keys and gets no helper; leg 2 gets one.
  assert.deepEqual(plain(api.getKeyframeTimes(legs[0].line, "stroke.trimEnd")), [0, 10]);
  assert.equal(api.getInConnection(legs[0].line, "stroke.trimEnd"), "");
  const draws = drawsOf(api, G, r.groupId);
  assert.equal(draws.length, 1);
  assert.equal(trimChain(api, legs[1].line), draws[0] + ".id");
  // Lean and shape by hand let go, their values kept on the handle helpers, their keys forgotten.
  handles.forEach((h) => { assert.equal(api.getInConnection(h, LEAN), ""); assert.equal(api.get(h, LEAN), 15); });
  [legs[1].startHandle, legs[1].endHandle].forEach((h) => { assert.equal(api.getInConnection(h, HAND), ""); assert.equal(api.get(h, HAND), true); });
  const after = slotsOf(api, V);
  assert.equal(after["route:" + r.groupId + ":lean"], undefined);
  assert.equal(after["leg:" + legs[1].line + ":hand"], undefined);
  // The animated Flip side stays connected and keeps its key.
  handles.forEach((h) => assert.equal(api.getInConnection(h, FLIP), V + "." + flip));
  assert.equal(after["route:" + r.groupId + ":flip"], flip);
  assert.deepEqual(plain(api.getKeyframeTimes(V, flip)), [0, 10]);
});

test("prepareRoutes: a leg whose trim end is connected (not keyed) to something else gets no helper", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  unnumber(api, G, r);
  const mine = api.create("javaScript", "My driver");
  api.connect(mine, "id", r.legs[0], "stroke.trimEnd", true);
  G.prepareRoutes(map);
  assert.equal(api.getInConnection(r.legs[0], "stroke.trimEnd"), mine + ".id", "still driven by the user's layer");
  const draws = drawsOf(api, G, r.groupId);
  assert.equal(draws.length, 1);
  assert.equal(trimChain(api, r.legs[1]), draws[0] + ".id");
});

test("prepareRoutes: a leg whose trim end was set by hand to 50 counts as taken and gets no helper", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  unnumber(api, G, r);
  api.deleteLayer(plain(api.getUserDataKey(r.groupId, "geoRoute")).legs[1].clipEnd); // the user let go of the clip end
  api.set(r.legs[1], { "stroke.trimEnd": 50 });
  G.prepareRoutes(map);
  const draws = drawsOf(api, G, r.groupId);
  assert.equal(draws.length, 1);
  assert.equal(trimChain(api, r.legs[0]), draws[0] + ".id");
  assert.equal(api.getInConnection(r.legs[1], "stroke.trimEnd"), "");
  assert.equal(api.get(r.legs[1], "stroke.trimEnd"), 50, "the user's value stays");
});

test("prepareRoutes: an old-style route gets helpers in geoRouteTravel; a record copied from another group keeps only the group's own legs", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;
  const G = context.GeoScene, map = routeMap(context, "O");
  const a = G.createRoute(map, STOPS3, { lift: 30, pins: false, labels: false });
  const b = G.createRoute(map, STOPS_DE, { lift: 30, pins: false, labels: false });
  // a: from before Travel % (no helpers, no record).
  G.routeDraws(a.groupId).forEach((d) => api.deleteLayer(d));
  api.setUserData(a.groupId, "geoRouteTravel", null);
  G.prepareRoutes(map);
  const ta = plain(api.getUserDataKey(a.groupId, "geoRouteTravel"));
  assert.deepEqual(ta.legs.map((l) => l.line), plain(a.legs));
  ta.legs.forEach((l, k) => {
    assert.equal(api.getInConnection(l.line, "stroke.trimEnd"), l.draw + ".id");
    assert.equal(api.getParent(l.draw), a.groupId, "an old-style helper sits in the route group");
    assert.equal(api.get(l.draw, "array.1"), k);
    assert.equal(api.get(l.draw, "array.2"), 2);
  });
  // b: like a duplicate of a (the group copies a's record); its own legs are free.
  G.routeDraws(b.groupId).forEach((d) => api.deleteLayer(d));
  api.setUserData(b.groupId, "geoRouteTravel", ta);
  assert.deepEqual(drawsOf(api, G, b.groupId), [], "the copied record's helpers are not b's");
  G.prepareRoutes(map);
  const tb = plain(api.getUserDataKey(b.groupId, "geoRouteTravel"));
  assert.deepEqual(tb.legs.map((l) => l.line), plain(b.legs), "only b's own legs");
  tb.legs.forEach((l) => { assert.equal(api.getParent(l.draw), b.groupId); assert.equal(api.getInConnection(l.line, "stroke.trimEnd"), l.draw + ".id"); });
  assert.deepEqual(plain(api.getUserDataKey(a.groupId, "geoRouteTravel")), ta, "a keeps its own record");
});

test("prepareRoutes: an already-numbered route is never renamed, even when its name reads \"Route: …\"", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const a = G.createRoute(map, STOPS3, { arc: 30 }), b = G.createRoute(map, STOPS_DE, { arc: 30 });
  api.rename(a.groupId, "Route: Custom");
  G.prepareRoutes(map);
  assert.equal(api.getNiceName(a.groupId), "Route: Custom");
  assert.equal(api.getNiceName(b.groupId), "Route 2: D → E");
  assert.deepEqual([G.routeNumber(a.groupId), G.routeNumber(b.groupId)], [1, 2]);
});

test("route numbers: older unnumbered routes are numbered bottom first (oldest first), and a new route takes the next number on its first create", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const a = G.createRoute(map, STOPS3, { arc: 30 }), b = G.createRoute(map, STOPS_DE, { arc: 30 });
  unnumber(api, G, a, "Route: A → B → C");
  unnumber(api, G, b, "Route: D → E");
  const c = G.createRoute(map, STOPS_FG, { arc: 30 });
  assert.deepEqual([a, b, c].map((r) => G.routeNumber(r.groupId)), [1, 2, 3]);
  assert.deepEqual([a, b, c].map((r) => api.getNiceName(r.groupId)), ["Route 1: A → B → C", "Route 2: D → E", "Route 3: F → G"]);
});

test("route numbers: a route inside a group within the map is ranked by its place in the Scene Window", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const folder = api.create("group", "Folder");
  api.parent(folder, map.groupId); // at the bottom once the routes are made
  const a = G.createRoute(map, STOPS3, { arc: 30 }), b = G.createRoute(map, STOPS_DE, { arc: 30 });
  api.parent(b.groupId, folder);
  unnumber(api, G, a, "Route: A → B → C");
  unnumber(api, G, b, "Route: D → E");
  G.prepareRoutes(map);
  assert.equal(G.routeNumber(b.groupId), 1, "b sits lowest (inside the bottom group)");
  assert.equal(G.routeNumber(a.groupId), 2);
});

test("route numbers: a route sharing its number with an older one (a duplicated group) takes the highest + 1, renamed only if it still has the plugin's name", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const a = G.createRoute(map, STOPS3, { arc: 30 }), b = G.createRoute(map, STOPS_DE, { arc: 30 }), c = G.createRoute(map, STOPS_FG, { arc: 30 });
  [b, c].forEach((r) => api.setUserData(r.groupId, "geoRouteNumber", 1));
  api.rename(b.groupId, "My trip");
  api.rename(c.groupId, "Route 1: F → G");
  G.prepareRoutes(map);
  assert.deepEqual([a, b, c].map((r) => G.routeNumber(r.groupId)), [1, 2, 3], "oldest keeps 1; the later copies count on from the highest");
  assert.deepEqual([a, b, c].map((r) => api.getNiceName(r.groupId)), ["Route 1: A → B → C", "My trip", "Route 3: F → G"]);
  const d = G.createRoute(map, [{ name: "H", lon: 5, lat: 5 }, { name: "I", lon: 6, lat: 6 }], { arc: 30 });
  assert.equal(G.routeNumber(d.groupId), 4);
});

test("route numbers: renaming \"Route: …\" to \"Route n: …\" keeps the 60-character cap", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const r = G.createRoute(map, STOPS_DE, { arc: 30 });
  const long = "Saint-Rémy-de-Provence → Aix-en-Provence → Marseille → Toulon";
  unnumber(api, G, r, "Route: " + long);
  G.prepareRoutes(map);
  const name = api.getNiceName(r.groupId);
  assert.equal(name.length, 60);
  assert.equal(name, ("Route 1: " + long).slice(0, 59) + "…");
});

test("prepareRoutes: a helper that can't be wired is deleted, the helpers made before it are recorded, and the other routes still get theirs", () => {
  const { context, api } = buildSandbox();
  const G = context.GeoScene, map = routeMap(context);
  const a = G.createRoute(map, STOPS3, { arc: 30 }), b = G.createRoute(map, STOPS3, { arc: 30 });
  unnumber(api, G, a);
  unnumber(api, G, b);
  const real = api.connect;
  const failing = plain(api.getUserDataKey(b.groupId, "geoRoute")).legs.filter((l) => l.line === b.legs[1])[0].clipEnd;
  api.connect = function (x, y, z, w) { if (w === CLIPDRAW && z === failing) throw new Error("no"); return real.apply(this, arguments); };
  assert.doesNotThrow(() => G.prepareRoutes(map));
  api.connect = real;
  assert.equal(drawHelpers(api).length, 3, "b's leg 1 and both of a's: the failed helper is gone");
  assert.equal(plain(api.getUserDataKey(b.groupId, "geoRoute")).legs.filter((l) => l.draw).length, 1, "b's record keeps the helper made before the failure");
  assert.equal(drawsOf(api, G, a.groupId).length, 2, "a later route still gets its helpers");
  G.prepareRoutes(map);
  assert.equal(drawsOf(api, G, b.groupId).length, 2, "the next refresh finishes b");
});

test("an old-style route whose leg helper can't be wired keeps no stray helper; the next refresh adds it", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;
  const G = context.GeoScene, map = routeMap(context, "O");
  const real = api.connect;
  let n = 0;
  api.connect = function (x, y, z, w) { if (w === "stroke.trimEnd" && ++n === 2) throw new Error("no"); return real.apply(this, arguments); };
  const r = G.createRoute(map, STOPS3, { lift: 30, pins: false, labels: false });
  api.connect = real;
  assert.deepEqual(plain(api.getUserDataKey(r.groupId, "geoRouteTravel")).legs.map((l) => l.line), [r.legs[0]], "the helper made is recorded");
  assert.equal(drawHelpers(api).length, 1, "the helper that failed was deleted");
  assert.equal(api.getInConnection(r.legs[1], "stroke.trimEnd"), "");
  G.prepareRoutes(map);
  const draws = drawsOf(api, G, r.groupId);
  assert.equal(draws.length, 2);
  assert.equal(api.get(draws[1], "array.1"), 1);
  assert.equal(api.getInConnection(r.legs[1], "stroke.trimEnd"), draws[1] + ".id");
});

test("controls: a refresh that adds draw helpers keeps the user's selection", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const r = G.createRoute(map, STOPS3, { arc: 30 });
  const pin = G.addPin(map, "P", 1, 1);
  context.GeoControlPanel.sync(map);
  unnumber(api, G, r);
  const realCreate = api.create;
  api.create = function () { const id = realCreate.apply(this, arguments); api.select([id]); return id; };
  api.select([pin]);
  context.GeoControlPanel.sync(map);
  api.create = realCreate;
  assert.equal(G.routeDraws(r.groupId).length, 2, "helpers were made");
  assert.deepEqual(plain(api.getSelection()), [pin]);
});

test("controls: a route's notes list every stop from its record (not the capped name) and follow when the stops change", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  const stops = [{ name: "Saint-Rémy-de-Provence", lon: 0, lat: 0 }, { name: "Aix-en-Provence", lon: 5, lat: 5 }, { name: "Marseille", lon: 6, lat: 4 }, { name: "Toulon", lon: 7, lat: 3 }];
  const r = G.createRoute(map, stops, { arc: 30 });
  const full = stops.map((s) => s.name).join(" → ");
  assert.ok(api.getNiceName(r.groupId).endsWith("…"), "the group name is capped");
  const s1 = context.GeoControlPanel.sync(map);
  assert.equal(notesAt(api, s1.components.overlay, "Route 1 · Travel %"), full);
  const rec = plain(api.getUserDataKey(r.groupId, "geoRoute"));
  rec.stops[3].name = "Hyères";
  api.setUserData(r.groupId, "geoRoute", rec);
  const s2 = context.GeoControlPanel.sync(map);
  assert.equal(notesAt(api, s2.components.overlay, "Route 1 · Colour"), "Saint-Rémy-de-Provence → Aix-en-Provence → Marseille → Hyères");
});

test("controls: an old-style route's notes follow its title when the group is renamed", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;
  const map = controlsMap(context), G = context.GeoScene;
  const r = G.createRoute(map, STOPS3, { lift: 30, pins: false, labels: false });
  const s1 = context.GeoControlPanel.sync(map);
  assert.equal(notesAt(api, s1.components.overlay, "Route 1 · Width"), "A → B → C");
  api.rename(r.groupId, "Route 1: Paris → Rome");
  const s2 = context.GeoControlPanel.sync(map);
  ["Travel %", "Arc height", "Colour", "Width"].forEach((n) => assert.equal(notesAt(api, s2.components.overlay, "Route 1 · " + n), "Paris → Rome", n));
});

test("controls: a plugin note the user cleared comes back on the next refresh", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  G.createRoute(map, STOPS3, { arc: 30 });
  const s1 = context.GeoControlPanel.sync(map), i = plain(promotedNames(api, s1.components.overlay)).indexOf("Route 1 · Arc height");
  api.set(s1.components.overlay, { ["promotedAttributes." + i + ".notes"]: "" });
  const s2 = context.GeoControlPanel.sync(map);
  assert.equal(notesAt(api, s2.components.overlay, "Route 1 · Arc height"), "A → B → C");
});

test("controls: when one row's promotion fails, every other row still gets its own notes", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context), G = context.GeoScene;
  G.createRoute(map, STOPS3, { arc: 30 });
  const second = G.createRoute(map, STOPS_DE, { arc: 30 });
  const real = api.connect;
  // Route 2's Width input can't be promoted (Cavalry refuses it). Route 2 is listed first, so every
  // row after it sits one promotion slot higher than its place in the plan.
  api.connect = function (x, y, z, w) {
    if (w === "promotedAttributes" && api.hasUserDataKey(x, "geoSlots") && api.getUserDataKey(x, "geoSlots")["route:" + second.groupId + ":width"] === y) throw new Error("no");
    return real.apply(this, arguments);
  };
  const s = context.GeoControlPanel.sync(map);
  api.connect = real;
  const names = plain(promotedNames(api, s.components.overlay));
  assert.ok(!names.includes("Route 2 · Width"), "the failed row is missing");
  assert.ok(names.indexOf("Route 2 · Colour") < names.indexOf("Route 1 · Travel %"));
  names.forEach((n, i) => {
    const notes = api.get(s.components.overlay, "promotedAttributes." + i + ".notes");
    if (/^Route 1 · /.test(n)) assert.equal(notes, "A → B → C", n);
    else if (/^Route 2 · /.test(n)) assert.equal(notes, "D → E", n);
    else assert.equal(notes, "", n);
  });
});

// ---- Highlights --------------------------------------------------------------------
function highlightMap(context) {
  const map = controlsMap(context), G = context.GeoScene, C = require("../src/core/codec.js");
  const poly = C.encodeLayer({ kind: "polygon", features: [{ name: "France", rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]] }] });
  const extract = G.createMapLayer(map, "France", poly, { camera: map.cameraId, category: "extract", source: "countries" }, G.layerStyle(map, "extractFill"), {});
  return { map, extract };
}
const hlRec = (api, g) => plain(api.getUserDataKey(g, "geoHighlight"));

test("highlights: the effects list", () => {
  const { context } = buildSandbox();
  assert.deepEqual(plain(context.GeoScene.HIGHLIGHT_EFFECTS), [{ id: "fill", name: "Fill in" }, { id: "outline", name: "Outline draw-on" }, { id: "pulse", name: "Pulse" }, { id: "glow", name: "Glow" }]);
});

test("highlights: Fill in makes a numbered group directly above the extract, a filled shape from the extract's data, keyed opacity", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 10, duration: 25 });
  assert.equal(api.getNiceName(g), "Highlight 1: France");
  assert.equal(api.getUserDataKey(g, "geoHighlightNumber"), 1);
  assert.ok(directlyAbove(api, g, extract));
  const rec = hlRec(api, g);
  assert.equal(rec.extract, extract); assert.equal(rec.effect, "fill");
  assert.equal(api.getParent(rec.shape), g);
  assert.equal(api.getNiceName(rec.shape), "Highlight 1 shape");
  assert.deepEqual(plain(G.readLayerMeta(rec.shape)), { camera: map.cameraId, category: "highlight", effect: "fill" });
  assert.deepEqual(plain(G.readLayerData(rec.shape)), plain(G.readLayerData(extract)));
  assert.equal(api.getInConnection(rec.shape, "generator.array.2"), map.cameraId + ".array.2", "follows the camera");
  assert.ok(api.hasFill(rec.shape) && !api.hasStroke(rec.shape));
  assert.equal(api.get(rec.shape, "material.materialColor"), "#1F8F4E");
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "opacity")), [10, 35]);
  api.setFrame(10); assert.equal(api.get(rec.shape, "opacity"), 0);
  api.setFrame(35); assert.equal(api.get(rec.shape, "opacity"), 100);
});

test("highlights: Outline draw-on keys the shape's trim end, stroke only, width 3", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context);
  const rec = hlRec(api, context.GeoScene.createHighlight(map, extract, "outline", { start: 0, duration: 20 }));
  assert.ok(api.hasStroke(rec.shape) && !api.hasFill(rec.shape));
  assert.equal(api.get(rec.shape, "stroke.width"), 3);
  assert.equal(api.get(rec.shape, "stroke.trim"), true);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "stroke.trimEnd")), [0, 20]);
});

test("highlights: Pulse adds an oscillator into the shape's phase and a fade helper into its opacity; Amount keys the group", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context);
  const g = context.GeoScene.createHighlight(map, extract, "pulse", { start: 5, duration: 10 }), rec = hlRec(api, g);
  const phase = "generator.array." + context.GeoExpression.inputIndex(context.GeoExpression.HIGHLIGHT_SHAPE_INPUTS, "phase");
  assert.equal(api.getParent(rec.osc), g); assert.equal(api.getNiceName(rec.osc), "Highlight 1 pulse");
  assert.equal(api.get(rec.osc, "waveType"), 3); assert.equal(api.get(rec.osc, "minimum"), 0); assert.equal(api.get(rec.osc, "maximum"), 1);
  assert.equal(api.get(rec.osc, "frequency"), 1); assert.equal(api.get(rec.osc, "strengthToZero"), false);
  assert.equal(api.getInConnection(rec.shape, phase), rec.osc + ".id");
  assert.equal(api.getParent(rec.fade), g); assert.equal(api.getNiceName(rec.fade), "Highlight 1 fade");
  assert.equal(api.getInConnection(rec.fade, "array.0"), rec.osc + ".id");
  assert.equal(api.getInConnection(rec.shape, "opacity"), rec.fade + ".id");
  assert.deepEqual(plain(api.getKeyframeTimes(g, "opacity")), [5, 15]);
});

test("highlights: Glow sits directly below the extract with a blur inside its group", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context);
  const g = context.GeoScene.createHighlight(map, extract, "glow", { start: 0, duration: 25 }), rec = hlRec(api, g);
  assert.ok(directlyAbove(api, extract, g), "the extract stays on top");
  assert.ok(api.hasFill(rec.shape));
  assert.equal(api.getInConnection(rec.shape, "filters.0"), rec.blur + ".id");
  assert.equal(api.getParent(rec.blur), g);
  assert.deepEqual(plain(api.get(rec.blur, "amount")), { x: 20, y: 20 });
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "opacity")), [0, 25]);
});

test("highlights: numbers go up; findHighlights lists them in Scene Window order with their members", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const a = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 });
  const b = G.createHighlight(map, extract, "outline", { start: 0, duration: 5 });
  assert.equal(api.getNiceName(b), "Highlight 2: France");
  const found = G.findHighlights(map);
  assert.deepEqual(plain(found.map((h) => h.groupId)), [b, a], "top first");
  assert.equal(found[1].number, 1); assert.equal(found[1].effect, "fill"); assert.equal(found[1].name, "France");
  assert.equal(found[1].extract, extract); assert.equal(found[1].osc, null);
});

test("highlights: prepareHighlights deletes highlights whose extract is gone and renumbers a duplicate", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const a = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 });
  const b = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 });
  api.setUserData(b, "geoHighlightNumber", 1);    // a duplicated group copies its number
  api.rename(b, "Highlight 1: France");
  assert.equal(G.prepareHighlights(map), 0);
  assert.equal(api.getUserDataKey(a, "geoHighlightNumber"), 1);
  assert.equal(api.getUserDataKey(b, "geoHighlightNumber"), 2);
  assert.equal(api.getNiceName(b), "Highlight 2: France");
  api.deleteLayer(extract);
  assert.equal(G.prepareHighlights(map), 2);
  assert.equal(api.layerExists(a), false); assert.equal(api.layerExists(b), false);
});

test("highlights: createHighlight refuses a layer that isn't an extract of this map, and leaves nothing behind", () => {
  const { context, api } = buildSandbox();
  const { map } = highlightMap(context), G = context.GeoScene;
  const pin = G.addPin(map, "Here", 1, 1), before = api.getCompLayers(false).length;
  assert.throws(() => G.createHighlight(map, pin, "fill", {}), /extracted feature/);
  assert.throws(() => G.createHighlight(map, pin, "sparkle", {}), /Unknown highlight effect/);
  assert.equal(api.getCompLayers(false).length, before);
});

test("highlights: highlightParts lists every group and member", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "pulse", { start: 0, duration: 5 }), rec = hlRec(api, g);
  const parts = G.highlightParts(map);
  [g, rec.shape, rec.osc, rec.fade].forEach((id) => assert.ok(parts[id], id));
  assert.ok(!parts[extract]);
});

test("highlights in Controls: rows land in Extract controls with notes; a highlight shape is not an extract row", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "glow", { start: 0, duration: 10 }), rec = plain(api.getUserDataKey(g, "geoHighlight"));
  const r = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, r.components.extract));
  ["Highlight 1 · Amount %", "Highlight 1 · Colour", "Highlight 1 · Size"].forEach((n) => assert.ok(names.includes(n), n));
  assert.ok(names.includes("France · Hide"));
  assert.ok(!names.some((n) => /^Highlight 1 shape/.test(n)), "the shape is not listed as an extract");
  const promos = api._promoted(r.components.extract);
  assert.ok(promos.includes(rec.shape + ".opacity"));
  const notes = api.get(r.components.extract, "promotedAttributes." + promos.indexOf(rec.shape + ".opacity") + ".notes");
  assert.equal(notes, "France");
  // Size: one values input driving both blur axes.
  const slot = plain(api.getUserDataKey(r.valuesId, "geoSlots"))["hl:" + g + ":size"];
  assert.equal(api.getInConnection(rec.blur, "amount.x"), r.valuesId + "." + slot);
  assert.equal(api.getInConnection(rec.blur, "amount.y"), r.valuesId + "." + slot);
});

test("highlights in Controls: a refresh after the extract is deleted removes the highlight and its rows", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "pulse", { start: 0, duration: 10 });
  context.GeoControlPanel.sync(map);
  api.deleteLayer(extract);
  const r = context.GeoControlPanel.sync(map);
  assert.equal(api.layerExists(g), false);
  assert.equal(r.components.extract, null, "nothing left to show");
});

test("highlights in Controls: the Amount row points at the keyed attribute and keeps its keys", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "outline", { start: 3, duration: 7 }), rec = plain(api.getUserDataKey(g, "geoHighlight"));
  const r = context.GeoControlPanel.sync(map);
  assert.ok(api._promoted(r.components.extract).includes(rec.shape + ".stroke.trimEnd"));
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "stroke.trimEnd")), [3, 10]);
});

// ---- Highlights: final review fixes ---------------------------------------------------
// A duplicated highlight group: the copy carries the original's record, but its own shape (and helpers).
function duplicateHighlight(api, G, map, extract, effect) {
  const a = G.createHighlight(map, extract, effect, { start: 0, duration: 5 });
  const b = G.createHighlight(map, extract, effect, { start: 0, duration: 5 });
  api.setUserData(b, "geoHighlight", api.getUserDataKey(a, "geoHighlight"));
  api.setUserData(b, "geoHighlightNumber", 1);
  api.rename(b, "Highlight 1: France");
  return { a, b, recA: hlRec(api, a), own: G.findHighlights(map).filter((h) => h.groupId === b)[0] };
}

test("highlights (duplicate): a copied group's members are its own children, not the original's", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const { a, b, recA, own } = duplicateHighlight(api, G, map, extract, "pulse");
  assert.equal(api.getParent(own.shape), b); assert.notEqual(own.shape, recA.shape);
  assert.equal(api.getParent(own.osc), b); assert.notEqual(own.osc, recA.osc);
  assert.equal(api.getParent(own.fade), b); assert.notEqual(own.fade, recA.fade);
  const parts = G.highlightParts(map);
  [b, own.shape, own.osc, own.fade, a, recA.shape].forEach((id) => assert.ok(parts[id], id));
});

test("highlights (duplicate): sync renumbers the copy, rewrites its record and points its rows at its own shape", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const { a, b, recA, own } = duplicateHighlight(api, G, map, extract, "pulse");
  const r = context.GeoControlPanel.sync(map);
  assert.equal(api.getUserDataKey(a, "geoHighlightNumber"), 1);
  assert.equal(api.getUserDataKey(b, "geoHighlightNumber"), 2);
  const recB = hlRec(api, b);
  assert.equal(recB.shape, own.shape); assert.equal(recB.osc, own.osc); assert.equal(recB.fade, own.fade);
  assert.equal(hlRec(api, a).shape, recA.shape, "the original keeps its own members");
  const promos = plain(api._promoted(r.components.extract));
  assert.equal(promos.filter((p) => p === a + ".opacity").length, 1, "the original is promoted once");
  assert.ok(promos.includes(b + ".opacity"), "the copy's Amount row is its own group");
  assert.deepEqual(promos, promos.filter((p, i) => promos.indexOf(p) === i), "no duplicated promotion");
  const names = plain(promotedNames(api, r.components.extract));
  assert.ok(names.includes("Highlight 1 · Amount %") && names.includes("Highlight 2 · Amount %"));
});

test("highlights (duplicate): Bake on a copy's shape is skipped", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const { own } = duplicateHighlight(api, G, map, extract, "fill");
  api.select([own.shape]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights can't be baked.");
});

test("highlights: Bake skips a highlight shape that no group record lists", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 }), rec = hlRec(api, g);
  api.setUserData(g, "geoHighlight", {});
  api.select([rec.shape]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights can't be baked.");
});

test("highlights: a highlight whose extract is gone is removed, but a group holding the user's layers stays", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "pulse", { start: 0, duration: 10 }), rec = hlRec(api, g);
  const mine = api.create("group", "Mine"); api.parent(mine, g);
  context.GeoControlPanel.sync(map);
  api.deleteLayer(extract);
  const r = context.GeoControlPanel.sync(map);
  [rec.shape, rec.osc, rec.fade].forEach((id) => assert.equal(api.layerExists(id), false, id));
  assert.equal(api.layerExists(g), true); assert.equal(api.layerExists(mine), true);
  assert.equal(api.getParent(mine), g);
  assert.equal(r.components.extract, null, "no rows");
});

test("highlights: prepareHighlights on a copy whose extract is gone never touches the original's members", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const { a, b, recA, own } = duplicateHighlight(api, G, map, extract, "fill");
  api.deleteLayer(extract);
  assert.equal(G.prepareHighlights(map), 2);
  [a, b, recA.shape, own.shape].forEach((id) => assert.equal(api.layerExists(id), false, id));
});

test("highlights: the shape's detail and dot size follow the extract's inputs", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene, E = context.GeoExpression;
  const rec = hlRec(api, G.createHighlight(map, extract, "fill", { start: 0, duration: 5 }));
  ["detail", "pointRadius"].forEach((n) => {
    const at = "generator.array." + E.inputIndex(E.MAP_INPUTS, n);
    assert.equal(api.getInConnection(rec.shape, at), extract + "." + at, n);
  });
});

test("highlights: if connecting detail fails the extract's value is copied instead", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene, E = context.GeoExpression;
  const at = "generator.array." + E.inputIndex(E.MAP_INPUTS, "detail");
  api.set(extract, { [at]: 77 });
  const real = api.connect;
  api.connect = function (a, b, c, d) { if (a === extract && d === at) throw new Error("no"); return real.apply(this, arguments); };
  try {
    const rec = hlRec(api, G.createHighlight(map, extract, "fill", { start: 0, duration: 5 }));
    assert.equal(api.getInConnection(rec.shape, at), "");
    assert.equal(api.get(rec.shape, at), 77);
  } finally { api.connect = real; }
});

test("highlights: createHighlight leaves the user's selection as it was, even for Glow", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  ["fill", "glow"].forEach((effect) => {
    api.select(["someone#1"]);
    G.createHighlight(map, extract, effect, { start: 0, duration: 5 });
    assert.deepEqual(plain(api.getSelection()), ["someone#1"], effect);
  });
});

test("highlights: Glow is made without selection or reorder calls", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  api.select = undefined;
  assert.doesNotThrow(() => G.createHighlight(map, extract, "glow", { start: 0, duration: 5 }));
});

function twoFeatures(context) {
  const C = require("../src/core/codec.js"), map = controlsMap(context), G = context.GeoScene;
  const poly = C.encodeLayer({ kind: "polygon", features: [
    { name: "France", rank: 1, rings: [[[0, 40], [5, 40], [5, 50], [0, 40]]], props: {} },
    { name: "Spain", rank: 1, rings: [[[-8, 36], [-2, 36], [-2, 43], [-8, 36]]], props: {} }] });
  G.createMapLayer(map, "Map: Countries", poly, { camera: map.cameraId, category: "countries" }, G.layerStyle(map, "countries"), {});
  context.featureQuery.setText("");
  context.findBtn.onClick();
  context.featureList.getSelection = () => context.featureList._model.map((m) => m.uuid);
  return map;
}

test("Highlight selected: one failing feature doesn't stop the others", () => {
  const { context } = buildSandbox();
  const map = twoFeatures(context), G = context.GeoScene;
  assert.equal(context.featureList._model.length, 2);
  const real = G.createHighlight; let calls = 0;
  G.createHighlight = function () { if (++calls === 2) throw new Error("Boom"); return real.apply(this, arguments); };
  context.highlightStartField.setValue(5); context.highlightLengthField.setValue(10);
  context.highlightBtn.onClick();
  G.createHighlight = real;
  assert.equal(G.findHighlights(map).length, 1);
  assert.match(context.statusLabel.getText(), /^Highlighted 1 feature\(s\) with Fill in\. Animate or re-time its Amount % keys on the timeline\./);
  assert.match(context.statusLabel.getText(), / Couldn't highlight 1: Boom/);
  assert.equal(context.highlightStartField.getValue(), 15, "Start still advances");
});

test("Highlight selected: when every feature fails the first error is shown and Start stays", () => {
  const { context } = buildSandbox();
  twoFeatures(context);
  const G = context.GeoScene, real = G.createHighlight; let calls = 0;
  G.createHighlight = function () { throw new Error("Boom " + (++calls)); };
  context.highlightStartField.setValue(5);
  context.highlightBtn.onClick();
  G.createHighlight = real;
  assert.equal(context.statusLabel.getText(), "Error: Boom 1");
  assert.equal(context.highlightStartField.getValue(), 5);
});

// ---- Start here tips ---------------------------------------------------------
const TIPS_LINES = [
  "1. Make a map: type a place in Search and press Enter, or pick \"New map\" and press Create map here.",
  "2. Add layers: in the Layers tab, tick countries, coastlines, roads… and press Add layers.",
  "3. Mark places: the Label tab adds pins, labels and routes. Click the preview to drop a stop.",
  "4. Animate: Fly here moves the camera between frames; key a route's Travel % or a highlight's Amount % in its Controls.",
  "Every map's settings are in \"(map name) Map controls\" in the Scene Window."
];
function tipsWidgets(context) { return context.tipsBox.slice(); }

test("Start here: a first run shows the box at the top of the Map tab with the approved text", () => {
  const { context, ui } = buildSandbox();
  const mapPage = context.sectionPages.pages[0];
  tipsWidgets(context).forEach((w, i) => assert.ok(holds(mapPage, w), "tips widget " + i + " is on the Map page"));
  tipsWidgets(context).forEach((w, i) => assert.equal(w.isHidden(), false, "tips widget " + i + " is shown"));
  assert.equal(mapPage._items[0].getText(), "Start here", "the title comes first");
  const notes = context.tipsBox.filter((w) => w instanceof ui.Label).map((w) => w.getText());
  assert.deepEqual(plain(notes), ["Start here"].concat(TIPS_LINES));
  assert.equal(mapPage._items[context.tipsBox.length - 1], context.tipsGotItBtn, "Got it ends the box");
  assert.equal(context.tipsGotItBtn.getText(), "Got it");
  assert.equal(context.tipsBtn.getText(), "Tips");
  assert.equal(context.tipsTitle._fontSize, 11, "the title is a small heading");
  assert.equal(context.tipsTitle._fixedHeight, 16);
  const pageItems = mapPage._items, tipsRow = pageItems[pageItems.length - 1];
  assert.ok(holds(tipsRow, context.tipsBtn), "the Tips button closes the Map tab");
  assert.equal(tipsRow._stretch, 1, "a stretch after the button keeps it small");
  assert.equal(holds(ui._root(), context.tipsBtn), true, "the Map page is inside the panel");
  const items = ui._root()._items;
  assert.equal(items.some((n) => n === context.statusLabel), true);
  assert.equal(items[items.length - 1], context.statusLabel, "the status line is still last");
  items.slice(0, -1).forEach((n) => assert.ok(n !== tipsRow && !(n._items || []).includes(context.tipsBtn), "root does not hold Tips directly"));
  assert.equal(context.tipsGotItBtn._background, "#1F8F4E", "Got it is the green primary button");
});

test("Start here: Got it hides the box and remembers it, keeping other settings", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mono", source: "eox" }); } });
  context.tipsGotItBtn.onClick();
  tipsWidgets(context).forEach((w, i) => assert.equal(w.isHidden(), true, "tips widget " + i + " is hidden"));
  const s = settingsOf(api);
  assert.equal(s.showTips, false);
  assert.equal(s.mapStyle, "Mono");
  assert.equal(s.source, "eox");
});

test("Start here: a saved showTips false starts hidden; any other saved settings still show it", () => {
  const hidden = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ showTips: false }); } });
  tipsWidgets(hidden.context).forEach((w, i) => assert.equal(w.isHidden(), true, "tips widget " + i));
  const shown = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mono" }); } });
  tipsWidgets(shown.context).forEach((w, i) => assert.equal(w.isHidden(), false, "tips widget " + i));
});

test("Start here: the Tips button shows the Map tab and the box again, and remembers it", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ showTips: false, mapStyle: "Mono" }); } });
  context.showSection("Imagery");
  context.tipsBtn.onClick();
  assert.equal(context.sectionTabs.selected(), "Map");
  assert.equal(context.sectionPages.currentPage(), 0);
  tipsWidgets(context).forEach((w, i) => assert.equal(w.isHidden(), false, "tips widget " + i));
  assert.equal(settingsOf(api).showTips, true);
  assert.equal(settingsOf(api).mapStyle, "Mono");
});

test("Start here: widgets without setHidden don't break the panel", () => {
  // A Cavalry that documents setHidden on Button only.
  const api = makeFakeApi(), ui = makeFakeUi();
  delete ui.Label.prototype.setHidden;
  api._files[SETTINGS_FILE] = JSON.stringify({ showTips: false });
  const context = vm.createContext({ api: api, ui: ui, cavalry: makeFakeCavalry(), console: console });
  vm.runInContext(buildPanel(), context, { filename: "CavalryGeo.js" });
  assert.doesNotThrow(() => context.tipsBtn.onClick());
  assert.equal(settingsOf(api).showTips, true);
  assert.doesNotThrow(() => context.tipsGotItBtn.onClick());
  assert.equal(settingsOf(api).showTips, false);
});

test("no panel text contains < (Cavalry reads it as a tag), and the Controls note has the new wording", () => {
  const { context, ui } = buildSandbox();
  const texts = [];
  walkUi(ui._root(), (n) => { if (n instanceof ui.Label) texts.push(n.getText()); });
  walkUi(ui._root(), (n) => { if (n instanceof ui.Button) texts.push(n.getText()); });
  assert.ok(texts.length > 30, "labels were found");
  texts.forEach((t) => assert.ok(!/</.test(t), "text with <: " + t));
  assert.ok(texts.indexOf("Each map's settings in one place: select \"(map name) Map controls\" (or its Overlay, Data and Extract controls) in the Scene Window.") >= 0);
});

// ---- Highlights: change effect in place ----------------------------------------------
const valueAt = (api, id, attr, f) => { api.setFrame(f); return api.get(id, attr); };

test("change effect: Fill in -> Pulse keeps the group, number, name, colour and Amount timing", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 10, duration: 25 }), old = hlRec(api, g);
  api.setFrame(4);
  const r = G.changeHighlightEffect(map, g, "pulse");
  assert.deepEqual(plain(r), { number: 1 });
  assert.equal(api.getFrame(), 4, "the playhead goes back where it was");
  assert.equal(api.getNiceName(g), "Highlight 1: France");
  assert.equal(api.getUserDataKey(g, "geoHighlightNumber"), 1);
  const rec = hlRec(api, g);
  assert.equal(rec.effect, "pulse"); assert.equal(rec.extract, extract);
  assert.equal(api.layerExists(old.shape), false, "the old shape is gone");
  [rec.shape, rec.osc, rec.fade].forEach((id) => assert.equal(api.getParent(id), g, id));
  assert.equal(api.getNiceName(rec.shape), "Highlight 1 shape");
  assert.deepEqual(plain(G.readLayerMeta(rec.shape)), { camera: map.cameraId, category: "highlight", effect: "pulse" });
  assert.deepEqual(plain(api.getKeyframeTimes(g, "opacity")), [10, 35]);
  assert.equal(valueAt(api, g, "opacity", 10), 0); assert.equal(valueAt(api, g, "opacity", 35), 100);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "opacity")), [], "the fade drives the shape's opacity");
  assert.equal(api.getInConnection(rec.shape, "opacity"), rec.fade + ".id");
  assert.ok(api.hasStroke(rec.shape) && !api.hasFill(rec.shape));
  assert.equal(api.get(rec.shape, "stroke.strokeColor"), "#1F8F4E", "the fill colour is now the stroke colour");
  assert.equal(G.findHighlights(map).length, 1);
});

test("change effect: Pulse -> Glow removes the oscillator and fade, adds a blur, moves the keys and the group below the extract", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "pulse", { start: 5, duration: 10 }), old = hlRec(api, g);
  assert.ok(directlyAbove(api, g, extract));
  G.changeHighlightEffect(map, g, "glow");
  const rec = hlRec(api, g);
  [old.osc, old.fade, old.shape].forEach((id) => assert.equal(api.layerExists(id), false, id));
  assert.equal(rec.osc, undefined); assert.equal(rec.fade, undefined);
  assert.equal(api.getParent(rec.blur), g);
  assert.equal(api.getInConnection(rec.shape, "filters.0"), rec.blur + ".id");
  assert.deepEqual(plain(api.getKeyframeTimes(g, "opacity")), [], "the group's Amount keys are gone");
  assert.equal(api.get(g, "opacity"), 100);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "opacity")), [5, 15]);
  assert.equal(valueAt(api, rec.shape, "opacity", 5), 0); assert.equal(valueAt(api, rec.shape, "opacity", 15), 100);
  assert.ok(directlyAbove(api, extract, g), "Glow sits directly below the extract");
});

test("change effect: Glow -> Fill in moves back above the extract", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "glow", { start: 0, duration: 5 });
  G.changeHighlightEffect(map, g, "fill");
  assert.ok(directlyAbove(api, g, extract));
});

test("change effect: Outline -> Fill in keys the shape's opacity and keeps a changed colour", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "outline", { start: 2, duration: 8 });
  api.set(hlRec(api, g).shape, { "stroke.strokeColor": "#ff0000" });
  G.changeHighlightEffect(map, g, "fill");
  const rec = hlRec(api, g);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "opacity")), [2, 10]);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "stroke.trimEnd")), []);
  assert.ok(api.hasFill(rec.shape) && !api.hasStroke(rec.shape));
  assert.equal(api.get(rec.shape, "material.materialColor"), "#ff0000");
});

test("change effect: re-timed keys and values move across; no keys means a new 0 -> 100 at the playhead", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 0, duration: 10 }), shape = hlRec(api, g).shape;
  api.deleteKeyframe(shape, "opacity", 10);
  api.keyframe(shape, 20, { opacity: 60 });
  G.changeHighlightEffect(map, g, "outline");
  let rec = hlRec(api, g);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "stroke.trimEnd")), [0, 20]);
  assert.equal(valueAt(api, rec.shape, "stroke.trimEnd", 20), 60);
  api.getKeyframeTimes(rec.shape, "stroke.trimEnd").forEach((f) => api.deleteKeyframe(rec.shape, "stroke.trimEnd", f));
  api.setFrame(7);
  G.changeHighlightEffect(map, g, "glow");
  rec = hlRec(api, g);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.shape, "opacity")), [7, 32]);
});

test("change effect: the same effect, an unknown effect or a non-highlight are refused and nothing changes", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 }), before = hlRec(api, g);
  assert.throws(() => G.changeHighlightEffect(map, g, "fill"), (e) => e.message === "Highlight 1 already uses Fill in.");
  assert.throws(() => G.changeHighlightEffect(map, g, "sparkle"), /Unknown highlight effect/);
  assert.throws(() => G.changeHighlightEffect(map, extract, "glow"), /Select a highlight/);
  assert.deepEqual(hlRec(api, g), before);
});

test("change effect: the user's selection is kept, with the old shape swapped for the new one", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 });
  api.select([hlRec(api, g).shape, extract]);
  G.changeHighlightEffect(map, g, "glow");
  assert.deepEqual(plain(api.getSelection()), [hlRec(api, g).shape, extract]);
});

test("change effect: a failure while building leaves the old highlight as it was", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 }), before = hlRec(api, g), count = api.getCompLayers(false).length;
  const real = api.create;
  api.create = function (type) { if (type === "oscillator") throw new Error("no oscillators"); return real.apply(this, arguments); };
  try { assert.throws(() => G.changeHighlightEffect(map, g, "pulse"), /no oscillators/); } finally { api.create = real; }
  assert.deepEqual(hlRec(api, g), before);
  assert.equal(api.layerExists(before.shape), true);
  assert.equal(api.getCompLayers(false).length, count, "nothing left behind");
  assert.deepEqual(plain(api.getKeyframeTimes(before.shape, "opacity")), [0, 5]);
});

test("change effect: Outline width carries to Pulse (and back); other changes use the default width", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "outline", { start: 0, duration: 5 });
  api.set(hlRec(api, g).shape, { "stroke.width": 7 });
  G.changeHighlightEffect(map, g, "pulse");
  assert.equal(api.get(hlRec(api, g).shape, "stroke.width"), 7, "Outline -> Pulse keeps the width");
  G.changeHighlightEffect(map, g, "outline");
  assert.equal(api.get(hlRec(api, g).shape, "stroke.width"), 7, "and back");
  G.changeHighlightEffect(map, g, "fill");
  G.changeHighlightEffect(map, g, "outline");
  assert.equal(api.get(hlRec(api, g).shape, "stroke.width"), 3, "through Fill in the width starts again");
});

test("change effect: the new record is written before the old layers go, and keys are re-keyed in time order", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 3, duration: 10 }), old = hlRec(api, g);
  const realDelete = api.deleteLayer, realTimes = api.getKeyframeTimes;
  api.deleteLayer = function () { throw new Error("boom"); };
  try { assert.throws(() => G.changeHighlightEffect(map, g, "outline"), /boom/); } finally { api.deleteLayer = realDelete; }
  assert.equal(hlRec(api, g).effect, "outline", "never a record naming the old effect");
  assert.notEqual(hlRec(api, g).shape, old.shape);
  const g2 = G.createHighlight(map, extract, "fill", { start: 3, duration: 10 });
  api.getKeyframeTimes = function () { return realTimes.apply(this, arguments).slice().reverse(); };
  try { G.changeHighlightEffect(map, g2, "glow"); } finally { api.getKeyframeTimes = realTimes; }
  assert.deepEqual(plain(realTimes.call(api, hlRec(api, g2).shape, "opacity")), [3, 13]);
  assert.equal(valueAt(api, hlRec(api, g2).shape, "opacity", 3), 0);
  assert.equal(valueAt(api, hlRec(api, g2).shape, "opacity", 13), 100);
});

test("Change effect button: a highlight of another map is named as such", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "fill", { start: 0, duration: 5 });
  context.makeMap("Other", context.worldViewCamera(0)); // the picker now shows the other map
  assert.equal(G.findMaps().length, 2);
  api.select([hlRec(api, g).shape]);
  context.changeEffectBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: That highlight belongs to another map. Pick that map first.");
  api.select([]);
  context.changeEffectBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Select a highlight in the Scene Window first.");
  assert.equal(hlRec(api, g).effect, "fill", "nothing changed");
});

test("highlightOfSelection: finds the group from the group, its shape or its oscillator; null otherwise", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "pulse", { start: 0, duration: 5 }), rec = hlRec(api, g);
  const other = api.create("group", "Mine");
  assert.equal(G.highlightOfSelection(map, [g]), g);
  assert.equal(G.highlightOfSelection(map, [rec.shape]), g);
  assert.equal(G.highlightOfSelection(map, [other, rec.osc]), g, "the first id that is a highlight part");
  assert.equal(G.highlightOfSelection(map, [extract]), null);
  assert.equal(G.highlightOfSelection(map, [other]), null);
  assert.equal(G.highlightOfSelection(map, []), null);
});

test("Change effect button: changes the selected highlight, or says what is missing", () => {
  const { context, api } = buildSandbox();
  const map = findFrance(context), G = context.GeoScene;
  assert.ok(holds(context.sectionPages.pages[1], context.changeEffectBtn), "Layers page");
  assert.equal(context.changeEffectBtn.getText(), "Change effect");
  context.highlightBtn.onClick();                       // Fill in
  api.select([]);
  context.changeEffectBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Select a highlight in the Scene Window first.");
  api.select([G.findHighlights(map)[0].shape]);
  context.changeEffectBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlight 1 already uses Fill in.");
  context.highlightEffectPicker.setValue(3);            // Glow
  context.changeEffectBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Highlight 1 now uses Glow.");
  assert.equal(G.findHighlights(map)[0].effect, "glow");
});

test("Change effect: the Controls rows follow the new effect", () => {
  const { context, api } = buildSandbox();
  const { map, extract } = highlightMap(context), G = context.GeoScene;
  const g = G.createHighlight(map, extract, "outline", { start: 0, duration: 5 });
  let names = plain(promotedNames(api, context.GeoControlPanel.sync(map).components.extract));
  assert.ok(names.includes("Highlight 1 · Width"));
  G.changeHighlightEffect(map, g, "pulse");
  const r = context.GeoControlPanel.sync(map);
  names = plain(promotedNames(api, r.components.extract));
  assert.ok(names.includes("Highlight 1 · Speed"));
  assert.ok(!names.includes("Highlight 1 · Width"));
  assert.ok(api._promoted(r.components.extract).includes(g + ".opacity"), "the Amount row is on the group");
});

// ---- Follow-up: hover events, numbered maps, one street layer at a time ----
test("preview: hover events are switched on so Cavalry reports middle-button moves", () => {
  const { context } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  assert.equal(p._draw._hover, true);
  const noHover = buildSandbox({ setup: installNe });
  delete noHover.ui.Draw.prototype.useHoverEvents;
  assert.doesNotThrow(() => makePreview(noHover.context), "a Draw without useHoverEvents is fine");
});

test("preview: a hover move with no button held changes nothing and triggers no redraw", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  p.setWidth(320);
  p.showCamera({ lat: 45, lon: 2, zoom: 5 }, "camera");
  p._render();
  runTimersOnce(api); // settle the redraw the showCamera call queued
  const view = JSON.stringify(plain(p._view())), redraws = p._draw._redraws, paths = p._draw._paths.length;
  p._draw.onMouseMove({ x: 140, y: 100 });
  p._draw.onMouseMove({ x: 150, y: 90 });
  runTimersOnce(api);
  assert.equal(JSON.stringify(plain(p._view())), view, "the view is untouched");
  assert.equal(p.source(), "camera", "still the camera's frame");
  assert.equal(p._draw._redraws, redraws, "no redraw");
  assert.equal(p._draw._paths.length, paths);
  // after a drag has finished, hovering is still a no-op
  p._draw.onMousePress({ x: 100, y: 100 }, "left");
  p._draw.onMouseMove({ x: 140, y: 100 });
  p._draw.onMouseRelease({ x: 140, y: 100 }, "left");
  runTimersOnce(api);
  const after = JSON.stringify(plain(p._view())), n = p._draw._redraws;
  p._draw.onMouseMove({ x: 200, y: 100 });
  runTimersOnce(api);
  assert.equal(JSON.stringify(plain(p._view())), after);
  assert.equal(p._draw._redraws, n);
});

function blankCreateHere(context) {
  context.mapPicker.setValue(context.maps.length); // New map
  context.nameField.setText("");
  context.preview.showCamera({ lat: 35, lon: 139, zoom: 8 }, "camera");
  context.createHereBtn.onClick();
}

test("Create map here: a blank name numbers the maps Map 1, Map 2…", () => {
  const { context } = buildSandbox({ setup: installNe });
  blankCreateHere(context);
  assert.equal(context.currentMap().name, "Map 1");
  blankCreateHere(context);
  assert.equal(context.currentMap().name, "Map 2");
  assert.deepEqual(plain(context.GeoScene.findMaps().map((m) => m.name).sort()), ["Map 1", "Map 2"]);
  assert.match(context.statusLabel.getText(), /^Created map "Map 2" /);
});

test("Create map here: the lowest free number is used, and existing maps are never renamed", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  blankCreateHere(context);
  blankCreateHere(context);
  api.deleteLayer(context.GeoScene.findMaps().find((m) => m.name === "Map 1").groupId);
  assert.deepEqual(plain(context.GeoScene.findMaps().map((m) => m.name)), ["Map 2"]);
  blankCreateHere(context);
  assert.deepEqual(plain(context.GeoScene.findMaps().map((m) => m.name).sort()), ["Map 1", "Map 2"]);
  assert.equal(context.currentMap().name, "Map 1");
});

test("Create map here: a typed name is unchanged (and made unique), and the Controls component reads Map 1 Map controls", () => {
  const { context, api } = buildSandbox({ setup: installNe });
  context.mapPicker.setValue(context.maps.length);
  context.nameField.setText("Paris");
  context.preview.showCamera({ lat: 35, lon: 139, zoom: 8 }, "camera");
  context.createHereBtn.onClick();
  assert.equal(context.currentMap().name, "Paris");
  context.mapPicker.setValue(context.maps.length);
  context.nameField.setText("Paris");
  context.createHereBtn.onClick();
  assert.equal(context.currentMap().name, "Paris 2");
  blankCreateHere(context);
  const map = context.currentMap();
  assert.equal(map.name, "Map 1");
  assert.equal(api.getNiceName(controlsOf(api, map)), "Map 1 Map controls");
});

test("the name box placeholder explains the numbering", () => {
  const { context } = buildSandbox();
  assert.equal(context.nameField._placeholder, "Map name (blank = the place's name, or Map 1, Map 2…)");
});

function streetsSetup(context, opts) {
  const map = context.makeMap("Map", { lat: 35, lon: 139, zoom: 15, rotation: 0, projection: 0 });
  const C = context.GeoCodec;
  const line = C.encodeLayer({ kind: "line", features: [{ name: "Road", rings: [[[139, 35], [139.001, 35.001]]] }] });
  const none = C.encodeLayer({ kind: "line", features: [] });
  context.GeoNet.osmLayer = (cat) => (opts.empty && opts.empty.indexOf(cat) >= 0 ? none : line);
  context.GeoNet.neLayer = () => C.encodeLayer({ kind: "polygon", features: [{ name: "Here", rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }] });
  return map;
}

test("Streets note says to add one street layer at a time", () => {
  const { context, ui } = buildSandbox();
  const texts = [];
  walkUi(context.sectionPages.pages[1], (n) => { if (n instanceof ui.Label) texts.push(n.getText()); });
  assert.ok(texts.includes("Downloads the area the camera shows. Add one street layer at a time; its box unticks once it's added."), texts.join(" | "));
});

test("Add layers: a street box unticks once its layer is added; World boxes stay ticked", () => {
  const { context } = buildSandbox({ setup: installNe });
  const map = streetsSetup(context, {});
  context.checks.roads.setValue(true);
  context.checks.countries.setValue(true);
  context.addLayersBtn.onClick();
  const cats = context.GeoScene.findMapLayers(map).map((l) => l.meta.category);
  assert.ok(cats.includes("roads") && cats.includes("countries"), context.statusLabel.getText());
  assert.equal(context.checks.roads.getValue(), false, "Roads unticked");
  assert.equal(context.checks.countries.getValue(), true, "Countries stays ticked");
});

test("Add layers: a street layer that came back empty stays ticked", () => {
  const { context } = buildSandbox({ setup: installNe });
  streetsSetup(context, { empty: ["parks"] });
  context.checks.roads.setValue(true);
  context.checks.parks.setValue(true);
  context.addLayersBtn.onClick();
  assert.equal(context.checks.roads.getValue(), false);
  assert.equal(context.checks.parks.getValue(), true, "nothing was added for Parks");
  assert.match(context.statusLabel.getText(), /Nothing found for: Parks/);
});

test("Add layers: a failed or cancelled add unticks nothing", () => {
  const failed = buildSandbox({ setup: installNe });
  streetsSetup(failed.context, {});
  failed.context.GeoNet.osmLayer = () => { throw new Error("Overpass is busy"); };
  failed.context.checks.roads.setValue(true);
  failed.context.addLayersBtn.onClick();
  assert.match(failed.context.statusLabel.getText(), /Overpass is busy/);
  assert.equal(failed.context.checks.roads.getValue(), true);
  const cancelled = buildSandbox({ setup: installNe });
  streetsSetup(cancelled.context, {});
  cancelled.context.checks.roads.setValue(true);
  cancelled.ui.Modal = function () { this.showQuestion = () => false; };
  cancelled.context.GeoUtil.checkArea = () => ({ refuse: false, needsConfirm: true, areaKm2: 999 });
  cancelled.context.addLayersBtn.onClick();
  assert.match(cancelled.context.statusLabel.getText(), /^Cancelled/);
  assert.equal(cancelled.context.checks.roads.getValue(), true);
});

// ---- Callouts ----------------------------------------------------------------------
const calloutMap = controlsMap;
const coRec = (api, g) => plain(api.getUserDataKey(g, "geoCallout"));
const near = (a, b) => Math.abs(a - b) < 1e-6;
// Where a new callout's label starts: the place's screen point + (160, 100), clamped inside the comp (1920 x 1080, 40 px margin).
function labelStart(context, map, lon, lat) {
  const p = plain(context.GeoRuntime.projectPoint(lon, lat, context.GeoScene.readCamera(map.cameraId)));
  return [Math.max(-960 + 40, Math.min(960 - 240, p[0] + 160)), Math.max(-540 + 40, Math.min(540 - 40, p[1] + 100))];
}

test("callouts: createCallout makes a numbered group with every member named and parented", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris");
  assert.equal(api.getNiceName(g), "Callout 1: Paris");
  assert.equal(api.getParent(g), map.groupId);
  assert.equal(api.getUserDataKey(g, "geoCalloutNumber"), 1);
  const rec = coRec(api, g);
  assert.equal(rec.camera, map.cameraId); assert.equal(rec.lon, 2.35); assert.equal(rec.lat, 48.85); assert.equal(rec.text, "Paris");
  const names = { label: "Callout 1 label", box: "Callout 1 box", dot: "Callout 1 dot", line1: "Callout 1 line 1", line2: "Callout 1 line 2",
    size: "Callout 1 size", place: "Callout 1 place", fade: "Callout 1 fade", edge: "Callout 1 edge", bend: "Callout 1 bend" };
  Object.keys(names).forEach((k) => assert.equal(api.getNiceName(rec[k]), names[k], k));
  assert.equal(api.getNiceName(rec.draws[0]), "Callout 1 draw 1"); assert.equal(api.getNiceName(rec.draws[1]), "Callout 1 draw 2");
  assert.equal(api.getLayerType(rec.label), "textShape");
  assert.equal(api.getLayerType(rec.box), "customShape");
  assert.equal(api.getLayerType(rec.size), "boundingBox");
  assert.equal(api.getLayerType(rec.line1), "basicLine"); assert.equal(api.getLayerType(rec.line2), "basicLine");
  [rec.label, rec.dot, rec.line1, rec.line2].forEach((id) => assert.equal(api.getParent(id), g));
  assert.equal(api.getParent(rec.box), g, "the box is the label's sibling, not its child (a child would draw over the text)");
  assert.ok(directlyAbove(api, rec.label, rec.box), "the box sits directly below the label");
  ["position", "rotation.z", "scale.x", "scale.y"].forEach((attr) => assert.equal(api.getInConnection(rec.box, attr), rec.label + "." + attr, "the box follows the label's " + attr));
  const helpers = api.getParent(rec.size);
  assert.equal(api.getNiceName(helpers), "Callout 1 helpers");
  assert.equal(api.getParent(helpers), g);
  [rec.size, rec.place, rec.fade, rec.edge, rec.bend].concat(rec.draws).forEach((id) => assert.equal(api.getParent(id), helpers));
  assert.equal(api.get(g, "position.x"), 0);
});

test("callouts: the label is a text layer with a Document background, its position free and starting by the place", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, g);
  assert.equal(api.get(rec.label, "text"), "Paris");
  assert.equal(api.get(rec.label, "backgroundMode"), 4);
  assert.deepEqual(plain(api.get(rec.label, "backgroundPadding")), [12, 8]);
  assert.equal(api.get(rec.label, "cornerRadius"), 6);
  assert.equal(api.getInConnection(rec.box, "inputShape"), rec.label + ".backgroundShape");
  assert.equal(api.getInConnection(rec.label, "position"), "", "the label's position is the user's");
  const at = plain(api.get(rec.label, "position")), want = labelStart(context, map, 2.35, 48.85);
  assert.ok(near(at[0], want[0]) && near(at[1], want[1]), "label at " + at + ", wanted " + want);
});

test("callouts: a label starting past the comp's edge is clamped inside it", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const rec = coRec(api, G.createCallout(map, { lon: 170, lat: 70 }, "Far"));
  const at = plain(api.get(rec.label, "position"));
  assert.deepEqual(at, labelStart(context, map, 170, 70));
  assert.ok(at[0] === 720 || at[1] === 500, "clamped: " + at);
});

test("callouts: the size utility reads the label; the place and fade drivers follow the camera", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene, E = context.GeoExpression;
  const rec = coRec(api, G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  assert.equal(api.getInConnection(rec.size, "inputShapes.0"), rec.label + ".id");
  assert.equal(api.getInConnection(rec.size, "inputShapes.1"), rec.box + ".id", "the size covers the label and its box");
  for (let i = 0; i < 5; i++) {
    assert.equal(api.getInConnection(rec.place, "array." + i), map.cameraId + ".array." + i);
    assert.equal(api.getInConnection(rec.fade, "array." + i), map.cameraId + ".array." + i);
  }
  assert.equal(api.get(rec.place, "array.5"), 2.35); assert.equal(api.get(rec.place, "array.6"), 48.85);
  assert.equal(api.getInConnection(rec.fade, "array.5"), rec.place + ".array.5", "the fade reads lon / lat from the place driver");
  assert.equal(api.getInConnection(rec.fade, "array.6"), rec.place + ".array.6");
  assert.equal(api.get(rec.place, "expression"), E.labelDriverExpression(context.GEO_RUNTIME_SRC, { camera: map.cameraId, category: "calloutPlace" }, context.GeoAttrs.DRIVER_RETURN));
  assert.equal(api.get(rec.fade, "expression"), E.labelVisibilityExpression(context.GEO_RUNTIME_SRC, { camera: map.cameraId, category: "calloutFade" }));
  assert.equal(api.getInConnection(rec.dot, "position"), rec.place + ".id");
  [rec.dot, rec.line1, rec.line2].forEach((id) => assert.equal(api.getInConnection(id, "opacity"), rec.fade + ".id"));
  assert.equal(api.getInConnection(rec.label, "opacity"), "", "the label never fades by itself");
});

test("callouts: edge, bend and draw helpers are fed from the dot and the size utility and drive the lines", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene, E = context.GeoExpression;
  const rec = coRec(api, G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  const sources = [[rec.dot, "position.x"], [rec.dot, "position.y"], [rec.size, "position.x"], [rec.size, "position.y"], [rec.size, "size.x"], [rec.size, "size.y"]];
  [rec.edge, rec.bend, rec.draws[0], rec.draws[1]].forEach((h) => sources.forEach((s, i) => assert.equal(api.getInConnection(h, "array." + i), s[0] + "." + s[1], h + " input " + i)));
  const meta = (category) => ({ camera: map.cameraId, category: category });
  assert.equal(api.get(rec.edge, "expression"), E.calloutEdgeExpression(meta("calloutEdge")));
  assert.equal(api.get(rec.bend, "expression"), E.calloutBendExpression(meta("calloutBend")));
  assert.equal(api.get(rec.draws[0], "expression"), E.calloutDrawExpression(meta("calloutDraw")));
  assert.equal(api.get(rec.draws[1], "expression"), E.calloutDrawExpression(meta("calloutDraw")));
  const idx = (n) => "array." + E.inputIndex(E.CALLOUT_DRAW_INPUTS, n);
  assert.equal(api.get(rec.draws[0], idx("index")), 0); assert.equal(api.get(rec.draws[1], idx("index")), 1);
  [rec.draws[0], rec.draws[1]].forEach((d) => { assert.equal(api.get(d, idx("draw")), 100); assert.equal(api.get(d, idx("style")), 1); assert.equal(api.get(d, idx("elbow")), 40); });
  assert.equal(api.get(rec.bend, "array." + E.inputIndex(E.CALLOUT_GEOM_INPUTS, "style")), 1);
  assert.equal(api.getInConnection(rec.line1, "generator.startPosition"), rec.edge + ".id");
  assert.equal(api.getInConnection(rec.line1, "generator.endPosition"), rec.bend + ".id");
  assert.equal(api.getInConnection(rec.line2, "generator.startPosition"), rec.bend + ".id");
  assert.equal(api.getInConnection(rec.line2, "generator.endPosition"), rec.place + ".id");
  assert.equal(api.getInConnection(rec.line1, "stroke.trimEnd"), rec.draws[0] + ".id");
  assert.equal(api.getInConnection(rec.line2, "stroke.trimEnd"), rec.draws[1] + ".id");
  [rec.line1, rec.line2].forEach((l) => {
    assert.equal(api.get(l, "generator"), "bezierLine");
    assert.equal(api.get(l, "stroke.trim"), true);
    assert.deepEqual(plain(api.get(l, "generator.startOffset")), [0, 0]); assert.deepEqual(plain(api.get(l, "generator.endOffset")), [0, 0]);
    assert.equal(api.get(l, "stroke.capStyle"), 1);
  });
});

test("callouts: colours come from the map's style", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene, c = context.GeoStyles.builtIn("Dark").colors;
  const rec = coRec(api, G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  [rec.line1, rec.line2].forEach((l) => {
    assert.ok(api.hasStroke(l) && !api.hasFill(l));
    assert.equal(api.get(l, "stroke.strokeColor"), c.accent); assert.equal(api.get(l, "stroke.width"), 3);
  });
  assert.ok(api.hasFill(rec.dot) && !api.hasStroke(rec.dot));
  assert.equal(api.get(rec.dot, "material.materialColor"), c.accent);
  assert.deepEqual(plain(api.get(rec.dot, "generator.radius")), [6, 6]);
  assert.equal(api.get(rec.label, "material.materialColor"), c.text);
  assert.equal(api.get(rec.box, "material.materialColor"), context.GeoStyles.calloutBox(context.GeoStyles.builtIn("Dark")));
});

test("callouts: numbers go up; findCallouts lists them top first with their members; prepareCallouts renumbers a duplicate", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const a = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris");
  const b = G.createCallout(map, { lon: -0.12, lat: 51.5 }, "London");
  assert.equal(api.getNiceName(b), "Callout 2: London");
  assert.equal(G.calloutNumber(b), 2);
  let found = G.findCallouts(map);
  assert.deepEqual(found.map((c) => c.groupId), [b, a], "top first");
  assert.deepEqual(found.map((c) => c.number), [2, 1]);
  assert.deepEqual(found.map((c) => c.text), ["London", "Paris"]);
  const rec = coRec(api, b), f = found[0];
  ["label", "box", "dot", "line1", "line2", "size", "place", "fade", "edge", "bend"].forEach((k) => assert.equal(f[k], rec[k], k));
  assert.deepEqual(plain(f.draws), rec.draws);
  api.setUserData(b, "geoCalloutNumber", 1);   // a duplicated group copies the number
  G.prepareCallouts(map);
  assert.deepEqual([G.calloutNumber(a), G.calloutNumber(b)], [1, 2]);
  assert.equal(api.getNiceName(b), "Callout 2: London");
  api.deleteLayer(rec.fade);
  found = G.findCallouts(map);
  assert.equal(found.filter((c) => c.groupId === b)[0].fade, null, "a missing member is null");
});

test("callouts: findCallouts reads only the map group's children", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris");
  let scans = 0; const real = api.getCompLayers;
  api.getCompLayers = function () { scans++; return real.apply(api, arguments); };
  assert.equal(G.findCallouts(map).length, 1);
  api.getCompLayers = real;
  assert.equal(scans, 0);
});

test("callouts: calloutParts lists the group and every member; isMapPart covers the group and its members", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, g);
  const parts = plain(G.calloutParts(map));
  [g, rec.label, rec.box, rec.dot, rec.line1, rec.line2, rec.size, rec.place, rec.fade, rec.edge, rec.bend, rec.draws[0], rec.draws[1]].forEach((id) => assert.equal(parts[id], true, String(id)));
  assert.ok(G.isMapPart(map, g)); assert.ok(G.isMapPart(map, rec.label)); assert.ok(G.isMapPart(map, rec.place));
});

test("callouts: applying a map style recolours the lines, dot, text and box", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene, light = context.GeoStyles.builtIn("Light");
  const rec = coRec(api, G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  G.applyMapStyle(map, light);
  assert.equal(api.get(rec.line1, "stroke.strokeColor"), light.colors.accent);
  assert.equal(api.get(rec.line2, "stroke.strokeColor"), light.colors.accent);
  assert.equal(api.get(rec.dot, "material.materialColor"), light.colors.accent);
  assert.equal(api.get(rec.label, "material.materialColor"), light.colors.text);
  assert.equal(api.get(rec.box, "material.materialColor"), context.GeoStyles.calloutBox(light));
});

test("callouts: the previews show a callout's place as a pin", () => {
  const { context } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris");
  assert.deepEqual(plain(G.previewModel(map).pins), [{ lon: 2.35, lat: 48.85 }]);
});

test("callouts: a failure part way through leaves nothing behind and keeps the selection", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const before = api.getCompLayers(false).slice().sort(), keep = api.getCompLayers(false).slice(0, 1);
  api.select(keep);
  const real = api.connect;
  api.connect = function (a, b) { if (b === "backgroundShape") throw new Error("no background"); return real.apply(api, arguments); };
  assert.throws(() => G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), /no background/);
  api.connect = real;
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
  assert.deepEqual(plain(api.getSelection()), keep);
  assert.equal(G.findCallouts(map).length, 0);
});

// Mirrors Ctrl+D on a callout group: every layer in the group is copied (new ids, same names, types and
// attributes), the copy's internal connections point at the copies, and the user data is copied as it
// was (the record still names the original's layers). The copy lands on top of the map group's children.
function duplicateCallout(api, groupId, parentId) {
  const copies = {}, all = [];
  const copyTree = (src) => {
    const dst = api.create(api.getLayerType(src), api.getNiceName(src));
    copies[src] = dst; all.push(src);
    const attrs = ["expression", "text", "hidden"]; for (let i = 0; i < 12; i++) attrs.push("array." + i);
    attrs.forEach((a) => {
      if (!api.hasAttribute(src, a)) return;
      api.set(dst, { [a]: api.get(src, a) });
      const custom = api.getCustomAttributeName(src, a); if (custom) api.renameAttribute(dst, a, custom);
    });
    api.getChildren(src).slice().reverse().forEach((kid) => api.parent(copyTree(kid), dst));
    return dst;
  };
  const copy = copyTree(groupId);
  all.forEach((src) => {
    api.getInConnectedAttributes(src).forEach((attr) => {
      const from = api.getInConnection(src, attr), at = from.indexOf(".");
      api.connect(copies[from.slice(0, at)] || from.slice(0, at), from.slice(at + 1), copies[src], attr, true);
    });
  });
  ["geoCallout", "geoCalloutNumber"].forEach((k) => api.setUserData(copy, k, api.getUserDataKey(groupId, k)));
  api.parent(copy, parentId);
  return copy;
}

test("callouts: a duplicated callout adopts its own members, is renumbered, and a second sync changes nothing", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const a = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, a);
  const copy = duplicateCallout(api, a, map.groupId);
  const found = G.findCallouts(map), mine = found.filter((c) => c.groupId === copy)[0], orig = found.filter((c) => c.groupId === a)[0];
  assert.deepEqual(found.map((c) => c.groupId), [copy, a], "the copy sits on top");
  const own = (id) => api.getParent(id) === copy || api.getParent(api.getParent(id)) === copy;
  ["label", "box", "dot", "line1", "line2", "size", "place", "fade", "edge", "bend"].forEach((k) => {
    assert.ok(mine[k] && mine[k] !== rec[k] && own(mine[k]), k + " is the copy's own");
    assert.equal(orig[k], rec[k], k + " of the original is unaffected");
  });
  assert.equal(api.getLayerType(mine.label), "textShape"); assert.equal(api.getLayerType(mine.box), "customShape");
  assert.equal(api.getLayerType(mine.size), "boundingBox");
  assert.equal(mine.draws.length, 2);
  mine.draws.forEach((d, i) => { assert.ok(d && d !== rec.draws[i] && own(d)); assert.equal(api.get(d, "array.9"), i, "draw " + (i + 1) + " by its Index input"); });
  assert.deepEqual(plain(orig.draws), rec.draws);
  const parts = plain(G.calloutParts(map));
  [copy, mine.label, mine.box, mine.place, mine.draws[0], mine.draws[1], api.getParent(mine.place)].forEach((id) => assert.equal(parts[id], true, String(id)));
  // The record still names the original until prepareCallouts points it at the copy's own members.
  assert.deepEqual(coRec(api, copy), rec);
  G.prepareCallouts(map);
  assert.deepEqual([G.calloutNumber(a), G.calloutNumber(copy)], [1, 2]);
  assert.equal(api.getNiceName(copy), "Callout 2: Paris");
  const fixed = coRec(api, copy);
  ["label", "box", "dot", "line1", "line2", "size", "place", "fade", "edge", "bend"].forEach((k) => assert.equal(fixed[k], mine[k], k));
  assert.deepEqual(fixed.draws, plain(mine.draws));
  assert.equal(fixed.lon, rec.lon); assert.equal(fixed.text, "Paris");
  assert.deepEqual(coRec(api, a), rec, "the original's record is untouched");
  // Stable: nothing is written the second time.
  const writes = []; const real = api.setUserData;
  api.setUserData = function (id, key) { writes.push(id + ":" + key); return real.apply(api, arguments); };
  G.prepareCallouts(map);
  api.setUserData = real;
  assert.deepEqual(writes, []);
  assert.deepEqual(coRec(api, copy), fixed);
  // A draw is told apart by its Index input, not by its name.
  const names = mine.draws.map((d) => api.getNiceName(d));
  api.rename(mine.draws[0], names[1]); api.rename(mine.draws[1], names[0]);
  assert.deepEqual(plain(G.findCallouts(map)[0].draws), plain(mine.draws));
});

test("callouts: a duplicated callout gets its own Controls rows, and the original's stay as they were", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const a = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, a);
  const before = context.GeoControlPanel.sync(map), slots0 = plain(slotsOf(api, before.valuesId));
  const copy = duplicateCallout(api, a, map.groupId);
  const r = context.GeoControlPanel.sync(map), slots = plain(slotsOf(api, r.valuesId));
  assert.equal(G.calloutNumber(copy), 2);
  const names = plain(promotedNames(api, r.components.overlay));
  ["Draw %", "Line colour", "Line width", "Dot size", "Text colour", "Box colour", "Hide box"].forEach((n) => {
    assert.ok(names.includes("Callout 1 · " + n), "Callout 1 · " + n);
    assert.ok(names.includes("Callout 2 · " + n), "Callout 2 · " + n);
  });
  Object.keys(slots0).filter((k) => k.indexOf("callout:" + a + ":") === 0).forEach((k) => assert.equal(slots[k], slots0[k], k));
  const mine = coRec(api, copy);
  assert.notEqual(slots["callout:" + copy + ":draw"], slots["callout:" + a + ":draw"]);
  rec.draws.forEach((d) => assert.equal(api.getInConnection(d, "array.8"), r.valuesId + "." + slots["callout:" + a + ":draw"]));
  const list = api._promoted(r.components.overlay);
  assert.ok(list.includes(mine.label + ".fontSize") && list.includes(rec.label + ".fontSize"));
  // Moving the copy's label leaves the original's alone.
  api.set(mine.label, { position: [-300, 200] });
  assert.notDeepEqual(plain(api.get(rec.label, "position")), [-300, 200]);
  // A second sync changes nothing.
  const writes = []; const real = api.setUserData;
  api.setUserData = function (id, key) { if (key === "geoCallout") writes.push(id); return real.apply(api, arguments); };
  const again = context.GeoControlPanel.sync(map);
  api.setUserData = real;
  assert.deepEqual(writes, []);
  assert.deepEqual(plain(slotsOf(api, again.valuesId)), slots);
  assert.deepEqual(plain(api._promoted(again.components.overlay)), plain(list));
});

test("callouts in Controls: the notes follow the label's words as they are now", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, g);
  const notesOf = (r) => api.get(r.components.overlay, "promotedAttributes." + plain(promotedNames(api, r.components.overlay)).indexOf("Callout 1 · Draw %") + ".notes");
  assert.equal(notesOf(context.GeoControlPanel.sync(map)), "Paris");
  api.set(rec.label, { text: "Lutetia" });
  assert.equal(G.findCallouts(map)[0].text, "Lutetia");
  assert.equal(notesOf(context.GeoControlPanel.sync(map)), "Lutetia");
  api.deleteLayer(rec.label);
  assert.equal(G.findCallouts(map)[0].text, "Paris", "without the label, the recorded words");
});

test("callouts: a map style applied after a Controls sync lands on the Controls values, not the lines", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene, light = context.GeoStyles.builtIn("Light"), dark = context.GeoStyles.builtIn("Dark");
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, g);
  const r = context.GeoControlPanel.sync(map), slot = slotsOf(api, r.valuesId)["callout:" + g + ":color"];
  assert.ok(slot, "the Line colour row has a slot");
  [rec.line1, rec.line2].forEach((id) => assert.equal(api.getInConnection(id, "stroke.strokeColor"), r.valuesId + "." + slot));
  G.applyMapStyle(map, light);
  assert.equal(api.get(r.valuesId, slot), light.colors.accent, "the Controls value took the colour");
  [rec.line1, rec.line2].forEach((id) => assert.equal(api.get(id, "stroke.strokeColor"), dark.colors.accent, "the line itself is untouched"));
  assert.equal(api.get(rec.dot, "material.materialColor"), light.colors.accent, "an unconnected member is styled directly");
});

test("callouts: a late failure (a trim connection, or the record) removes the helpers group and every helper", () => {
  ["stroke.trimEnd", "record"].forEach((late) => {
    const { context, api } = buildSandbox();
    const map = calloutMap(context), G = context.GeoScene;
    const before = api.getCompLayers(false).slice().sort();
    const realConnect = api.connect, realSet = api.setUserData;
    api.connect = function (a, b, c, d) { if (late !== "record" && d === late) throw new Error("late " + late); return realConnect.apply(api, arguments); };
    api.setUserData = function (id, key) { if (late === "record" && key === "geoCallout") throw new Error("late record"); return realSet.apply(api, arguments); };
    assert.throws(() => G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), /late/);
    api.connect = realConnect; api.setUserData = realSet;
    assert.deepEqual(api.getCompLayers(false).slice().sort(), before, late);
    assert.equal(G.findCallouts(map).length, 0);
    assert.equal(api.getChildren(map.groupId).filter((id) => /Callout/.test(api.getNiceName(id))).length, 0);
  });
});

test("callouts: the user's selection is put back after a successful build too", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const keep = [map.cameraId];
  api.select(keep);
  G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris");
  assert.deepEqual(plain(api.getSelection()), keep);
});

// ---- Callouts in Controls ----
test("callouts in Controls: a callout's rows land in Overlay controls with its text as notes; Draw % drives both draw helpers", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, g);
  const r = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, r.components.overlay));
  const wanted = ["Draw %", "Line style (0 straight · 1 elbow)", "Line colour", "Line width", "Dot size", "Text colour", "Text size", "Box colour", "Hide box"].map((n) => "Callout 1 · " + n);
  assert.deepEqual(names.filter((n) => /^Callout 1 · /.test(n)), wanted);
  const list = api._promoted(r.components.overlay), at = names.indexOf("Callout 1 · Draw %");
  assert.equal(api.get(r.components.overlay, "promotedAttributes." + at + ".notes"), "Paris");
  const slots = slotsOf(api, r.valuesId);
  rec.draws.forEach((d) => assert.equal(api.getInConnection(d, "array.8"), r.valuesId + "." + slots["callout:" + g + ":draw"]));
  assert.equal(list[at], r.valuesId + "." + slots["callout:" + g + ":draw"]);
  [rec.bend].concat(rec.draws).forEach((id) => assert.equal(api.getInConnection(id, "array.6"), r.valuesId + "." + slots["callout:" + g + ":style"]));
  [rec.line1, rec.line2].forEach((id) => assert.equal(api.getInConnection(id, "stroke.width"), r.valuesId + "." + slots["callout:" + g + ":width"]));
  ["generator.radius.x", "generator.radius.y"].forEach((a) => assert.equal(api.getInConnection(rec.dot, a), r.valuesId + "." + slots["callout:" + g + ":dot"]));
  assert.ok(list.includes(rec.label + ".fontSize") && list.includes(rec.box + ".hidden") && list.includes(rec.box + ".material.materialColor"));
});

test("callouts in Controls: a second sync adds no slots and changes no promotions; a callout without a box has no Box rows", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const g = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"), rec = coRec(api, g);
  const first = context.GeoControlPanel.sync(map);
  const slots1 = plain(slotsOf(api, first.valuesId)), promos1 = plain(api._promoted(first.components.overlay));
  const second = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(slotsOf(api, second.valuesId)), slots1);
  assert.deepEqual(plain(api._promoted(second.components.overlay)), promos1);
  api.deleteLayer(rec.box);
  const third = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, third.components.overlay));
  assert.ok(!names.some((n) => /^Callout 1 · (Box colour|Hide box)/.test(n)));
  assert.ok(names.includes("Callout 1 · Text colour"));
});

// ---- Callouts in the panel ----
test("callouts: Callout here and Callout at coordinates are buttons on the Pins page, under the Label buttons' rows", () => {
  const { context } = buildSandbox();
  const page = context.sectionPages.pages[3];
  assert.ok(holds(page, context.calloutHereBtn) && holds(page, context.calloutCoordBtn));
  assert.equal(context.calloutHereBtn._background, "#1F8F4E");
  assert.equal(context.calloutCoordBtn._background, undefined);
  assert.equal(context.calloutHereBtn.getText(), "Callout here");
  assert.equal(context.calloutCoordBtn.getText(), "Callout at coordinates");
});

test("callouts: Callout here makes the callout for the picked place and says how to place it", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  context.calloutHereBtn.onClick();
  assert.ok(api.getChildren(context.currentMap().groupId).some((id) => api.getNiceName(id) === "Callout 1: Paris"));
  assert.equal(context.statusLabel.getText(), "Callout 1 added for Paris. Drag its label in the viewport to place it; key its Draw % in Overlay controls.");
  context.labelText.setText("The capital");
  context.calloutHereBtn.onClick();
  assert.ok(api.getChildren(context.currentMap().groupId).some((id) => api.getNiceName(id) === "Callout 2: The capital"));
  assert.equal(context.statusLabel.getText(), "Callout 2 added for The capital. Drag its label in the viewport to place it; key its Draw % in Overlay controls.");
});

test("callouts: Callout here with no search says where to search; a failed Controls update keeps the callout", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.calloutHereBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Search for a place under Label → Pins first.");
  searchFinds(context, [PARIS]);
  mapSearch(context, "Paris");
  context.GeoControlPanel.sync = () => { throw new Error("boom"); };
  context.calloutHereBtn.onClick();
  assert.equal(context.GeoScene.findCallouts(context.currentMap()).length, 1);
  assert.match(context.statusLabel.getText(), /^Callout 1 added for Paris\. Drag its label in the viewport to place it; key its Draw % in Overlay controls\. Its controls couldn't be updated: boom\./);
});

test("callouts: Callout at coordinates uses the Lat / Lon fields and the coordinate name unless text is typed", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.latField.setValue(48.8566); context.lonField.setValue(2.3522);
  context.calloutCoordBtn.onClick();
  const map = context.currentMap(), found = context.GeoScene.findCallouts(map);
  assert.equal(found.length, 1);
  const rec = plain(api.getUserDataKey(found[0].groupId, "geoCallout"));
  assert.equal(rec.lat, 48.8566); assert.equal(rec.lon, 2.3522);
  assert.equal(api.getNiceName(found[0].groupId), "Callout 1: 48.8566, 2.3522");
  assert.equal(context.statusLabel.getText(), "Callout 1 added for 48.8566, 2.3522. Drag its label in the viewport to place it; key its Draw % in Overlay controls.");
  context.labelText.setText("Home");
  context.calloutCoordBtn.onClick();
  assert.equal(api.getNiceName(context.GeoScene.findCallouts(map)[0].groupId), "Callout 2: Home");
});

test("Bake: highlight parts and callout parts together get one message of their own", () => {
  const { context, api } = buildSandbox();
  const map = findFrance(context);
  context.highlightBtn.onClick();
  const h = context.GeoScene.findHighlights(map)[0];
  const rec = coRec(api, context.GeoScene.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  api.select([h.shape]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights can't be baked.");
  api.select([h.shape, rec.label]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights and callouts can't be baked.");
  api.select([rec.label]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Callouts are already Cavalry layers, so there's nothing to bake.");
});

test("Bake: callout parts are skipped, with a message of their own", () => {
  const { context, api } = buildSandbox();
  const map = calloutMap(context), G = context.GeoScene;
  const rec = coRec(api, G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  api.select([rec.label]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Callouts are already Cavalry layers, so there's nothing to bake.");
  api.select([rec.dot, rec.line1, rec.box, rec.size, rec.place]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Callouts are already Cavalry layers, so there's nothing to bake.");
  const countries = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  api.select([countries, rec.label, rec.dot]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Baked 1 layer\(s\) at the current frame\./);
  assert.match(context.statusLabel.getText(), / Skipped 2 callout part\(s\)\./);
  assert.doesNotMatch(context.statusLabel.getText(), /group\(s\) or other/);
});

// Camera feel: remembered flights.
const flightRec = (start, end, extra) => Object.assign({ kind: "flight", start, end, from: { lat: 0, lon: 0, zoom: 2 }, to: { lat: 48.85, lon: 2.35, zoom: 12 } }, extra || {});

test("recordFlight stores a record, replaces overlapping ones, keeps others and survives JSON", () => {
  const { context, api } = buildSandbox();
  const map = flyWorld(context);
  const S = context.GeoScene;
  S.recordFlight(map, flightRec(10, 20));
  assert.deepEqual(plain(api.getUserDataKey(map.cameraId, "geoFlights")), [flightRec(10, 20)]);
  S.recordFlight(map, flightRec(15, 30, { easing: "gentle" }));
  assert.deepEqual(plain(api.getUserDataKey(map.cameraId, "geoFlights")), [flightRec(15, 30, { easing: "gentle" })]);
  S.recordFlight(map, flightRec(40, 50));
  const all = plain(api.getUserDataKey(map.cameraId, "geoFlights"));
  assert.equal(all.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(all)), all);
});

test("flightAt finds the record under the frame, the latest made when several touch it", () => {
  const { context, api } = buildSandbox();
  const map = flyWorld(context);
  const S = context.GeoScene;
  assert.equal(S.flightAt(map, 5), null);
  S.recordFlight(map, flightRec(10, 20));
  S.recordFlight(map, flightRec(30, 40));
  assert.deepEqual(plain(S.flightAt(map, 15)), flightRec(10, 20));
  assert.equal(S.flightAt(map, 25), null);
  assert.equal(S.flightAt(map, 9), null);
  assert.equal(S.flightAt(map, 40).start, 30);
  // two records touching one frame (stored directly): the later one wins
  api.setUserData(map.cameraId, "geoFlights", [flightRec(10, 20), flightRec(20, 30, { easing: "snappy" })]);
  assert.equal(S.flightAt(map, 20).easing, "snappy");
});

test("flightStart is rec.from at the first frame, else the camera one frame before, playhead restored", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyWorld(context);
  const S = context.GeoScene;
  const first = S.compFrameRange().start;
  assert.deepEqual(plain(S.flightStart(map, flightRec(first, first + 9))), { lat: 0, lon: 0, zoom: 2 });
  api.keyframe(map.cameraId, 39, { "array.0": 10, "array.1": 20, "array.2": 5 });
  api.keyframe(map.cameraId, 40, { "array.0": 50, "array.1": 60, "array.2": 9 });
  api.setFrame(7);
  const s = plain(S.flightStart(map, flightRec(40, 60)));
  assert.deepEqual(s, { lat: 10, lon: 20, zoom: 5 });
  assert.equal(api.getFrame(), 7);
});

test("rebuilding a recorded flight with new easing / arc replaces exactly its keys", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyWorld(context);
  const S = context.GeoScene, F = context.GeoFly;
  api.keyframe(map.cameraId, 10, { "array.0": 0, "array.1": 0, "array.2": 2 });
  api.keyframe(map.cameraId, 80, { "array.0": 1, "array.1": 1, "array.2": 3 });
  const rec = flightRec(30, 49);
  S.recordFlight(map, rec);
  const start = S.flightStart(map, rec);
  S.flyCamera(map, F.path(start, rec.to, 20, S.compSize().width, { easing: "gentle", arc: "high" }), 30);
  camTimes(api, map).forEach((t) => assert.deepEqual(t, [10].concat(range(30, 49), [80])));
  S.flyCamera(map, F.path(start, rec.to, 20, S.compSize().width, { easing: "snappy", arc: "low" }), rec.start);
  camTimes(api, map).forEach((t) => assert.deepEqual(t, [10].concat(range(30, 49), [80])));
});

// Camera feel: Map tab controls (Easing, Zoom-out, Update flight, Drift).
function flyParis(context) {
  createWorldMap(context);
  context.results = [{ name: "Paris, France", lat: 48.8566, lon: 2.3522, bbox: { south: 48.8, north: 48.9, west: 2.2, east: 2.5 } }];
  context.refreshResultPicker();
  context.resultPicker.setValue(1);
  context.resultPicker.onValueChanged();
  return context.currentMap();
}
function camSeries(api, map, a, b) {
  const out = [], back = api.getFrame();
  for (let f = a; f <= b; f++) { api.setFrame(f); out.push({ lat: api.get(map.cameraId, "array.0"), lon: api.get(map.cameraId, "array.1"), zoom: api.get(map.cameraId, "array.2") }); }
  api.setFrame(back);
  return out;
}
function flightsOf(api, map) { return plain(api.getUserDataKey(map.cameraId, "geoFlights")) || []; }
const nearly = (a, b) => { assert.equal(a.length, b.length); a.forEach((p, i) => ["lat", "lon", "zoom"].forEach((k) => assert.ok(Math.abs(p[k] - b[i][k]) < 1e-9, k + " at " + i))); };

test("Map tab: Easing / Zoom-out and Drift rows sit right after the Fly row with the exact choices", () => {
  const { context, ui } = buildSandbox();
  const items = context.sectionPages.pages[0]._items;
  const flyRow = items.filter((n) => n instanceof ui.HLayout && holds(n, context.flyBtn))[0];
  const i = items.indexOf(flyRow);
  assert.equal(items[i + 1], context.flyNote);
  assert.ok(holds(items[i + 2], context.easingPicker) && holds(items[i + 2], context.arcPicker) && holds(items[i + 2], context.updateFlightBtn));
  assert.ok(holds(items[i + 3], context.driftPicker) && holds(items[i + 3], context.driftBtn));
  assert.equal(context.easingLabel.getText(), "Easing");
  assert.equal(context.arcLabel.getText(), "Zoom-out");
  assert.equal(context.driftLabel.getText(), "Drift move");
  assert.deepEqual(plain(context.easingPicker._entries), ["Smooth", "Gentle", "Snappy", "Overshoot"]);
  assert.deepEqual(plain(context.arcPicker._entries), ["Low", "Normal", "High"]);
  assert.deepEqual(plain(context.driftPicker._entries), ["Push in", "Pull out", "Pan left", "Pan right", "Pan up", "Pan down"]);
  assert.equal(context.updateFlightBtn.getText(), "Update flight");
  assert.equal(context.driftBtn.getText(), "Drift");
  assert.equal(context.easingPicker.getValue(), 0);
  assert.equal(context.arcPicker.getValue(), 1);
  assert.equal(context.driftPicker.getValue(), 0);
});

test("Map tab: Easing, Zoom-out and Drift move are remembered in settings, other settings kept", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mono" }); } });
  context.easingPicker.setValue(2); context.easingPicker.onValueChanged();
  context.arcPicker.setValue(2); context.arcPicker.onValueChanged();
  context.driftPicker.setValue(4); context.driftPicker.onValueChanged();
  const s = settingsOf(api);
  assert.equal(s.flyEasing, "snappy"); assert.equal(s.flyArc, "high"); assert.equal(s.driftMove, "up"); assert.equal(s.mapStyle, "Mono");
  const again = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify(s); } }).context;
  assert.equal(again.easingPicker.getValue(), 2);
  assert.equal(again.arcPicker.getValue(), 2);
  assert.equal(again.driftPicker.getValue(), 4);
  const junk = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ flyEasing: 7, flyArc: "x" }); } }).context;
  assert.equal(junk.easingPicker.getValue(), 0);
  assert.equal(junk.arcPicker.getValue(), 1);
});

test("Fly here with Snappy and High keys the matching path and records the flight", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  context.easingPicker.setValue(2); context.arcPicker.setValue(2);
  flyRange(context, 0, 20);
  const begin = camSeries(api, map, 0, 0)[0];
  context.flyBtn.onClick();
  const rec = flightsOf(api, map)[0];
  assert.equal(rec.kind, "flight"); assert.equal(rec.name, "Paris"); assert.equal(rec.easing, "snappy"); assert.equal(rec.arc, "high");
  assert.equal(rec.start, 0); assert.equal(rec.end, 20);
  assert.deepEqual(plain(rec.from), { lat: begin.lat, lon: begin.lon, zoom: begin.zoom });
  assert.ok(Math.abs(rec.to.lat - 48.8566) < 0.2 && rec.to.zoom > 5);
  const s = context.GeoScene.compSize();
  nearly(camSeries(api, map, 0, 20), context.GeoFly.path(rec.from, rec.to, 21, s.width, { easing: "snappy", arc: "high" }));
});

test("Update flight rebuilds the flight under the playhead with the new Easing and Zoom-out", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  flyRange(context, 0, 20);
  context.flyBtn.onClick();
  const before = flightsOf(api, map)[0];
  context.easingPicker.setValue(3); context.arcPicker.setValue(0);
  api.setFrame(10);
  context.statusLabel.setText("");
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Flight to Paris (frames 0–20) updated: Overshoot, Low zoom-out.");
  const recs = flightsOf(api, map);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].easing, "overshoot"); assert.equal(recs[0].arc, "low");
  assert.deepEqual(plain(recs[0].to), plain(before.to));
  nearly(camSeries(api, map, 0, 20), context.GeoFly.path(before.from, before.to, 21, context.GeoScene.compSize().width, { easing: "overshoot", arc: "low" }));
  assert.equal(api.getFrame(), 10);
});

test("Update flight resets the imagery plan", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  flyParis(context);
  flyRange(context, 0, 20);
  context.flyBtn.onClick();
  let reset = 0;
  const orig = context.resetImageryPlan;
  context.resetImageryPlan = function () { reset++; return orig.apply(this, arguments); };
  api.setFrame(5);
  context.updateFlightBtn.onClick();
  assert.equal(reset, 1);
});

test("Update flight outside any flight, or inside a drift, says what to do", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  flyParis(context);
  api.setFrame(10);
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Put the playhead inside a flight made with Fly here first.");
  flyRange(context, 0, 20);
  context.flyBtn.onClick();
  api.setFrame(50);
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Put the playhead inside a flight made with Fly here first.");
  flyRange(context, 30, 60);
  context.driftBtn.onClick();
  api.setFrame(40);
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: That's a drift — choose a move and press Drift to redo it.");
});

test("Drift keys a gentle move from the camera at From, records it and moves the boxes on", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyWorld(context);
  api.keyframe(map.cameraId, 0, { "array.0": 40, "array.1": 10, "array.2": 6 });
  context.driftPicker.setValue(2); // Pan left
  flyRange(context, 30, 60);
  const start = camSeries(api, map, 30, 30)[0];
  context.driftBtn.onClick();
  const F = context.GeoFly, end = F.driftEnd(start, "left", 1920, 1080);
  nearly(camSeries(api, map, 30, 60), F.driftPath(start, end, 31));
  assert.equal(context.statusLabel.getText(), "Drift (pan left) from frame 30 to 60.");
  const rec = flightsOf(api, map).filter((r) => r.kind === "drift")[0];
  assert.equal(rec.move, "left"); assert.equal(rec.start, 30); assert.equal(rec.end, 60);
  assert.equal(context.flyStartField.getValue(), 60);
  assert.equal(context.flyEndField.getValue(), 90);
});

test("Drift past the composition's end asks like Fly here, and Yes extends it", () => {
  const { context, api, ui } = buildSandbox();
  flyWorld(context);
  const asked = withModal(ui, true);
  flyRange(context, 0, 14);
  context.driftBtn.onClick();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Extend the timeline");
  assert.equal(asked[0].question, "This drift ends at frame 14, after your composition's last frame (9). Drift will extend the composition, and the layers that reach its end, to frame 89 (3 seconds after the drift ends). Continue?");
  assert.equal(context.statusLabel.getText(), "Drift (push in) from frame 0 to 14. The composition was extended to frame 89 (3 seconds after the drift ends).");
  assert.equal(api.get(api.getActiveComp(), "endFrame"), 89);
});

test("Drift past the composition's end: No cancels, no dialog refuses", () => {
  const a = buildSandbox();
  const map = flyWorld(a.context);
  withModal(a.ui, false);
  flyRange(a.context, 0, 14);
  a.context.driftBtn.onClick();
  assert.match(a.context.statusLabel.getText(), /^Cancelled\./);
  camTimes(a.api, map).forEach((t) => assert.deepEqual(t, []));
  const b = buildSandbox();
  flyWorld(b.context);
  flyRange(b.context, 0, 14);
  b.context.driftBtn.onClick();
  assert.match(b.context.statusLabel.getText(), /^Error: End is after your composition's last frame/);
});

test("a Drift over an older flight removes that flight's record", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  flyRange(context, 0, 20);
  context.flyBtn.onClick();
  flyRange(context, 10, 30);
  context.driftBtn.onClick();
  const recs = flightsOf(api, map);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, "drift");
});

test("recordFlight keeps a record that only shares a boundary frame, drops a real overlap", () => {
  const { context, api } = buildSandbox();
  const map = flyWorld(context);
  const S = context.GeoScene;
  S.recordFlight(map, flightRec(0, 20));
  S.recordFlight(map, flightRec(20, 40));
  assert.deepEqual(plain(api.getUserDataKey(map.cameraId, "geoFlights")).map((r) => [r.start, r.end]), [[0, 20], [20, 40]]);
  S.recordFlight(map, flightRec(30, 50));
  assert.deepEqual(plain(api.getUserDataKey(map.cameraId, "geoFlights")).map((r) => [r.start, r.end]), [[0, 20], [30, 50]]);
});

test("Update flight on the first of two chained flights rebuilds it and leaves the second alone", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  flyRange(context, 0, 20);
  context.flyBtn.onClick();
  context.results = [{ name: "Rome, Italy", lat: 41.9, lon: 12.5, bbox: { south: 41.8, north: 42, west: 12.4, east: 12.6 } }];
  context.refreshResultPicker();
  context.resultPicker.setValue(1);
  context.resultPicker.onValueChanged();
  context.flyBtn.onClick(); // 20-40, from the old To
  const recs = flightsOf(api, map);
  assert.equal(recs.length, 2);
  const first = recs[0], secondKeys = camSeries(api, map, 21, 40);
  context.easingPicker.setValue(2); context.arcPicker.setValue(2);
  api.setFrame(10);
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Flight to Paris (frames 0–20) updated: Snappy, High zoom-out.");
  nearly(camSeries(api, map, 0, 20), context.GeoFly.path(first.from, first.to, 21, context.GeoScene.compSize().width, { easing: "snappy", arc: "high" }));
  nearly(camSeries(api, map, 21, 40), secondKeys);
  assert.equal(flightsOf(api, map).length, 2);
  // the second flight now starts from the first one's destination
  api.setFrame(30);
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Flight to Rome (frames 20–40) updated: Snappy, High zoom-out.");
  nearly(camSeries(api, map, 21, 40), context.GeoFly.path(first.to, recs[1].to, 21, context.GeoScene.compSize().width, { easing: "snappy", arc: "high" }).slice(1));
});

test("Update flight on a flight after frame 0 that is not chained starts from the camera one frame before", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  api.keyframe(map.cameraId, 0, { "array.0": 10, "array.1": 20, "array.2": 4 });
  flyRange(context, 30, 50);
  context.flyBtn.onClick();
  const rec = flightsOf(api, map)[0];
  const before = camSeries(api, map, 29, 29)[0];
  context.easingPicker.setValue(1);
  api.setFrame(40);
  context.updateFlightBtn.onClick();
  nearly(camSeries(api, map, 30, 50), context.GeoFly.path(before, rec.to, 21, context.GeoScene.compSize().width, { easing: "gentle", arc: "normal" }));
});

test("Update flight with the playhead past the comp end still finds a flight that ends at the comp end", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  flyRange(context, 480, 500);
  context.flyBtn.onClick();
  api.setFrame(700);
  context.updateFlightBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Flight to Paris (frames 480–500) updated: Smooth, Normal zoom-out.");
});

test("Update flight keeps the record's place so the later chained flight still wins at the shared frame", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  const map = flyParis(context);
  flyRange(context, 0, 20);
  context.flyBtn.onClick();
  context.results = [{ name: "Rome, Italy", lat: 41.9, lon: 12.5, bbox: { south: 41.8, north: 42, west: 12.4, east: 12.6 } }];
  context.refreshResultPicker();
  context.resultPicker.setValue(1);
  context.resultPicker.onValueChanged();
  context.flyBtn.onClick(); // 20-40
  api.setFrame(10);
  context.updateFlightBtn.onClick();
  const recs = flightsOf(api, map);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].start, 0);
  assert.equal(recs[1].start, 20);
  const at = context.GeoScene.flightAt(map, 20);
  assert.equal(at.start, 20);
  assert.equal(at.name, "Rome");
});

test("Update flight on a comp starting at frame 10 starts from the recorded view and reads no frame before it", () => {
  const { context, api } = buildSandbox();
  longComp(api);
  api.set(api.getActiveComp(), { startFrame: 10, playbackStart: 10 });
  const map = flyParis(context);
  flyRange(context, 10, 30);
  context.flyBtn.onClick();
  const rec = flightsOf(api, map)[0];
  const seen = [], orig = api.setFrame;
  api.setFrame = (f) => { seen.push(f); return orig(f); };
  api.setFrame(20);
  seen.length = 0;
  context.updateFlightBtn.onClick();
  assert.ok(seen.indexOf(9) < 0, "read frame 9");
  nearly(camSeries(api, map, 10, 30), context.GeoFly.path(rec.from, rec.to, 21, context.GeoScene.compSize().width, { easing: "smooth", arc: "normal" }));
});

// ---- Day & night: the overlay, its opacity helpers and the time label ----
const dnMap = controlsMap;
const dnRec = (api, g) => plain(api.getUserDataKey(g, "geoDayNight"));
const dnVal = (context, api, id, inputs, name) => api.get(id, "generator.array." + context.GeoExpression.inputIndex(inputs, name));
const dnHelperVal = (context, api, id, name) => api.get(id, "array." + context.GeoExpression.inputIndex(context.GeoExpression.NIGHT_OPACITY_INPUTS, name));

test("day & night: add makes the group, four night layers, helpers, a record and no label by default", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression, dark = context.GeoStyles.builtIn("Dark");
  const r = G.addDayNight(map, { dayOfYear: 172, utcTime: 14.5 });
  assert.equal(r.created, true);
  assert.equal(api.getNiceName(r.groupId), "Day & night");
  assert.equal(api.getParent(r.groupId), map.groupId);
  const rec = dnRec(api, r.groupId);
  assert.equal(rec.camera, map.cameraId); assert.equal(rec.label, null);
  assert.equal(rec.layers.length, 4); assert.equal(rec.helpers.length, 4);
  [0, 6, 12, 18].forEach((a, i) => {
    const id = rec.layers[i], h = rec.helpers[i];
    assert.equal(api.getNiceName(id), "Night " + a + "°");
    assert.equal(api.getLayerType(id), "javaScriptShape");
    assert.equal(api.getParent(id), r.groupId);
    assert.deepEqual(plain(E.readTag(api.get(id, "generator.expression"), "GEO_META")), { camera: map.cameraId, category: "dayNight", depression: a });
    E.NIGHT_INPUTS.forEach((inp, k) => assert.equal(api.getCustomAttributeName(id, "generator.array." + k), inp[0]));
    for (let k = 0; k < 5; k++) assert.equal(api.getInConnection(id, "generator.array." + k), map.cameraId + ".array." + k);
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "dayOfYear"), 172);
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "utcTime"), 14.5);
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "depression"), a);
    assert.ok(api.hasFill(id) && !api.hasStroke(id));
    assert.equal(api.get(id, "material.materialColor"), context.GeoStyles.nightColour(dark));
    assert.equal(api.getNiceName(h), "Night opacity " + a + "°");
    assert.equal(api.getLayerType(h), "javaScript");
    assert.equal(api.getNiceName(api.getParent(h)), "Day & night helpers");
    assert.equal(api.getParent(api.getParent(h)), r.groupId);
    assert.deepEqual(plain(E.readTag(api.get(h, "expression"), "GEO_META")), { camera: map.cameraId, category: "dayNightOpacity", step: i });
    E.NIGHT_OPACITY_INPUTS.forEach((inp, k) => assert.equal(api.getCustomAttributeName(h, "array." + k), inp[0]));
    assert.equal(dnHelperVal(context, api, h, "night"), 55);
    assert.equal(dnHelperVal(context, api, h, "twilight"), 1);
    assert.equal(dnHelperVal(context, api, h, "step"), i);
    assert.equal(api.getInConnection(id, "opacity"), h + ".id");
  });
  assert.equal(api.getChildren(map.groupId).filter((id) => api.getNiceName(id) === "Time label").length, 0);
});

test("day & night: the label option adds a Time label with its inputs, the style's text colour and the same time", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression, dark = context.GeoStyles.builtIn("Dark");
  const r = G.addDayNight(map, { dayOfYear: 172, utcTime: 14.5, label: true });
  const rec = dnRec(api, r.groupId), id = rec.label;
  assert.equal(api.getNiceName(id), "Time label");
  assert.equal(api.getLayerType(id), "javaScriptShape");
  assert.equal(api.getParent(id), map.groupId);
  assert.deepEqual(plain(E.readTag(api.get(id, "generator.expression"), "GEO_META")), { camera: map.cameraId, category: "timeLabel" });
  E.TIME_LABEL_INPUTS.forEach((inp, k) => assert.equal(api.getCustomAttributeName(id, "generator.array." + k), inp[0]));
  for (let k = 0; k < 5; k++) assert.equal(api.getInConnection(id, "generator.array." + k), map.cameraId + ".array." + k);
  const v = (n) => dnVal(context, api, id, E.TIME_LABEL_INPUTS, n);
  assert.equal(v("dayOfYear"), 172); assert.equal(v("utcTime"), 14.5);
  assert.equal(v("compW"), 1920); assert.equal(v("compH"), 1080); assert.equal(v("corner"), 0); assert.equal(v("margin"), 40); assert.equal(v("size"), 18);
  assert.ok(api.hasFill(id) && !api.hasStroke(id));
  assert.equal(api.get(id, "material.materialColor"), dark.colors.text);
});

test("day & night: the group sits above the base layers, Ocean and imagery, below an earlier pin and callout", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const countries = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  const roads = G.createMapLayer(map, "Roads", { v: 1, kind: "line", f: [] }, { camera: map.cameraId, category: "roads" }, {}, {});
  G.restackBaseLayers(map, context.DRAW_ORDER);
  const pin = G.addPin(map, "Pin", 0, 0);
  const callout = G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris");
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId;
  const kids = api.getChildren(map.groupId), pos = (id) => kids.indexOf(id);
  assert.ok(pos(pin) < pos(g) && pos(callout) < pos(g), "below the pin and the callout");
  assert.ok(pos(g) < pos(roads) && pos(roads) < pos(countries) && pos(countries) < pos(oceanOf(api, map)), "above every base layer and the Ocean");
  // a later restack of the base layers keeps it above them
  G.restackBaseLayers(map, context.DRAW_ORDER);
  const again = api.getChildren(map.groupId);
  assert.ok(again.indexOf(pin) < again.indexOf(g) && again.indexOf(g) < again.indexOf(roads));
});

test("day & night: with no base layer the group still sits above the Ocean and below a pin", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const pin = G.addPin(map, "Pin", 0, 0);
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId;
  const kids = api.getChildren(map.groupId);
  assert.ok(kids.indexOf(pin) < kids.indexOf(g) && kids.indexOf(g) < kids.indexOf(oceanOf(api, map)));
});

test("day & night: a second add updates the time on every layer, makes nothing new and reports created false", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression;
  const first = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 });
  const before = api.getCompLayers(false).slice().sort();
  const second = G.addDayNight(map, { dayOfYear: 355, utcTime: 3.25 });
  assert.equal(second.created, false); assert.equal(second.groupId, first.groupId);
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
  dnRec(api, first.groupId).layers.forEach((id) => {
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "dayOfYear"), 355);
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "utcTime"), 3.25);
  });
});

test("day & night: a second add with the label option adds a missing label, then updates it", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression;
  const first = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 });
  assert.equal(dnRec(api, first.groupId).label, null);
  const second = G.addDayNight(map, { dayOfYear: 100, utcTime: 6, label: true });
  assert.equal(second.created, false);
  const label = dnRec(api, first.groupId).label;
  assert.ok(label && api.getNiceName(label) === "Time label");
  assert.equal(dnVal(context, api, label, E.TIME_LABEL_INPUTS, "dayOfYear"), 100);
  const third = G.addDayNight(map, { dayOfYear: 200, utcTime: 18, label: true });
  assert.equal(dnRec(api, first.groupId).label, label, "no second label");
  assert.equal(dnVal(context, api, label, E.TIME_LABEL_INPUTS, "dayOfYear"), 200);
  assert.equal(dnVal(context, api, label, E.TIME_LABEL_INPUTS, "utcTime"), 18);
  assert.equal(third.created, false);
  // without the option an existing label still follows the time
  G.addDayNight(map, { dayOfYear: 10, utcTime: 1 });
  assert.equal(dnVal(context, api, label, E.TIME_LABEL_INPUTS, "dayOfYear"), 10);
});

test("day & night: findDayNight lists the group, its layers, helpers and label; dayNightParts names every part", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  assert.equal(G.findDayNight(map), null);
  const r = G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), rec = dnRec(api, r.groupId);
  const f = G.findDayNight(map);
  assert.equal(f.groupId, r.groupId);
  assert.deepEqual(plain(f.layers), rec.layers); assert.deepEqual(plain(f.helpers), rec.helpers); assert.equal(f.label, rec.label);
  const parts = plain(G.dayNightParts(map));
  [r.groupId, rec.label, api.getParent(rec.helpers[0])].concat(rec.layers, rec.helpers).forEach((id) => assert.equal(parts[id], true, id));
  assert.equal(Object.keys(parts).length, 1 + 1 + 1 + 4 + 4 + 4 + 1, "group, label, helpers group, layers, helpers, blurs, blur helper");
  assert.deepEqual(plain(G.dayNightParts({ groupId: "none", cameraId: "none" })), {});
});

test("day & night: findDayNight needs the record, this map's camera and members that belong to the group", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const r = G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), rec = dnRec(api, r.groupId);
  // a layer moved out of the group, and a label that is gone, are no longer the overlay's
  api.parent(rec.layers[1], map.groupId);
  api.deleteLayer(rec.label);
  const f = G.findDayNight(map);
  assert.equal(f.layers[1], null); assert.equal(f.layers[0], rec.layers[0]);
  assert.equal(f.label, null);
  assert.equal(G.dayNightParts(map)[rec.layers[1]], undefined);
  // another map's record is not ours
  api.setUserData(r.groupId, "geoDayNight", Object.assign({}, rec, { camera: "elsewhere" }));
  assert.equal(G.findDayNight(map), null);
});

test("day & night: applying a map style recolours the four fills and the label", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, S = context.GeoStyles, light = S.builtIn("Light");
  const rec = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }).groupId);
  G.applyMapStyle(map, light);
  rec.layers.forEach((id) => assert.equal(api.get(id, "material.materialColor"), S.nightColour(light)));
  assert.equal(api.get(rec.label, "material.materialColor"), light.colors.text);
});

test("day & night: nightColour mixes the ocean 60 % toward black", () => {
  const { context } = buildSandbox();
  assert.equal(context.GeoStyles.nightColour(context.GeoStyles.builtIn("Dark")), "#0c1114");
});

test("day & night: a failure part way through leaves nothing behind and keeps the selection", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const before = api.getCompLayers(false).slice().sort(), keep = api.getCompLayers(false).slice(0, 1);
  api.select(keep);
  const real = api.connect;
  api.connect = function (a, b, c, d) { if (/Night opacity 12/.test(api.getNiceName(a))) throw new Error("no opacity"); return real.apply(api, arguments); };
  assert.throws(() => G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), /no opacity/);
  api.connect = real;
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
  assert.deepEqual(plain(api.getSelection()), keep);
  assert.equal(G.findDayNight(map), null);
});

test("day & night: a late failure (the label, or the record) removes everything it made", () => {
  ["label", "record"].forEach((late) => {
    const { context, api } = buildSandbox();
    const map = dnMap(context), G = context.GeoScene;
    const before = api.getCompLayers(false).slice().sort(), realSet = api.setUserData, realCreate = api.create;
    api.setUserData = function (id, key) { if (late === "record" && key === "geoDayNight") throw new Error("late record"); return realSet.apply(api, arguments); };
    api.create = function (type, name) { if (late === "label" && name === "Time label") throw new Error("late label"); return realCreate.apply(api, arguments); };
    assert.throws(() => G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), /late/);
    api.setUserData = realSet; api.create = realCreate;
    assert.deepEqual(api.getCompLayers(false).slice().sort(), before, late);
    assert.equal(G.findDayNight(map), null);
  });
});

test("day & night: a failure adding the label to an existing overlay leaves the overlay as it was", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId;
  const before = api.getCompLayers(false).slice().sort(), realCreate = api.create;
  api.create = function (type, name) { if (name === "Time label") throw new Error("late label"); return realCreate.apply(api, arguments); };
  assert.throws(() => G.addDayNight(map, { dayOfYear: 90, utcTime: 12, label: true }), /late label/);
  api.create = realCreate;
  assert.deepEqual(api.getCompLayers(false).slice().sort(), before);
  assert.equal(dnRec(api, g).label, null);
});

test("day & night: the user's selection is put back after a successful add and update", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, keep = [map.cameraId];
  api.select(keep);
  G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true });
  assert.deepEqual(plain(api.getSelection()), keep);
  G.addDayNight(map, { dayOfYear: 81, utcTime: 12, label: true });
  assert.deepEqual(plain(api.getSelection()), keep);
});

test("day & night: the overlay's group and layers are map parts", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const r = G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), rec = dnRec(api, r.groupId);
  assert.ok(G.isMapPart(map, r.groupId));
  assert.ok(G.isMapPart(map, rec.layers[0]));
});

// ---- Day & night in Controls ----
const TIME_ROWS = ["Day & night · Day of year (1–365)", "Day & night · UTC time (0–24)", "Day & night · Night colour", "Day & night · Night opacity", "Day & night · Twilight (0 hard · 1 soft)",
  "Day & night · Hide", "Time label · Hide", "Time label · Colour", "Time label · Size", "Time label · Corner (0 top-left · 1 top-right · 2 bottom-left · 3 bottom-right)"];

test("day & night in Controls: a Time controls component after Extract controls, with exactly the time rows, driving the four layers and the label", () => {
  const { context, api } = buildSandbox();
  const map = fullControlsMap(context), E = context.GeoExpression;
  const r0 = context.GeoControlPanel.sync(map);
  assert.equal(r0.components.time, null);
  const dn = context.GeoScene.addDayNight(map, { dayOfYear: 172, utcTime: 14.5, label: true }), rec = dnRec(api, dn.groupId);
  const r = context.GeoControlPanel.sync(map);
  assert.ok(r.components.time, "made");
  assert.equal(api.getNiceName(r.components.time), "Map Time controls");
  assert.equal(api.getUserDataKey(r.components.time, "geoControlsGroup"), "time");
  const sib = api.getChildren(api.getParent(map.groupId) || api.getActiveComp());
  assert.equal(sib.indexOf(r.components.time), sib.indexOf(r.components.extract) + 1);
  assert.equal(sib.indexOf(r.components.time), sib.indexOf(map.groupId) - 1);
  assert.deepEqual(plain(promotedNames(api, r.components.time)), TIME_ROWS);
  const slots = slotsOf(api, r.valuesId), V = r.valuesId;
  const dayIn = V + "." + slots["dn:day"], timeIn = V + "." + slots["dn:time"];
  rec.layers.forEach((id) => {
    assert.equal(api.getInConnection(id, "generator.array." + E.inputIndex(E.NIGHT_INPUTS, "dayOfYear")), dayIn);
    assert.equal(api.getInConnection(id, "generator.array." + E.inputIndex(E.NIGHT_INPUTS, "utcTime")), timeIn);
  });
  assert.equal(api.getInConnection(rec.label, "generator.array." + E.inputIndex(E.TIME_LABEL_INPUTS, "dayOfYear")), dayIn);
  assert.equal(api.getInConnection(rec.label, "generator.array." + E.inputIndex(E.TIME_LABEL_INPUTS, "utcTime")), timeIn);
  rec.helpers.forEach((id) => assert.equal(api.getInConnection(id, "array." + E.inputIndex(E.NIGHT_OPACITY_INPUTS, "night")), V + "." + slots["dn:night"]));
  assert.equal(api.get(V, slots["dn:day"]), 172);
  // the script inputs keep their own names
  rec.layers.forEach((id) => E.NIGHT_INPUTS.forEach((inp, k) => assert.equal(api.getCustomAttributeName(id, "generator.array." + k), inp[0])));
  // a second sync changes nothing
  const promos = plain(api._promoted(r.components.time)), slots1 = plain(slots);
  const again = context.GeoControlPanel.sync(map);
  assert.equal(again.components.time, r.components.time);
  assert.deepEqual(plain(api._promoted(again.components.time)), promos);
  assert.deepEqual(slotsOf(api, again.valuesId), slots1);
  // deleting the overlay removes the Time controls component
  api.deleteLayer(dn.groupId);
  const gone = context.GeoControlPanel.sync(map);
  assert.equal(gone.components.time, null);
  assert.ok(!api.getChildren(api.getParent(map.groupId) || api.getActiveComp()).includes(r.components.time));
});

test("day & night in Controls: with no Extract controls it stacks after Overlay controls, and without a label has only the day & night rows", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  context.GeoScene.addPin && context.GeoScene.addPin(map, "Here", 1, 1);
  context.GeoScene.addDayNight(map, { dayOfYear: 80, utcTime: 12 });
  const r = context.GeoControlPanel.sync(map);
  assert.equal(r.components.extract, null);
  assert.ok(r.components.overlay && r.components.time);
  const sib = api.getChildren(api.getParent(map.groupId) || api.getActiveComp());
  assert.equal(sib.indexOf(r.components.time), sib.indexOf(r.components.overlay) + 1);
  assert.deepEqual(plain(promotedNames(api, r.components.time)), TIME_ROWS.slice(0, 6));
});

// ---- Day & night in the panel ----
// A panel built at a fixed moment: 7 Oct 2026, 14:37 UTC.
function dayNightSandbox() {
  const fixed = Date.UTC(2026, 9, 7, 14, 37);
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [fixed])); } }
  return buildSandbox({ globals: { Date: FixedDate } });
}

test("day & night: the Label page has a Day & night section with its widgets, defaulting to now (UTC)", () => {
  const { context } = dayNightSandbox();
  const page = context.sectionPages.pages[3];
  [context.dayNightDayField, context.dayNightMonthPicker, context.dayNightTimeField, context.timeLabelCheck, context.addDayNightBtn].forEach((w) => assert.ok(holds(page, w)));
  let heading = false;
  walkUi(page, (n) => { if (n.getText && n.getText() === "Day & night") heading = true; });
  assert.ok(heading, "a Day & night heading");
  assert.equal(context.dayNightDayField.getValue(), 7);
  assert.equal(context.dayNightMonthPicker.getValue(), 9);
  assert.equal(context.dayNightTimeField.getValue(), 14.5);
  assert.equal(context.timeLabelCheck.getValue(), true);
  assert.equal(context.addDayNightBtn._background, "#1F8F4E");
  assert.equal(context.addDayNightBtn.getText(), "Add day & night");
});

test("day & night: Add makes the overlay for the typed date and time, then a second press updates it", () => {
  const { context, api } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap(), calls = [], real = context.GeoScene.addDayNight;
  context.GeoScene.addDayNight = (m, o) => { calls.push(plain(o)); return real(m, o); };
  context.dayNightDayField.setValue(21); context.dayNightMonthPicker.setValue(5); context.dayNightTimeField.setValue(14.5);
  context.addDayNightBtn.onClick();
  assert.deepEqual(calls[0], { dayOfYear: 172, utcTime: 14.5, label: true });
  assert.equal(context.statusLabel.getText().indexOf("Day & night added to " + map.name + " for 21 Jun 14:30 UTC. Key its Day of year and UTC time in " + map.name + " Time controls."), 0);
  assert.ok(api.getChildren(map.groupId).some((id) => api.getNiceName(id) === "Day & night"));
  context.dayNightDayField.setValue(1); context.dayNightMonthPicker.setValue(0); context.dayNightTimeField.setValue(24); context.timeLabelCheck.setValue(false);
  context.addDayNightBtn.onClick();
  assert.deepEqual(calls[1], { dayOfYear: 1, utcTime: 24, label: false });
  assert.equal(context.statusLabel.getText().indexOf("Day & night updated to 1 Jan 00:00 UTC."), 0);
});

test("Bake: only day & night parts gets a message of its own; mixed adds a skipped count", () => {
  const { context, api } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap(), G = context.GeoScene;
  const r = G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), f = G.findDayNight(map);
  api.select([f.layers[0], f.label]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Day & night redraws from its time, so it can't be baked.");
  api.select([r.groupId]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Day & night redraws from its time, so it can't be baked.");
  const countries = G.createMapLayer(map, "Countries", { v: 1, kind: "polygon", f: [] }, { camera: map.cameraId, category: "countries" }, {}, {});
  api.select([countries, f.layers[0], f.layers[1]]);
  context.bakeBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Baked 1 layer\(s\)/);
  assert.match(context.statusLabel.getText(), / Skipped 2 day & night part\(s\)\./);
});

test("Extract's source list leaves out the night layers and the time label", () => {
  const { context } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  context.GeoScene.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true });
  context.refreshSourceLayers();
  assert.ok(context.sourceLayers.every((l) => l.meta.category !== "dayNight" && l.meta.category !== "timeLabel"));
  assert.ok(context.GeoScene.findMapLayers(map).some((l) => l.meta.category === "dayNight"), "they are map layers");
});

// ---- Day & night: final fixes ----
const resizeComp = (api, w, h) => {
  const realGet = api.get;
  api.get = function (id, attr) { if (id === api.getActiveComp() && attr === "resolution") return { x: w, y: h }; return realGet.apply(this, arguments); };
};

test("day & night: the time label's comp size follows a resized composition (fitFurniture and a Controls sync)", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression;
  const label = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }).groupId).label;
  const v = (n) => dnVal(context, api, label, E.TIME_LABEL_INPUTS, n);
  resizeComp(api, 1080, 1350);
  G.fitFurniture(map);
  assert.equal(v("compW"), 1080); assert.equal(v("compH"), 1350);
  resizeComp(api, 3840, 2160);
  context.GeoControlPanel.sync(map);
  assert.equal(v("compW"), 3840); assert.equal(v("compH"), 2160);
});

// A duplicated Day & night group: the copy carries the original's record, but has its own layers.
function duplicateDayNight(api, G, map) {
  const a = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, recA = dnRec(api, a);
  api.setUserData(a, "geoDayNight", Object.assign({}, recA, { camera: "hidden" }));
  const b = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, recB = dnRec(api, b);
  api.setUserData(a, "geoDayNight", recA);
  api.setUserData(b, "geoDayNight", recA);
  api.select([b]); api.bringToFront(); // like Ctrl+D: the copy lands on top
  return { a, b, recA, recB };
}

test("day & night (duplicate): the original wins over its copy; with the original gone the copy adopts its own layers", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const { a, b, recA, recB } = duplicateDayNight(api, G, map);
  const kids = api.getChildren(map.groupId);
  assert.ok(kids.indexOf(b) < kids.indexOf(a), "the copy sits on top");
  const f = G.findDayNight(map);
  assert.equal(f.groupId, a);
  assert.deepEqual(plain(f.layers), recA.layers); assert.deepEqual(plain(f.helpers), recA.helpers);
  api.deleteLayer(a);
  const g = G.findDayNight(map);
  assert.equal(g.groupId, b);
  assert.deepEqual(plain(g.layers), recB.layers); assert.deepEqual(plain(g.helpers), recB.helpers);
  assert.deepEqual(dnRec(api, b).layers, recB.layers, "the copy's record now names its own layers");
  assert.deepEqual(dnRec(api, b).helpers, recB.helpers);
});

test("day & night (duplicate): an empty copy with the original's record is never picked over the original", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const a = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId;
  const copy = api.create("group", "Day & night");
  api.parent(copy, map.groupId);
  api.setUserData(copy, "geoDayNight", dnRec(api, a));
  assert.ok(api.getChildren(map.groupId).indexOf(copy) < api.getChildren(map.groupId).indexOf(a), "the copy is on top");
  assert.equal(G.findDayNight(map).groupId, a);
});

test("day & night: Add with every night layer deleted makes them again (and a lost helper), wired and recorded", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression;
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, rec = dnRec(api, g);
  rec.layers.forEach((id) => api.deleteLayer(id));
  api.deleteLayer(rec.helpers[2]);
  const r = G.addDayNight(map, { dayOfYear: 100, utcTime: 6 });
  assert.equal(r.created, false); assert.equal(r.groupId, g);
  assert.equal(r.restored, 5);
  const f = G.findDayNight(map), now = dnRec(api, g);
  assert.ok(f.layers.every(Boolean) && f.helpers.every(Boolean));
  assert.deepEqual(now.layers, plain(f.layers)); assert.deepEqual(now.helpers, plain(f.helpers));
  [0, 6, 12, 18].forEach((a, i) => {
    const id = f.layers[i];
    assert.equal(api.getNiceName(id), "Night " + a + "°");
    assert.equal(api.getParent(id), g);
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "dayOfYear"), 100);
    assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "depression"), a);
    assert.equal(api.getInConnection(id, "opacity"), f.helpers[i] + ".id");
  });
  assert.equal(f.helpers[0], rec.helpers[0], "a helper that was still there is kept");
  assert.equal(api.getParent(f.helpers[2]), api.getParent(rec.helpers[0]), "in the same helpers group");
});

test("day & night: the panel says when it remade missing night layers", () => {
  const { context, api } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap();
  const rec = dnRec(api, context.GeoScene.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId);
  rec.layers.forEach((id) => api.deleteLayer(id));
  context.addDayNightBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Day & night updated to 7 Oct 14:30 UTC\. Its missing night layers were made again\./);
});

test("day & night: a Time label left behind by a deleted overlay is used again, or removed without the label option", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression;
  const labels = () => api.getChildren(map.groupId).filter((id) => api.getNiceName(id) === "Time label");
  const first = G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }), label = dnRec(api, first.groupId).label;
  api.deleteLayer(first.groupId);
  assert.deepEqual(plain(labels()), [label], "the label is left behind");
  const second = G.addDayNight(map, { dayOfYear: 200, utcTime: 9, label: true });
  assert.equal(second.created, true);
  assert.deepEqual(plain(labels()), [label], "used again, not doubled");
  assert.equal(dnRec(api, second.groupId).label, label);
  assert.equal(dnVal(context, api, label, E.TIME_LABEL_INPUTS, "dayOfYear"), 200);
  // an overlay whose record lost its label picks the stray one up too
  const rec = dnRec(api, second.groupId);
  api.setUserData(second.groupId, "geoDayNight", Object.assign({}, rec, { label: null }));
  G.addDayNight(map, { dayOfYear: 201, utcTime: 9, label: true });
  assert.deepEqual(plain(labels()), [label]);
  assert.equal(dnRec(api, second.groupId).label, label);
  // without the option, a fresh overlay removes the stray label
  api.deleteLayer(second.groupId);
  G.addDayNight(map, { dayOfYear: 10, utcTime: 1 });
  assert.deepEqual(plain(labels()), []);
});

test("day & night: Add again leaves omitted values alone and skips an animated (keyed) input, saying so", () => {
  const { context, api } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap(), G = context.GeoScene, E = context.GeoExpression;
  const rec = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }).groupId);
  G.addDayNight(map, {});
  rec.layers.forEach((id) => { assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "dayOfYear"), 80); assert.equal(dnVal(context, api, id, E.NIGHT_INPUTS, "utcTime"), 12); });
  assert.equal(dnVal(context, api, rec.label, E.TIME_LABEL_INPUTS, "utcTime"), 12);
  const at = "generator.array." + E.inputIndex(E.NIGHT_INPUTS, "utcTime");
  api.keyframe(rec.layers[0], 0, { [at]: 3 });
  api.keyframe(rec.layers[0], 10, { [at]: 9 });
  const r = G.addDayNight(map, { dayOfYear: 90, utcTime: 15 });
  assert.deepEqual(plain(r.kept), ["UTC time"]);
  assert.deepEqual(plain(api.getKeyframeTimes(rec.layers[0], at)), [0, 10], "the keys stay");
  assert.equal(dnVal(context, api, rec.layers[0], E.NIGHT_INPUTS, "dayOfYear"), 90);
  assert.equal(dnVal(context, api, rec.layers[1], E.NIGHT_INPUTS, "utcTime"), 15);
  context.dayNightDayField.setValue(1); context.dayNightMonthPicker.setValue(0); context.dayNightTimeField.setValue(6);
  context.addDayNightBtn.onClick();
  assert.match(context.statusLabel.getText(), /^Day & night updated to 1 Jan 06:00 UTC\. It kept your animated UTC time\./);
});

test("day & night: Add again with the time on Controls values sets those values and keeps the layers connected; a keyed value is kept", () => {
  const { context, api } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap(), G = context.GeoScene, E = context.GeoExpression;
  const rec = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }).groupId);
  const s = context.GeoControlPanel.sync(map), V = s.valuesId, slots = slotsOf(api, V);
  const dayIn = V + "." + slots["dn:day"], timeIn = V + "." + slots["dn:time"];
  const r = G.addDayNight(map, { dayOfYear: 172, utcTime: 18 });
  assert.deepEqual(plain(r.kept), []);
  assert.equal(api.get(V, slots["dn:day"]), 172); assert.equal(api.get(V, slots["dn:time"]), 18);
  rec.layers.forEach((id) => {
    assert.equal(api.getInConnection(id, "generator.array." + E.inputIndex(E.NIGHT_INPUTS, "dayOfYear")), dayIn);
    assert.equal(api.getInConnection(id, "generator.array." + E.inputIndex(E.NIGHT_INPUTS, "utcTime")), timeIn);
  });
  assert.equal(api.getInConnection(rec.label, "generator.array." + E.inputIndex(E.TIME_LABEL_INPUTS, "dayOfYear")), dayIn);
  api.keyframe(V, 0, { [slots["dn:day"]]: 1 });
  api.keyframe(V, 20, { [slots["dn:day"]]: 365 });
  const r2 = G.addDayNight(map, { dayOfYear: 200, utcTime: 6 });
  assert.deepEqual(plain(r2.kept), ["Day of year"]);
  assert.deepEqual(plain(api.getKeyframeTimes(V, slots["dn:day"])), [0, 20]);
  assert.equal(api.get(V, slots["dn:time"]), 6);
  // a time wired to something else is left alone as well
  const other = api.create("javaScript", "Clock");
  api.connect(other, "id", rec.layers[2], "generator.array." + E.inputIndex(E.NIGHT_INPUTS, "utcTime"), true);
  assert.deepEqual(plain(G.addDayNight(map, { dayOfYear: 200, utcTime: 7 }).kept), ["Day of year", "UTC time"]);
});

test("Bake: a night layer or time label that is no longer in the overlay is still skipped as day & night", () => {
  const { context, api } = dayNightSandbox();
  createWorldMap(context);
  const map = context.currentMap(), G = context.GeoScene;
  const rec = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12, label: true }).groupId);
  api.parent(rec.layers[1], map.groupId); // moved out of the group
  api.setUserData(G.findDayNight(map).groupId, "geoDayNight", Object.assign({}, rec, { label: null }));
  assert.equal(G.dayNightParts(map)[rec.layers[1]], undefined);
  assert.equal(G.dayNightParts(map)[rec.label], undefined);
  api.select([rec.layers[1], rec.label]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Day & night redraws from its time, so it can't be baked.");
});

test("Bake: day & night with callout or highlight parts and nothing baked names day & night too", () => {
  const { context, api } = buildSandbox();
  const map = findFrance(context), G = context.GeoScene;
  context.highlightBtn.onClick();
  const h = G.findHighlights(map)[0];
  const co = coRec(api, G.createCallout(map, { lon: 2.35, lat: 48.85 }, "Paris"));
  const night = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId).layers[0];
  api.select([co.label, night]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Callouts and day & night can't be baked.");
  api.select([h.shape, night]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights and day & night can't be baked.");
  api.select([h.shape, co.label, night]);
  context.bakeBtn.onClick();
  assert.equal(context.statusLabel.getText(), "Error: Highlights, callouts and day & night can't be baked.");
});

test("Routes: the Shape dropdown offers Arc and Great circle, default Arc", () => {
  const { context } = buildSandbox();
  assert.deepEqual(plain(context.routeShapePicker._entries), ["Arc", "Great circle"]);
  assert.equal(context.routeShapePicker.getValue(), 0);
});

test("Routes: picking Great circle sets Arc height to 0; back to Arc restores 30 only from 0", () => {
  const { context } = buildSandbox();
  context.arcField.setValue(55);
  context.routeShapePicker.setValue(1); context.routeShapePicker.onValueChanged();
  assert.equal(context.arcField.getValue(), 0);
  context.routeShapePicker.setValue(0); context.routeShapePicker.onValueChanged();
  assert.equal(context.arcField.getValue(), 30);
  context.arcField.setValue(45);
  context.routeShapePicker.setValue(1); context.routeShapePicker.onValueChanged();
  context.arcField.setValue(20);
  context.routeShapePicker.setValue(0); context.routeShapePicker.onValueChanged();
  assert.equal(context.arcField.getValue(), 20, "a hand-set value is kept");
});

test("Routes: Create route passes the picked Shape to the handle helpers", () => {
  [0, 1].forEach((pick) => {
    const { context, api } = buildSandbox({ setup: installNe });
    createWorldMap(context);
    context.routeShapePicker.setValue(pick);
    lookupGives(context, "A"); clickAt(context.routesPreview, 100, 60);
    lookupGives(context, "B"); clickAt(context.routesPreview, 200, 120);
    context.createRouteBtn.onClick();
    const group = api.getCompLayers().filter((id) => api.hasUserDataKey(id, "geoRoute"))[0];
    const d = routeData(api, group);
    assert.ok(d.legs.length >= 1);
    d.legs.forEach((l) => [l.startHandle, l.endHandle].forEach((h) => assert.equal(api.get(h, HIN("shape")), pick)));
  });
});

test("Routes: Shape is remembered as routeShape, other settings kept, and restored at load", () => {
  const { context, api } = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ mapStyle: "Mono" }); } });
  context.routeShapePicker.setValue(1); context.routeShapePicker.onValueChanged();
  const s = settingsOf(api);
  assert.equal(s.routeShape, 1); assert.equal(s.mapStyle, "Mono");
  const again = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify(s); } }).context;
  assert.equal(again.routeShapePicker.getValue(), 1);
  const junk = buildSandbox({ setup: (a) => { a._files[SETTINGS_FILE] = JSON.stringify({ routeShape: 7 }); } }).context;
  assert.equal(junk.routeShapePicker.getValue(), 0);
});

// ---- Route legs clipped at the globe's edge ----
const CIN = (name) => "array." + GeoExpressionT.inputIndex(GeoExpressionT.CLIP_INPUTS, name);
function oldClipRoute(context, api, map, opts) {
  // A route as built before clipping: no clip helpers, the old two-input fade, the draw straight on the trim end.
  const r = context.GeoScene.createRoute(map, ABC, opts || { arc: 30, labels: false, shape: 1 });
  const d = routeData(api, r.groupId);
  d.legs.forEach((l) => {
    api.deleteLayer(l.clipStart); api.deleteLayer(l.clipEnd);
    delete l.clipStart; delete l.clipEnd;
    api._truncate(l.fade, "array", 2);
    api.set(l.fade, { expression: "OLD" });
    api.connect(l.draw, "id", l.line, "stroke.trimEnd", true);
  });
  api.setUserData(r.groupId, "geoRoute", d);
  return r;
}

test("clipped legs: a new leg gets clip start / clip end / fade helpers wired to the line, the camera and the stops' places", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false, shape: 1 });
  const d = routeData(api, r.groupId), IN = (id, attr) => api.getInConnection(id, attr);
  assert.equal(d.legs.length, 2);
  d.legs.forEach((l) => {
    const a = d.stops[l.from], b = d.stops[l.to];
    [l.fade, l.clipStart, l.clipEnd].forEach((h) => {
      assert.equal(api.getParent(h), d.helpers);
      assert.equal(api.hasAttribute(h, "array.20"), true);
      assert.equal(api.hasAttribute(h, "array.21"), false);
      assert.match(api.get(h, "expression"), /GeoCurve\.(visibleSpan|anyVisible)/);
      assert.deepEqual([IN(h, CIN("aX")), IN(h, CIN("aY")), IN(h, CIN("bX")), IN(h, CIN("bY"))],
        [l.line + ".generator.startPosition.x", l.line + ".generator.startPosition.y", l.line + ".generator.endPosition.x", l.line + ".generator.endPosition.y"]);
      assert.deepEqual([IN(h, CIN("startX")), IN(h, CIN("startY")), IN(h, CIN("endX")), IN(h, CIN("endY"))],
        [l.line + ".generator.startOffset.x", l.line + ".generator.startOffset.y", l.line + ".generator.endOffset.x", l.line + ".generator.endOffset.y"]);
      ["camLat", "camLon", "camZoom", "camRotation", "camProjection"].forEach((n, i) => assert.equal(IN(h, CIN(n)), map.cameraId + ".array." + i, n));
      assert.equal(IN(h, CIN("aLon")), a.position + ".array.5"); assert.equal(IN(h, CIN("aLat")), a.position + ".array.6");
      assert.equal(IN(h, CIN("bLon")), b.position + ".array.5"); assert.equal(IN(h, CIN("bLat")), b.position + ".array.6");
      assert.equal(IN(h, CIN("shape")), l.startHandle + "." + HIN("shape"));
    });
    assert.equal(IN(l.line, "opacity"), l.fade + ".id");
    assert.equal(IN(l.line, "stroke.trimStart"), l.clipStart + ".id");
    assert.equal(IN(l.line, "stroke.trimEnd"), l.clipEnd + ".id");
    assert.equal(IN(l.clipEnd, CIN("draw")), l.draw + ".id", "the draw feeds the clip end");
    assert.deepEqual([IN(l.fade, CIN("fromOpacity")), IN(l.fade, CIN("toOpacity"))], [a.holder + ".opacity", b.holder + ".opacity"]);
    assert.equal(api.get(l.line, "stroke.trim"), true);
    assert.deepEqual(["legFade", "legClip", "legClip"], [l.fade, l.clipStart, l.clipEnd].map((h) => GeoExpressionT.readTag(api.get(h, "expression"), "GEO_META").category));
  });
  assert.equal(api.getNiceName(d.legs[0].clipStart), "Leg 1: A → B clip start");
  assert.equal(api.getNiceName(d.legs[0].clipEnd), "Leg 1: A → B clip end");
});

test("clipped legs: a refresh gives an older route the clip helpers and the new fade, once", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context), G = context.GeoScene;
  const r = oldClipRoute(context, api, map);
  const before = routeData(api, r.groupId), IN = (id, attr) => api.getInConnection(id, attr);
  before.legs.forEach((l) => assert.equal(IN(l.line, "stroke.trimEnd"), l.draw + ".id"));
  G.prepareRoutes(map);
  const d = routeData(api, r.groupId);
  d.legs.forEach((l) => {
    assert.ok(l.clipStart && l.clipEnd);
    assert.equal(api.getParent(l.clipStart), d.helpers); assert.equal(api.getParent(l.clipEnd), d.helpers);
    assert.equal(IN(l.line, "stroke.trimStart"), l.clipStart + ".id");
    assert.equal(IN(l.line, "stroke.trimEnd"), l.clipEnd + ".id");
    assert.equal(IN(l.clipEnd, CIN("draw")), l.draw + ".id");
    assert.equal(api.hasAttribute(l.fade, "array.20"), true);
    assert.match(api.get(l.fade, "expression"), /visibleSpan/);
    assert.equal(IN(l.fade, CIN("camProjection")), map.cameraId + ".array.4");
    assert.equal(IN(l.fade, CIN("shape")), l.startHandle + "." + HIN("shape"));
    assert.deepEqual([IN(l.fade, "array.0"), IN(l.fade, "array.1")], [d.stops[l.from].holder + ".opacity", d.stops[l.to].holder + ".opacity"], "the stops' opacities stay wired");
  });
  const count = api.getCompLayers(false).length, snapshot = JSON.stringify(plain(api._connections));
  G.prepareRoutes(map);
  assert.equal(api.getCompLayers(false).length, count, "no layers added");
  assert.equal(JSON.stringify(plain(api._connections)), snapshot, "no connections changed");
  assert.deepEqual(routeData(api, r.groupId), d);
});

test("clipped legs: a leg whose trim end the user owns keeps it; it still gets clip start and the new fade", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context), G = context.GeoScene;
  const r = G.createRoute(map, ABC, { arc: 30, labels: false, shape: 1 });
  const d0 = routeData(api, r.groupId), IN = (id, attr) => api.getInConnection(id, attr);
  api.keyframe(d0.legs[0].line, 0, { "stroke.trimEnd": 0 });
  api.keyframe(d0.legs[0].line, 9, { "stroke.trimEnd": 100 });
  G.prepareRoutes(map);
  const d = routeData(api, r.groupId), l = d.legs[0];
  assert.equal(api.layerExists(d0.legs[0].clipEnd), false, "the clip end lets go");
  assert.ok(!l.clipEnd);
  assert.equal(IN(l.line, "stroke.trimEnd"), "");
  assert.deepEqual(plain(api.getKeyframeTimes(l.line, "stroke.trimEnd")), [0, 9]);
  assert.equal(IN(l.line, "stroke.trimStart"), l.clipStart + ".id");
  assert.equal(IN(l.line, "opacity"), l.fade + ".id");
  assert.ok(d.legs[1].clipEnd, "the other leg is unaffected");
  const count = api.getCompLayers(false).length;
  G.prepareRoutes(map);
  assert.equal(api.getCompLayers(false).length, count);
  // An older leg whose trim end was set by hand: no draw helper, so no clip end either.
  const old = oldClipRoute(context, api, map);
  const od = routeData(api, old.groupId);
  api.deleteLayer(od.legs[0].draw); delete od.legs[0].draw; api.setUserData(old.groupId, "geoRoute", od);
  api.set(od.legs[0].line, { "stroke.trimEnd": 50 });
  G.prepareRoutes(map);
  const after = routeData(api, old.groupId);
  assert.ok(after.legs[0].clipStart); assert.ok(!after.legs[0].clipEnd);
  assert.equal(api.get(after.legs[0].line, "stroke.trimEnd"), 50);
  assert.ok(after.legs[1].clipEnd);
});

test("clipped legs: travellers read the leg's trim start and un-clipped draw, and a refresh upgrades an older traveller", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context), G = context.GeoScene, IN = (id, attr) => api.getInConnection(id, attr);
  const r = G.createRoute(map, ABC, { arc: 30, labels: false, shape: 1 });
  G.addTraveller(map, r.groupId, "dot");
  const t = plain(api.getUserDataKey(r.groupId, "geoTraveller")), d = routeData(api, r.groupId);
  const SH = (later, n) => "array." + (later + n);
  t.legs.forEach((leg, i) => {
    const later = t.legs.length - 1 - i;
    assert.equal(IN(leg.show, SH(later, 2)), leg.line + ".stroke.trimStart");
    assert.equal(IN(leg.show, SH(later, 3)), d.legs[i].draw + ".id");
    assert.equal(api.hasAttribute(leg.show, SH(later, 4)), false);
    assert.equal(IN(leg.tip, "array.0"), leg.line + ".stroke.trimEnd", "the tip still rides the (clipped) trim end");
  });
  // An older traveller: show helpers with only their first inputs.
  t.legs.forEach((leg, i) => {
    api._truncate(leg.show, "array", t.legs.length - 1 - i + 2);
    api.set(leg.show, { expression: "OLD" });
  });
  G.prepareRoutes(map);
  t.legs.forEach((leg, i) => {
    const later = t.legs.length - 1 - i;
    assert.equal(IN(leg.show, SH(later, 2)), leg.line + ".stroke.trimStart");
    assert.equal(IN(leg.show, SH(later, 3)), d.legs[i].draw + ".id");
    assert.match(api.get(leg.show, "expression"), /<= _i\d+ \+ 1e-6/);
    assert.equal(api.hasAttribute(leg.show, SH(later, 4)), false);
  });
  const count = api.getCompLayers(false).length, snapshot = JSON.stringify(plain(api._connections));
  G.prepareRoutes(map);
  assert.equal(api.getCompLayers(false).length, count);
  assert.equal(JSON.stringify(plain(api._connections)), snapshot);
});

test("clipped legs: deleting a route takes the clip helpers with it", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context), G = context.GeoScene;
  const r = G.createRoute(map, ABC, { arc: 30, labels: false, shape: 1 });
  const d = routeData(api, r.groupId), helpers = d.legs.reduce((a, l) => a.concat([l.clipStart, l.clipEnd, l.fade]), []);
  api.deleteLayer(r.groupId);
  helpers.forEach((h) => assert.equal(api.layerExists(h), false));
});

// ---- Day & night: the night steps blurred into a smooth gradient ----
const filtersOf = (api, layer) => api._connections.filter((c) => c[2] === layer && String(c[3]).indexOf("filters.") === 0).map((c) => c[0]);
const dnBlurIn = (context, name) => "array." + context.GeoExpression.inputIndex(context.GeoExpression.NIGHT_BLUR_INPUTS, name);

test("day & night blur: a new overlay gets four Fast Blurs on the night layers, driven by one Night blur helper", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene, E = context.GeoExpression;
  const r = G.addDayNight(map, { dayOfYear: 172, utcTime: 14.5 }), rec = dnRec(api, r.groupId);
  assert.equal(rec.blurs.length, 4);
  assert.ok(rec.blurHelper);
  const holder = api.getParent(rec.helpers[0]);
  assert.equal(api.getNiceName(rec.blurHelper), "Night blur");
  assert.equal(api.getLayerType(rec.blurHelper), "javaScript");
  assert.equal(api.getParent(rec.blurHelper), holder);
  assert.deepEqual(plain(E.readTag(api.get(rec.blurHelper, "expression"), "GEO_META")), { camera: map.cameraId, category: "dayNightBlur" });
  E.NIGHT_BLUR_INPUTS.forEach((inp, k) => assert.equal(api.getCustomAttributeName(rec.blurHelper, "array." + k), inp[0]));
  assert.equal(api.getInConnection(rec.blurHelper, dnBlurIn(context, "zoom")), map.cameraId + ".array.2");
  assert.equal(api.getInConnection(rec.blurHelper, dnBlurIn(context, "twilight")), "");
  assert.equal(api.get(rec.blurHelper, dnBlurIn(context, "twilight")), 1);
  [0, 6, 12, 18].forEach((a, i) => {
    const b = rec.blurs[i];
    assert.equal(api.getLayerType(b), "blurFilter");
    assert.equal(api.getNiceName(b), "Night blur " + a + "°");
    assert.equal(api.getParent(b), holder);
    assert.deepEqual(filtersOf(api, rec.layers[i]), [b]);
    assert.equal(api.getInConnection(b, "amount"), rec.blurHelper + ".id");
  });
  const f = G.findDayNight(map);
  assert.deepEqual(plain(f.blurs), rec.blurs); assert.equal(f.blurHelper, rec.blurHelper);
  const parts = plain(G.dayNightParts(map));
  rec.blurs.concat([rec.blurHelper]).forEach((id) => assert.equal(parts[id], true, id));
});

test("day & night blur: the helper's output is GeoSun.blurAmount for both axes", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const rec = dnRec(api, G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId);
  const expr = api.get(rec.blurHelper, "expression"), vm = require("node:vm");
  [[2, 1], [4, 1], [4, 0], [8, 1]].forEach(([zoom, twilight]) => {
    const got = vm.runInNewContext(expr, { zoom, twilight });
    const want = require("../src/core/sun.js").blurAmount(zoom, twilight);
    assert.deepEqual([got[0], got[1]], [want, want]);
  });
});

test("day & night blur: Add again makes a deleted blur or helper once, wired like the rest, and says nothing more", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, rec = dnRec(api, g);
  const full = api.getCompLayers(false).length;
  api.deleteLayer(rec.blurs[1]); api.deleteLayer(rec.blurHelper);
  const r = G.addDayNight(map, { dayOfYear: 90, utcTime: 6 });
  assert.equal(r.restored, 0, "blurs are not night layers or opacity helpers");
  const now = dnRec(api, g);
  assert.equal(now.blurs[0], rec.blurs[0]); assert.notEqual(now.blurs[1], rec.blurs[1]);
  assert.notEqual(now.blurHelper, rec.blurHelper);
  now.blurs.forEach((b, i) => {
    assert.deepEqual(filtersOf(api, now.layers[i]), [b]);
    assert.equal(api.getInConnection(b, "amount"), now.blurHelper + ".id");
  });
  assert.equal(api.getInConnection(now.blurHelper, dnBlurIn(context, "zoom")), map.cameraId + ".array.2");
  assert.equal(api.getCompLayers(false).length, full, "one blur and the helper are back, nothing else");
  const again = G.addDayNight(map, { dayOfYear: 90, utcTime: 6 });
  assert.equal(again.restored, 0);
  assert.deepEqual(dnRec(api, g), now, "nothing changes the second time");
  // Night layers deleted: the blurs that stayed are connected to the remade layers.
  now.layers.forEach((id) => api.deleteLayer(id));
  const back = G.addDayNight(map, { dayOfYear: 90, utcTime: 6 }), fresh = dnRec(api, g);
  assert.equal(back.restored, 4);
  assert.deepEqual(fresh.blurs, now.blurs);
  fresh.blurs.forEach((b, i) => assert.deepEqual(filtersOf(api, fresh.layers[i]), [b]));
});

test("day & night blur: a Controls refresh gives an older overlay its blurs, once, and the Twilight row drives the blur helper", () => {
  const { context, api } = buildSandbox();
  const map = fullControlsMap(context), G = context.GeoScene;
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, rec = dnRec(api, g);
  // As made before the blur: no blurs, no blur helper, no record of them.
  rec.blurs.forEach((b) => api.deleteLayer(b)); api.deleteLayer(rec.blurHelper);
  const old = Object.assign({}, rec); delete old.blurs; delete old.blurHelper;
  api.setUserData(g, "geoDayNight", old);
  rec.layers.forEach((id) => assert.deepEqual(filtersOf(api, id), []));
  const s = context.GeoControlPanel.sync(map), now = dnRec(api, g);
  assert.equal(now.blurs.length, 4); assert.ok(now.blurHelper);
  now.blurs.forEach((b, i) => {
    assert.deepEqual(filtersOf(api, now.layers[i]), [b]);
    assert.equal(api.getInConnection(b, "amount"), now.blurHelper + ".id");
    assert.equal(api.getParent(b), api.getParent(now.helpers[0]));
  });
  const slots = slotsOf(api, s.valuesId), V = s.valuesId;
  now.helpers.forEach((h) => assert.equal(api.getInConnection(h, "array.1"), V + "." + slots["dn:twilight"]));
  assert.equal(api.getInConnection(now.blurHelper, dnBlurIn(context, "twilight")), V + "." + slots["dn:twilight"]);
  const count = api.getCompLayers(false).length;
  context.GeoControlPanel.sync(map);
  assert.equal(api.getCompLayers(false).length, count, "a second refresh makes nothing");
  assert.deepEqual(dnRec(api, g), now);
  // A blur made later follows the opacity helpers' twilight source.
  api.deleteLayer(now.blurHelper);
  G.addDayNight(map, { dayOfYear: 80, utcTime: 12 });
  const later = dnRec(api, g);
  assert.equal(api.getInConnection(later.blurHelper, dnBlurIn(context, "twilight")), V + "." + slots["dn:twilight"]);
});

test("day & night blur: deleting the overlay removes the blurs and the helper", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, rec = dnRec(api, g);
  api.deleteLayer(g);
  rec.blurs.concat([rec.blurHelper]).forEach((id) => assert.equal(api.layerExists(id), false, id));
});

test("day & night blur: a failure while making an overlay leaves no blur behind", () => {
  const { context, api } = buildSandbox();
  const map = dnMap(context), G = context.GeoScene;
  const before = api.getCompLayers(false).length, real = api.setUserData;
  api.setUserData = function (id, key) { if (key === "geoDayNight") throw new Error("no"); return real.apply(this, arguments); };
  assert.throws(() => G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }));
  api.setUserData = real;
  assert.equal(api.getCompLayers(false).length, before);
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "blurFilter").length, 0);
});

test("clipped legs: a refresh keeps the clip end and the draw -> clip end -> trim end chain, whatever value the driven trim end reads back", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context), G = context.GeoScene;
  const r = G.createRoute(map, ABC, { arc: 30, labels: false, shape: 1 });
  const d0 = routeData(api, r.groupId);
  // Cavalry reads a connected attribute as its driven value (the clip end's s1 * 100, or Travel %).
  [60, 100, 0].forEach((driven) => {
    d0.legs.forEach((l) => api.set(l.line, { "stroke.trimEnd": driven }));
    [0, 1].forEach(() => {
      G.prepareRoutes(map);
      const d = routeData(api, r.groupId);
      d.legs.forEach((l, i) => {
        assert.equal(l.clipEnd, d0.legs[i].clipEnd, "driven " + driven);
        assert.equal(api.layerExists(l.clipEnd), true);
        assert.equal(trimChain(api, l.line), l.draw + ".id");
        assert.equal(api.getInConnection(l.line, "stroke.trimEnd"), l.clipEnd + ".id");
      });
    });
  });
  // The camera turned so the legs are clipped changes nothing about the wiring.
  api.set(map.cameraId, { "array.0": 0, "array.1": -60, "array.4": 2 });
  G.prepareRoutes(map);
  assert.deepEqual(routeData(api, r.groupId).legs.map((l) => l.clipEnd), d0.legs.map((l) => l.clipEnd));
  // A clip end that lost its place on the trim end goes back on it.
  api.disconnect(d0.legs[0].clipEnd, "id", d0.legs[0].line, "stroke.trimEnd");
  api.set(d0.legs[0].line, { "stroke.trimEnd": 100 });
  G.prepareRoutes(map);
  assert.equal(api.getInConnection(d0.legs[0].line, "stroke.trimEnd"), d0.legs[0].clipEnd + ".id");
  assert.equal(trimChain(api, d0.legs[0].line), d0.legs[0].draw + ".id");
});

test("clipped legs: a clip end whose draw helper is gone gets a new draw on it, and keeps the chain", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context), G = context.GeoScene;
  const r = G.createRoute(map, ABC, { arc: 30, labels: false, shape: 1 });
  const d = routeData(api, r.groupId);
  api.deleteLayer(d.legs[0].draw); delete d.legs[0].draw; api.setUserData(r.groupId, "geoRoute", d);
  api.set(d.legs[0].line, { "stroke.trimEnd": 60 });
  G.prepareRoutes(map);
  const now = routeData(api, r.groupId);
  assert.equal(now.legs[0].clipEnd, d.legs[0].clipEnd);
  assert.ok(now.legs[0].draw);
  assert.equal(trimChain(api, now.legs[0].line), now.legs[0].draw + ".id");
  const count = api.getCompLayers(false).length;
  G.prepareRoutes(map);
  assert.equal(api.getCompLayers(false).length, count);
});

test("day & night blur: Refresh controls three times and Add again leave exactly one blur per night layer, also beside a user's own filter", () => {
  const { context, api } = buildSandbox();
  const map = fullControlsMap(context), G = context.GeoScene;
  const g = G.addDayNight(map, { dayOfYear: 80, utcTime: 12 }).groupId, rec = dnRec(api, g);
  const own = api.create("blurFilter", "Mine");
  api.connect(own, "id", rec.layers[2], "filters");
  for (let k = 0; k < 3; k++) context.GeoControlPanel.sync(map);
  G.addDayNight(map, { dayOfYear: 90, utcTime: 6 });
  const now = dnRec(api, g);
  assert.deepEqual(now.blurs, rec.blurs);
  now.layers.forEach((id, i) => {
    const on = filtersOf(api, id);
    assert.ok(on.includes(now.blurs[i]));
    assert.equal(on.filter((f) => api.getNiceName(f).indexOf("Night blur") === 0).length, 1, "one night blur on layer " + i);
  });
  assert.equal(filtersOf(api, now.layers[2]).length, 2);
  assert.equal(api.getInConnection(now.layers[0], "filters"), "", "like Cavalry, the filters input itself reads back empty");
  // A copy of the record without blurs finds the blurs by what they are connected to.
  const old = Object.assign({}, now); delete old.blurs; delete old.blurHelper;
  api.setUserData(g, "geoDayNight", old);
  const f = G.findDayNight(map);
  assert.deepEqual(plain(f.blurs), now.blurs); assert.equal(f.blurHelper, now.blurHelper);
  context.GeoControlPanel.sync(map);
  assert.deepEqual(dnRec(api, g).blurs, now.blurs);
});

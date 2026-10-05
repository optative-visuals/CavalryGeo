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

  function ensure(id) { if (!store[id]) store[id] = {}; return store[id]; }
  // Like Cavalry: a layer with no parent sits at the composition's top level.
  function siblingsOf(id) { var key = parents[id] || COMP_ID; return childOrder[key] || (childOrder[key] = []); }
  function leave(id) { var sib = siblingsOf(id), i = sib.indexOf(id); if (i >= 0) sib.splice(i, 1); }
  function addToComp(id) { outFrames[id] = comp.endFrame + 1; delete parents[id]; (childOrder[COMP_ID] = childOrder[COMP_ID] || []).unshift(id); return id; }
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
      leave(id);
      parents[id] = parentId;
      (childOrder[parentId] = childOrder[parentId] || []).unshift(id); // newly parented layers land on top
    },
    // Like Cavalry: moves the layer to the top level, directly below its former parent group.
    unParent: function (id) {
      var former = parents[id];
      leave(id);
      delete parents[id];
      var top = childOrder[COMP_ID] = childOrder[COMP_ID] || [], at = former ? top.indexOf(former) : -1;
      if (at >= 0) top.splice(at + 1, 0, id); else top.unshift(id);
    },
    getParent: function (id) { return parents[id] || ""; },
    getInFrame: function () { return 0; },
    getOutFrame: function (id) { return outFrames[id]; },
    setOutFrame: function (id, f) { outFrames[id] = f; },
    getChildren: function (parentId) { return (childOrder[parentId] || []).slice(); },
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
      (childOrder[id] || []).slice().forEach(function (c) { this.deleteLayer(c); }, this);
      leave(id);
      // Like Cavalry: a deleted layer's promotions and connections go with it.
      Object.keys(promoted).forEach(function (c) { promoted[c] = promoted[c].filter(function (p) { return p.attribute.indexOf(id + ".") !== 0; }); });
      delete promoted[id]; delete userData[id];
      for (var ci = connections.length - 1; ci >= 0; ci--) { if (connections[ci][0] === id || connections[ci][2] === id) connections.splice(ci, 1); }
      delete niceNames[id]; delete parents[id]; delete childOrder[id]; delete store[id];
    },
    addDynamic: function (id, arr) {
      var o = ensure(id), n = 0;
      while (o[arr + "." + n] !== undefined) n++;
      o[arr + "." + n] = 0;
      return arr + "." + n; // like Cavalry: the new attribute's path
    },
    renameAttribute: function (id, attr, name) { (attrNames[id] = attrNames[id] || {})[attr] = name; },
    getCustomAttributeName: function (id, attr) { return (attrNames[id] || {})[attr] || ""; },
    hasAttribute: function (id, attr) { return ensure(id)[attr] !== undefined; },
    set: function (id, obj) {
      if (id === COMP_ID) { Object.keys(obj).forEach(function (k) { if (k in comp) comp[k] = obj[k]; }); }
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
      if (id === COMP_ID && attr === "frameRange") return { x: comp.startFrame, y: comp.endFrame };
      if (id === COMP_ID && attr in comp) return comp[attr];
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
    _promoted: function (id) { return (promoted[id] || []).map(function (p) { return p.attribute; }); },
    _overrides: overrides,
    _connections: connections,
    getCompLayers: function () { return Object.keys(niceNames); },
    getActiveComp: function () { return COMP_ID; },
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
  LineEdit.prototype.setPlaceholder = function () {};
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
  Draw.prototype.useHoverEvents = function () {};
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
  const context = vm.createContext(sandbox);
  vm.runInContext(buildPanel({ version: options.version }), context, { filename: "CavalryGeo.js" });
  // The Map tab's own preview owns a redraw timer from the moment the panel opens; tests watch
  // the timers they cause (downloads, builds, a preview they create), so leave that one out
  // (found by asking the preview for its timer).
  const own = context.preview && context.preview._timer && context.preview._timer();
  if (own && api._timers.indexOf(own) >= 0) api._timers.splice(api._timers.indexOf(own), 1);
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
  // Tab bar, the shown page only as tall as itself, a stretch, then the status line at the bottom.
  assert.deepEqual(root._items, [context.sectionTabs.widget, pages.widget, context.statusLabel]);
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
    "refreshMapsBtn", "searchBtn", "jumpBtn", "flyBtn",
    "addLayersBtn", "clearCacheBtn",
    "refreshLayersBtn", "findBtn", "extractBtn", "bakeBtn", "refreshControlsBtn",
    "pinSearchBtn", "pinHereBtn", "labelHereBtn", "pinCoordBtn", "labelCoordBtn",
    "routeSearchBtn", "addStopBtn", "removeStopBtn", "clearStopsBtn", "createRouteBtn", "pinStopsBtn",
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
  assert.deepEqual(texts, ["Refresh", "Search", "Jump here", "Fly here", "Create map here"]);
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
  assert.ok(names.includes("Map: Countries"), names.join(", "));
  assert.ok(names.includes("Map: Coastlines"), names.join(", "));
  assert.equal(context.statusLabel.getText(), "Created map \"Map\" with countries and coastlines at the preview frame.");
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
  assert.match(context.statusLabel.getText(), /^Created map "Map" at the preview frame\. \(Countries and coastlines couldn't be added: .+\)$/);
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
  assert.match(context.statusLabel.getText(), /The composition was extended to frame 14 so the flight isn't cut off\./);
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
  assert.equal(asked[0].question, "This flight ends at frame 14, after your composition's last frame (9). Fly here will extend the composition, and the layers that reach its end, to frame 14. Continue?");
  assert.equal(api.get(comp, "endFrame"), 14);
  assert.equal(api.get(comp, "frameRange").y, 14);
  assert.equal(api.get(comp, "playbackEnd"), 14);
  assert.equal(api.getOutFrame(atEnd), 15);
  assert.equal(api.getOutFrame(atEndMinusOne), 15);
  assert.equal(api.getOutFrame(trimmed), 4, "a layer trimmed to end earlier is left alone");
  assert.equal(api.getOutFrame(map.cameraId), 15);
  camTimes(api, map).forEach((t) => assert.deepEqual(t, range(0, 14)));
  assert.equal(context.statusLabel.getText().indexOf("Flight to the world view: frames 0–14. The composition was extended to frame 14 so the flight isn't cut off."), 0);
  assert.ok(context.statusLabel.getText().indexOf("Press Build imagery") > 0);
  assert.equal(context.flyStartField.getValue(), 14);
  assert.equal(context.flyEndField.getValue(), 28);
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
  assert.equal(api.getNiceName(r.groupId), "Route: Paris → Lyon → Marseille");
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
  assert.throws(() => context.GeoScene.planImagery(map, src, {}), /Imagery needs the Web Mercator projection/);
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
  const primary = ["searchBtn", "pinSearchBtn", "routeSearchBtn", "flyBtn", "addLayersBtn", "buildImageryBtn",
    "pinHereBtn", "labelHereBtn", "createRouteBtn", "addDataBtn"];
  const quiet = ["clearCacheBtn", "clearTilesBtn"];
  const plainBtns = ["jumpBtn", "refreshMapsBtn", "findBtn", "extractBtn", "bakeBtn", "cancelImageryBtn", "dataLoadBtn",
    "refreshLayersBtn", "pinCoordBtn", "labelCoordBtn", "addStopBtn", "removeStopBtn", "clearStopsBtn", "refreshDataBtn", "imageryAttrBtn"];
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
  assert.deepEqual(headings(pages[0]), ["Search", "Preview (drag to move)"]);
  assert.deepEqual(headings(pages[1]), ["World · Natural Earth", "Streets · OpenStreetMap", "Extract", "Bake", "Controls"]);
  assert.deepEqual(headings(pages[2]), ["Source", "Build"]);
  assert.deepEqual(headings(pages[3]), ["Place", "At coordinates", "Stops", "Style"]);
  assert.deepEqual(headings(pages[4]), ["Sheet", "Columns", "Show", "Unmatched rows"]);
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

test("preview overlay: the Draw says how to use it, and the old note row and native buttons are gone", () => {
  const { context, ui } = buildSandbox({ setup: installNe });
  const { p } = makePreview(context);
  assert.equal(p._draw._toolTip, "Drag to move · double-click or + / − to zoom");
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
  assert.equal(map.name, "Map");
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

// ---- Map controls ------------------------------------------------------------------
function controlsMap(context) { createWorldMap(context); return context.GeoScene.findMaps()[0]; }
// Cavalry keeps non-breaking spaces in a script input's name but strips plain ones, so the
// plugin writes U+00A0 there; tests compare names with plain spaces.
const NBSP = "\u00a0";
function plainSpaces(name) { return String(name).split(NBSP).join(" "); }
function promotedNames(api, comp) {
  return api._promoted(comp).map((s) => { const d = s.indexOf("."); return plainSpaces(api.getCustomAttributeName(s.slice(0, d), s.slice(d + 1))); });
}
// The map's Controls component: the one in the composition with user data geoControls === the camera.
function controlsOf(api, map) {
  return api.getCompLayers(false).find((id) => api.getLayerType(id) === "component" && api.hasUserDataKey(id, "geoControls") && api.getUserDataKey(id, "geoControls") === map.cameraId);
}
function siblingsOfLayer(api, id) { const p = api.getParent(id); return api.getChildren(p || api.getActiveComp()); }
// Whether `id` sits directly above `below` in the same parent.
function directlyAbove(api, id, below) {
  const sib = siblingsOfLayer(api, below), i = sib.indexOf(id);
  return i >= 0 && i === sib.indexOf(below) - 1;
}
function slotsOf(api, valuesId) { return plain(api.getUserDataKey(valuesId, "geoSlots")); }
const CAMERA_NAMES = ["Camera · Zoom", "Camera · Centre latitude", "Camera · Centre longitude", "Camera · Rotation", "Camera · Projection (0 flat · 1 Equal Earth · 2 globe)"];

test("controls: a sync puts \"<Map> Controls\" just above the map group with the camera and Ocean", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const r = context.GeoControlPanel.sync(map);
  const kids = api.getChildren(map.groupId);
  assert.ok(directlyAbove(api, r.componentId, map.groupId), "directly above the group");
  assert.equal(api.getParent(r.componentId), "", "at the composition's top level");
  assert.equal(kids.indexOf(r.componentId), -1, "not inside the group");
  assert.equal(api.getLayerType(r.componentId), "component");
  assert.equal(api.getNiceName(r.componentId), "Map Controls");
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
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), ["Pins · Hide", "Pins · Colour", "Pins · Size"]);
  const c = S.addPin(map, "C", 20, 20);
  r = context.GeoControlPanel.sync(map);
  assert.equal(api.getInConnection(c, "material.materialColor"), r.valuesId + "." + color);
  assert.ok(directlyAbove(api, r.componentId, map.groupId), "the component stays where it was");
  assert.equal(plain(api._promoted(r.componentId)).filter((s) => s === r.valuesId + "." + color).length, 1);
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
  assert.ok(p.indexOf(r.valuesId + "." + slotsOf(api, r.valuesId)["pins:color"]) < last);
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
  assert.ok(promotedNames(api, r.componentId).indexOf("Labels · Colour") >= 0);
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
  S.createLabel(map, "Paris", 2.35, 48.85);
  let r = context.GeoControlPanel.sync(map);
  const before = plain(api._promoted(r.componentId));
  assert.equal(before.length, 10); // camera 5, Ocean 2, Labels 3
  const removed = [], realRemove = api.removeArrayIndex;
  api.removeArrayIndex = function (id, path) { removed.push(path); return realRemove.apply(this, arguments); };
  S.addPin(map, "A", 0, 0); // the pins' rows go in before the labels'
  r = context.GeoControlPanel.sync(map);
  assert.deepEqual(removed, ["promotedAttributes.9", "promotedAttributes.8", "promotedAttributes.7"]);
  const after = plain(api._promoted(r.componentId));
  assert.deepEqual(after.slice(0, 7), before.slice(0, 7));
  assert.deepEqual(after.slice(10), before.slice(7));
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), ["Pins · Hide", "Pins · Colour", "Pins · Size", "Labels · Hide", "Labels · Colour", "Labels · Size"]);
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
  assert.ok(directlyAbove(api, r2.componentId, map.groupId), "the new component is placed above the group");
  const color = slotsOf(api, r2.valuesId)["pins:color"];
  [a, b].forEach((id) => assert.equal(api.getInConnection(id, "material.materialColor"), r2.valuesId + "." + color));
});

test("controls: labels share Hide, Colour and Size", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const t = context.GeoScene.createLabel(map, "Paris", 2.35, 48.85);
  assert.deepEqual(plain(context.GeoScene.findLabels(map)), [t]);
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), ["Labels · Hide", "Labels · Colour", "Labels · Size"]);
  assert.equal(api.getInConnection(t, "fontSize"), r.valuesId + "." + slotsOf(api, r.valuesId)["labels:size"]);
});

test("controls: a route gets shared colour, width and arc height, then each leg's draw on %", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const map = controlsMap(context);
  const route = context.GeoScene.createRoute(map, [{ name: "Paris", lon: 2.35, lat: 48.85 }, { name: "London", lon: -0.12, lat: 51.5 }, { name: "Rome", lon: 12.5, lat: 41.9 }], { lift: 30, pins: false, labels: false });
  const r = context.GeoControlPanel.sync(map);
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), [
    "Paris → London → Rome · Colour", "Paris → London → Rome · Width", "Paris → London → Rome · Arc height",
    "Paris → London → Rome · Leg 1 draw on %", "Paris → London → Rome · Leg 2 draw on %"
  ]);
  assert.equal(plain(api._promoted(r.componentId))[10], route.legs[0] + ".stroke.trimEnd");
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
  const pinRows = () => plain(promotedNames(api, r.componentId)).filter((n) => /^Pins · /.test(n));
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
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), [
    "Data · Year", "Population · Low colour", "Population · High colour", "Population · No-data colour",
    "Population · Bubble size", "Population · Bubble colour", "Population · Label size"
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
  assert.deepEqual(plain(promotedNames(api, r.componentId)).slice(7), ["Data · Year", "Population · Low colour", "Population · High colour", "Population · No-data colour"]);
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

test("controls: a leg whose name doesn't say its number is numbered by its place in the route", () => {
  const { context, api } = buildSandbox();
  delete api.setGenerator;   // the old-style route (script legs, pins) is what this checks
  const map = controlsMap(context);
  const route = context.GeoScene.createRoute(map, [{ name: "Paris", lon: 2.35, lat: 48.85 }, { name: "London", lon: -0.12, lat: 51.5 }, { name: "Rome", lon: 12.5, lat: 41.9 }], { lift: 30, pins: false, labels: false });
  const realName = api.getNiceName;
  api.getNiceName = function (id) { return id === route.legs[1] ? "Last hop" : realName.apply(this, arguments); };
  const r = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, r.componentId)).filter((n) => /draw on %$/.test(n));
  assert.deepEqual(names, ["Paris → London → Rome · Leg 1 draw on %", "Paris → London → Rome · Leg 2 draw on %"]);
  const p = plain(api._promoted(r.componentId));
  assert.ok(p.indexOf(route.legs[0] + ".stroke.trimEnd") < p.indexOf(route.legs[1] + ".stroke.trimEnd"));
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
  assert.equal(api.getNiceName(top), map.name + " Controls");
  assert.ok(directlyAbove(api, top, map.groupId));
  assert.ok(promotedNames(api, top).indexOf("Countries · Fill colour") >= 0, "starter layers are in it");
});

test("controls: adding a pin updates the Controls", () => {
  const { context, api } = buildSandbox();
  createWorldMap(context);
  context.lonField.setValue(2.35); context.latField.setValue(48.85);
  context.pinCoordBtn.onClick();
  const map = context.GeoScene.findMaps()[0];
  const comp = controlsOf(api, map);
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
  assert.equal(context.statusLabel.getText(), "Controls updated: " + api._promoted(comp).length + " setting(s) in \"Map Controls\". Select it to see them.");
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
    assert.equal(api.getNiceName(rs[i].componentId), m.name + " Controls");
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
  assert.deepEqual(api.getChildren(api.getActiveComp()), before);
  assert.ok(directlyAbove(api, r2.componentId, map.groupId));
});

test("controls: a Controls component made inside the group by the earlier build is moved out, keeping its id and promotions", () => {
  const { context, api } = buildSandbox();
  const map = controlsMap(context);
  const old = api.create("component", "Map Controls");
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
  assert.equal(api.getCompLayers(false).filter((id) => api.getLayerType(id) === "component").length, 1, "no second component");
  assert.ok(promotedNames(api, r2.componentId).indexOf("Pins · Colour") >= 0, "still kept up to date");
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
const GeoProjT = require("../src/core/projection.js");
function routeMap(context) { createWorldMap(context); return context.GeoScene.findMaps()[0]; }
const ABC = [{ name: "A", lon: 0, lat: 0 }, { name: "B", lon: 10, lat: 10 }, { name: "C", lon: 20, lat: 0 }];
function routeData(api, groupId) { return plain(api.getUserDataKey(groupId, "geoRoute")); }

test("routes: Create route builds stops, Bézier legs and helpers, top to bottom", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: false });
  assert.equal(api.getNiceName(r.groupId), "Route: A → B → C");
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
  assert.match(api.get(leg.startHandle, "expression"), /GeoCurve\.handles[\s\S]*\.start\);/);
  assert.match(api.get(leg.endHandle, "expression"), /\.end\);/);
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

test("controls: a new route gets stop, curve and hand rows; values drive every handle", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 40, labels: true });
  const s = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, s.componentId)).slice(7);
  assert.deepEqual(names.slice(0, 6), ["Labels · Hide", "Labels · Colour", "Labels · Size", "Stops · Hide", "Stops · Colour", "Stops · Size"]);
  assert.deepEqual(names.slice(6, 11), ["A → B → C · Colour", "A → B → C · Width", "A → B → C · Arc height", "A → B → C · Lean", "A → B → C · Flip side"]);
  assert.equal(names[11], "A → B → C · Leg 1 draw on %");
  assert.equal(names.length, 6 + 5 + 2 * 6);
  const d = routeData(api, r.groupId), slots = slotsOf(api, s.valuesId);
  const arc = slots["route:" + r.groupId + ":arc"];
  d.legs.forEach((l) => [l.startHandle, l.endHandle].forEach((h) => assert.equal(api.getInConnection(h, "array.8"), s.valuesId + "." + arc)));
  assert.equal(api.get(s.valuesId, arc), 40);
  const size = slots["stops:size"];
  d.stops.forEach((st) => ["generator.radius.x", "generator.radius.y"].forEach((a) => assert.equal(api.getInConnection(st.circle, a), s.valuesId + "." + size)));
  const hx = slots["leg:" + d.legs[0].line + ":startX"];
  assert.equal(api.get(s.valuesId, hx), api.get(d.legs[0].startHandle, "array.12"), "hand X starts with the seeded value");
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
  assert.match(context.statusLabel.getText(), /^Route created: 1 leg\(s\)\. Drag its stops in the viewer, then Pin here to keep them there; animate each leg's draw on % in the map's Controls\./);
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

test("controls: a traveller gets its rows and one Size drives every copy", () => {
  const { context, api } = buildSandbox();
  const map = routeMap(context);
  const r = context.GeoScene.createRoute(map, ABC, { arc: 30, labels: false });
  context.GeoScene.addTraveller(map, r.groupId, "plane");
  const s = context.GeoControlPanel.sync(map);
  const names = plain(promotedNames(api, s.componentId));
  ["A → B → C · Traveller hide", "A → B → C · Traveller size", "A → B → C · Traveller colour", "A → B → C · Traveller faces direction"].forEach((n) => assert.ok(names.indexOf(n) >= 0, n));
  const size = slotsOf(api, s.valuesId)["trav:" + r.groupId + ":size"];
  travData(api, r.groupId).legs.forEach((l) => ["shapeScale.x", "shapeScale.y"].forEach((a) => assert.equal(api.getInConnection(l.dup, a), s.valuesId + "." + size)));
});

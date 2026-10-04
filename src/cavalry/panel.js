// Cavalry Geo panel. Sections ("tabs") register themselves in TAB_BUILDERS; buildUi() runs last.
var PROJECTIONS = ["Web Mercator (streets, cities)", "Equal Earth (world)", "Orthographic (globe)"];
var WORLD_VIEW = { west: -180, east: 180, south: -60, north: 75 };
var TAB_BUILDERS = [];

var statusLabel = new ui.Label("Ready.");
function say(msg) { statusLabel.setText(msg); console.log("[CavalryGeo] " + msg); }
// Like say(), but also nudges Cavalry to repaint the label immediately - useful
// right before a slow network call, so the panel doesn't look frozen while it runs.
function sayNow(msg) {
  say(msg);
  if (typeof api.processEvents === "function") api.processEvents();
}
function guard(fn) {
  return function () {
    try { fn(); } catch (e) { say("Error: " + (e && e.message ? e.message : e)); }
  };
}
function column(items) {
  var v = new ui.VLayout();
  v.setMargins(0, 6, 0, 0); // flush left and right: everything shares one left edge
  if (typeof v.setSpaceBetween === "function") v.setSpaceBetween(4);
  // A heading sits close to what it introduces (4 px below) and further from what came before (about 8 px above).
  items.forEach(function (w, i) {
    if (i > 0 && GeoStyle.isHeading(w) && typeof v.addSpacing === "function") v.addSpacing(4);
    v.add(w);
  });
  if (typeof v.addStretch === "function") v.addStretch(); // controls pack at the top
  return v;
}
function row() {
  var h = new ui.HLayout();
  if (typeof h.setMargins === "function") h.setMargins(0, 0, 0, 0);
  for (var i = 0; i < arguments.length; i++) h.add(arguments[i]);
  return h;
}

// ---- Map tab --------------------------------------------------------------
// There is no Create map button: the Map picker ends with "New map", and Search makes
// the map (centred on the first result) when that entry is picked.
var NEW_MAP = "New map";
var maps = [], results = [];
var mapPicker = new ui.DropDown();
var refreshMapsBtn = GeoStyle.button("Refresh");
var nameField = new ui.LineEdit(); nameField.setPlaceholder("Map name (blank = the place's name)");
var projPicker = new ui.DropDown(); PROJECTIONS.forEach(function (p) { projPicker.addEntry(p); });
var searchField = new ui.LineEdit(); searchField.setPlaceholder("Search a place, e.g. Notre-Dame, Paris");
var searchBtn = GeoStyle.primaryButton("Search");
var resultPicker = new ui.DropDown();
var jumpBtn = GeoStyle.button("Jump here");
var flyFramesField = new ui.NumericField(100);
flyFramesField.setType(0);
flyFramesField.setMin(2);
var flyBtn = GeoStyle.primaryButton("Fly here");

// Search and Fly here share one width so they line up above each other on the right.
var MAP_ACTION_WIDTH = 84;
if (typeof searchBtn.setFixedWidth === "function") searchBtn.setFixedWidth(MAP_ACTION_WIDTH);
if (typeof flyBtn.setFixedWidth === "function") flyBtn.setFixedWidth(MAP_ACTION_WIDTH);

// The preview: Task 1's Cavalry probe settled these.
var PREVIEW_Y_UP = true, PREVIEW_DIM = true, PREVIEW_REDRAW = "timer";
var framesLabel = new ui.Label("Frames");
var createHereBtn = GeoStyle.primaryButton("Create map here");
var preview = GeoPreviewPanel.create({
  compSize: function () { return GeoScene.compSize(); },
  onPick: function (i) { if (i < 0 || i >= results.length) return; resultPicker.setValue(i + 1); previewFollowPicked(); },
  yUp: PREVIEW_Y_UP, dim: PREVIEW_DIM, redraw: PREVIEW_REDRAW
});
// Centres the preview on the picked result (or the world view) — the preview then "follows" it.
function previewFollowPicked() {
  if (!preview.available()) return;
  var cam = resultPicker.getValue() > 0 ? camForResult(selectedResult(), 0) : worldViewCamera(0);
  preview.setPlaces(results.map(function (r) { return { lat: r.lat, lon: r.lon, name: r.name }; }), resultPicker.getValue() - 1);
  preview.showCamera(cam, resultPicker.getValue() > 0 ? "result" : "world");
}
// Centres the preview on the picked map's camera and shows it as the dashed frame.
function previewShowMap() {
  if (!preview.available() || newMapSelected()) { if (preview.available()) preview.setCurrentCamera(null); return; }
  var cam = GeoScene.readCamera(maps[mapPicker.getValue()].cameraId);
  preview.setCurrentCamera(cam);
  preview.showCamera(cam, "camera");
}

// "New map" is always the last entry, and the one selected when the scene has no maps.
function refreshMaps(selectCameraId) {
  maps = GeoScene.findMaps();
  mapPicker.clear();
  var sel = 0;
  maps.forEach(function (m, i) { mapPicker.addEntry(m.name); if (m.cameraId === selectCameraId) sel = i; });
  mapPicker.addEntry(NEW_MAP);
  mapPicker.setValue(sel);
  refreshNewMapFields();
  previewShowMap();
}
function newMapSelected() {
  var idx = mapPicker.getValue();
  return idx < 0 || idx >= maps.length;
}
// The map name and projection only matter when Search is about to make a map.
function refreshNewMapFields() {
  var show = newMapSelected();
  // Real Cavalry only documents setHidden on Button, so check before calling it.
  if (typeof nameField.setHidden === "function") nameField.setHidden(!show);
  if (typeof projPicker.setHidden === "function") projPicker.setHidden(!show);
  [jumpBtn, framesLabel, flyFramesField, flyBtn].forEach(function (w) { if (typeof w.setHidden === "function") w.setHidden(show); });
  // With the preview gone there is no frame to make a map from; Search still does it.
  if (typeof createHereBtn.setHidden === "function") createHereBtn.setHidden(!show || !preview.available());
}
function currentMap() {
  if (newMapSelected()) throw new Error("Pick a map, or search for a place first — that creates the map (Map tab).");
  return maps[mapPicker.getValue()];
}
// Makes a map and selects it in the Map picker.
function makeMap(name, cam) {
  var map = GeoScene.createMap(name, cam);
  refreshMaps(map.cameraId);
  return map;
}
// "Paris", or "Paris 2", "Paris 3"... when a map already has that name.
function uniqueMapName(name) {
  var taken = {};
  GeoScene.findMaps().forEach(function (m) { taken[m.name] = true; });
  if (!taken[name]) return name;
  for (var n = 2; ; n++) { if (!taken[name + " " + n]) return name + " " + n; }
}
// Index 0 of resultPicker is always the fixed "World view" entry, so there is always
// a way back to a world view even after searches have run.
// A real search result is results[i - 1] for picker index i.
function refreshResultPicker() {
  var sel = resultPicker.getValue();
  resultPicker.clear();
  resultPicker.addEntry("World view");
  results.forEach(function (r) { resultPicker.addEntry(placeLabel(r)); });
  resultPicker.setValue(sel > 0 && sel <= results.length ? sel : 0);
}
function placeLabel(r) { return r.name.length > 70 ? r.name.slice(0, 67) + "..." : r.name; }
function selectedResult() {
  var idx = resultPicker.getValue();
  if (idx <= 0) throw new Error("Search for a place first (Map tab).");
  return results[idx - 1];
}
function shortName(r) { return String(r.name).split(",")[0]; }
function camForResult(r, projection) {
  var s = GeoScene.compSize();
  var z = GeoProjection.zoomForBounds(r.bbox, s.width, s.height);
  if (!isFinite(z)) z = 10;
  return { lat: r.lat, lon: r.lon, zoom: Math.max(1, Math.min(18, z)), rotation: 0, projection: projection };
}
function worldViewCamera(projection) {
  var s = GeoScene.compSize();
  return { lat: 20, lon: 0, zoom: GeoProjection.zoomForBounds(WORLD_VIEW, s.width, s.height), rotation: 0, projection: projection };
}
// Where Jump here and Fly here go: the preview's green frame once the user has moved it;
// otherwise the picked place, or the world view for entry 0.
function pickedTarget(projection) {
  if (preview.available() && preview.source() === null) {
    var f = preview.frameCamera();
    return { cam: { lat: f.lat, lon: f.lon, zoom: f.zoom, rotation: 0, projection: projection }, name: "the preview frame" };
  }
  if (resultPicker.getValue() > 0) {
    var r = selectedResult();
    return { cam: camForResult(r, projection), name: shortName(r) };
  }
  return { cam: worldViewCamera(projection), name: "the world view" };
}

refreshResultPicker();
resultPicker.onValueChanged = guard(function () { previewFollowPicked(); });

refreshMapsBtn.onClick = guard(function () { refreshMaps(); say(maps.length + " map(s) in this composition."); });

searchBtn.onClick = guard(function () {
  var q = searchField.getText().trim();
  if (!q) throw new Error("Type a place to search for.");
  var creating = newMapSelected();
  results = GeoNet.search(q);
  refreshResultPicker();
  previewFollowPicked(); // clears old dots when nothing was found
  if (!results.length) { say("No results for \"" + q + "\"."); return; }
  resultPicker.setValue(1);
  previewFollowPicked();
  prefillPins(q, results);
  if (!creating) { say(results.length + " result(s). Pick one, then Jump here or Fly here."); return; }
  var r = results[0], name = uniqueMapName(nameField.getText().trim() || shortName(r));
  makeMap(name, camForResult(r, projPicker.getValue()));
  say("Created map \"" + name + "\" centred on " + shortName(r) + ". " + results.length + " result(s): pick one, then Jump here or Fly here.");
});

jumpBtn.onClick = guard(function () {
  var map = currentMap(), t = pickedTarget(GeoScene.readCamera(map.cameraId).projection);
  GeoScene.setCamera(map.cameraId, { lat: t.cam.lat, lon: t.cam.lon, zoom: t.cam.zoom });
  say("Camera jumped to " + t.name + (t.name !== "the world view" ? " (zoom " + t.cam.zoom.toFixed(1) + ")" : "") + ".");
  previewShowMap();
});

flyBtn.onClick = guard(function () {
  var map = currentMap(), s = GeoScene.compSize(), start = GeoScene.readCamera(map.cameraId), t = pickedTarget(start.projection);
  var frame = api.getFrame();
  var pts = GeoFly.path(start, t.cam, flyFramesField.getValue(), s.width);
  var range = GeoScene.flyCamera(map, pts, frame);
  api.setFrame(frame);
  var msg = "Flight to " + t.name + ": frames " + range.start + "–" + range.end + ".";
  if (t.name === "the world view") msg += " Flying to the world view — to fly somewhere else, search for a place and pick it first.";
  msg += " Press Build imagery (Imagery tab) for sharp imagery along the way.";
  var compEnd = GeoScene.compFrameRange().end;
  if (range.end > compEnd) msg += " Note: the flight ends after the composition's last frame (" + compEnd + ").";
  say(msg);
  resetImageryPlan();
  previewShowMap();
});

createHereBtn.onClick = guard(function () {
  if (!preview.available()) throw new Error("The map preview isn't available — search for a place to make a map instead.");
  var f = preview.frameCamera(), name = uniqueMapName(nameField.getText().trim() || "Map");
  makeMap(name, { lat: f.lat, lon: f.lon, zoom: f.zoom, rotation: 0, projection: projPicker.getValue() });
  say("Created map \"" + name + "\" at the preview frame.");
});

TAB_BUILDERS.push(function (tabs) {
  tabs.add("Map", column([
    row(mapPicker, refreshMapsBtn),
    row(nameField, projPicker),
    GeoStyle.heading("Search"),
    row(searchField, searchBtn),
    resultPicker,
    GeoStyle.heading("Preview"),
    preview.layout,
    GeoStyle.heading("Camera"),
    row(jumpBtn, framesLabel, flyFramesField, flyBtn),
    createHereBtn
  ]));
});

// ---- Layers tab ------------------------------------------------------------
var NE_CATS = [["countries", "Countries"], ["states", "States / provinces"], ["coastlines", "Coastlines"], ["lakes", "Lakes"], ["rivers", "Rivers"], ["cities", "Cities"]];
var OSM_CATS = [["buildings", "Buildings"], ["roads", "Roads"], ["water", "Water"], ["parks", "Parks"], ["railways", "Railways"]];
var DRAW_ORDER = ["countries", "states", "lakes", "coastlines", "rivers", "parks", "water", "buildings", "railways", "roads", "cities"];
var NE_SCALES = ["110m", "50m", "10m"];
var CATEGORY_LABEL = {};
NE_CATS.concat(OSM_CATS).forEach(function (c) { CATEGORY_LABEL[c[0]] = c[1]; });

// Toggle texts are shorter than the layer names ("States", not "States / provinces").
var checks = {};
NE_CATS.concat(OSM_CATS).forEach(function (c) { checks[c[0]] = GeoStyle.toggle(c[1].split(" /")[0], false); });
var scalePicker = new ui.DropDown();
["Low detail (bundled)", "Medium detail (bundled)", "High detail (downloads 10-40 MB once)"].forEach(function (s) { scalePicker.addEntry(s); });
scalePicker.setValue(1);
var modePicker = new ui.DropDown();
modePicker.addEntry("Main features only");
modePicker.addEntry("Everything");
var creditCheck = new ui.Checkbox(true);
var addLayersBtn = GeoStyle.primaryButton("Add layers");
var clearCacheBtn = GeoStyle.quietButton("Clear download cache");

addLayersBtn.onClick = guard(function () {
  var map = currentMap();
  var selected = DRAW_ORDER.filter(function (c) { return checks[c].getValue(); });
  if (!selected.length) throw new Error("Turn on at least one layer.");
  var isOsm = function (c) { return OSM_CATS.some(function (o) { return o[0] === c; }); };
  var mode = modePicker.getValue() === 1 ? "all" : "main";
  var scale = NE_SCALES[scalePicker.getValue()];
  var boxes = null;

  if (selected.some(isOsm)) {
    var s = GeoScene.compSize();
    boxes = GeoProjection.mercatorViewBoxes(GeoScene.readCamera(map.cameraId), s.width, s.height);
    var area = GeoUtil.checkArea(boxes, mode);
    if (area.refuse) {
      throw new Error("The camera shows about " + Math.round(area.areaKm2) + " km² — too large for street data. Zoom the camera in (street layers work best around zoom 14–18).");
    }
    if (area.needsConfirm && !new ui.Modal().showQuestion("Large area",
        "The camera shows about " + Math.round(area.areaKm2) + " km². Downloading " +
        (mode === "all" ? "everything" : "main features") + " for that area may be slow and heavy. Continue?")) {
      say("Cancelled. Zoom the camera in, or choose Main features only.");
      return;
    }
  }

  if (selected.some(isOsm)) sayNow("Downloading from OpenStreetMap… Cavalry may pause for a few seconds.");

  // Fetch and encode everything first so a failure adds nothing.
  var fetched = [], bytes = 0;
  selected.forEach(function (c) {
    sayNow("Loading " + CATEGORY_LABEL[c] + "...");
    var enc = isOsm(c) ? GeoNet.osmLayer(c, boxes, mode) : GeoNet.neLayer(c, scale);
    bytes += JSON.stringify(enc).length;
    fetched.push({ category: c, enc: enc });
  });
  if (bytes > GeoUtil.LIMITS.SCENE_WARN_BYTES && !new ui.Modal().showQuestion("Heavy layers",
      "These layers add about " + GeoUtil.formatBytes(bytes) + " to the scene file. Continue?")) {
    say("Cancelled. Nothing was added.");
    return;
  }

  var added = 0, empty = [];
  fetched.forEach(function (r) {
    if (!r.enc.f.length) { empty.push(CATEGORY_LABEL[r.category]); return; }
    GeoScene.createMapLayer(map, map.name + ": " + CATEGORY_LABEL[r.category], r.enc,
      { camera: map.cameraId, category: r.category }, GeoScene.STYLE[r.category], {});
    added++;
  });
  if (selected.some(isOsm) && creditCheck.getValue() && !GeoScene.hasAttribution(map)) GeoScene.createAttribution(map);
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  say("Added " + added + " layer(s), " + GeoUtil.formatBytes(bytes) + "." + (empty.length ? " Nothing found for: " + empty.join(", ") + "." : ""));
});

clearCacheBtn.onClick = guard(function () {
  if (imageryState.timer) throw new Error("The download cache can't be cleared while imagery is downloading or building — wait, or press Cancel first.");
  var r = GeoNet.clearCache();
  if (r.fallback) say("Download cache cleared (old downloads will be re-fetched; some files could not be deleted from disk).");
  else say("Download cache cleared: " + r.files + " file(s), " + GeoUtil.formatBytes(r.bytes) + " freed.");
  resetImageryPlan();
});

// ---- Extract and Bake (in the Layers section) ---------------------------------
var NOT_EXTRACTABLE = ["extract", "pin", "label", "route", "data"];
var sourceLayers = [], groups = [], groupsEnc = null, groupsLayer = null;
var layerPicker = new ui.DropDown();
var refreshLayersBtn = GeoStyle.button("Refresh");
var featureQuery = new ui.LineEdit(); featureQuery.setPlaceholder("Name, e.g. France or Rue de Rivoli (blank = all named)");
var findBtn = GeoStyle.button("Find");
var featureList = new ui.List();
featureList.setSelectionMode("extended");
var extractBtn = GeoStyle.button("Extract selected");
var bakeBtn = GeoStyle.button("Bake selected layers to editable shapes");

// Extract state (groups/groupsEnc/groupsLayer, and the feature list) is only ever
// valid for the layer it was built from. Any refresh of the source-layer list -
// including a map switch - must invalidate it, otherwise Extract can build one
// map's feature connected to a different map's camera.
function refreshSourceLayers() {
  var map = currentMap();
  clearSourceLayers();
  sourceLayers = GeoScene.findMapLayers(map).filter(function (l) { return NOT_EXTRACTABLE.indexOf(l.meta.category) < 0; });
  sourceLayers.forEach(function (l) { layerPicker.addEntry(l.name); });
}
function clearSourceLayers() {
  sourceLayers = [];
  layerPicker.clear();
  groups = [];
  groupsEnc = null;
  groupsLayer = null;
  featureList.setModel([]);
}

refreshLayersBtn.onClick = guard(function () { refreshSourceLayers(); say(sourceLayers.length + " map layer(s) available."); });
// Picking "New map" is a normal choice, not an error: it just leaves no map to extract from.
mapPicker.onValueChanged = guard(function () {
  refreshNewMapFields();
  previewShowMap();
  if (!newMapSelected()) { refreshSourceLayers(); return; }
  clearSourceLayers();
  say("New map: type a place and press Search to make it.");
});

findBtn.onClick = guard(function () {
  // Refresh always (the map may have changed layers since the last refresh), but
  // keep the user's picked layer selected if it still exists.
  var pickedId = (sourceLayers[layerPicker.getValue()] || {}).id;
  refreshSourceLayers();
  if (!sourceLayers.length) throw new Error("This map has no layers to extract from yet.");
  var idx = 0;
  for (var i = 0; i < sourceLayers.length; i++) { if (sourceLayers[i].id === pickedId) { idx = i; break; } }
  layerPicker.setValue(idx);
  groupsLayer = sourceLayers[idx];
  groupsEnc = GeoScene.readLayerData(groupsLayer.id);
  groups = GeoCodec.findByName(groupsEnc, featureQuery.getText().trim()).slice(0, 500);
  featureList.setModel(groups.map(function (g, i) {
    return { uuid: "g" + i, label: g.name + (g.indices.length > 1 ? " (" + g.indices.length + " parts)" : "") };
  }));
  say(groups.length ? groups.length + " match(es). Select some, then Extract." : "No named features match.");
});

extractBtn.onClick = guard(function () {
  if (!groupsLayer) throw new Error("Click Find first (Layers tab).");
  var sel = featureList.getSelection();
  if (!sel || !sel.length) throw new Error("Select features in the list first.");
  var map = currentMap();
  sel.forEach(function (uuid) { GeoScene.extract(map, groupsLayer, groupsEnc, groups[parseInt(String(uuid).slice(1), 10)]); });
  say("Extracted " + sel.length + " feature layer(s). They follow the camera; style and animate them freely.");
});

bakeBtn.onClick = guard(function () {
  var ids = api.getSelection();
  if (!ids.length) throw new Error("Select one or more map layers in the Scene Window first.");
  var baked = 0, skippedData = 0, other = 0;
  ids.forEach(function (id) {
    var meta = GeoScene.readLayerMeta(id);
    if (!meta) { other++; return; }
    if (meta.category === "data") { skippedData++; return; }
    GeoScene.bake(id);
    baked++;
  });

  if (baked === 0) {
    if (skippedData && !other) {
      throw new Error("Data layers can't be baked yet. Select map layers such as \"world: Countries\" instead.");
    } else {
      throw new Error("Select Cavalry Geo map layers to bake (groups and the camera can't be baked).");
    }
  }

  var msg = "Baked " + baked + " layer(s) at the current frame. Baked shapes no longer follow the camera.";
  if (skippedData) msg += " Skipped " + skippedData + " data layer(s) - data layers can't be baked yet.";
  if (other) msg += " Skipped " + other + " group(s) or other layer(s).";
  say(msg);
});

// Layers holds the layer categories, then Extract and Bake.
TAB_BUILDERS.push(function (tabs) {
  var toggles = function (cats) { return cats.map(function (c) { return checks[c[0]]; }); };
  tabs.add("Layers", column([
    GeoStyle.heading("World · Natural Earth"),
    GeoStyle.toggleGrid(toggles(NE_CATS), 3),
    row(new ui.Label("Detail"), scalePicker),
    GeoStyle.heading("Streets · OpenStreetMap"),
    GeoStyle.note("Downloads the area the camera shows."),
    GeoStyle.toggleGrid(toggles(OSM_CATS), 3),
    modePicker,
    row(creditCheck, new ui.Label("Add © OpenStreetMap contributors credit")),
    addLayersBtn,
    GeoStyle.heading("Extract"),
    row(layerPicker, refreshLayersBtn),
    row(featureQuery, findBtn),
    featureList,
    extractBtn,
    GeoStyle.heading("Bake"),
    bakeBtn,
    clearCacheBtn
  ]));
});

// Runs a place search from a text field into a results dropdown (no "World view" entry).
function searchInto(field, picker) {
  var q = field.getText().trim();
  if (!q) throw new Error("Type a place to search for.");
  var found = GeoNet.search(q);
  fillPlaces(picker, found);
  if (!found.length) say("No results for \"" + q + "\".");
  return found;
}
function fillPlaces(picker, found) {
  picker.clear();
  found.forEach(function (r) { picker.addEntry(placeLabel(r)); });
  if (found.length) picker.setValue(0);
}

// ---- Pins (Label section) ---------------------------------------------------
// The Pins page has its own search (a Map tab search fills it in too), so a pin or label
// always goes to the place shown right here (never to whatever is picked on the Map tab).
var pinResults = [];
var pinSearchField = new ui.LineEdit(); pinSearchField.setPlaceholder("Search a place, e.g. Eiffel Tower");
var pinSearchBtn = GeoStyle.primaryButton("Search");
var pinResultPicker = new ui.DropDown();
var labelText = new ui.LineEdit(); labelText.setPlaceholder("Label text (blank = place name)");
var pinHereBtn = GeoStyle.primaryButton("Pin here");
var labelHereBtn = GeoStyle.primaryButton("Label here");
var latField = new ui.NumericField(0); latField.setType(1); latField.setMin(-90); latField.setMax(90);
var lonField = new ui.NumericField(0); lonField.setType(1); lonField.setMin(-180); lonField.setMax(180);
var pinCoordBtn = GeoStyle.button("Pin at coordinates");
var labelCoordBtn = GeoStyle.button("Label at coordinates");

function labelOr(fallback) { return labelText.getText().trim() || fallback; }
function coordName() { return latField.getValue().toFixed(4) + ", " + lonField.getValue().toFixed(4); }
// A Map tab search fills the Pins page too, so Pin here works without searching again.
function prefillPins(q, found) {
  pinSearchField.setText(q);
  pinResults = found.slice();
  fillPlaces(pinResultPicker, pinResults);
}
function pinPlace() {
  var idx = pinResultPicker.getValue();
  if (!pinResults.length || idx < 0 || idx >= pinResults.length) throw new Error("Search for a place under Label → Pins first.");
  return pinResults[idx];
}

pinSearchBtn.onClick = guard(function () {
  pinResults = searchInto(pinSearchField, pinResultPicker);
  if (pinResults.length) say(pinResults.length + " result(s). Pick one, then Pin here or Label here.");
});
pinHereBtn.onClick = guard(function () {
  var r = pinPlace(), name = labelOr(shortName(r));
  GeoScene.addPin(currentMap(), name, r.lon, r.lat);
  say("Pin added at " + shortName(r) + ".");
});
labelHereBtn.onClick = guard(function () {
  var r = pinPlace(), text = labelOr(shortName(r));
  GeoScene.createLabel(currentMap(), text, r.lon, r.lat);
  say("Label \"" + text + "\" added at " + shortName(r) + ".");
});
pinCoordBtn.onClick = guard(function () {
  GeoScene.addPin(currentMap(), labelOr(coordName()), lonField.getValue(), latField.getValue());
  say("Pin added at " + coordName() + ".");
});
labelCoordBtn.onClick = guard(function () {
  var text = labelOr(coordName());
  GeoScene.createLabel(currentMap(), text, lonField.getValue(), latField.getValue());
  say("Label \"" + text + "\" added at " + coordName() + ".");
});

// ---- Routes (Label section) -------------------------------------------------
// A flight arc is a route with two stops; a journey has more. One leg layer per pair.
var routeResults = [], stops = [];
var routeSearchField = new ui.LineEdit(); routeSearchField.setPlaceholder("Search a stop, e.g. London");
var routeSearchBtn = GeoStyle.primaryButton("Search");
var routeResultPicker = new ui.DropDown();
var addStopBtn = GeoStyle.button("Add stop");
var stopsList = new ui.List(); stopsList.setSelectionMode("extended");
var removeStopBtn = GeoStyle.button("Remove selected");
var clearStopsBtn = GeoStyle.button("Clear");
var liftField = new ui.NumericField(30); liftField.setType(1); liftField.setMin(0); liftField.setMax(100);
var pinsAtStops = new ui.Checkbox(true);
var labelsAtStops = new ui.Checkbox(false);
var createRouteBtn = GeoStyle.primaryButton("Create route");

function refreshStops() {
  stopsList.setModel(stops.map(function (s, i) { return { uuid: "s" + i, label: (i + 1) + ". " + s.name }; }));
}

routeSearchBtn.onClick = guard(function () {
  routeResults = searchInto(routeSearchField, routeResultPicker);
  if (routeResults.length) say(routeResults.length + " result(s). Pick one, then Add stop.");
});
addStopBtn.onClick = guard(function () {
  var idx = routeResultPicker.getValue();
  if (!routeResults.length || idx < 0 || idx >= routeResults.length) throw new Error("Search for a stop under Label → Routes first.");
  var r = routeResults[idx];
  var last = stops[stops.length - 1];
  if (last && Math.abs(last.lon - r.lon) < 1e-9 && Math.abs(last.lat - r.lat) < 1e-9) {
    say("That's already the last stop.");
    return;
  }
  stops.push({ name: shortName(r), lon: r.lon, lat: r.lat });
  refreshStops();
  say("Stop " + stops.length + ": " + shortName(r) + ".");
});
removeStopBtn.onClick = guard(function () {
  var sel = stopsList.getSelection() || [];
  if (!sel.length) throw new Error("Select stops in the list to remove.");
  var drop = {};
  sel.forEach(function (u) { drop[parseInt(String(u).slice(1), 10)] = true; });
  stops = stops.filter(function (s, i) { return !drop[i]; });
  refreshStops();
  say(stops.length + " stop(s) left.");
});
clearStopsBtn.onClick = guard(function () { stops = []; refreshStops(); say("Stops cleared."); });
createRouteBtn.onClick = guard(function () {
  var map = currentMap();
  if (stops.length < 2) throw new Error("Add at least 2 stops to make a route.");
  var r = GeoScene.createRoute(map, stops, { lift: liftField.getValue(), pins: pinsAtStops.getValue(), labels: labelsAtStops.getValue() });
  say("Route created: " + r.legs.length + " leg(s). Animate each leg's Trim to draw it on.");
});

// ---- Label section: Pins and Routes, switched by a small tab bar -----------------
var LABEL_PAGES = ["Pins", "Routes"];
var labelTabs = null, labelPages = null;
function showLabelPage(name) {
  var i = LABEL_PAGES.indexOf(name);
  if (i < 0 || !labelPages) return;
  labelTabs.select(name);
  labelPages.setPage(i);
}
TAB_BUILDERS.push(function (tabs) {
  labelPages = GeoStyle.pageStack();
  labelPages.add(column([
    GeoStyle.heading("Place"),
    row(pinSearchField, pinSearchBtn),
    pinResultPicker,
    labelText,
    row(pinHereBtn, labelHereBtn),
    GeoStyle.heading("At coordinates"),
    row(new ui.Label("Lat"), latField, new ui.Label("Lon"), lonField),
    row(pinCoordBtn, labelCoordBtn)
  ]));
  labelPages.add(column([
    GeoStyle.heading("Stops"),
    row(routeSearchField, routeSearchBtn),
    row(routeResultPicker, addStopBtn),
    stopsList,
    row(removeStopBtn, clearStopsBtn),
    GeoStyle.heading("Style"),
    row(new ui.Label("Lift %"), liftField),
    row(pinsAtStops, new ui.Label("Pins at stops"), labelsAtStops, new ui.Label("Labels at stops")),
    createRouteBtn
  ]));
  labelTabs = GeoStyle.tabBar(LABEL_PAGES, function (name) { showLabelPage(name); });
  // No margins here: the page columns already carry theirs.
  var labelColumn = new ui.VLayout();
  labelColumn.setMargins(0, 0, 0, 0);
  labelColumn.add(labelTabs.widget);
  labelColumn.add(labelPages.widget);
  tabs.add("Label", labelColumn);
});

// ---- Data tab -------------------------------------------------------------------
var dataLoaded = null; // { url, table, detection }
var dataLinkField = new ui.LineEdit(); dataLinkField.setPlaceholder("Google Sheet link (shared: Anyone with the link) or CSV link");
var dataLoadBtn = GeoStyle.button("Load");
var placePicker = new ui.DropDown(), valuePicker = new ui.DropDown(), yearPicker = new ui.DropDown();
var prefixField = new ui.LineEdit(); prefixField.setPlaceholder("Prefix, e.g. $");
var suffixField = new ui.LineEdit(); suffixField.setPlaceholder("Suffix, e.g. %");
var regionsCheck = GeoStyle.toggle("Coloured regions", true), bubblesCheck = GeoStyle.toggle("Bubbles", false);
var labelsCheck = GeoStyle.toggle("Value labels", false), legendCheck = GeoStyle.toggle("Legend", true);
var lookupCheck = new ui.Checkbox(false);
var addDataBtn = GeoStyle.primaryButton("Add to map");
var refreshDataBtn = GeoStyle.button("Refresh data");
var dataUnmatchedList = new ui.List();
var NO_YEAR = "(none)", WIDE_YEARS = "(one column per year)";

function fillPicker(picker, entries, selected) {
  picker.clear();
  entries.forEach(function (e) { picker.addEntry(e); });
  var i = entries.indexOf(selected);
  picker.setValue(i >= 0 ? i : 0);
}

function currentChoice() {
  if (!dataLoaded) throw new Error("Paste a link and press Load first.");
  var t = dataLoaded.table, d = dataLoaded.detection, header = t.header;
  var choice = GeoDataset.defaultChoice(d);
  var place = header[placePicker.getValue()];
  if (place !== choice.placeColumn) {
    choice.placeColumn = place;
    choice.placeKind = place === d.latColumn || place === d.lonColumn ? "latlon" : GeoCsv.placeKindOf(t, place);
  }
  var yearEntry = yearPickerEntries()[yearPicker.getValue()];
  if (yearEntry === NO_YEAR) { choice.layout = "none"; choice.yearColumn = null; }
  else if (yearEntry === WIDE_YEARS) { choice.layout = "wide"; }
  else { choice.layout = "long"; choice.yearColumn = yearEntry; }
  if (choice.layout !== "wide") choice.valueColumn = valuePickerEntries()[valuePicker.getValue()] || null;
  return choice;
}
function yearPickerEntries() {
  var d = dataLoaded.detection, entries = [NO_YEAR];
  if (d.time.yearColumns.length >= 2) entries.push(WIDE_YEARS);
  return entries.concat(dataLoaded.table.header);
}
function valuePickerEntries() { return dataLoaded.detection.values.length ? dataLoaded.detection.values : dataLoaded.table.header; }

function showUnmatched(list) {
  dataUnmatchedList.setModel(list.slice(0, 300).map(function (label, i) { return { uuid: "u" + i, label: label || "(blank)" }; }));
}

dataLoadBtn.onClick = guard(function () {
  var url = dataLinkField.getText().trim();
  sayNow("Downloading data…");
  var table = GeoCsv.parse(GeoNet.fetchCsv(url));
  if (!table.rows.length) throw new Error("That link has no data rows.");
  var detection = GeoCsv.detect(table);
  dataLoaded = { url: url, table: table, detection: detection };
  fillPicker(placePicker, table.header, detection.place ? detection.place.column : null);
  fillPicker(valuePicker, valuePickerEntries(), detection.values[0]);
  var yearEntries = yearPickerEntries();
  fillPicker(yearPicker, yearEntries, detection.time.layout === "wide" ? WIDE_YEARS : (detection.time.yearColumn || NO_YEAR));
  var prepared = GeoDataset.prepare(table, currentChoice(), GeoNet.neLayer("countries", "50m"));
  showUnmatched(prepared.unmatched);
  say(table.rows.length + " rows, " + prepared.matched + " place(s) matched, " + prepared.unmatched.length + " unmatched" + (prepared.unmatched.length ? " (see list)." : "."));
});

addDataBtn.onClick = guard(function () {
  var map = currentMap(), choice = currentChoice();
  var countries = GeoNet.neLayer("countries", "50m");
  var prepared = GeoDataset.prepare(dataLoaded.table, choice, countries);
  var usedLookup = false;
  if (lookupCheck.getValue() && prepared.unmatched.length) {
    sayNow("Looking up " + prepared.unmatched.length + " place name(s) — about one per second…");
    prepared = GeoDataset.prepare(dataLoaded.table, choice, countries, GeoNet.geocodePlaces(prepared.unmatched));
    usedLookup = true;
  }
  if (!prepared.matched) throw new Error("No places matched, so nothing was added. Check the Place column.");
  var opts = { regions: regionsCheck.getValue(), bubbles: bubblesCheck.getValue(), labels: labelsCheck.getValue(), legend: legendCheck.getValue(), prefix: prefixField.getText(), suffix: suffixField.getText() };
  if (!opts.regions && !opts.bubbles && !opts.labels) throw new Error("Turn on at least one of Coloured regions, Bubbles or Value labels.");
  var source = { url: dataLoaded.url, choice: choice, scale: "50m" };
  if (usedLookup) source.lookup = true;
  var r = GeoScene.createDataLayers(map, source, prepared, opts);
  showUnmatched(prepared.unmatched);
  say("Added " + Object.keys(r.layers).length + " data layer(s) for " + prepared.matched + " place(s)." + (prepared.years ? " Animate Year " + prepared.years[0] + "–" + prepared.years[1] + "." : ""));
});

refreshDataBtn.onClick = guard(function () {
  sayNow("Refreshing data…");
  var r = GeoScene.refreshData(currentMap());
  if (!r.layers) throw new Error("This map has no data layers to refresh.");
  showUnmatched(r.unmatched);
  say("Refreshed " + r.layers + " layer(s): " + r.matched + " place(s) matched, " + r.unmatched.length + " unmatched.");
});

TAB_BUILDERS.push(function (tabs) {
  tabs.add("Data", column([
    GeoStyle.heading("Sheet"),
    row(dataLinkField, dataLoadBtn),
    GeoStyle.heading("Columns"),
    row(new ui.Label("Place"), placePicker, new ui.Label("Value"), valuePicker),
    row(new ui.Label("Year"), yearPicker),
    row(prefixField, suffixField),
    GeoStyle.heading("Show"),
    GeoStyle.toggleGrid([regionsCheck, bubblesCheck, labelsCheck, legendCheck], 2),
    row(lookupCheck, new ui.Label("Look up unmatched names as places (cities)")),
    row(addDataBtn, refreshDataBtn),
    GeoStyle.heading("Unmatched rows"),
    dataUnmatchedList
  ]));
});

// ---- Imagery tab ------------------------------------------------------------------
var imagerySettings = GeoNet.loadSettings();
// One timer drives both stages. With curl available, one background batch downloads
// everything and the timer polls it every POLL_MS. Otherwise each download blocks Cavalry
// for ~0.1-0.2 s, so they are spaced DOWNLOAD_GAP_MS apart to let the UI breathe; the build then runs
// as steps of BUILD_BUDGET_MS work every BUILD_TICK_MS. Measured in Cavalry: after every
// step that adds layers, Cavalry spends ~1.3 s refreshing (more in big scenes) however
// few layers it added, so steps of ~1 s of work keep pauses short without that fixed
// cost dominating (80 ms steps built only ~0.6 tiles/s).
var DOWNLOAD_GAP_MS = 60, POLL_MS = 250, BUILD_TICK_MS = 20, BUILD_BUDGET_MS = 1000;
var imageryState = { plan: null, timer: null, job: null, tick: null, batch: null };
var sourcePicker = new ui.DropDown();
GeoSources.list().forEach(function (s) { sourcePicker.addEntry(s.label); });
var licenceLabel = GeoStyle.note("");
var maptilerKeyField = new ui.LineEdit(); maptilerKeyField.setPlaceholder("MapTiler key (free at maptiler.com)");
var mapboxKeyField = new ui.LineEdit(); mapboxKeyField.setPlaceholder("Mapbox access token (free at mapbox.com)");
var styleField = new ui.LineEdit(); styleField.setPlaceholder("MapTiler Map ID or Mapbox style (blank = default)");
var stylePicker = new ui.DropDown();
var customUrlField = new ui.LineEdit(); customUrlField.setPlaceholder("Custom tile link with {z}, {x} and {y}");
var customAttrField = new ui.LineEdit(); customAttrField.setPlaceholder("Credit for the custom tiles");
var buildImageryBtn = GeoStyle.primaryButton("Build imagery");
var cancelImageryBtn = GeoStyle.button("Cancel");
var imageryAttrBtn = GeoStyle.button("Add attribution");
var clearTilesBtn = GeoStyle.quietButton("Clear imagery tiles");
var imageryProgress = new ui.ProgressBar();

maptilerKeyField.setText(imagerySettings.maptilerKey || "");
mapboxKeyField.setText(imagerySettings.mapboxKey || "");
styleField.setText(imagerySettings.style || "");
customUrlField.setText(imagerySettings.customUrl || "");
customAttrField.setText(imagerySettings.customAttribution || "");
(function () {
  var ids = GeoSources.list().map(function (s) { return s.id; }), i = ids.indexOf(imagerySettings.source);
  sourcePicker.setValue(i >= 0 ? i : 0);
})();

function currentSource() { return GeoSources.list()[sourcePicker.getValue()] || GeoSources.list()[0]; }
function sourceOptions(src) {
  return {
    key: src.key === "maptiler" ? maptilerKeyField.getText().trim() : src.key === "mapbox" ? mapboxKeyField.getText().trim() : "",
    style: styleField.getText().trim(),
    template: customUrlField.getText().trim(),
    customAttribution: customAttrField.getText().trim()
  };
}
function resetImageryPlan() { imageryState.plan = null; buildImageryBtn.setText("Build imagery"); disarmClearTiles(); }
// "Clear imagery tiles" sits just below Cancel; in Cavalry a mid-build Cancel click once
// landed on it and deleted every tile, so it needs a confirming second press.
var clearTilesArmed = false;
function disarmClearTiles() { clearTilesArmed = false; clearTilesBtn.setText("Clear imagery tiles"); }
// Fingerprints everything a plan depends on, so a camera edit (a keyframe moved or
// retimed, a new Fly here, a different comp size or frame range) makes the plan stale
// even when the map, source and options are unchanged.
function imageryPlanSignature(map, src, opts) {
  var camera = [];
  for (var i = 0; i < 5; i++) {
    var attr = "array." + i;
    camera.push([api.getKeyframeTimes(map.cameraId, attr), api.get(map.cameraId, attr)]);
  }
  return JSON.stringify([map.cameraId, src.id, opts, camera, GeoScene.compFrameRange(), GeoScene.compSize()]);
}
function refreshSourceUi() {
  var src = currentSource();
  licenceLabel.setText(src.licence);
  stylePicker.clear();
  (src.suggestions || []).forEach(function (s) { stylePicker.addEntry(s); });
  resetImageryPlan();
}
function saveImagerySettings() {
  GeoNet.saveSettings({ source: currentSource().id, maptilerKey: maptilerKeyField.getText().trim(), mapboxKey: mapboxKeyField.getText().trim(),
    style: styleField.getText().trim(), customUrl: customUrlField.getText().trim(), customAttribution: customAttrField.getText().trim() });
}
function stopImageryTimer() {
  if (imageryState.timer) { imageryState.timer.stop(); imageryState.timer = null; }
  imageryState.job = null;
  imageryState.tick = null;
  imageryState.batch = null;
}
function itemNoun(plan) { return plan.mode === "images" ? "images" : "tiles"; }
function ImageryTimerCallbacks() {
  this.onTimeout = function () {
    try { if (imageryState.tick) imageryState.tick(); } catch (e) {
      stopImageryTimer(); resetImageryPlan();
      say("Error: " + (e && e.message ? e.message : e));
    }
  };
}
// Points the imagery timer at a new tick function and interval, creating it if needed,
// so the download timer carries straight on as the build timer.
function runImageryTimer(intervalMs, tick) {
  imageryState.tick = tick;
  if (imageryState.timer) imageryState.timer.stop();
  else {
    imageryState.timer = new api.Timer(new ImageryTimerCallbacks());
    imageryState.timer.setRepeating(true);
  }
  imageryState.timer.setInterval(intervalMs);
  imageryState.timer.start();
}
refreshSourceUi();
sourcePicker.onValueChanged = function () { refreshSourceUi(); };
stylePicker.onValueChanged = function () {
  var s = currentSource().suggestions || [];
  if (s.length) styleField.setText(s[stylePicker.getValue()] || "");
  resetImageryPlan();
};

// Builds in timer steps so Cavalry stays responsive: the progress bar counts tiles,
// then the old imagery for this source is removed, a few layers per step.
function startImageryBuild(map, src, opts, plan, missing, failed) {
  var job = GeoScene.beginImageryBuild(map, src, opts, plan);
  imageryState.job = job; // from here on, Cancel cancels the build rather than a download
  imageryProgress.setValue(0);
  say("Building imagery…");
  runImageryTimer(BUILD_TICK_MS, function () {
    var r = job.step(BUILD_BUDGET_MS);
    imageryProgress.setMaximum(Math.max(1, r.total));
    imageryProgress.setValue(r.built);
    if (!r.done) {
      if (r.phase === "discard") say("Cancelling — removing the partly built imagery…");
      else if (r.phase === "cleanup") say("Removing the old imagery…");
      else say("Building imagery: " + r.built + " / " + r.total + " " + itemNoun(plan) + "…");
      return;
    }
    stopImageryTimer();
    resetImageryPlan();
    if (r.cancelled) { say("Cancelled — no imagery was built."); return; }
    var b = r.result;
    say("Imagery built: " + b.tiles + " " + itemNoun(plan) + " in " + b.levels + " level(s) (" + missing + " missing, " + failed + " failed)." +
      (failed ? " Press Build again to retry." : "") +
      (b.unreadable > 0 ? (plan.mode === "images" ? " " + b.unreadable + " image(s) couldn't be read by Cavalry and were skipped."
        : " " + b.unreadable + " tiles couldn't be read by Cavalry (palette PNGs) — choose a JPG style or link.") : "") +
      " Credit: " + GeoSources.attribution(src, opts));
  });
}

// 401/403: a keyed source rejected the key; a source without one turned the request down.
function refusedMessage(src, code) {
  return src.key ? GeoSources.providerName(src) + " rejected your key — check it in the Imagery tab."
    : GeoSources.providerName(src) + " refused the request (HTTP " + code + ") — try again later or choose another source.";
}

function startImageryDownload(map, src, opts, plan) {
  var total = plan.missing.length;
  imageryProgress.setMaximum(Math.max(1, total));
  imageryProgress.setValue(0);
  if (!total) { startImageryBuild(map, src, opts, plan, 0, 0); return; }
  var jobs = plan.missing.map(function (r) {
    var url = GeoScene.itemUrl(src, opts, plan, r), ext = plan.mode === "images" ? "jpg" : GeoSources.extForUrl(url);
    return { rect: r, url: url, base: GeoScene.itemBase(plan, r), path: ext ? GeoScene.itemBase(plan, r) + "." + ext : null };
  });
  // Background curl needs the file type up front; links without one (some Mapbox styles,
  // custom links) use the one-at-a-time download that reads the Content-Type.
  if (GeoFetch.available() && jobs.every(function (j) { return j.path; })) startBackgroundDownload(map, src, opts, plan, jobs);
  else startBlockingDownload(map, src, opts, plan, jobs);
}

function startBackgroundDownload(map, src, opts, plan, jobs) {
  var noun = itemNoun(plan), byPath = {}, missing = 0, failed = 0, seen = 0, unreached = 0;
  jobs.forEach(function (j) { byPath[j.path] = j; });
  var batch = GeoFetch.start(jobs.map(function (j) { return { url: j.url, path: j.path }; }));
  imageryState.batch = batch;
  say("Downloading " + noun + ": 0 / " + jobs.length + "…");
  runImageryTimer(POLL_MS, function () {
    var r = GeoFetch.poll(batch), refused = 0;
    // Every result of this poll is handled (bad files deleted) before a 401/403 stops the
    // stage: finish() takes all of them off the in-flight list.
    for (var i = 0; i < r.results.length; i++) {
      var res = r.results[i], j = byPath[res.path];
      seen++;
      if (res.status === 0) unreached++;
      if (res.ok) continue;
      // Anything but a whole JPEG/PNG (a broken-off transfer, an error page) is deleted,
      // so the next plan lists it as missing instead of building from it.
      GeoFetch.discard(res.path);
      if (res.status === 401 || res.status === 403) { refused = refused || res.status; failed++; }
      else if (res.status === 404 || res.status === 204) { GeoNet.markEmptyTile(j.base); missing++; }
      else failed++;
    }
    if (refused) {
      GeoFetch.finish(batch); // reported files leave the in-flight list; the rest stay until curl reports them
      stopImageryTimer(); resetImageryPlan();
      say(refusedMessage(src, refused));
      return;
    }
    imageryProgress.setValue(r.count);
    say("Downloading " + noun + ": " + r.count + " / " + jobs.length + "…");
    // No line at all after FIRST_LINE_MS, or nothing but 000 (no connection made): curl
    // isn't working here, so the rest of the session downloads one file at a time.
    if (r.silent || ((r.done || r.stalled) && seen > 0 && unreached === seen)) {
      GeoFetch.disable();
      GeoFetch.abandon(batch);
      stopImageryTimer(); resetImageryPlan();
      say("Background downloads aren't working on this computer — press Build imagery to plan again with map tiles.");
      return;
    }
    if (r.done || r.stalled) {
      if (!r.done) failed += jobs.length - r.count;
      GeoFetch.finish(batch);
      imageryState.batch = null;
      startImageryBuild(map, src, opts, plan, missing, failed);
    }
  });
}

// One download per timer tick, each blocking Cavalry briefly; reads the Content-Type.
function startBlockingDownload(map, src, opts, plan, jobs) {
  var noun = itemNoun(plan), queue = jobs.slice(), total = queue.length, done = 0, missing = 0, failed = 0;
  runImageryTimer(DOWNLOAD_GAP_MS, function () {
    var j = queue.shift();
    var r = GeoNet.downloadTile(j.url, j.base);
    if (r.status === 401 || r.status === 403) {
      stopImageryTimer(); resetImageryPlan();
      say(refusedMessage(src, r.status));
      return;
    }
    if (r.unsupported) {
      stopImageryTimer(); resetImageryPlan();
      say("Cavalry can't load this image type (" + r.unsupported + ") — choose a PNG or JPG style or link.");
      return;
    }
    if (r.status === 404 || r.status === 204) { GeoNet.markEmptyTile(j.base); missing++; }
    else if (r.status !== 200) failed++;
    // A whole file now: no earlier background batch's claim on it may keep it out of the build.
    if (r.path) GeoFetch.release([r.path]);
    done++;
    imageryProgress.setValue(done);
    say("Downloading " + noun + ": " + done + " / " + total + "…");
    if (!queue.length) startImageryBuild(map, src, opts, plan, missing, failed);
  });
}

// Cavalry's question dialog, or null in an older Cavalry without one (Build imagery then
// falls back to a second press to confirm the download).
function questionDialog() {
  try {
    var m = typeof ui.Modal === "function" ? new ui.Modal() : null;
    return m && typeof m.showQuestion === "function" ? m : null;
  } catch (e) { return null; }
}

// One press plans, then downloads and builds: straight away when everything is already
// downloaded, otherwise after a Yes in a dialog showing the plan. Without the dialog the
// button relabels ("Download N tiles") and a second press confirms.
buildImageryBtn.onClick = guard(function () {
  disarmClearTiles();
  if (imageryState.timer) throw new Error(imageryState.job ? "Imagery is already being built — press Cancel to stop." : "Imagery is already downloading — press Cancel to stop.");
  var map = currentMap(), src = currentSource(), opts = sourceOptions(src);
  saveImagerySettings();
  var sig = imageryPlanSignature(map, src, opts), dialog = questionDialog();
  if (dialog || !imageryState.plan || imageryState.plan.sig !== sig) {
    resetImageryPlan();
    imageryProgress.setValue(0); // don't keep showing the last build's 100% for a new plan
    sayNow("Checking the camera animation…");
    var plan = GeoScene.planImagery(map, src, opts);
    plan.sig = sig;
    imageryState.plan = plan;
    var noun = itemNoun(plan), n = plan.items.length, missing = plan.missing.length;
    var label = (missing ? "Download " + missing : "Build " + n) + " " + noun;
    var warn = plan.mode === "images" ? n > GeoBlocks.WARN_IMAGES : n > GeoTiles.WARN_TILES;
    // Name the limit that forced the cap (image count or tiles' worth of pixels).
    var limit = plan.mode !== "images" ? GeoTiles.MAX_TILES + " tiles"
      : plan.uncappedItems > GeoBlocks.MAX_IMAGES ? GeoBlocks.MAX_IMAGES + " images" : GeoBlocks.MAX_IMAGE_TILES + " tiles' worth";
    var summary = n + " " + noun + " needed (" + (plan.mode === "images" ? plan.imageTiles + " tiles' worth, " : "") + plan.cached +
      " already downloaded, about " + GeoUtil.formatBytes(GeoBlocks.totalTiles(plan.missing) * 15000) + " to download)" +
      (warn ? " — this may make Cavalry slower" : "") + ".";
    var capNote = plan.cappedZoom !== undefined ? " Sharpest detail is limited to zoom " + plan.cappedZoom + " to stay under " + limit +
      " — imagery gets softer as the flight zooms in further." : "";
    if (!dialog) {
      buildImageryBtn.setText(label);
      say(summary + " Press \"" + label + "\"." + capNote);
      return;
    }
    if (missing) sayNow(summary + capNote); // the plan, not "Checking…", behind the dialog
    if (missing && !dialog.showQuestion("Build imagery", summary + capNote + "\n\nDownload and build now?")) {
      resetImageryPlan();
      say("Nothing downloaded.");
      return;
    }
  }
  startImageryDownload(map, src, opts, imageryState.plan);
});

cancelImageryBtn.onClick = guard(function () {
  disarmClearTiles();
  // During the build the timer keeps running: the job deletes the partly built imagery
  // in steps (or, once the new imagery is complete, finishes removing the old one).
  if (imageryState.job) {
    say(imageryState.job.cancel() ? "Cancelling — removing the partly built imagery…" : "The new imagery is already built — finishing removing the old imagery…");
    return;
  }
  if (!imageryState.timer) throw new Error("Nothing is downloading or building.");
  // The background curl can't be stopped: its files stay on the in-flight list (no
  // GeoFetch.finish) so the next plan treats them as missing until a batch reports them.
  if (imageryState.batch) {
    stopImageryTimer(); resetImageryPlan();
    say("Download cancelled. Files still downloading in the background are kept; nothing was built.");
    return;
  }
  stopImageryTimer();
  resetImageryPlan();
  say("Download cancelled. Downloaded tiles are kept; nothing was built.");
});

imageryAttrBtn.onClick = guard(function () {
  disarmClearTiles();
  var src = currentSource(), text = GeoSources.attribution(src, sourceOptions(src));
  if (!text) throw new Error("Type a credit for the custom tiles first.");
  GeoScene.createImageryCredit(currentMap(), text);
  say("Added the imagery credit: " + text);
});

clearTilesBtn.onClick = guard(function () {
  if (imageryState.timer) {
    disarmClearTiles();
    throw new Error("Imagery tiles can't be cleared while imagery is downloading or building — wait, or press Cancel first.");
  }
  if (!clearTilesArmed) {
    clearTilesArmed = true;
    clearTilesBtn.setText("Confirm: clear imagery tiles");
    say("This deletes every downloaded imagery tile, and imagery already built from them will show missing images until you rebuild. Press \"Confirm: clear imagery tiles\" to delete them.");
    return;
  }
  disarmClearTiles();
  var r = GeoNet.clearTiles();
  say("Imagery tiles cleared: " + r.files + " file(s), " + GeoUtil.formatBytes(r.bytes) + " freed. Imagery already built from them will show missing images until you rebuild.");
  resetImageryPlan();
});

TAB_BUILDERS.push(function (tabs) {
  tabs.add("Imagery", column([
    GeoStyle.heading("Source"),
    sourcePicker,
    licenceLabel,
    row(new ui.Label("MapTiler key"), maptilerKeyField),
    row(new ui.Label("Mapbox token"), mapboxKeyField),
    row(new ui.Label("Map ID / style"), styleField, stylePicker),
    row(new ui.Label("Custom link"), customUrlField),
    row(new ui.Label("Custom credit"), customAttrField),
    GeoStyle.heading("Build"),
    row(buildImageryBtn, cancelImageryBtn),
    imageryProgress,
    imageryAttrBtn,
    clearTilesBtn
  ]));
});

// ---- Other tabs are appended above this line by later tasks ---------------

// Sections: one tab bar above one page per section. Builders register (name, layout);
// SECTION_ORDER sets the order (unlisted ones go last). The old section names still work in
// showSection: Extract lives in Layers, Pins and Routes in Label.
var SECTION_ORDER = ["Map", "Layers", "Imagery", "Label", "Data"];
var SECTION_ALIASES = { Extract: ["Layers"], Pins: ["Label", "Pins"], Routes: ["Label", "Routes"] };
var sectionNames = [], sectionTabs = null, sectionPages = null;
function showSection(name) {
  var target = SECTION_ALIASES[name] || [name], i = sectionNames.indexOf(target[0]);
  if (i < 0) return;
  sectionTabs.select(target[0]);
  sectionPages.setPage(i);
  if (target[1]) showLabelPage(target[1]);
}

function buildUi() {
  ui.setTitle("Cavalry Geo");
  var layouts = {}, extra = [];
  TAB_BUILDERS.forEach(function (build) {
    build({ add: function (name, layout) {
      layouts[name] = layout;
      if (SECTION_ORDER.indexOf(name) < 0) extra.push(name);
    } });
  });
  sectionNames = SECTION_ORDER.filter(function (n) { return layouts[n]; }).concat(extra);
  sectionPages = GeoStyle.pageStack();
  sectionNames.forEach(function (name) { sectionPages.add(layouts[name]); });
  sectionTabs = GeoStyle.tabBar(sectionNames, function (name) { showSection(name); });
  showSection(sectionNames[0]);
  var root = new ui.VLayout();
  root.setMargins(4, 4, 4, 4);
  root.add(sectionTabs.widget);
  root.add(sectionPages.widget);
  // The stretch keeps the status line at the bottom when the page is shorter than the window.
  if (typeof root.addStretch === "function") root.addStretch();
  root.add(statusLabel);
  ui.add(root);
  ui.show();
  // The preview follows the panel's width (Cavalry's Draw doesn't stretch by itself).
  function fitPreview() {
    try { var g = sectionTabs.widget.geometry(); if (g && g.width > 50) preview.setWidth(g.width); } catch (e) { /* older Cavalry */ }
  }
  ui.onResize = fitPreview;
  fitPreview();
  guard(function () { refreshMaps(); })();
  guard(function () { previewFollowPicked(); previewShowMap(); })();
  try { GeoUpdateCheck.run(say); } catch (e) { /* the update check never gets in the way */ }
}
buildUi();

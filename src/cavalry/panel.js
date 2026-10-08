// Cavalry Geo panel. Sections ("tabs") register themselves in TAB_BUILDERS; buildUi() runs last.
var PROJECTIONS = ["Web Mercator (streets, cities)", "Equal Earth (world)", "Orthographic (globe)"];
var WORLD_VIEW = { west: -180, east: 180, south: -60, north: 75 };
var TAB_BUILDERS = [];

var statusLabel = new ui.Label("Ready.");
function say(msg) { statusLabel.setText(msg); console.log("[CavalryGeo] " + msg); }
// Like say(), right before something slow. It no longer calls api.processEvents to repaint the label:
// that let Cavalry run the user's other clicks inside the running action, which hung Cavalry.
function sayNow(msg) { say(msg); }
// Wraps a panel action. Afterwards (also after an error): Cavalry expands Scene Window groups to
// reveal selected nested layers and no API collapses them, so a selection that now holds a nested
// layer is put back to what it was (a top-level selection made on purpose stays); then the
// viewport is nudged to redraw, which fixes the occasional black viewport after a click.
function currentSelection() {
  try { return typeof api.getSelection === "function" ? (api.getSelection() || []).slice() : null; } catch (e) { return null; }
}
function sameIds(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function keepGroupsCollapsed(before) {
  if (before === null || typeof api.getParent !== "function" || typeof api.select !== "function") return;
  try {
    var after = currentSelection();
    if (after === null || sameIds(before, after)) return;
    var nested = false;
    for (var i = 0; i < after.length; i++) {
      try { if (String(api.getParent(after[i])) !== "") { nested = true; break; } } catch (e) { /* not a layer with a parent */ }
    }
    if (nested) {
      // Layers the action deleted (a Bake) can't be selected again: keep the ones that are left, or nothing.
      var keep = before.filter(function (id) { try { return typeof api.layerExists !== "function" || api.layerExists(id); } catch (e) { return false; } });
      api.select(keep);
    }
  } catch (e) { /* cosmetic */ }
}
function nudgeRedraw() {
  try { if (typeof api.setFrame === "function" && typeof api.getFrame === "function") api.setFrame(api.getFrame()); } catch (e) { /* cosmetic */ }
}
// Wraps a handler that is not a button click (pickers, text commits, preview clicks, start-up): errors go
// to the status line, nothing else is touched.
function guard(fn) {
  return function () {
    try { fn(); } catch (e) { say("Error: " + (e && e.message ? e.message : e)); }
  };
}
// One action at a time: a button, an Enter that starts work or a preview click can pump Cavalry's events
// (sayNow, the network waits), so a second press could otherwise run nested inside the first.
var busy = false;
// While a long action runs Cavalry is frozen and keeps the user's clicks; it delivers them all as soon as
// the action ends, after the flag has cleared. So after an action that took a while, clicks arriving in
// the next moment are those held-back ones and are dropped (quietly, keeping the action's message).
var SETTLE_AFTER_MS = 300, SETTLE_MIN_MS = 1500, settleUntil = 0;
function refuseIfBusy() {
  if (busy) { say("Still working on the last action…"); return true; }
  return Date.now() < settleUntil;
}
// Runs fn as the one current action; afterwards opens the settle window when it was a long one.
function runAsAction(fn) {
  var started = Date.now();
  busy = true;
  try { fn(); } finally {
    busy = false;
    var ended = Date.now();
    // Cavalry often freezes again just after (drawing what the action made), for about as long again.
    if (ended - started >= SETTLE_AFTER_MS) settleUntil = ended + Math.max(SETTLE_MIN_MS, ended - started);
  }
}
// guard() for a commit (Enter) that starts work: refused while another action runs; the flag clears in a finally.
function guardWork(fn) {
  return function () {
    if (refuseIfBusy()) return;
    runAsAction(guard(fn));
  };
}
// Wraps a button's click: guardWork() plus the selection restore and the redraw nudge. With keepSelection the
// restore is skipped (an action that selects something on purpose, like a new callout's label). With
// allowNested (Cancel) the click runs even while another action is busy, and leaves the flag alone.
function guardAction(fn, keepSelection, allowNested) {
  return function () {
    if (!allowNested && refuseIfBusy()) return;
    var before = keepSelection ? null : currentSelection();
    var run = function () { try { fn(); } catch (e) { say("Error: " + (e && e.message ? e.message : e)); } };
    if (allowNested) run(); else runAsAction(run);
    keepGroupsCollapsed(before);
    nudgeRedraw();
  };
}
// Brings the map's Controls component up to date after an action changed the map. Never
// throws (the action already happened): returns "" or a note to add to the status line.
// With `select` (a map just made), the Controls component is selected afterwards so the
// Attribute Editor opens on it.
function syncControls(map, select) {
  try {
    var r = GeoControlPanel.sync(map); // also keeps the furniture's comp size in step
    if (select && r && r.componentId && typeof api.select === "function") {
      try { api.select([r.componentId]); } catch (e) { /* cosmetic */ }
    }
    try { refreshPreviews(); } catch (e) { /* cosmetic */ }
    return "";
  } catch (e) {
    try { GeoScene.fitFurniture(map); } catch (e3) { /* cosmetic */ }
    try { refreshPreviews(); } catch (e2) { /* cosmetic */ }
    return " Its controls couldn't be updated: " + (e && e.message ? e.message : e) + ". Press Refresh controls (Map tab) to try again.";
  }
}
function column(items) {
  var v = new ui.VLayout();
  v.setMargins(0, 6, 0, 0); // flush left and right: everything shares one left edge
  if (typeof v.setSpaceBetween === "function") v.setSpaceBetween(4);
  // A heading sits close to what it introduces (4 px below) and further from what came before (about 8 px above).
  var panelSeen = false;
  items.forEach(function (w, i) {
    if (i > 0 && GeoStyle.isHeading(w) && typeof v.addSpacing === "function") v.addSpacing(4);
    // 5 px between panels (4 + 1); never above the first one (the Map tab's hidden Start here tips come before it).
    if (GeoStyle.isPanel(w)) { if (panelSeen && typeof v.addSpacing === "function") v.addSpacing(1); panelSeen = true; }
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
var cameraPanel = null; // the Camera panel, hidden whole while New map is picked
var mapPicker = new ui.DropDown();
var refreshMapsBtn = GeoStyle.button("Refresh");
var nameField = new ui.LineEdit(); nameField.setPlaceholder("Map name (blank = the place's name, or Map 1, Map 2…)");
var projPicker = new ui.DropDown(); PROJECTIONS.forEach(function (p) { projPicker.addEntry(p); });
var searchField = new ui.LineEdit(); searchField.setPlaceholder("Search a place, e.g. Notre-Dame, Paris");
var searchBtn = GeoStyle.primaryButton("Search");
var resultPicker = new ui.DropDown();
var jumpBtn = GeoStyle.button("Jump here");
// Fly here runs from Start to End (frames). Both open on the playhead and 100 frames on, and move
// on after each flight so the next one chains from where this one ended.
function playhead() {
  try { var f = Number(api.getFrame()); return isFinite(f) ? Math.round(f) : 0; } catch (e) { return 0; }
}
var flyStartField = new ui.NumericField(playhead());
var flyEndField = new ui.NumericField(playhead() + 100);
[flyStartField, flyEndField].forEach(function (f) {
  f.setType(0); f.setMin(0);
  if (typeof f.setFixedWidth === "function") f.setFixedWidth(48); // number-sized, so the whole Fly row fits
});
var flyBtn = GeoStyle.primaryButton("Fly here");
var flyNote = GeoStyle.note("(animates the camera to the preview's green frame)");
// Camera feel: how a flight eases, how far it zooms out on the way, a button to redo the flight
// under the playhead with new choices, and Drift (a small move from the current view, From to To).
var easingLabel = GeoStyle.fieldLabel("Easing");
var easingPicker = new ui.DropDown();
var arcLabel = GeoStyle.fieldLabel("Zoom-out");
var arcPicker = new ui.DropDown();
var updateFlightBtn = GeoStyle.button("Update flight");
var driftLabel = GeoStyle.fieldLabel("Drift move");
var driftPicker = new ui.DropDown();
var driftBtn = GeoStyle.button("Drift");
GeoFly.EASINGS.forEach(function (e) { easingPicker.addEntry(e.name); });
GeoFly.ARCS.forEach(function (a) { arcPicker.addEntry(a.name); });
GeoFly.DRIFTS.forEach(function (d) { driftPicker.addEntry(d.name); });
function indexOfId(list, id, fallback) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return fallback;
}
(function () { // Smooth / Normal / Push in unless settings.json remembers other choices.
  var s = {};
  try { s = GeoNet.loadSettings() || {}; } catch (e) { s = {}; }
  easingPicker.setValue(indexOfId(GeoFly.EASINGS, s.flyEasing, 0));
  arcPicker.setValue(indexOfId(GeoFly.ARCS, s.flyArc, 1));
  driftPicker.setValue(indexOfId(GeoFly.DRIFTS, s.driftMove, 0));
})();
function pickedEasing() { return GeoFly.EASINGS[easingPicker.getValue()] || GeoFly.EASINGS[0]; }
function pickedArc() { return GeoFly.ARCS[arcPicker.getValue()] || GeoFly.ARCS[1]; }
function pickedDrift() { return GeoFly.DRIFTS[driftPicker.getValue()] || GeoFly.DRIFTS[0]; }
easingPicker.onValueChanged = guard(function () { GeoNet.updateSettings({ flyEasing: pickedEasing().id }); });
arcPicker.onValueChanged = guard(function () { GeoNet.updateSettings({ flyArc: pickedArc().id }); });
driftPicker.onValueChanged = guard(function () { GeoNet.updateSettings({ driftMove: pickedDrift().id }); });

// Search and Fly here share one width.
var MAP_ACTION_WIDTH = 84;
if (typeof searchBtn.setFixedWidth === "function") searchBtn.setFixedWidth(MAP_ACTION_WIDTH);
if (typeof flyBtn.setFixedWidth === "function") flyBtn.setFixedWidth(MAP_ACTION_WIDTH);

// The preview: settled by probing Cavalry (2026-10).
var PREVIEW_Y_UP = true, PREVIEW_DIM = true, PREVIEW_REDRAW = "timer";
var fromLabel = new ui.Label("From:");
var toLabel = new ui.Label("To:");
var flyStartBox = GeoStyle.frameField(flyStartField);
var flyEndBox = GeoStyle.frameField(flyEndField);
var createHereBtn = GeoStyle.primaryButton("Create map here");
// Map styles: picked here for the next new map, applied to the picked map, saved from it.
// settings.json keeps the picked name ("mapStyle") and the saved styles ("mapStyles"); the
// imagery settings already own "style". (GeoStyle = the panel's widget kit; GeoStyles = map colour styles.)
var mapStylePicker = new ui.DropDown();
var applyStyleBtn = GeoStyle.button("Apply to map");
var styleNameField = new ui.LineEdit(); styleNameField.setPlaceholder("Name for a new style");
var saveStyleBtn = GeoStyle.button("Save as style");
var deleteStyleBtn = GeoStyle.quietButton("Delete style");
var savedStyles = [];
function styleList() { return GeoStyles.BUILT_IN.concat(savedStyles); }
function pickedStyle() { return styleList()[mapStylePicker.getValue()] || GeoStyles.DARK; }
// Lists the built-ins then the saved styles and picks `name` (Dark when it isn't listed).
// Programmatic changes to the picker must not count as the user picking: refreshingStyles
// makes onValueChanged ignore them.
var refreshingStyles = false;
function refreshStylePicker(name) {
  var list = styleList(), sel = 0;
  refreshingStyles = true;
  try {
    mapStylePicker.clear();
    list.forEach(function (s, i) {
      mapStylePicker.addEntry(s.name);
      if (typeof name === "string" && s.name.toLowerCase() === name.trim().toLowerCase()) sel = i;
    });
    mapStylePicker.setValue(sel);
  } finally { refreshingStyles = false; }
}
function previewStyle() { setPreviewColors(GeoStyles.previewColors(pickedStyle())); }
function setPreviewColors(colors) {
  [preview, pinsPreview, routesPreview].forEach(function (p) { if (p && p.available()) p.setColors(colors); });
}
// The previews take the picked map's own colours (ocean, land, borders as they are on the canvas);
// with "New map" picked, or when they can't be read, the Style picker's colours.
function previewMapColors() {
  var colors = null;
  if (!newMapSelected()) {
    try { colors = GeoStyles.previewColors(GeoScene.readMapStyle(maps[mapPicker.getValue()], "On the canvas")); } catch (e) { colors = null; }
  }
  if (colors && colors.water && colors.land && colors.border) setPreviewColors(colors); else previewStyle();
}
(function () {
  var s = {};
  try { s = GeoNet.loadSettings() || {}; } catch (e) { s = {}; }
  savedStyles = GeoStyles.normalise(s.mapStyles);
  refreshStylePicker(s.mapStyle);
})();
var preview = GeoPreviewPanel.create({
  compSize: function () { return GeoScene.compSize(); },
  onPick: function (i) { if (i < 0 || i >= results.length) return; resultPicker.setValue(i + 1); previewFollowPicked(); },
  // Hide Create map here as soon as the preview fails (it may fail while the panel is being built).
  onFail: function () { if (preview) refreshNewMapFields(); },
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
  var labelOnes = [pinsPreview, routesPreview].filter(function (p) { return p && p.available(); });
  if (newMapSelected()) {
    previewStyle();
    if (preview.available()) preview.setCurrentCamera(null);
    labelOnes.forEach(function (p) { p.setCurrentCamera(null); p.showCamera(worldViewCamera(0), "world"); });
    refreshPreviews();
    return;
  }
  var cam = GeoScene.readCamera(maps[mapPicker.getValue()].cameraId);
  previewMapColors();
  if (preview.available()) { preview.setCurrentCamera(cam); preview.showCamera(cam, "camera"); }
  labelOnes.forEach(function (p) { p.setCurrentCamera(cam); p.showCamera(cam, "camera"); });
  refreshPreviews();
}
// After Jump or Fly: the dashed frame shows where the camera is now; the view stays put.
function previewShowCurrent() {
  if (newMapSelected()) return;
  var cam = GeoScene.readCamera(currentMap().cameraId);
  [preview, pinsPreview, routesPreview].forEach(function (p) { if (p && p.available()) p.setCurrentCamera(cam); });
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
  // The Camera panel goes as a whole, so no empty shaded box with only its heading is left; its
  // widgets are hidden too, which is all that happens when the panel can't be hidden itself.
  if (cameraPanel && typeof cameraPanel.setHidden === "function") cameraPanel.setHidden(show);
  [jumpBtn, fromLabel, flyStartBox, flyStartField, toLabel, flyEndBox, flyEndField, flyBtn, flyNote, easingLabel, easingPicker, arcLabel, arcPicker, updateFlightBtn, driftLabel, driftPicker, driftBtn].forEach(function (w) { if (typeof w.setHidden === "function") w.setHidden(show); });
  // With the preview gone there is no frame to make a map from; Search still does it.
  if (typeof createHereBtn.setHidden === "function") createHereBtn.setHidden(!show || !preview.available());
  [applyStyleBtn, saveStyleBtn].forEach(function (w) { if (typeof w.setHidden === "function") w.setHidden(show); });
}
function currentMap() {
  if (newMapSelected()) throw new Error("Pick a map, or search for a place first — that creates the map (Map tab).");
  return maps[mapPicker.getValue()];
}
// Makes a map and selects it in the Map picker.
function makeMap(name, cam) {
  var map = GeoScene.createMap(name, cam, pickedStyle());
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
// "Map 1", "Map 2"... the lowest number not already used by a map. Existing maps are never renamed.
function numberedMapName() {
  var taken = {};
  GeoScene.findMaps().forEach(function (m) { taken[m.name] = true; });
  for (var n = 1; ; n++) { if (!taken["Map " + n]) return "Map " + n; }
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
// Where Jump here and Fly here go: the preview's green frame. While the preview follows the
// picked result or the world view, the frame is on that place, so use its camera and name.
// Without the preview: the picked place, or the world view for entry 0.
function pickedTarget(projection) {
  var src = preview.source();
  if (preview.available() && src !== "result" && src !== "world") {
    var f = preview.frameCamera();
    return { cam: { lat: f.lat, lon: f.lon, zoom: f.zoom, rotation: 0, projection: projection }, name: "the preview frame" };
  }
  if (resultPicker.getValue() > 0) {
    var r = selectedResult();
    return { cam: camForResult(r, projection), name: shortName(r) };
  }
  return { cam: worldViewCamera(projection), name: "the world view", world: true };
}

refreshResultPicker();
resultPicker.onValueChanged = guard(function () { previewFollowPicked(); });

refreshMapsBtn.onClick = guardAction(function () { refreshMaps(); say(maps.length + " map(s) in this composition."); });

// The query the Map box last searched: pressing Enter again, or Search after Enter, doesn't ask the network twice.
var lastMapQuery = null;
// A search that fails on Enter would fire again as the box loses focus a moment later, and net.js would answer
// "Please wait a second" in place of the real error: the same text tried within this time is skipped.
var SEARCH_RETRY_MS = 1500;
function recentlyTried(memo, q) {
  var now = Date.now();
  if (memo.tried === q && now - memo.triedAt < SEARCH_RETRY_MS) return true;
  memo.tried = q;
  memo.triedAt = now;
  return false;
}
var mapTry = { tried: null, triedAt: 0 };
function mapSearchResults(q) {
  results = GeoNet.search(q);
  lastMapQuery = q;
  refreshResultPicker();
  previewFollowPicked(); // clears old dots when nothing was found
  if (!results.length) return results;
  resultPicker.setValue(1);
  previewFollowPicked();
  prefillPins(q, results);
  return results;
}

// Return (or leaving the box) lists the results, but never makes a map: that stays with Search.
searchField.onValueCommitted = guardWork(function () {
  var q = searchField.getText().trim();
  if (!q || q === lastMapQuery || recentlyTried(mapTry, q)) return;
  var creating = newMapSelected();
  mapSearchResults(q);
  if (!results.length) { say("No results for \"" + q + "\"."); return; }
  say(results.length + (creating ? " result(s). Press Search to make the map at the first one." : " result(s). Pick one, then Jump here or Fly here."));
});

searchBtn.onClick = guardAction(function () {
  var q = searchField.getText().trim();
  if (!q) throw new Error("Type a place to search for.");
  var creating = newMapSelected();
  if (q === lastMapQuery && results.length) {
    // Same text as the last search (often an Enter just now): use those results and keep the one picked.
    if (resultPicker.getValue() < 1) resultPicker.setValue(1);
    previewFollowPicked();
  } else {
    mapSearchResults(q);
  }
  if (!results.length) { say("No results for \"" + q + "\"."); return; }
  if (!creating) { say(results.length + " result(s). Pick one, then Jump here or Fly here."); return; }
  var r = results[Math.max(resultPicker.getValue(), 1) - 1], name = uniqueMapName(nameField.getText().trim() || shortName(r));
  var made = makeMap(name, camForResult(r, projPicker.getValue()));
  var starter = addStarterLayers(made);
  var note = syncControls(made, true);
  say("Created map \"" + name + "\" " + (starter === true ? "with countries and coastlines, " : "") + "centred on " + shortName(r) + ". " + results.length + " result(s): pick one, then Jump here or Fly here." + starterNote(starter) + note);
});

jumpBtn.onClick = guardAction(function () {
  var map = currentMap(), t = pickedTarget(GeoScene.readCamera(map.cameraId).projection);
  GeoScene.setCamera(map.cameraId, { lat: t.cam.lat, lon: t.cam.lon, zoom: t.cam.zoom });
  say("Camera jumped to " + t.name + (t.world ? "" : " (zoom " + t.cam.zoom.toFixed(1) + ")") + ".");
  previewShowCurrent();
});

// Fly here and Drift share their checks: Start / End, the composition's first and last frame, and
// the Yes / No question before the composition is lengthened. Everything is checked (and a longer
// composition asked for) before anything changes.
function planMove(noun) {
  var map = currentMap(), from = Math.round(Number(flyStartField.getValue())), to = Math.round(Number(flyEndField.getValue()));
  if (!(to >= from + 1)) throw new Error("Set End at least 1 frame after Start (a " + noun + " needs 2 frames or more).");
  var comp = GeoScene.compFrameRange();
  if (from < comp.start) throw new Error("Start is before the composition's first frame (" + comp.start + ").");
  return { map: map, from: from, to: to, comp: comp };
}
// A composition extended for a move gets this many seconds after the move, so playback doesn't hit
// the end and snap back to the start.
var EXTEND_PAD_SECONDS = 3;
function extendPadFrames() {
  var fps = 25;
  try { var f = Number(api.get(api.getActiveComp(), "fps")); if (f > 0) fps = f; } catch (e) {}
  return Math.round(fps * EXTEND_PAD_SECONDS);
}
// The new end frame when extended, false = no need, null = the user said No (already told).
function extendForMove(plan, noun, button) {
  if (plan.to <= plan.comp.end) return false;
  var dialog = questionDialog();
  if (!dialog) throw new Error("End is after your composition's last frame (" + plan.comp.end + "). Set End to " + plan.comp.end + " or earlier, or lengthen the composition first.");
  var newEnd = plan.to + extendPadFrames();
  if (!dialog.showQuestion("Extend the timeline", "This " + noun + " ends at frame " + plan.to + ", after your composition's last frame (" + plan.comp.end +
    "). " + button + " will extend the composition, and the layers that reach its end, to frame " + newEnd + " (" + EXTEND_PAD_SECONDS + " seconds after the " + noun + " ends). Continue?")) {
    say("Cancelled. Set End to " + plan.comp.end + " or earlier to stay within your composition.");
    return null;
  }
  return GeoScene.extendComp(newEnd) ? newEnd : false;
}
function moveFieldsOn(plan) {
  flyStartField.setValue(plan.to);
  flyEndField.setValue(plan.to + (plan.to - plan.from));
}
function viewOf(c) { return { lat: c.lat, lon: c.lon, zoom: c.zoom }; }

// Flies from the Start frame to the End frame; the flight leaves from the camera as it is at Start.
flyBtn.onClick = guardAction(function () {
  var plan = planMove("flight"), map = plan.map, from = plan.from, to = plan.to;
  var t = pickedTarget(GeoScene.readCamera(map.cameraId).projection), s = GeoScene.compSize();
  var extended = extendForMove(plan, "flight", "Fly here");
  if (extended === null) return;
  var easing = pickedEasing(), arc = pickedArc(), previous = api.getFrame(), range, begin;
  try {
    api.setFrame(from);
    begin = GeoScene.readCamera(map.cameraId);
    var pts = GeoFly.path(begin, t.cam, to - from + 1, s.width, { easing: easing.id, arc: arc.id });
    range = GeoScene.flyCamera(map, pts, from);
  } finally { api.setFrame(previous); }
  GeoScene.recordFlight(map, { kind: "flight", start: from, end: to, from: viewOf(begin), to: viewOf(t.cam), name: t.name, easing: easing.id, arc: arc.id });
  var msg = "Flight to " + t.name + ": frames " + range.start + "–" + range.end + ".";
  if (extended) msg += " The composition was extended to frame " + extended + " (" + EXTEND_PAD_SECONDS + " seconds after the flight ends).";
  if (t.world) msg += " Flying to the world view — to fly somewhere else, search for a place and pick it first.";
  msg += " Press Build imagery (Imagery tab) for sharp imagery along the way.";
  moveFieldsOn(plan);
  say(msg);
  resetImageryPlan();
  previewShowCurrent();
});

// Redoes the flight under the playhead with the current Easing and Zoom-out, keeping its frames
// and destination. It leaves from where the flight began (read before its keys are rewritten).
updateFlightBtn.onClick = guardAction(function () {
  var map = currentMap(), cr = GeoScene.compFrameRange(), rec = GeoScene.flightAt(map, Math.max(cr.start, Math.min(cr.end, playhead())));
  if (!rec) throw new Error("Put the playhead inside a flight made with Fly here first.");
  if (rec.kind === "drift") throw new Error("That's a drift — choose a move and press Drift to redo it.");
  var easing = pickedEasing(), arc = pickedArc(), begin = GeoScene.flightStart(map, rec);
  var pts = GeoFly.path(begin, rec.to, rec.end - rec.start + 1, GeoScene.compSize().width, { easing: easing.id, arc: arc.id });
  var range = GeoScene.flyCamera(map, pts, rec.start);
  GeoScene.recordFlight(map, { kind: "flight", start: rec.start, end: rec.end, from: rec.from, to: rec.to, name: rec.name, easing: easing.id, arc: arc.id });
  say("Flight to " + (rec.name || "the destination") + " (frames " + range.start + "–" + range.end + ") updated: " + easing.name + ", " + arc.name + " zoom-out.");
  resetImageryPlan();
  previewShowCurrent();
});

// A small move from the camera as it is at Start, over Start to End: push in, pull out or pan.
driftBtn.onClick = guardAction(function () {
  var plan = planMove("drift"), map = plan.map, from = plan.from, to = plan.to, s = GeoScene.compSize();
  var extended = extendForMove(plan, "drift", "Drift");
  if (extended === null) return;
  var move = pickedDrift(), begin = viewOf(GeoScene.readCameraAt(map, from));
  var end = GeoFly.driftEnd(begin, move.id, s.width, s.height);
  var range = GeoScene.flyCamera(map, GeoFly.driftPath(begin, end, to - from + 1), from);
  GeoScene.recordFlight(map, { kind: "drift", start: from, end: to, from: begin, to: end, move: move.id });
  var msg = "Drift (" + move.name.toLowerCase() + ") from frame " + range.start + " to " + range.end + ".";
  if (extended) msg += " The composition was extended to frame " + extended + " (" + EXTEND_PAD_SECONDS + " seconds after the drift ends).";
  moveFieldsOn(plan);
  say(msg);
  resetImageryPlan();
  previewShowCurrent();
});

createHereBtn.onClick = guardAction(function () {
  if (!preview.available()) throw new Error("The map preview isn't available — search for a place to make a map instead.");
  var f = preview.frameCamera(), typed = nameField.getText().trim(), name = typed ? uniqueMapName(typed) : numberedMapName();
  var made = makeMap(name, { lat: f.lat, lon: f.lon, zoom: f.zoom, rotation: 0, projection: projPicker.getValue() });
  var starter = addStarterLayers(made);
  var note = syncControls(made, true);
  say("Created map \"" + name + "\" " + (starter === true ? "with countries and coastlines " : "") + "at the preview frame." + starterNote(starter) + note);
});

mapStylePicker.onValueChanged = guard(function () {
  if (refreshingStyles) return;
  GeoNet.updateSettings({ mapStyle: pickedStyle().name });
  previewStyle();
});
function styleMap() {
  if (newMapSelected()) throw new Error("Pick a map first.");
  return currentMap();
}
applyStyleBtn.onClick = guardAction(function () {
  var map = styleMap(), style = pickedStyle(), r = GeoScene.applyMapStyle(map, style);
  refreshPreviews();
  var left = r.skipped ? " " + r.skipped + " animated or connected colour" + (r.skipped === 1 ? " was" : "s were") + " left alone." : "";
  say("Applied " + style.name + " to " + map.name + "." + left);
});
saveStyleBtn.onClick = guardAction(function () {
  var map = styleMap(), name = styleNameField.getText().trim();
  if (!name) throw new Error("Type a name for the style first.");
  var built = GeoStyles.builtIn(name);
  if (built) throw new Error(built.name + " is a built-in style — pick another name.");
  var existing = GeoStyles.find(name, savedStyles);
  if (existing) {
    var q = questionDialog();
    if (!q) throw new Error("\"" + existing.name + "\" is already saved — pick another name.");
    if (!q.showQuestion("Replace style", "Replace the saved style " + existing.name + "?")) { say("Nothing was saved."); return; }
    name = existing.name;
  }
  var style = GeoScene.readMapStyle(map, name);
  var at = savedStyles.indexOf(existing);
  if (at >= 0) savedStyles[at] = style; else savedStyles.push(style);
  GeoNet.updateSettings({ mapStyles: savedStyles, mapStyle: style.name });
  GeoScene.setMapStyle(map, style);
  refreshStylePicker(style.name);
  previewStyle();
  refreshPreviews();
  say("Saved style \"" + style.name + "\" from " + map.name + ".");
});
deleteStyleBtn.onClick = guardAction(function () {
  var style = pickedStyle();
  if (GeoStyles.isBuiltIn(style.name)) throw new Error("Built-in styles can't be deleted.");
  savedStyles = savedStyles.filter(function (s) { return s !== style; });
  GeoNet.updateSettings({ mapStyles: savedStyles, mapStyle: GeoStyles.DARK.name });
  refreshStylePicker(GeoStyles.DARK.name);
  previewStyle();
  say("Deleted style \"" + style.name + "\".");
});

// ---- Start here tips -------------------------------------------------------
// Shown on the Map tab until "Got it"; the Tips button (bottom of the Map tab) brings them back.
// A missing showTips setting means a first run, so the box shows.
var tipsGotItBtn = GeoStyle.primaryButton("Got it");
var tipsBtn = GeoStyle.quietButton("Tips");
// The title is a plain Label (not GeoStyle.heading, which is a layout that can't be hidden).
var tipsTitle = new ui.Label("Start here");
if (typeof tipsTitle.setFontSize === "function") tipsTitle.setFontSize(11);
if (typeof tipsTitle.setTextColor === "function") tipsTitle.setTextColor(GeoStyle.HEADING_COLOR);
if (typeof tipsTitle.setFixedHeight === "function") tipsTitle.setFixedHeight(16);
var tipsBox = [tipsTitle].concat([
  "1. Make a map: type a place in Search and press Search, or pick \"New map\" and press Create map here.",
  "2. Add layers: in the Layers tab, tick countries, coastlines, roads… and press Add layers.",
  "3. Mark places: the Label tab adds pins, labels and routes. On Routes, click the preview to add a stop.",
  "4. Animate: Fly here moves the camera between frames; key a route's Travel % or a highlight's Amount % in its Controls.",
  "Every map's settings are in \"(map name) Map controls\" in the Scene Window."
].map(function (t) { return GeoStyle.note(t); }), [tipsGotItBtn]);
// Hides or shows the whole box. Cavalry only documents setHidden on some widgets, so check first.
function showTips(show) {
  tipsBox.forEach(function (w) { if (typeof w.setHidden === "function") w.setHidden(!show); });
}
function rememberTips(show) {
  showTips(show);
  GeoNet.updateSettings({ showTips: show });
}
tipsGotItBtn.onClick = guardAction(function () { rememberTips(false); });
tipsBtn.onClick = guardAction(function () {
  showSection("Map");
  rememberTips(true);
});
(function () {
  var s = {};
  try { s = GeoNet.loadSettings() || {}; } catch (e) { s = {}; }
  showTips(s.showTips !== false);
})();

TAB_BUILDERS.push(function (tabs) {
  var tipsRow = row(tipsBtn);
  if (typeof tipsRow.addStretch === "function") tipsRow.addStretch(); // keeps the Tips button small
  tabs.add("Map", column(tipsBox.concat([
    GeoStyle.panel([
      row(mapPicker, refreshMapsBtn),
      row(nameField, projPicker),
      refreshControlsBtn
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Search"),
      row(searchField, searchBtn),
      resultPicker
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Preview (drag to move)"),
      preview.layout,
      row(jumpBtn),
      createHereBtn
    ]),
    cameraPanel = GeoStyle.panel([
      GeoStyle.heading("Camera"),
      row(flyBtn, fromLabel, flyStartBox, toLabel, flyEndBox),
      flyNote,
      row(easingLabel, easingPicker),
      row(arcLabel, arcPicker),
      updateFlightBtn,
      row(driftLabel, driftPicker, driftBtn)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Style"),
      row(mapStylePicker, applyStyleBtn),
      row(styleNameField, saveStyleBtn, deleteStyleBtn)
    ]),
    tipsRow
  ])));
});

// ---- Layers tab ------------------------------------------------------------
var NE_CATS = [["countries", "Countries"], ["states", "States / provinces"], ["coastlines", "Coastlines"], ["lakes", "Lakes"], ["rivers", "Rivers"], ["cities", "Cities"]];
var OSM_CATS = [["buildings", "Buildings"], ["roads", "Roads"], ["water", "Water"], ["parks", "Parks"], ["railways", "Railways"]];
var DRAW_ORDER = ["countries", "states", "lakes", "coastlines", "rivers", "parks", "water", "buildings", "railways", "roads", "cities"];
var NE_SCALES = ["110m", "50m", "10m"];
var CATEGORY_LABEL = {};
NE_CATS.concat(OSM_CATS).forEach(function (c) { CATEGORY_LABEL[c[0]] = c[1]; });

// New maps start with Countries and Coastlines (bundled medium detail), made the same way as
// Add layers makes them. Returns true, or the error message: the map is already made by then.
function addStarterLayers(map) {
  try {
    var fetched = ["countries", "coastlines"].map(function (c) { return { category: c, enc: GeoNet.neLayer(c, "50m") }; });
    fetched.forEach(function (r) {
      if (!r.enc.f.length) return;
      GeoScene.createMapLayer(map, map.name + ": " + CATEGORY_LABEL[r.category], r.enc,
        { camera: map.cameraId, category: r.category }, GeoScene.layerStyle(map, r.category), {});
    });
    GeoScene.restackBaseLayers(map, DRAW_ORDER);
    return true;
  } catch (e) {
    return String(e && e.message ? e.message : e);
  }
}
function starterNote(result) {
  return result === true ? "" : " (Countries and coastlines couldn't be added: " + result + ")";
}

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
var addScaleBarBtn = GeoStyle.button("Add scale bar");
var addNorthArrowBtn = GeoStyle.button("Add north arrow");

addLayersBtn.onClick = guardAction(function () {
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
    if (area.needsConfirm) {
      var areaDialog = questionDialog();
      if (!areaDialog) throw new Error("The camera shows about " + Math.round(area.areaKm2) + " km², a large area to download. Zoom the camera in, or choose Main features only.");
      if (!areaDialog.showQuestion("Large area",
          "The camera shows about " + Math.round(area.areaKm2) + " km². Downloading " +
          (mode === "all" ? "everything" : "main features") + " for that area may be slow and heavy. Continue?")) {
        say("Cancelled. Zoom the camera in, or choose Main features only.");
        return;
      }
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
  // (Without a question dialog in this Cavalry the layers are simply added.)
  var heavyDialog = bytes > GeoUtil.LIMITS.SCENE_WARN_BYTES ? questionDialog() : null;
  if (heavyDialog && !heavyDialog.showQuestion("Heavy layers",
      "These layers add about " + GeoUtil.formatBytes(bytes) + " to the scene file. Continue?")) {
    say("Cancelled. Nothing was added.");
    return;
  }

  var added = 0, empty = [];
  fetched.forEach(function (r) {
    if (!r.enc.f.length) { empty.push(CATEGORY_LABEL[r.category]); return; }
    GeoScene.createMapLayer(map, map.name + ": " + CATEGORY_LABEL[r.category], r.enc,
      { camera: map.cameraId, category: r.category }, GeoScene.layerStyle(map, r.category), {});
    added++;
    checks[r.category].setValue(false); // every box unticks once its layer is added, so a repeated click can't add it twice
  });
  if (selected.some(isOsm) && creditCheck.getValue() && !GeoScene.hasAttribution(map)) GeoScene.createAttribution(map);
  GeoScene.restackBaseLayers(map, DRAW_ORDER);
  say("Added " + added + " layer(s), " + GeoUtil.formatBytes(bytes) + "." + (empty.length ? " Nothing found for: " + empty.join(", ") + "." : "") + syncControls(map));
});

addScaleBarBtn.onClick = guardAction(function () {
  var map = currentMap();
  GeoScene.addScaleBar(map);
  say("Scale bar added to " + map.name + "." + syncControls(map));
});
addNorthArrowBtn.onClick = guardAction(function () {
  var map = currentMap();
  GeoScene.addNorthArrow(map);
  say("North arrow added to " + map.name + "." + syncControls(map));
});

clearCacheBtn.onClick = guardAction(function () {
  if (imageryState.timer) throw new Error("The download cache can't be cleared while imagery is downloading or building — wait, or press Cancel first.");
  var r = GeoNet.clearCache();
  if (r.fallback) say("Download cache cleared (old downloads will be re-fetched; some files could not be deleted from disk).");
  else say("Download cache cleared: " + r.files + " file(s), " + GeoUtil.formatBytes(r.bytes) + " freed.");
  resetImageryPlan();
});

// ---- Extract and Bake (in the Layers section) ---------------------------------
var NOT_EXTRACTABLE = ["extract", "pin", "label", "route", "data", "scaleBar", "northArrow", "highlight", "dayNight", "dayNightMask", "timeLabel"];
var sourceLayers = [], groups = [], groupsEnc = null, groupsLayer = null;
var layerPicker = new ui.DropDown();
var refreshLayersBtn = GeoStyle.button("Refresh");
var featureQuery = new ui.LineEdit(); featureQuery.setPlaceholder("Name, e.g. France or Rue de Rivoli (blank = all named)");
var findBtn = GeoStyle.button("Find");
var featureList = new ui.List();
featureList.setSelectionMode("extended");
var extractBtn = GeoStyle.primaryButton("Extract selected");
// Highlight: an effect, Start (opens on the playhead and moves on after each highlight, like Fly
// here) and Duration (1 second of the comp's frames).
function compFps() {
  try { var f = Number(api.get(api.getActiveComp(), "fps")); return isFinite(f) && f > 0 ? Math.round(f) : 25; } catch (e) { return 25; }
}
var highlightEffectPicker = new ui.DropDown();
GeoScene.HIGHLIGHT_EFFECTS.forEach(function (e) { highlightEffectPicker.addEntry(e.name); });
var highlightStartField = new ui.NumericField(playhead());
var highlightLengthField = new ui.NumericField(compFps());
[highlightStartField, highlightLengthField].forEach(function (f) {
  f.setType(0);
  if (typeof f.setFixedWidth === "function") f.setFixedWidth(48);
});
highlightStartField.setMin(0); highlightLengthField.setMin(1);
var highlightBtn = GeoStyle.button("Highlight selected");
// Change effect: rebuilds the highlight selected in the Scene Window with the picked effect.
var changeEffectBtn = GeoStyle.button("Change effect");
var bakeBtn = GeoStyle.button("Bake selected layers to editable shapes");
var refreshControlsBtn = GeoStyle.button("Refresh controls");

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
  lastFindText = null;
  featureList.setModel([]);
}

refreshLayersBtn.onClick = guardAction(function () { refreshSourceLayers(); say(sourceLayers.length + " map layer(s) available."); });
// Picking "New map" is a normal choice, not an error: it just leaves no map to extract from.
mapPicker.onValueChanged = guard(function () {
  refreshNewMapFields();
  if (!newMapSelected()) refreshSourceLayers();
  else {
    clearSourceLayers();
    say("New map: type a place and press Search to make it, or press Create map here.");
  }
  previewShowMap(); // last, so a preview problem can't skip the layer refresh
});

// Find runs from the button (always) or from Return / leaving the box (only when the text changed;
// blank is a valid Find, meaning all named features).
// null = nothing found yet (so the first Enter, even on a blank box, runs); it is only set once a Find
// has worked, and cleared with the layer list, so a failed Find or another map's layers run again.
var lastFindText = null;
function runFind() {
  var findText = featureQuery.getText().trim();
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
  groups = GeoCodec.findByName(groupsEnc, findText).slice(0, 500);
  featureList.setModel(groups.map(function (g, i) {
    return { uuid: "g" + i, label: g.name + (g.indices.length > 1 ? " (" + g.indices.length + " parts)" : "") };
  }));
  lastFindText = findText;
  say(groups.length ? groups.length + " match(es). Select some, then Extract." : "No named features match.");
}
findBtn.onClick = guardAction(runFind);
featureQuery.onValueCommitted = guardWork(function () {
  if (featureQuery.getText().trim() !== lastFindText) runFind();
});

extractBtn.onClick = guardAction(function () {
  if (!groupsLayer) throw new Error("Click Find first (Layers → Extract).");
  var sel = featureList.getSelection();
  if (!sel || !sel.length) throw new Error("Select features in the list first.");
  var map = currentMap();
  // One feature failing doesn't undo the others: each is tried on its own.
  var done = 0, failed = 0, firstError = null;
  sel.forEach(function (uuid) {
    try { GeoScene.extract(map, groupsLayer, groupsEnc, groups[parseInt(String(uuid).slice(1), 10)]); done++; }
    catch (e) { failed++; if (!firstError) firstError = e; }
  });
  if (!done) throw firstError;
  say("Extracted " + done + " feature layer(s). They follow the camera; style and animate them freely." +
    (failed ? " Couldn't extract " + failed + ": " + (firstError && firstError.message ? firstError.message : String(firstError)) + "." : "") + syncControls(map));
});

highlightBtn.onClick = guardAction(function () {
  if (!groupsLayer) throw new Error("Click Find first (Layers → Extract).");
  var sel = featureList.getSelection();
  if (!sel || !sel.length) throw new Error("Select some features in the list first.");
  var map = currentMap(), effects = GeoScene.HIGHLIGHT_EFFECTS, effect = effects[highlightEffectPicker.getValue()] || effects[0];
  var start = Math.max(0, Math.round(Number(highlightStartField.getValue()) || 0));
  var duration = Math.max(1, Math.round(Number(highlightLengthField.getValue()) || 1));
  // A feature already extracted on this map (same name, same source layer) is reused.
  var extracts = GeoScene.findMapLayers(map).filter(function (l) { return l.meta.category === "extract" && l.meta.source === groupsLayer.meta.category; });
  // One feature failing doesn't undo the others: each is tried on its own.
  var done = 0, failed = 0, firstError = null;
  sel.forEach(function (uuid) {
    try {
      var g = groups[parseInt(String(uuid).slice(1), 10)], name = g.name || "Feature";
      var have = extracts.filter(function (l) { return l.name === name; })[0];
      var id = have ? have.id : GeoScene.extract(map, groupsLayer, groupsEnc, g);
      if (!have) extracts.push({ id: id, name: name, meta: { category: "extract", source: groupsLayer.meta.category } });
      GeoScene.createHighlight(map, id, effect.id, { start: start, duration: duration });
      done++;
    } catch (e) {
      failed++;
      if (!firstError) firstError = e;
    }
  });
  if (!done) throw firstError;
  highlightStartField.setValue(start + duration);
  say("Highlighted " + done + " feature(s) with " + effect.name + ". Animate or re-time its Amount % keys on the timeline." +
    (failed ? " Couldn't highlight " + failed + ": " + (firstError && firstError.message ? firstError.message : String(firstError)) : "") + syncControls(map));
});

changeEffectBtn.onClick = guardAction(function () {
  var map = currentMap(), sel = api.getSelection(), g = GeoScene.highlightOfSelection(map, sel);
  if (!g) {
    var elsewhere = GeoScene.findMaps().some(function (m) { return m.cameraId !== map.cameraId && GeoScene.highlightOfSelection(m, sel); });
    throw new Error(elsewhere ? "That highlight belongs to another map. Pick that map first." : "Select a highlight in the Scene Window first.");
  }
  var effects = GeoScene.HIGHLIGHT_EFFECTS, effect = effects[highlightEffectPicker.getValue()] || effects[0];
  var r = GeoScene.changeHighlightEffect(map, g, effect.id);
  say("Highlight " + r.number + " now uses " + effect.name + "." + syncControls(map));
});

bakeBtn.onClick = guardAction(function () {
  var ids = api.getSelection();
  if (!ids.length) throw new Error("Select one or more map layers in the Scene Window first.");
  var baked = 0, skippedData = 0, skippedRoute = 0, skippedFurniture = 0, skippedHighlight = 0, skippedCallout = 0, skippedDayNight = 0, other = 0;
  var hlParts = {}, cParts = {}, dnParts = {};
  // A new-style route is made of ordinary Cavalry layers (Bézier lines, circles, helpers),
  // so its parts are skipped with a message of their own rather than counted as "other".
  var routeParts = {}, recogniseNote = "";
  try {
    GeoScene.findMaps().forEach(function (m) {
      GeoScene.findRoutes(m).forEach(function (r) {
        if (r.helpers) routeParts[r.helpers] = true;
        r.stops.forEach(function (s) { [s.holder, s.circle, s.label, s.position, s.visibility, s.endPoint].forEach(function (p) { if (p) routeParts[p] = true; }); });
        r.legs.forEach(function (l) { [l.line, l.startHandle, l.endHandle, l.fade, l.draw].forEach(function (p) { if (p) routeParts[p] = true; }); });
        GeoScene.routeDraws(r.groupId).forEach(function (d) { routeParts[d] = true; });
      });
      // A traveller's copies, helpers and plugin marker are route parts too (your own layer is not).
      GeoScene.findTravellers(m).forEach(function (t) {
        t.legs.forEach(function (l) { [l.dup, l.tip, l.show].forEach(function (p) { if (p) routeParts[p] = true; }); });
        if (t.scale) routeParts[t.scale] = true;
        if (!t.userSource && t.source) routeParts[t.source] = true;
      });
      var hp = GeoScene.highlightParts(m);
      Object.keys(hp).forEach(function (k) { hlParts[k] = true; });
      var cp = GeoScene.calloutParts(m);
      Object.keys(cp).forEach(function (k) { cParts[k] = true; });
      var dp = GeoScene.dayNightParts(m);
      Object.keys(dp).forEach(function (k) { dnParts[k] = true; });
    });
  } catch (e) {
    // Carry on (most selections have no route parts), but say it: a route part may then be baked as a plain layer.
    recogniseNote = " Couldn't check for route parts: " + (e && e.message ? e.message : String(e)) + ".";
  }
  var bakeFailed = 0, bakeError = null;
  ids.forEach(function (id) {
    if (routeParts[id]) { skippedRoute++; return; }
    if (hlParts[id]) { skippedHighlight++; return; }
    if (cParts[id]) { skippedCallout++; return; }
    if (dnParts[id]) { skippedDayNight++; return; }
    var meta = GeoScene.readLayerMeta(id);
    if (!meta) { other++; return; }
    if (meta.category === "highlight") { skippedHighlight++; return; }
    if (meta.category === "dayNight" || meta.category === "dayNightMask" || meta.category === "timeLabel") { skippedDayNight++; return; }
    if (meta.category === "data") { skippedData++; return; }
    if (meta.category === "scaleBar" || meta.category === "northArrow") { skippedFurniture++; return; }
    // One layer failing doesn't undo the others: each is tried on its own.
    try { GeoScene.bake(id); baked++; }
    catch (e) { bakeFailed++; if (!bakeError) bakeError = e; }
  });
  if (baked === 0 && bakeFailed) throw bakeError;

  if (baked === 0) {
    // e.g. "Highlights and callouts", "Callouts and day & night", "Highlights, callouts and day & night"
    var kinds = [skippedHighlight ? "highlights" : "", skippedCallout ? "callouts" : "", skippedDayNight ? "day & night" : ""].filter(Boolean);
    var list = kinds.length > 1 ? kinds.slice(0, -1).join(", ") + " and " + kinds[kinds.length - 1] : kinds[0];
    if (skippedFurniture && !skippedRoute && !skippedData && !other) {
      throw new Error("The scale bar and north arrow follow the camera, so they can't be baked." +
        (kinds.length ? " " + list.charAt(0).toUpperCase() + list.slice(1) + " can't be baked either." : "") + recogniseNote);
    } else if (skippedDayNight && !skippedHighlight && !skippedCallout && !skippedRoute && !skippedData && !skippedFurniture && !other) {
      throw new Error("Day & night redraws from its time, so it can't be baked.");
    } else if ((skippedHighlight || skippedCallout) && !skippedRoute && !skippedData && !skippedFurniture && !other) {
      if (!skippedHighlight && !skippedDayNight) throw new Error("Callouts are already Cavalry layers, so there's nothing to bake.");
      throw new Error(list.charAt(0).toUpperCase() + list.slice(1) + " can't be baked." + recogniseNote);
    } else if (skippedRoute) {
      throw new Error("Route legs and stops are already Cavalry shapes, so there's nothing to bake.");
    } else if (skippedData && !other) {
      throw new Error("Data layers can't be baked yet. Select map layers such as \"world: Countries\" instead.");
    } else {
      throw new Error("Select Cavalry Geo map layers to bake (groups and the camera can't be baked).");
    }
  }

  var msg = "Baked " + baked + " layer(s) at the current frame. Baked shapes no longer follow the camera.";
  if (skippedData) msg += " Skipped " + skippedData + " data layer(s) — data layers can't be baked yet.";
  if (skippedRoute) msg += " Skipped " + skippedRoute + " route part(s) — they're already Cavalry shapes.";
  if (skippedHighlight) msg += " Skipped " + skippedHighlight + " highlight part(s).";
  if (skippedCallout) msg += " Skipped " + skippedCallout + " callout part(s).";
  if (skippedDayNight) msg += " Skipped " + skippedDayNight + " day & night part(s).";
  if (skippedFurniture) msg += " Skipped the scale bar / north arrow (they follow the camera).";
  if (other) msg += " Skipped " + other + " group(s) or other layer(s).";
  if (bakeFailed) msg += " Couldn't bake " + bakeFailed + ": " + (bakeError && bakeError.message ? bakeError.message : String(bakeError)) + ".";
  msg += recogniseNote;
  // Bake doesn't need a picked map; when one is picked, its Controls are brought up to date.
  if (!newMapSelected()) msg += syncControls(currentMap());
  say(msg);
});

refreshControlsBtn.onClick = guardAction(function () {
  var map = currentMap(), r = GeoControlPanel.sync(map, { gatherImagery: true });
  // N spans the Map controls and any Overlay / Data / Extract / Time controls that exist.
  var names = [map.name + " Map controls"];
  [["overlay", "Overlay"], ["data", "Data"], ["extract", "Extract"], ["time", "Time"]].forEach(function (g) { if (r.components[g[0]]) names.push(g[1] + " controls"); });
  var where = names.length === 1 ? "in " + names[0] : "across " + names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  var msg = "Controls updated: " + r.controls + (r.controls === 1 ? " setting " : " settings ") + where + ".";
  say(msg);
  if (r.nightLightsNeeded) startNightLights(map, msg);
});

// Layers has three pages: Add (the layer categories), Overlays (day and night, furniture) and
// Extract (extract, highlight, bake).
var LAYERS_PAGES = ["Add", "Overlays", "Extract"];
var layersTabs = null, layersPages = null;
function showLayersPage(name) {
  var i = LAYERS_PAGES.indexOf(name);
  if (i < 0 || !layersPages) return;
  layersTabs.select(name);
  layersPages.setPage(i);
}
TAB_BUILDERS.push(function (tabs) {
  var toggles = function (cats) { return cats.map(function (c) { return checks[c[0]]; }); };
  layersPages = GeoStyle.pageStack();
  layersPages.add(column([
    GeoStyle.panel([
      GeoStyle.heading("World · Natural Earth"),
      GeoStyle.toggleGrid(toggles(NE_CATS), 3),
      row(GeoStyle.fieldLabel("Detail"), scalePicker)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Streets · OpenStreetMap"),
      GeoStyle.note("Downloads the area the camera shows. Add one street layer at a time. Boxes untick once their layer is added."),
      GeoStyle.toggleGrid(toggles(OSM_CATS), 3),
      modePicker,
      row(creditCheck, new ui.Label("Add © OpenStreetMap contributors credit")),
      addLayersBtn,
      clearCacheBtn
    ])
  ]));
  layersPages.add(column([
    GeoStyle.panel([
      GeoStyle.heading("Day & night"),
      row(GeoStyle.fieldLabel("Day"), dayNightDayField, dayNightMonthPicker),
      row(GeoStyle.fieldLabel("UTC time (0-24)"), dayNightTimeField),
      row(timeLabelCheck, new ui.Label("Time label")),
      addDayNightBtn
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Map furniture"),
      row(addScaleBarBtn, addNorthArrowBtn)
    ])
  ]));
  layersPages.add(column([
    GeoStyle.panel([
      GeoStyle.heading("Extract"),
      row(layerPicker, refreshLayersBtn),
      row(featureQuery, findBtn),
      featureList,
      extractBtn
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Highlight"),
      row(highlightEffectPicker, new ui.Label("Start:"), GeoStyle.frameField(highlightStartField), new ui.Label("Frames:"), GeoStyle.frameField(highlightLengthField)),
      row(highlightBtn, changeEffectBtn)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Bake"),
      bakeBtn
    ])
  ]));
  layersTabs = GeoStyle.tabBar(LAYERS_PAGES, function (name) { showLayersPage(name); });
  // Only a top margin, so the tab bar starts where every other page's first panel does.
  var layersColumn = new ui.VLayout();
  layersColumn.setMargins(0, 6, 0, 0); // the same 6 px top margin as every page column
  layersColumn.add(layersTabs.widget);
  layersColumn.add(layersPages.widget);
  tabs.add("Layers", layersColumn);
});

// Runs a place search from a text field into a results dropdown (no "World view" entry).
// memo ({ q, found }) holds the box's last search, so the same text isn't searched twice.
function searchInto(field, picker, memo) {
  var q = field.getText().trim();
  if (!q) throw new Error("Type a place to search for.");
  var reuse = memo.q === q && memo.found.length;
  var found = reuse ? memo.found : GeoNet.search(q);
  var kept = reuse ? picker.getValue() : 0; // the same text again keeps the picked result
  memo.q = q;
  memo.found = found.slice();
  fillPlaces(picker, found);
  if (reuse && kept > 0 && kept < found.length) picker.setValue(kept);
  if (!found.length) say("No results for \"" + q + "\".");
  return found;
}
// Return (or leaving the box) runs the box's search, unless it is empty or already searched.
function searchOnCommit(field, memo, run) {
  field.onValueCommitted = guardWork(function () {
    var q = field.getText().trim();
    if (!q || q === memo.q || recentlyTried(memo, q)) return;
    run();
  });
}
function fillPlaces(picker, found) {
  picker.clear();
  found.forEach(function (r) { picker.addEntry(placeLabel(r)); });
  if (found.length) picker.setValue(0);
}

// ---- Pins (Label section) ---------------------------------------------------
// The Pins page has its own search (a Map tab search fills it in too), so a pin or label
// always goes to the place shown right here (never to whatever is picked on the Map tab).
var pinResults = [], pinMemo = { q: null, found: [] };
var pinSearchField = new ui.LineEdit(); pinSearchField.setPlaceholder("Search a place, e.g. Eiffel Tower");
var pinSearchBtn = GeoStyle.primaryButton("Search");
var pinResultPicker = new ui.DropDown();
var labelText = new ui.LineEdit(); labelText.setPlaceholder("Label text (blank = place name)");
var pinHereBtn = GeoStyle.primaryButton("Pin here");
var labelHereBtn = GeoStyle.primaryButton("Label here");
var calloutHereBtn = GeoStyle.primaryButton("Callout here");
var latField = new ui.NumericField(0); latField.setType(1); latField.setMin(-90); latField.setMax(90);
var lonField = new ui.NumericField(0); lonField.setType(1); lonField.setMin(-180); lonField.setMax(180);
var pinCoordBtn = GeoStyle.button("Pin at coordinates");
var labelCoordBtn = GeoStyle.button("Label at coordinates");
var calloutCoordBtn = GeoStyle.button("Callout at coordinates");

// Label previews: the picked map, a click on Pins sets the spot, a click on Routes adds a stop.
// No green frame or dim (those mark the Map tab's Jump / Fly target), no double-click zoom.
function labelPreview(hint, onClick, onPick) {
  return GeoPreviewPanel.create({
    compSize: function () { return GeoScene.compSize(); }, onPick: onPick, onClick: onClick, onFail: function () {},
    yUp: PREVIEW_Y_UP, dim: false, frame: false, doubleClickZoom: false, redraw: PREVIEW_REDRAW, hint: hint
  });
}
// guard() drops its arguments, so the click handlers get them passed on here. A lookup lets Cavalry
// run queued events (sayNow, and reverse's wait for its turn), so a second click could start inside
// the first: while one is being handled (or any other action runs), further clicks are ignored.
function guardClick(fn) {
  return function (lon, lat) { guardWork(function () { fn(lon, lat); })(); };
}
function round4(v) { return Math.round(v * 1e4) / 1e4; }
var spotName = null; // the name the last Pins click put in the text box
function pinsClick(lon, lat) {
  lon = round4(lon); lat = round4(lat);
  latField.setValue(lat); lonField.setValue(lon);
  pinsPreview.setSpot({ lon: lon, lat: lat });
  sayNow("Looking up the place…");
  var name = GeoNet.reverse(lat, lon, pinsPreview.frameCamera().zoom), typed = labelText.getText().trim();
  var ours = !typed || (spotName !== null && typed === spotName);
  if (ours) { labelText.setText(name || ""); spotName = name || null; }
  say("Spot set: " + (name || coordName()) + ". Press Pin at coordinates, Label at coordinates or Callout at coordinates.");
}
var pinsPreview = labelPreview("Click to set the spot · drag to move · middle-drag or + / − to zoom", guardClick(pinsClick), function (i) {
  if (i < 0 || i >= pinResults.length) return;
  pinResultPicker.setValue(i);
  pinsFollowPicked();
});
// Centres the Pins preview on the picked search result and shows the results as dots.
function pinsFollowPicked() {
  if (!pinsPreview.available()) return;
  var i = pinResultPicker.getValue();
  pinsPreview.setPlaces(pinResults.map(function (r) { return { lat: r.lat, lon: r.lon, name: r.name }; }), i);
  if (i >= 0 && i < pinResults.length) pinsPreview.showCamera(camForResult(pinResults[i], 0));
}
pinResultPicker.onValueChanged = guard(pinsFollowPicked);

function labelOr(fallback) { return labelText.getText().trim() || fallback; }
function coordName() { return latField.getValue().toFixed(4) + ", " + lonField.getValue().toFixed(4); }
// A Map tab search fills the Pins page too, so Pin here works without searching again.
function prefillPins(q, found) {
  pinSearchField.setText(q);
  pinResults = found.slice();
  pinMemo.q = q;
  pinMemo.found = found.slice();
  fillPlaces(pinResultPicker, pinResults);
  pinsFollowPicked();
}
function pinPlace() {
  var idx = pinResultPicker.getValue();
  if (!pinResults.length || idx < 0 || idx >= pinResults.length) throw new Error("Search for a place under Label → Pins first.");
  return pinResults[idx];
}

function pinSearch() {
  pinResults = searchInto(pinSearchField, pinResultPicker, pinMemo);
  if (pinResults.length) say(pinResults.length + " result(s). Pick one, then Pin here, Label here or Callout here.");
  pinsFollowPicked();
}
pinSearchBtn.onClick = guardAction(pinSearch);
searchOnCommit(pinSearchField, pinMemo, pinSearch);
pinHereBtn.onClick = guardAction(function () {
  var r = pinPlace(), name = labelOr(shortName(r)), map = currentMap();
  GeoScene.addPin(map, name, r.lon, r.lat);
  say("Pin added at " + shortName(r) + "." + syncControls(map));
});
labelHereBtn.onClick = guardAction(function () {
  var r = pinPlace(), text = labelOr(shortName(r)), map = currentMap();
  GeoScene.createLabel(map, text, r.lon, r.lat);
  say("Label \"" + text + "\" added at " + shortName(r) + "." + syncControls(map));
});
pinCoordBtn.onClick = guardAction(function () {
  var map = currentMap();
  GeoScene.addPin(map, labelOr(coordName()), lonField.getValue(), latField.getValue());
  say("Pin added at " + coordName() + "." + syncControls(map));
});
labelCoordBtn.onClick = guardAction(function () {
  var text = labelOr(coordName()), map = currentMap();
  GeoScene.createLabel(map, text, lonField.getValue(), latField.getValue());
  say("Label \"" + text + "\" added at " + coordName() + "." + syncControls(map));
});
function calloutSay(map, g, text) {
  // The status tells the user to drag the label, so the label is the selection.
  try {
    var rec = api.getUserDataKey(g, "geoCallout");
    if (rec && rec.label && typeof api.select === "function") api.select([rec.label]);
  } catch (e) { /* cosmetic */ }
  say("Callout " + GeoScene.calloutNumber(g) + " added for " + text + ". Drag its label in the viewport to place it; key its Draw % in " + map.name + " Overlay controls." + syncControls(map));
}
calloutHereBtn.onClick = guardAction(function () {
  var r = pinPlace(), text = labelOr(shortName(r)), map = currentMap();
  calloutSay(map, GeoScene.createCallout(map, { lon: r.lon, lat: r.lat }, text), text);
}, true);
calloutCoordBtn.onClick = guardAction(function () {
  var text = labelOr(coordName()), map = currentMap();
  calloutSay(map, GeoScene.createCallout(map, { lon: lonField.getValue(), lat: latField.getValue() }, text), text);
}, true);

// ---- Day & night (Layers → Overlays, above Map furniture) -----------------------------------
// The date and time start at now (UTC), the time rounded to a quarter hour. Pressing the button again
// on a map that has the overlay sets its date and time instead of making another.
var DAYNIGHT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var dayNightNow = new Date();
var dayNightDayField = new ui.NumericField(dayNightNow.getUTCDate()); dayNightDayField.setType(0); dayNightDayField.setMin(1); dayNightDayField.setMax(31);
var dayNightMonthPicker = new ui.DropDown();
DAYNIGHT_MONTHS.forEach(function (m) { dayNightMonthPicker.addEntry(m); });
dayNightMonthPicker.setValue(dayNightNow.getUTCMonth());
var dayNightTimeField = new ui.NumericField(Math.round((dayNightNow.getUTCHours() + dayNightNow.getUTCMinutes() / 60) * 4) / 4);
dayNightTimeField.setType(1); dayNightTimeField.setMin(0); dayNightTimeField.setMax(24);
var timeLabelCheck = new ui.Checkbox(true);
var addDayNightBtn = GeoStyle.primaryButton("Add day & night");
// "21 Jun 14:30 UTC" (the same time text the label draws, without its dot).
function dayNightWhen(day, time) { return GeoSun.timeText(day, time).replace(" · ", " "); }
addDayNightBtn.onClick = guardAction(function () {
  var map = currentMap();
  var day = GeoSun.dayOfYear(dayNightDayField.getValue(), dayNightMonthPicker.getValue() + 1), time = Number(dayNightTimeField.getValue());
  var r = GeoScene.addDayNight(map, { dayOfYear: day, utcTime: time, label: !!timeLabelCheck.getValue() });
  var when = dayNightWhen(day, time);
  var message;
  if (r.created) message = "Day & night added to " + map.name + " for " + when + ". Key its Day of year and UTC time in " + map.name + " Time controls." + syncControls(map);
  else {
    var note = r.restored ? " Its missing night layers were made again." : "";
    if (r.kept && r.kept.length) note += " It kept your animated " + r.kept.join(" and ") + ".";
    message = "Day & night updated to " + when + "." + note + syncControls(map);
  }
  say(message);
  // Night lights need Day & night over satellite imagery: added when wanted and missing, removed when no longer wanted.
  var st = GeoScene.nightLightsStatus(map);
  if (st.wanted && !st.night.length) startNightLights(map, message);
  else if (st.orphaned) GeoScene.removeNightLights(map);
});

// ---- Routes (Label section) -------------------------------------------------
// A route is stops joined by legs: each stop is a circle you can drag; each leg a Bézier line.
var routeResults = [], stops = [], routeMemo = { q: null, found: [] };
var routeSearchField = new ui.LineEdit(); routeSearchField.setPlaceholder("Search a stop, e.g. London");
var routeSearchBtn = GeoStyle.primaryButton("Search");
var routeResultPicker = new ui.DropDown();
var addStopBtn = GeoStyle.button("Add stop");
var stopsList = new ui.List(); stopsList.setSelectionMode("extended");
var removeStopBtn = GeoStyle.button("Remove selected");
var clearStopsBtn = GeoStyle.button("Clear");
var arcField = new ui.NumericField(30); arcField.setType(1); arcField.setMin(0); arcField.setMax(100);
var routeShapePicker = new ui.DropDown();
["Arc", "Great circle"].forEach(function (s) { routeShapePicker.addEntry(s); });
(function () { // Arc unless settings.json remembers Great circle.
  var s = {};
  try { s = GeoNet.loadSettings() || {}; } catch (e) { s = {}; }
  routeShapePicker.setValue(s.routeShape === 1 ? 1 : 0);
})();
routeShapePicker.onValueChanged = guard(function () {
  var shape = routeShapePicker.getValue() === 1 ? 1 : 0;
  GeoNet.updateSettings({ routeShape: shape });
  // Great circle starts with no extra bow; back to Arc restores the default one.
  if (shape === 1) arcField.setValue(0);
  else if (arcField.getValue() === 0) arcField.setValue(30);
});
var labelsAtStops = new ui.Checkbox(false);
var TRAVELLER_KINDS = [null, "plane", "arrow", "dot", "layer"];
var travellerPicker = new ui.DropDown();
["None", "Plane", "Arrow", "Dot", "Selected layer"].forEach(function (s) { travellerPicker.addEntry(s); });
var addTravellerBtn = GeoStyle.button("Add to route");
var createRouteBtn = GeoStyle.primaryButton("Create route");
var pinStopsBtn = GeoStyle.button("Pin here");

function routesClick(lon, lat) {
  lon = round4(lon); lat = round4(lat);
  var last = stops[stops.length - 1];
  if (last && Math.abs(last.lon - lon) < 1e-9 && Math.abs(last.lat - lat) < 1e-9) { say("That's already the last stop."); return; }
  sayNow("Looking up the place…");
  var name = GeoNet.reverse(lat, lon, routesPreview.frameCamera().zoom) || (lat.toFixed(4) + ", " + lon.toFixed(4));
  stops.push({ name: name, lon: lon, lat: lat });
  refreshStops();
  say("Added stop " + stops.length + ": " + name + ".");
}
var routesPreview = labelPreview("Click to add a stop · drag to move · middle-drag or + / − to zoom", guardClick(routesClick), function (i) {
  if (i < 0 || i >= routeResults.length) return;
  routeResultPicker.setValue(i);
  routesFollowPicked();
});
function routesFollowPicked() {
  if (!routesPreview.available()) return;
  var i = routeResultPicker.getValue();
  routesPreview.setPlaces(routeResults.map(function (r) { return { lat: r.lat, lon: r.lon, name: r.name }; }), i);
  if (i >= 0 && i < routeResults.length) routesPreview.showCamera(camForResult(routeResults[i], 0));
}
routeResultPicker.onValueChanged = guard(routesFollowPicked);

var streetCache = {}; // layer id -> { sig, prepared }: GeoPreview.prepare(...) of the layer's data, re-read when its sig changes
function previewStreetLayers(map, layers) {
  var list = GeoScene.previewStreets(map, layers), keep = {}, out = [];
  list.forEach(function (s) {
    keep[s.id] = true;
    var hit = streetCache[s.id];
    if (!hit || hit.sig !== s.sig) {
      try { hit = streetCache[s.id] = { sig: s.sig, prepared: GeoPreview.prepare(GeoScene.readPreviewLayer(s.id)) }; }
      catch (e) { delete streetCache[s.id]; return; } // a layer that won't read is skipped
    }
    out.push({ kind: s.kind, color: s.color, prepared: hit.prepared });
  });
  Object.keys(streetCache).forEach(function (id) { if (!keep[id]) delete streetCache[id]; });
  return out;
}

// Hands the picked map's pins, labels and routes to every preview. Never throws: on a read
// failure the previews keep what they had.
function refreshPreviews() {
  var model = null, streets = null;
  try {
    if (!newMapSelected()) {
      var map = currentMap(), layers = GeoScene.findMapLayers(map); // one scan of the comp for both
      model = GeoScene.previewModel(map, layers);
      try { streets = previewStreetLayers(map, layers); } catch (e2) { streets = null; }
    }
  } catch (e) { return; }
  [preview, pinsPreview, routesPreview].forEach(function (p) { if (p && p.available()) { p.setOverlay(model); p.setStreets(streets); } });
}

// The selected layer to send along a route: the first selected layer that isn't part of the map.
function travellerLayer(map) {
  var sel = [];
  try { sel = api.getSelection() || []; } catch (e) { sel = []; }
  for (var i = 0; i < sel.length; i++) if (!GeoScene.isMapPart(map, sel[i])) return sel[i];
  throw new Error("Select the layer to send along the route first.");
}

function refreshStops() {
  stopsList.setModel(stops.map(function (s, i) { return { uuid: "s" + i, label: (i + 1) + ". " + s.name }; }));
  if (typeof routesPreview !== "undefined" && routesPreview && routesPreview.available()) routesPreview.setDraft(stops);
}

function routeSearch() {
  routeResults = searchInto(routeSearchField, routeResultPicker, routeMemo);
  if (routeResults.length) say(routeResults.length + " result(s). Pick one, then Add stop.");
  routesFollowPicked();
}
routeSearchBtn.onClick = guardAction(routeSearch);
searchOnCommit(routeSearchField, routeMemo, routeSearch);
addStopBtn.onClick = guardAction(function () {
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
removeStopBtn.onClick = guardAction(function () {
  var sel = stopsList.getSelection() || [];
  if (!sel.length) throw new Error("Select stops in the list to remove.");
  var drop = {};
  sel.forEach(function (u) { drop[parseInt(String(u).slice(1), 10)] = true; });
  stops = stops.filter(function (s, i) { return !drop[i]; });
  refreshStops();
  say(stops.length + " stop(s) left.");
});
clearStopsBtn.onClick = guardAction(function () { stops = []; refreshStops(); say("Stops cleared."); });
createRouteBtn.onClick = guardAction(function () {
  var map = currentMap();
  if (stops.length < 2) throw new Error("Add at least 2 stops to make a route.");
  // Decide the traveller first, so a bad selection refuses before anything is built.
  var kind = TRAVELLER_KINDS[travellerPicker.getValue()], layer = kind === "layer" ? travellerLayer(map) : null;
  var r = GeoScene.createRoute(map, stops, { arc: arcField.getValue(), labels: labelsAtStops.getValue(), shape: routeShapePicker.getValue() === 1 ? 1 : 0 });
  var travNote = "";
  if (kind) {
    try { GeoScene.addTraveller(map, r.groupId, kind, layer); }
    catch (e) { travNote = " The traveller couldn't be added: " + (e && e.message ? e.message : e) + "."; }
  }
  var how = r.stops ? " Drag its stops in the viewer, then Pin here to keep them there; animate its Travel % in the map's Controls."
    : " This Cavalry can't make Bézier lines, so it uses the older route style; animate its Travel % in the map's Controls.";
  say("Route created: " + r.legs.length + " leg(s)." + how + travNote + syncControls(map));
});
addTravellerBtn.onClick = guardAction(function () {
  var map = currentMap(), sel = [];
  try { sel = api.getSelection() || []; } catch (e) { sel = []; }
  var groupId = GeoScene.routeOfSelection(map, sel);
  if (!groupId) throw new Error("Select a route (any part of it) first.");
  var kind = TRAVELLER_KINDS[travellerPicker.getValue()], name = GeoScene.stripRoute(api.getNiceName(groupId));
  if (!kind) {
    if (!GeoScene.removeTraveller(map, groupId)) throw new Error("This route has no traveller to remove.");
    say("Traveller removed from " + name + "." + syncControls(map));
    return;
  }
  var had = GeoScene.findTravellers(map).some(function (t) { return t.groupId === groupId; });
  var r;
  try { r = GeoScene.addTraveller(map, groupId, kind, kind === "layer" ? travellerLayer(map) : null); }
  catch (e) {
    // The old traveller is gone before the new one is built, so bring the Controls up to date first.
    if (had) syncControls(map);
    throw e;
  }
  say("Traveller " + (r.replaced ? "replaced on " : "added to ") + r.routeName + "." + syncControls(map));
});
pinStopsBtn.onClick = guardAction(function () {
  var map = currentMap(), sel = [];
  try { sel = api.getSelection() || []; } catch (e) { sel = []; }
  if (!sel.length) throw new Error("Select one or more route stops (the circles) first.");
  var r = GeoScene.pinStops(map, sel);
  if (!r.pinned && !r.offGlobe.length) throw new Error("Select one or more route stops (the circles) first.");
  var msg = "Pinned " + r.pinned + " stop(s).";
  if (r.offGlobe.length) msg += " " + r.offGlobe.join(", ") + (r.offGlobe.length > 1 ? " are" : " is") + " past the map's edge, so " + (r.offGlobe.length > 1 ? "they" : "it") + " kept " + (r.offGlobe.length > 1 ? "their places." : "its place.");
  say(msg + syncControls(map));
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
    GeoStyle.panel([
      GeoStyle.heading("Place"),
      row(pinSearchField, pinSearchBtn),
      pinResultPicker,
      labelText,
      row(pinHereBtn, labelHereBtn),
      row(calloutHereBtn)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Preview (click to set the spot, drag to move)"),
      pinsPreview.layout
    ]),
    GeoStyle.panel([
      GeoStyle.heading("At coordinates"),
      row(new ui.Label("Lat"), latField, new ui.Label("Lon"), lonField),
      row(pinCoordBtn, labelCoordBtn),
      row(calloutCoordBtn)
    ])
  ]));
  labelPages.add(column([
    GeoStyle.panel([
      GeoStyle.heading("Stops"),
      row(routeSearchField, routeSearchBtn),
      row(routeResultPicker, addStopBtn),
      stopsList,
      row(removeStopBtn, clearStopsBtn)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Preview (click to add a stop, drag to move)"),
      routesPreview.layout
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Style"),
      row(GeoStyle.fieldLabel("Shape"), routeShapePicker),
      row(GeoStyle.fieldLabel("Arc height %"), arcField),
      row(labelsAtStops, new ui.Label("Labels at stops")),
      row(GeoStyle.fieldLabel("Traveller"), travellerPicker, addTravellerBtn),
      createRouteBtn,
      GeoStyle.note("Drag stops in the viewer, then Pin here to keep them there."),
      pinStopsBtn
    ])
  ]));
  labelTabs = GeoStyle.tabBar(LABEL_PAGES, function (name) { showLabelPage(name); });
  // Only a top margin, so the tab bar starts where every other page's first panel does.
  var labelColumn = new ui.VLayout();
  labelColumn.setMargins(0, 6, 0, 0); // the same 6 px top margin as every page column
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

// Load runs from the button (always, so a link can be reloaded) or from Return / leaving the box
// (only for a non-empty link that differs from the last one loaded).
var lastLoadedLink = ""; // set once a link has loaded, so a failed one runs again on Enter
function runLoad() {
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
  lastLoadedLink = url;
  say(table.rows.length + " rows, " + prepared.matched + " place(s) matched, " + prepared.unmatched.length + " unmatched" + (prepared.unmatched.length ? " (see list)." : "."));
}
dataLoadBtn.onClick = guardAction(runLoad);
dataLinkField.onValueCommitted = guardWork(function () {
  var url = dataLinkField.getText().trim();
  if (url && url !== lastLoadedLink) runLoad();
});

addDataBtn.onClick = guardAction(function () {
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
  say("Added " + Object.keys(r.layers).length + " data layer(s) for " + prepared.matched + " place(s)." + (prepared.years ? " Animate Data · Year (" + prepared.years[0] + "–" + prepared.years[1] + ") in the map's Controls." : "") + syncControls(map));
});

refreshDataBtn.onClick = guardAction(function () {
  sayNow("Refreshing data…");
  var r = GeoScene.refreshData(currentMap());
  if (!r.layers) throw new Error("This map has no data layers to refresh.");
  showUnmatched(r.unmatched);
  say("Refreshed " + r.layers + " layer(s): " + r.matched + " place(s) matched, " + r.unmatched.length + " unmatched.");
});

TAB_BUILDERS.push(function (tabs) {
  tabs.add("Data", column([
    GeoStyle.panel([
      GeoStyle.heading("Sheet"),
      row(dataLinkField, dataLoadBtn)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Columns"),
      row(GeoStyle.fieldLabel("Place"), placePicker),
      row(GeoStyle.fieldLabel("Value"), valuePicker),
      row(GeoStyle.fieldLabel("Year"), yearPicker),
      row(prefixField, suffixField)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Show"),
      GeoStyle.toggleGrid([regionsCheck, bubblesCheck, labelsCheck, legendCheck], 2),
      row(lookupCheck, new ui.Label("Look up unmatched names as places (cities)")),
      row(addDataBtn, refreshDataBtn)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Unmatched rows"),
      dataUnmatchedList
    ])
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
var imageryState = { plan: null, timer: null, job: null, tick: null, batch: null, night: false };
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
// Refilling the style list may make Cavalry report a pick; that must not overwrite the Map ID / style box.
var refreshingSource = false;
function refreshSourceUi() {
  var src = currentSource();
  licenceLabel.setText(src.licence);
  refreshingSource = true;
  try {
    stylePicker.clear();
    (src.suggestions || []).forEach(function (s) { stylePicker.addEntry(s); });
  } finally { refreshingSource = false; }
  resetImageryPlan();
}
function saveImagerySettings() {
  GeoNet.updateSettings({ source: currentSource().id, maptilerKey: maptilerKeyField.getText().trim(), mapboxKey: mapboxKeyField.getText().trim(),
    style: styleField.getText().trim(), customUrl: customUrlField.getText().trim(), customAttribution: customAttrField.getText().trim() });
}
function stopImageryTimer() {
  if (imageryState.timer) { imageryState.timer.stop(); imageryState.timer = null; }
  imageryState.job = null;
  imageryState.tick = null;
  imageryState.batch = null;
  imageryState.night = false;
}
function itemNoun(plan) { return plan.mode === "images" ? "images" : "tiles"; }
function ImageryTimerCallbacks() {
  this.onTimeout = function () {
    try { if (imageryState.tick) imageryState.tick(); } catch (e) {
      var night = imageryState.night, msg = e && e.message ? e.message : e;
      stopImageryTimer(); resetImageryPlan();
      say(night ? "Night lights didn't download: " + msg + " Build imagery or Refresh controls tries again." : "Error: " + msg);
    }
    if (!imageryState.timer) followActiveComp(false, true); // the job just ended: catch up silently, so its result message stays
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
// The keys, token, style, link and credit boxes are saved when you leave them, not only by Build imagery.
[maptilerKeyField, mapboxKeyField, styleField, customUrlField, customAttrField].forEach(function (f) {
  f.onValueCommitted = guard(function () { saveImagerySettings(); });
});
refreshSourceUi();
sourcePicker.onValueChanged = guard(function () { refreshSourceUi(); });
stylePicker.onValueChanged = guard(function () {
  if (refreshingSource) return; // refilling the list is not the user picking a style
  var s = currentSource().suggestions || [];
  if (s.length) styleField.setText(s[stylePicker.getValue()] || "");
  resetImageryPlan();
});

// Builds in timer steps so Cavalry stays responsive: the progress bar counts tiles,
// then the old imagery for this source is removed, a few layers per step.
// Night lights are the same build with plan.night: their status lines say "night lights", and they
// follow a day build (see startNightLights). jobWord names the job in the cancel and cleanup lines.
function jobWord(plan) { return plan.night ? "night lights" : "imagery"; }
// The status line of a download step: night lights say so instead of tiles or images.
function downloadLine(plan, count, total) {
  return plan.night ? "Downloading night lights: " + count + " / " + total + "…" : "Downloading " + itemNoun(plan) + ": " + count + " / " + total + "…";
}
// A night download that fails says so, and that Build imagery or Refresh controls tries again.
function failLine(plan, text) {
  return plan.night ? "Night lights didn't download: " + text + " Build imagery or Refresh controls tries again." : text;
}
// Night lights start after Day & night (over satellite imagery) when none exist yet. A small public-domain
// download, so no dialog and no plan signature. While another imagery job runs, they wait for Refresh controls.
function startNightLights(map, lead) {
  if (imageryState.timer) {
    // Night lights already on their way, or a day build that will chain them when it ends.
    say(imageryState.night ? lead : lead + " Night lights will follow when the current imagery job ends.");
    return;
  }
  try {
    var plan = GeoScene.planNightLights(map);
    plan.sig = null;
    startImageryDownload(map, GeoSources.night(), {}, plan);
  } catch (e) {
    stopImageryTimer(); resetImageryPlan();
    say(lead + " Night lights didn't download: " + (e && e.message ? e.message : e) + " Build imagery or Refresh controls tries again.");
  }
}

function startImageryBuild(map, src, opts, plan, missing, failed) {
  var job = GeoScene.beginImageryBuild(map, src, opts, plan);
  imageryState.job = job; // from here on, Cancel cancels the build rather than a download
  imageryProgress.setValue(0);
  say(plan.night ? "Building night lights…" : "Building imagery…");
  runImageryTimer(BUILD_TICK_MS, function () {
    var r = job.step(BUILD_BUDGET_MS);
    imageryProgress.setMaximum(Math.max(1, r.total));
    imageryProgress.setValue(r.built);
    if (!r.done) {
      if (r.phase === "discard") say("Cancelling — removing the partly built " + jobWord(plan) + "…");
      else if (r.phase === "cleanup") say("Removing the old " + jobWord(plan) + "…");
      else say((plan.night ? "Building night lights: " : "Building imagery: ") + r.built + " / " + r.total + " " + itemNoun(plan) + "…");
      return;
    }
    stopImageryTimer();
    resetImageryPlan();
    if (r.cancelled) { say(plan.night ? "Cancelled — no night lights were built." : "Cancelled — no imagery was built."); return; }
    var b = r.result;
    if (plan.night) {
      var nightNote = syncControls(map);
      say("Night lights added to " + map.name + " (NASA Black Marble 2016, public domain)." +
        (plan.zoomCapped ? " Night lights use zoom 8, NASA's most detailed, so close-ups are softer." : "") +
        (failed ? " " + failed + " tile(s) didn't download — delete the Night lights group (inside Day & night) and press Refresh controls to try again." : "") + nightNote);
      return;
    }
    // A street style (not satellite) makes night lights orphaned: they go. Satellite with Day & night and none yet: they follow.
    var st = GeoScene.nightLightsStatus(map), gone = "";
    if (st.orphaned) { GeoScene.removeNightLights(map); gone = " Night lights removed (they need satellite imagery)."; }
    var note = syncControls(map);
    var text = "Imagery built: " + b.tiles + " " + itemNoun(plan) + " in " + b.levels + " level(s) (" + missing + " missing, " + failed + " failed)." +
      (failed ? " Press Build again to retry." : "") +
      (b.unreadable > 0 ? (plan.mode === "images" ? " " + b.unreadable + " image(s) couldn't be read by Cavalry and were skipped."
        : " " + b.unreadable + " tiles couldn't be read by Cavalry (palette PNGs) — choose a JPG style or link.") : "") +
      " Credit: " + GeoSources.attribution(src, opts) + note + gone;
    if (st.wanted && !st.night.length) {
      say(text + " Adding night lights…");
      startNightLights(map, text);
    } else say(text);
  });
}

// 401/403: a keyed source rejected the key; a source without one turned the request down.
function refusedMessage(src, code) {
  return src.key ? GeoSources.providerName(src) + " rejected your key — check it in the Imagery tab."
    : GeoSources.providerName(src) + " refused the request (HTTP " + code + ") — try again later or choose another source.";
}

function startImageryDownload(map, src, opts, plan) {
  imageryState.night = !!plan.night;
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
  var byPath = {}, missing = 0, failed = 0, seen = 0, unreached = 0;
  jobs.forEach(function (j) { byPath[j.path] = j; });
  var batch = GeoFetch.start(jobs.map(function (j) { return { url: j.url, path: j.path }; }));
  imageryState.batch = batch;
  say(downloadLine(plan, 0, jobs.length));
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
      say(failLine(plan, refusedMessage(src, refused)));
      return;
    }
    imageryProgress.setValue(r.count);
    say(downloadLine(plan, r.count, jobs.length));
    // No line at all after FIRST_LINE_MS, or nothing but 000 (no connection made): curl
    // isn't working here, so the rest of the session downloads one file at a time.
    if (r.silent || ((r.done || r.stalled) && seen > 0 && unreached === seen)) {
      GeoFetch.disable();
      GeoFetch.abandon(batch);
      stopImageryTimer(); resetImageryPlan();
      say(plan.night ? "Night lights didn't download: background downloads aren't working on this computer. Build imagery or Refresh controls tries again."
        : "Background downloads aren't working on this computer — press Build imagery to plan again with map tiles.");
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
  var queue = jobs.slice(), total = queue.length, done = 0, missing = 0, failed = 0;
  runImageryTimer(DOWNLOAD_GAP_MS, function () {
    var j = queue.shift();
    var r = GeoNet.downloadTile(j.url, j.base);
    if (r.status === 401 || r.status === 403) {
      stopImageryTimer(); resetImageryPlan();
      say(failLine(plan, refusedMessage(src, r.status)));
      return;
    }
    if (r.unsupported) {
      stopImageryTimer(); resetImageryPlan();
      say(plan.night ? failLine(plan, "Cavalry can't load this image type (" + r.unsupported + ").")
        : "Cavalry can't load this image type (" + r.unsupported + ") — choose a PNG or JPG style or link.");
      return;
    }
    if (r.status === 404 || r.status === 204) { GeoNet.markEmptyTile(j.base); missing++; }
    else if (r.status !== 200) failed++;
    // A whole file now: no earlier background batch's claim on it may keep it out of the build.
    if (r.path) GeoFetch.release([r.path]);
    done++;
    imageryProgress.setValue(done);
    say(downloadLine(plan, done, total));
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
buildImageryBtn.onClick = guardAction(function () {
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
      " already downloaded" + (plan.reused ? ", including " + plan.reused + (plan.reused === 1 ? " saved image that already covers" : " saved images that already cover") + " the view" : "") + ", about " + GeoUtil.formatBytes(GeoBlocks.totalTiles(plan.missing) * 15000) + " to download)" +
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

cancelImageryBtn.onClick = guardAction(function () {
  disarmClearTiles();
  var night = imageryState.night, what = night ? "night lights" : "imagery";
  // During the build the timer keeps running: the job deletes the partly built imagery
  // in steps (or, once the new imagery is complete, finishes removing the old one).
  if (imageryState.job) {
    say(imageryState.job.cancel() ? "Cancelling — removing the partly built " + what + "…" : "The new " + what + " is already built — finishing removing the old " + what + "…");
    return;
  }
  if (!imageryState.timer) throw new Error("Nothing is downloading or building.");
  // The background curl can't be stopped: its files stay on the in-flight list (no
  // GeoFetch.finish) so the next plan treats them as missing until a batch reports them.
  if (imageryState.batch) {
    stopImageryTimer(); resetImageryPlan();
    say(night ? "Cancelled — no night lights were built." : "Download cancelled. Files still downloading in the background are kept; nothing was built.");
    followActiveComp(false);
    return;
  }
  stopImageryTimer();
  resetImageryPlan();
  say(night ? "Cancelled — no night lights were built." : "Download cancelled. Downloaded tiles are kept; nothing was built.");
  followActiveComp(false);
}, false, true);

imageryAttrBtn.onClick = guardAction(function () {
  disarmClearTiles();
  var src = currentSource(), text = GeoSources.attribution(src, sourceOptions(src));
  if (!text) throw new Error("Type a credit for the custom tiles first.");
  var map = currentMap();
  // Night lights, when the map has any, are credited too.
  if (GeoScene.findNightLights(map).length) text = [text, GeoSources.night().attribution].filter(Boolean).join(" · ");
  GeoScene.createImageryCredit(map, text);
  say("Added the imagery credit: " + text);
});

clearTilesBtn.onClick = guardAction(function () {
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
    GeoStyle.panel([
      GeoStyle.heading("Source"),
      sourcePicker,
      licenceLabel
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Keys and links"),
      row(GeoStyle.fieldLabel("MapTiler key"), maptilerKeyField),
      row(GeoStyle.fieldLabel("Mapbox token"), mapboxKeyField),
      row(GeoStyle.fieldLabel("Map ID / style"), styleField, stylePicker),
      row(GeoStyle.fieldLabel("Custom link"), customUrlField),
      row(GeoStyle.fieldLabel("Custom credit"), customAttrField)
    ]),
    GeoStyle.panel([
      GeoStyle.heading("Build"),
      row(buildImageryBtn, cancelImageryBtn),
      imageryProgress,
      imageryAttrBtn,
      clearTilesBtn
    ])
  ]));
});

// ---- Hover help -----------------------------------------------------------
// Every control gets its tooltip from GeoTips (src/cavalry/tips.js); one table pairs them.
var TIP_TARGETS = [
  [mapPicker, "map.picker"],
  [refreshMapsBtn, "map.refreshMaps"],
  [nameField, "map.name"],
  [projPicker, "map.projection"],
  [refreshControlsBtn, "map.refreshControls"],
  [searchField, "map.searchField"],
  [searchBtn, "map.search"],
  [resultPicker, "map.results"],
  [jumpBtn, "map.jump"],
  [createHereBtn, "map.createHere"],
  [flyBtn, "map.fly"],
  [flyStartField, "map.flyFrom"],
  [flyEndField, "map.flyTo"],
  [easingPicker, "map.easing"],
  [arcPicker, "map.zoomOut"],
  [updateFlightBtn, "map.updateFlight"],
  [driftPicker, "map.driftMove"],
  [driftBtn, "map.drift"],
  [mapStylePicker, "map.stylePicker"],
  [applyStyleBtn, "map.applyStyle"],
  [styleNameField, "map.styleName"],
  [saveStyleBtn, "map.saveStyle"],
  [deleteStyleBtn, "map.deleteStyle"],
  [tipsGotItBtn, "map.tipsGotIt"],
  [tipsBtn, "map.tips"],
  [checks.countries, "layers.countries"],
  [checks.states, "layers.states"],
  [checks.coastlines, "layers.coastlines"],
  [checks.lakes, "layers.lakes"],
  [checks.rivers, "layers.rivers"],
  [checks.cities, "layers.cities"],
  [checks.buildings, "layers.buildings"],
  [checks.roads, "layers.roads"],
  [checks.water, "layers.water"],
  [checks.parks, "layers.parks"],
  [checks.railways, "layers.railways"],
  [scalePicker, "layers.detail"],
  [modePicker, "layers.mode"],
  [creditCheck, "layers.credit"],
  [addLayersBtn, "layers.add"],
  [clearCacheBtn, "layers.clearCache"],
  [dayNightDayField, "overlays.day"],
  [dayNightMonthPicker, "overlays.month"],
  [dayNightTimeField, "overlays.time"],
  [timeLabelCheck, "overlays.timeLabel"],
  [addDayNightBtn, "overlays.addDayNight"],
  [addScaleBarBtn, "overlays.scaleBar"],
  [addNorthArrowBtn, "overlays.northArrow"],
  [layerPicker, "extract.layer"],
  [refreshLayersBtn, "extract.refresh"],
  [featureQuery, "extract.query"],
  [findBtn, "extract.find"],
  [featureList, "extract.list"],
  [extractBtn, "extract.extract"],
  [highlightEffectPicker, "highlight.effect"],
  [highlightStartField, "highlight.start"],
  [highlightLengthField, "highlight.frames"],
  [highlightBtn, "highlight.add"],
  [changeEffectBtn, "highlight.change"],
  [bakeBtn, "extract.bake"],
  [sourcePicker, "imagery.source"],
  [maptilerKeyField, "imagery.maptilerKey"],
  [mapboxKeyField, "imagery.mapboxKey"],
  [styleField, "imagery.styleField"],
  [stylePicker, "imagery.stylePicker"],
  [customUrlField, "imagery.customLink"],
  [customAttrField, "imagery.customCredit"],
  [buildImageryBtn, "imagery.build"],
  [cancelImageryBtn, "imagery.cancel"],
  [imageryAttrBtn, "imagery.attribution"],
  [clearTilesBtn, "imagery.clearTiles"],
  [pinSearchField, "pins.searchField"],
  [pinSearchBtn, "pins.search"],
  [pinResultPicker, "pins.results"],
  [labelText, "pins.text"],
  [pinHereBtn, "pins.pinHere"],
  [labelHereBtn, "pins.labelHere"],
  [calloutHereBtn, "pins.calloutHere"],
  [latField, "pins.lat"],
  [lonField, "pins.lon"],
  [pinCoordBtn, "pins.pinCoord"],
  [labelCoordBtn, "pins.labelCoord"],
  [calloutCoordBtn, "pins.calloutCoord"],
  [routeSearchField, "routes.searchField"],
  [routeSearchBtn, "routes.search"],
  [routeResultPicker, "routes.results"],
  [addStopBtn, "routes.addStop"],
  [stopsList, "routes.stops"],
  [removeStopBtn, "routes.removeStop"],
  [clearStopsBtn, "routes.clearStops"],
  [routeShapePicker, "routes.shape"],
  [arcField, "routes.arcHeight"],
  [labelsAtStops, "routes.labelsAtStops"],
  [travellerPicker, "routes.traveller"],
  [addTravellerBtn, "routes.addTraveller"],
  [createRouteBtn, "routes.create"],
  [pinStopsBtn, "routes.pinStops"],
  [dataLinkField, "data.link"],
  [dataLoadBtn, "data.load"],
  [placePicker, "data.place"],
  [valuePicker, "data.value"],
  [yearPicker, "data.year"],
  [prefixField, "data.prefix"],
  [suffixField, "data.suffix"],
  [regionsCheck, "data.regions"],
  [bubblesCheck, "data.bubbles"],
  [labelsCheck, "data.valueLabels"],
  [legendCheck, "data.legend"],
  [lookupCheck, "data.lookup"],
  [addDataBtn, "data.add"],
  [refreshDataBtn, "data.refresh"],
  [dataUnmatchedList, "data.unmatched"]
];
// (Dropdowns keep Cavalry's own look: setBackgroundColor on a DropDown only paints its open list.)
TIP_TARGETS.forEach(function (t) { GeoStyle.tip(t[0], GeoTips.text(t[1])); });

// Sections: one tab bar above one page per section. Builders register (name, layout);
// SECTION_ORDER sets the order (unlisted ones go last). The old section names still work in
// showSection: Extract lives in Layers, Pins and Routes in Label.
var SECTION_ORDER = ["Map", "Layers", "Imagery", "Label", "Data"];
var SECTION_ALIASES = { Extract: ["Layers", "Extract"], Pins: ["Label", "Pins"], Routes: ["Label", "Routes"] };
var sectionNames = [], sectionTabs = null, sectionPages = null;
function showSection(name) {
  var target = SECTION_ALIASES[name] || [name], i = sectionNames.indexOf(target[0]);
  if (i < 0) return;
  sectionTabs.select(target[0]);
  sectionPages.setPage(i);
  if (target[1]) { if (target[0] === "Layers") showLayersPage(target[1]); else showLabelPage(target[1]); }
  if (name === "Map" || target[0] === "Label") { try { refreshPreviews(); } catch (e) { /* cosmetic */ } }
}

// ---- Following the active composition ------------------------------------------------
// The panel shows the maps of the composition you are working in, so an edit never lands on a map in
// another comp. Cavalry calls onCompChanged when the active comp changes and onSceneChanged when a scene
// is loaded or made new. Imagery builds switch comps themselves (bent imagery is built in its own
// "Imagery source: ..." comp, every timer step), so those switches are ignored: while a download or
// build runs, and whenever the active comp is such a source comp. followedComp is the comp the panel
// last showed; once a job ends, a different active comp is caught up with.
var followedComp = null;
function activeCompId() {
  try { return api.getActiveComp(); } catch (e) { return null; }
}
function isImagerySourceComp(id) {
  try { return String(api.getNiceName(id)).indexOf("Imagery source: ") === 0; } catch (e) { return false; }
}
function followActiveComp(sceneChanged, quiet) {
  try {
    if (sceneChanged) followedComp = null; // a new scene may reuse the old comp's id
    if (imageryState.timer || imageryState.job) return; // a build is switching comps: catch up when it ends
    var now = activeCompId();
    if (now === null || isImagerySourceComp(now)) return;
    if (now === followedComp) return;
    followedComp = now;
    var picked = null;
    try { if (!newMapSelected()) picked = currentMap().cameraId; } catch (e) { picked = null; }
    refreshMaps(picked); // keeps the picked map when it is in this comp, else the first map or New map
    if (newMapSelected()) clearSourceLayers(); else refreshSourceLayers();
    resetImageryPlan();
    var name = "";
    try { name = String(api.getNiceName(now) || ""); } catch (e) { name = ""; }
    if (!quiet) say(name ? "Showing maps in " + name + "." : "Showing maps in this composition.");
  } catch (e) {
    console.log("[CavalryGeo] Following the composition failed: " + (e && e.message ? e.message : e));
  }
}
function CompFollower() {
  this.onCompChanged = function () { followActiveComp(false); };
  this.onSceneChanged = function () { followActiveComp(true); };
}

function buildUi() {
  ui.setTitle("Cavalry Geo");
  if (typeof ui.setBackgroundColor === "function") ui.setBackgroundColor(GeoStyle.WINDOW_BACKGROUND);
  var layouts = {}, extra = [];
  TAB_BUILDERS.forEach(function (build) {
    build({ add: function (name, layout) {
      layouts[name] = layout;
      if (SECTION_ORDER.indexOf(name) < 0) extra.push(name);
    } });
  });
  sectionNames = SECTION_ORDER.filter(function (n) { return layouts[n]; }).concat(extra);
  sectionPages = GeoStyle.pageStack(GeoStyle.PAGE_BACKGROUND);
  sectionNames.forEach(function (name) { sectionPages.add(layouts[name]); });
  sectionPages.finish();
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
    try {
      var g = sectionTabs.widget.geometry();
      // The panel's insets plus the coloured page's: they exist only when panels are Containers.
      var inset = GeoStyle.hasContainer() ? GeoStyle.PANEL_INSET + 2 * GeoStyle.PAGE_INSET : 0;
      if (g && g.width > 50 + inset) [preview, pinsPreview, routesPreview].forEach(function (p) { p.setWidth(g.width - inset); });
    } catch (e) { /* older Cavalry */ }
  }
  ui.onResize = fitPreview;
  fitPreview();
  guard(function () { refreshMaps(); })();
  followedComp = activeCompId();
  try { if (typeof ui.addCallbackObject === "function") ui.addCallbackObject(new CompFollower()); } catch (e) { /* an older Cavalry: the Refresh button still works */ }
  guard(function () { previewStyle(); previewFollowPicked(); previewShowMap(); })();
  try { GeoUpdateCheck.run(say); } catch (e) { /* the update check never gets in the way */ }
}
buildUi();

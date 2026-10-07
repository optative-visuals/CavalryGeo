// Creates, connects and reads Cavalry Geo layers. Panel-only: uses `api` and `cavalry`.
var GeoScene = (function () {
  var A = GeoAttrs;
  var ATTRIBUTION_NAME = "OpenStreetMap credit";
  var OCEAN_NAME = "Ocean";
  var STYLE_KEY = "geoStyle";
  // Dark's layer styles (today's look), for callers that predate map styles. New layers are
  // drawn from their map's own style: layerStyle(map, kind).
  var STYLE = {};
  ["countries", "states", "lakes", "coastlines", "rivers", "cities", "buildings", "water", "parks", "roads", "railways",
    "extractFill", "extractLine", "pin", "label", "stop", "route"].forEach(function (k) { STYLE[k] = GeoStyles.layerStyle(GeoStyles.DARK, k); });
  var STOP_RADIUS = 8, ROUTE_KEY = "geoRoute";

  function setOne(id, attr, value) { var o = {}; o[attr] = value; api.set(id, o); }

  // The map's own style (user data geoStyle on its group), or Dark for a map made before styles.
  function styleOf(map) {
    var d = userData(map.groupId, STYLE_KEY);
    return d && typeof d === "object" ? GeoStyles.clean(d) : GeoStyles.DARK;
  }
  function setMapStyle(map, style) {
    if (typeof api.setUserData !== "function") return;
    var s = GeoStyles.clean(style);
    api.setUserData(map.groupId, STYLE_KEY, { name: s.name, colors: s.colors, widths: s.widths });
  }
  function layerStyle(map, kind) { return GeoStyles.layerStyle(styleOf(map), kind); }

  // A new Cavalry script layer already has one empty slot (index 0), so only add a
  // slot when the index doesn't exist yet — otherwise a spare unnamed slot is left over.
  // Slot 0 is always a number, so input lists put a number first.
  function addInputs(id, arrayAttr, inputs, values) {
    for (var i = 0; i < inputs.length; i++) {
      var name = inputs[i][0], attr = arrayAttr + "." + i, isColor = inputs[i][2] === "color";
      var type = isColor ? A.COLOR_INPUT_TYPE : (inputs[i][2] || "double");
      if (!api.hasAttribute(id, attr)) api.addDynamic(id, arrayAttr, type);
      try { api.renameAttribute(id, attr, name); } catch (e) { /* display name only */ }
      var value = values && values[name] !== undefined ? values[name] : inputs[i][1];
      setOne(id, attr, isColor ? A.COLOR_VALUE(value) : value);
    }
  }

  function readExpr(id, attr) {
    if (!api.hasAttribute(id, attr)) return "";
    try { return String(api.get(id, attr) || ""); } catch (e) { return ""; }
  }

  function camValues(cam) {
    return { centerLat: cam.lat, centerLon: cam.lon, zoom: cam.zoom, rotation: cam.rotation, projection: cam.projection };
  }

  function createMap(name, cam, style) {
    var groupId = api.create("group", name);
    style = style || GeoStyles.DARK;
    try { setMapStyle({ groupId: groupId }, style); } catch (e) { /* the map still works in Dark */ }
    var cameraId = api.create(A.CAMERA_LAYER_TYPE, name + " Camera");
    setOne(cameraId, A.CAMERA_EXPR_ATTR, GeoExpression.cameraExpression({ name: name }, A.CAMERA_BODY));
    addInputs(cameraId, A.CAMERA_ARRAY_ATTR, GeoExpression.CAMERA_INPUTS, camValues(cam));
    api.parent(cameraId, groupId);
    try { createOcean(groupId, GeoStyles.layerStyle(style, "ocean")); } catch (e) { /* the Ocean is cosmetic: never fail the map over it */ }
    return { name: name, cameraId: cameraId, groupId: groupId };
  }

  // The canvas has no water layer (the sea is the composition background), so each new
  // map gets a dark rectangle at the bottom of its group, twice the comp size so it
  // still covers the frame when the map group is moved or scaled. Optional: skipped
  // when this Cavalry has no api.primitive.
  function createOcean(groupId, oceanStyle) {
    // Read the selection before anything is created (Cavalry may select new layers) and
    // put it back however this returns, so the user's selection is never changed.
    var previous = null;
    try { previous = api.getSelection(); } catch (e) { /* nothing to restore */ }
    try {
      if (typeof api.primitive !== "function") return;
      var s = compSize();
      var id = api.primitive("rectangle", OCEAN_NAME);
      setOne(id, "generator.dimensions", [2 * s.width, 2 * s.height]);
      applyStyle(id, oceanStyle);
      api.parent(id, groupId);
      if (typeof api.moveToBack !== "function" || typeof api.select !== "function") return;
      try { sendToBack(id); } catch (e) { /* best-effort: it was just parented on top, so it may sit above the camera */ }
    } finally {
      if (previous && typeof api.select === "function") { try { api.select(previous); } catch (e) { /* cosmetic */ } }
    }
  }

  function findMaps() {
    var maps = [];
    api.getCompLayers(false).forEach(function (id) {
      var meta = GeoExpression.readTag(readExpr(id, A.CAMERA_EXPR_ATTR), "GEO_CAMERA");
      if (meta) maps.push({ name: meta.name, cameraId: id, groupId: api.getParent(id) });
    });
    return maps;
  }

  function readCamera(cameraId) {
    function v(i) { return Number(api.get(cameraId, A.CAMERA_ARRAY_ATTR + "." + i)); }
    return { lat: v(0), lon: v(1), zoom: v(2), rotation: v(3), projection: Math.round(v(4)) };
  }

  function setCamera(cameraId, cam) {
    var vals = camValues(cam), o = {};
    GeoExpression.CAMERA_INPUTS.forEach(function (inp, i) {
      if (vals[inp[0]] !== undefined) o[A.CAMERA_ARRAY_ATTR + "." + i] = vals[inp[0]];
    });
    api.set(cameraId, o);
  }

  function compSize() { return A.readResolution(api.get(api.getActiveComp(), A.COMP_RESOLUTION_ATTR)); }

  function connectCamera(cameraId, targetId, targetArrayAttr) {
    for (var i = 0; i < GeoExpression.CAMERA_INPUTS.length; i++) {
      api.connect(cameraId, A.CAMERA_ARRAY_ATTR + "." + i, targetId, targetArrayAttr + "." + i, true);
    }
  }

  function applyStyle(id, style) {
    api.setFill(id, !!style.fill);
    if (style.fill) setOne(id, A.FILL_COLOR_ATTR, A.COLOR_VALUE(style.fill));
    api.setStroke(id, !!style.stroke);
    if (style.stroke) {
      setOne(id, A.STROKE_COLOR_ATTR, A.COLOR_VALUE(style.stroke));
      setOne(id, A.STROKE_WIDTH_ATTR, style.width || 1);
    }
  }

  function createMapLayer(map, name, enc, meta, style, inputValues, parentId) {
    var id = api.create(A.MAP_LAYER_TYPE, name);
    addInputs(id, A.MAP_ARRAY_ATTR, GeoExpression.MAP_INPUTS, inputValues);
    setOne(id, A.MAP_EXPR_ATTR, GeoExpression.mapLayerExpression(GEO_RUNTIME_SRC, enc, meta, { ellipseScale: A.ELLIPSE_SCALE }));
    connectCamera(map.cameraId, id, A.MAP_ARRAY_ATTR);
    applyStyle(id, style);
    api.parent(id, parentId || map.groupId);
    return id;
  }

  function layerMeta(id) { return GeoExpression.readTag(readExpr(id, A.MAP_EXPR_ATTR), "GEO_META"); }

  function findMapLayers(map) {
    var out = [];
    api.getCompLayers(false).forEach(function (id) {
      var expr = readExpr(id, A.MAP_EXPR_ATTR), meta = GeoExpression.readTag(expr, "GEO_META");
      // size (the expression's length, data included) tells a caller whether a layer's data changed
      if (meta && meta.camera === map.cameraId) out.push({ id: id, name: api.getNiceName(id), meta: meta, size: expr.length });
    });
    return out;
  }

  function readLayerData(layerId) {
    var enc = GeoExpression.readData(readExpr(layerId, A.MAP_EXPR_ATTR));
    if (!enc) throw new Error("That layer has no Cavalry Geo map data.");
    return enc;
  }

  function addPin(map, name, lon, lat, parentId) {
    var enc = GeoCodec.encodeLayer({ kind: "point", features: [{ name: name, rank: 1, rings: [[[lon, lat]]] }] });
    return createMapLayer(map, "Pin: " + name, enc, { camera: map.cameraId, category: "pin" }, layerStyle(map, "pin"), { pointRadius: 8 }, parentId);
  }

  function createRouteLeg(map, parentId, name, enc, lift) {
    var id = api.create(A.MAP_LAYER_TYPE, name);
    addInputs(id, A.MAP_ARRAY_ATTR, GeoExpression.ROUTE_INPUTS, { lift: lift });
    setOne(id, A.MAP_EXPR_ATTR, GeoExpression.routeLayerExpression(GEO_RUNTIME_SRC, enc, { camera: map.cameraId, category: "route" }, { ellipseScale: A.ELLIPSE_SCALE }));
    connectCamera(map.cameraId, id, A.MAP_ARRAY_ATTR);
    applyStyle(id, layerStyle(map, "route"));
    if (A.STROKE_CAP_ATTR) { try { setOne(id, A.STROKE_CAP_ATTR, A.ROUND_CAP_VALUE); } catch (e) { /* default caps */ } }
    api.parent(id, parentId);
    return id;
  }

  var ROUTE_NUMBER_KEY = "geoRouteNumber", ROUTE_TRAVEL_KEY = "geoRouteTravel";
  var ROUTE_PREFIX = /^Route( \d+)?: /;
  // A route group's name is capped at 60 characters.
  function capTitle(t) { return t.length > 60 ? t.slice(0, 59) + "…" : t; }
  function routeTitle(stops, number) {
    return capTitle("Route " + number + ": " + stops.map(function (s) { return s.name; }).join(" → "));
  }
  function stripRoute(name) { return String(name).replace(ROUTE_PREFIX, ""); }
  function numberOf(groupId, key) { var n = Number(userData(groupId, key)); return n >= 1 && Math.floor(n) === n ? n : 0; }
  function routeNumber(groupId) { return numberOf(groupId, ROUTE_NUMBER_KEY); }

  // Sorts layers (ids or { id }) in Scene Window order under groupId: top first, a group's
  // children right after it; layers outside the group go last. The groups in `skip` (imagery,
  // which holds thousands of tiles) are ranked but not looked inside.
  function sceneOrder(groupId, skip) {
    var order = {}, n = 0;
    skip = skip || {};
    function visit(id) { api.getChildren(id).forEach(function (k) { order[k] = n++; if (!skip[k]) visit(k); }); }
    function at(x) { var id = typeof x === "string" ? x : x.id; return order[id] === undefined ? 1e9 : order[id]; }
    visit(groupId);
    return function (a, b) { return at(a) - at(b); };
  }
  // The map's Scene Window order, never looking inside its imagery groups.
  function mapOrder(map) {
    var skip = {};
    findImagery(map).forEach(function (im) { skip[im.groupId] = true; });
    return sceneOrder(map.groupId, skip);
  }

  // Every route group of the map (new style from geoRoute, old style = groups holding script legs),
  // in Scene Window order (top first). order: a sceneOrder the caller already made, else a fresh one.
  function routeGroups(map, mapLayers, routes, order) {
    var seen = {}, out = [];
    (routes || findRoutes(map)).forEach(function (r) { if (!seen[r.groupId]) { seen[r.groupId] = true; out.push(r.groupId); } });
    (mapLayers || findMapLayers(map)).forEach(function (l) {
      if (l.meta.category !== "route") return;
      var g = api.getParent(l.id);
      if (g && g !== map.groupId && !seen[g]) { seen[g] = true; out.push(g); }
    });
    return out.sort(order || mapOrder(map));
  }

  // A group still named with the plugin's `prefix` takes "<word> <number>: " instead (capped at
  // 60 characters); a name the user gave it is left alone.
  function renameNumbered(groupId, prefix, word, number) {
    if (typeof api.rename !== "function") return;
    try {
      var name = String(api.getNiceName(groupId));
      if (name.indexOf(prefix) === 0) api.rename(groupId, capTitle(word + " " + number + ": " + name.slice(prefix.length)));
    } catch (e) { /* cosmetic */ }
  }

  // Gives every numbered group (routes, highlights) a lasting number under `key`. groups: the
  // map's groups in Scene Window order (top first). They are walked in creation order (oldest
  // first, from the bottom of the Scene Window up): a group without a number, or one sharing its
  // number with an older group (a duplicated group copies the number), takes the highest
  // number + 1. Returns the highest number.
  function numberGroups(groups, key, word) {
    var top = 0, seen = {};
    groups.forEach(function (g) { top = Math.max(top, numberOf(g, key)); });
    if (typeof api.setUserData !== "function") return top;
    groups.slice().reverse().forEach(function (g) {
      var n = numberOf(g, key);
      if (n && !seen[n]) { seen[n] = true; return; }
      try { api.setUserData(g, key, top + 1); } catch (e) { return; }
      top += 1;
      seen[top] = true;
      renameNumbered(g, n ? word + " " + n + ": " : word + ": ", word, top);
    });
    return top;
  }
  function numberRoutes(map, groups) { return numberGroups(groups, ROUTE_NUMBER_KEY, "Route"); }

  // A "Leg k draw" helper: the route's Travel % -> this leg's trim end. A helper that can't be
  // set up and wired is deleted again before the error goes on.
  function addLegDraw(map, parentId, line, index, count, track) {
    var id = api.create(A.CAMERA_LAYER_TYPE, "Leg " + (index + 1) + " draw");
    if (track) track(id);
    try {
      addInputs(id, A.CAMERA_ARRAY_ATTR, GeoExpression.ROUTE_DRAW_INPUTS, { travel: 100, index: index, count: count });
      setOne(id, A.CAMERA_EXPR_ATTR, GeoExpression.routeDrawExpression({ camera: map.cameraId, category: "routeDraw" }));
      api.parent(id, parentId);
      try { setOne(line, "stroke.trim", true); } catch (e) { /* draw-on stays off */ }
      api.connect(id, A.DRIVER_OUTPUT_ATTR, line, "stroke.trimEnd", true);
    } catch (e) {
      try { if (layerThere(id)) api.deleteLayer(id); } catch (e2) { /* already gone */ }
      throw e;
    }
    return id;
  }
  // A leg's trim end is the user's when it is keyframed, connected to anything, or set by hand
  // to something other than fully drawn (100): such a leg gets no draw helper.
  function trimTaken(line) {
    var from = "";
    try { from = String(api.getInConnection(line, "stroke.trimEnd") || ""); } catch (e) { from = ""; }
    var keys = [];
    try { keys = api.getKeyframeTimes(line, "stroke.trimEnd") || []; } catch (e) { keys = []; }
    if (from || keys.length > 0) return true;
    var v = NaN;
    try { v = Number(api.get(line, "stroke.trimEnd")); } catch (e) { v = NaN; }
    return isFinite(v) && Math.abs(v - 100) > 1e-6;
  }
  // An old-style route's geoRouteTravel legs that belong to this group (a duplicated group
  // copies the record, which still names the original's legs).
  function ownTravelLegs(groupId) {
    var old = userData(groupId, ROUTE_TRAVEL_KEY);
    return ((old && old.legs) || []).filter(function (l) {
      try { return !!l.line && api.getParent(l.line) === groupId; } catch (e) { return false; }
    });
  }
  function routeDraws(groupId) {
    var rec = userData(groupId, ROUTE_KEY), legs = (rec && rec.legs) || ownTravelLegs(groupId);
    return legs.map(function (l) { return l.draw; }).filter(function (d) { return !!d && layerThere(d); });
  }

  // Same lon/lat to 1e-9, matching the panel's Add-stop duplicate check.
  function samePlace(a, b) { return Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9; }

  // Pairs of consecutive stops that make a leg; identical consecutive stops are skipped
  // (e.g. a round trip's A -> ... -> A would make an empty leg), so leg numbering continues
  // without gaps. Refuses before anything is created.
  function routePairs(stops) {
    if (!stops || stops.length < 2) throw new Error("Add at least 2 stops to make a route.");
    var pairs = [];
    for (var i = 0; i < stops.length - 1; i++) if (!samePlace(stops[i], stops[i + 1])) pairs.push([stops[i], stops[i + 1]]);
    if (!pairs.length) throw new Error("Add at least 2 different stops to make a route.");
    return pairs;
  }

  // Old-style route (script-drawn legs + pins at stops), used when this Cavalry can't make Bézier lines.
  // number: the route's number (createRoute numbers the older routes first).
  function createOldRoute(map, stops, pairs, opts, number) {
    var groupId = api.create("group", routeTitle(stops, number));
    if (typeof api.setUserData === "function") api.setUserData(groupId, ROUTE_NUMBER_KEY, number);
    api.parent(groupId, map.groupId);
    api.set(groupId, identityTransform()); // api.parent keeps the world transform: reset it
    var legs = [];
    var lift = opts.arc != null ? opts.arc : (opts.lift != null ? opts.lift : 30);
    pairs.forEach(function (pair, idx) {
      var a = pair[0], b = pair[1], name = a.name + " → " + b.name;
      var ends = A.TRIM_REVERSED ? [[b.lon, b.lat], [a.lon, a.lat]] : [[a.lon, a.lat], [b.lon, b.lat]];
      var enc = GeoCodec.encodeLayer({ kind: "route", features: [{ name: name, rank: 1, rings: [ends] }] });
      legs.push(createRouteLeg(map, groupId, "Leg " + (idx + 1) + ": " + name, enc, lift));
    });
    // At most one pin and one label per distinct place, so a round trip A -> B -> A
    // gets one pin at A, not two.
    var seen = [];
    stops.forEach(function (s) {
      if (seen.some(function (p) { return samePlace(p, s); })) return;
      seen.push(s);
      if (opts.pins !== false) addPin(map, s.name, s.lon, s.lat, groupId);
      if (opts.labels) createLabel(map, s.name, s.lon, s.lat, groupId);
    });
    if (typeof api.setUserData === "function") {
      // The helpers made are always recorded. One that can't be wired is deleted again (by
      // addLegDraw) and the legs left without one get theirs on the next Controls refresh.
      var travel = { legs: [] };
      try {
        legs.forEach(function (line, i) { travel.legs.push({ line: line, draw: addLegDraw(map, groupId, line, i, legs.length) }); });
      } catch (e) { /* the route still draws; prepareRoutes tries those legs again */ }
      finally { api.setUserData(groupId, ROUTE_TRAVEL_KEY, travel); }
    }
    return { groupId: groupId, legs: legs };
  }

  // A new-style route: stops (holder following the camera + a circle to drag) joined by
  // Bézier legs whose ends and handles are worked out by small helper scripts.
  // api.create / api.primitive make a layer beside the selection and api.parent keeps the
  // world transform (rewriting the local one), so every layer is reset right after it is
  // parented. A holder's position is driven, so only its rotation and scale are reset; the
  // helper utilities have no transform at all.
  function buildRoute(map, stops, pairs, opts, track, number) {
    var E = GeoExpression, CA = A.CAMERA_ARRAY_ATTR, arc = opts.arc != null ? opts.arc : 30;
    var look = styleOf(map);
    var groupId = track(api.create("group", routeTitle(stops, number)));
    if (typeof api.setUserData === "function") api.setUserData(groupId, ROUTE_NUMBER_KEY, number);
    api.parent(groupId, map.groupId);
    api.set(groupId, identityTransform());
    var helpers = track(api.create("group", "Route helpers"));
    api.parent(helpers, groupId);
    api.set(helpers, identityTransform());
    var places = [];
    stops.forEach(function (s) { if (!places.some(function (p) { return samePlace(p, s); })) places.push(s); });
    function placeIndex(s) { for (var i = 0; i < places.length; i++) if (samePlace(places[i], s)) return i; return -1; }
    function utility(name, inputs, values, expr) {
      var id = track(api.create(A.CAMERA_LAYER_TYPE, name));
      addInputs(id, CA, inputs, values);
      setOne(id, A.CAMERA_EXPR_ATTR, expr);
      api.parent(id, helpers);
      return id;
    }
    function feed(id, sources) { sources.forEach(function (s, i) { api.connect(s[0], s[1], id, CA + "." + i, true); }); }
    var meta = function (category) { return { camera: map.cameraId, category: category }; };

    var stopData = places.map(function (p) {
      var holder = track(api.create("group", "Stop: " + p.name));
      var circle = track(api.primitive("ellipse", p.name));
      setOne(circle, "generator.radius", [STOP_RADIUS, STOP_RADIUS]);
      applyStyle(circle, GeoStyles.layerStyle(look, "stop"));
      api.parent(circle, holder);
      api.set(circle, identityTransform());
      var label = null;
      if (opts.labels) {
        label = track(api.create(A.TEXT_LAYER_TYPE, p.name));
        setOne(label, A.TEXT_ATTR, p.name);
        applyStyle(label, GeoStyles.layerStyle(look, "label"));
        api.parent(label, circle);
        api.set(label, { "rotation.z": 0, "scale.x": 1, "scale.y": 1 });
        setOne(label, "position", [STOP_RADIUS + 6, STOP_RADIUS + 6]);
      }
      var position = utility(p.name + " position", E.LABEL_INPUTS, { labelLon: p.lon, labelLat: p.lat }, E.labelDriverExpression(GEO_RUNTIME_SRC, meta("stopDriver"), A.DRIVER_RETURN));
      connectCamera(map.cameraId, position, CA);
      api.connect(position, A.DRIVER_OUTPUT_ATTR, holder, "position", true);
      var visibility = utility(p.name + " visibility", E.LABEL_INPUTS, { labelLon: p.lon, labelLat: p.lat }, E.labelVisibilityExpression(GEO_RUNTIME_SRC, meta("stopVisibility")));
      connectCamera(map.cameraId, visibility, CA);
      api.connect(position, CA + ".5", visibility, CA + ".5", true);
      api.connect(position, CA + ".6", visibility, CA + ".6", true);
      api.connect(visibility, A.DRIVER_OUTPUT_ATTR, holder, "opacity", true);
      var endPoint = utility(p.name + " end point", E.END_POINT_INPUTS, {}, E.routeEndPointExpression(meta("stopEnd")));
      feed(endPoint, [[holder, "position.x"], [holder, "position.y"], [circle, "position.x"], [circle, "position.y"]]);
      return { name: p.name, lon: p.lon, lat: p.lat, holder: holder, circle: circle, label: label, position: position, visibility: visibility, endPoint: endPoint };
    });

    var cam = readCamera(map.cameraId);
    var legData = pairs.map(function (pair, idx) {
      var a = stopData[placeIndex(pair[0])], b = stopData[placeIndex(pair[1])];
      var name = "Leg " + (idx + 1) + ": " + a.name + " → " + b.name;
      var line = track(api.create("basicLine", name));
      api.setGenerator(line, "generator", "bezierLine");
      applyStyle(line, GeoStyles.layerStyle(look, "route"));
      if (A.STROKE_CAP_ATTR) { try { setOne(line, A.STROKE_CAP_ATTR, A.ROUND_CAP_VALUE); } catch (e) { /* default caps */ } }
      try { setOne(line, "stroke.trim", true); setOne(line, "stroke.trimEnd", 100); } catch (e) { /* draw-on stays off */ }
      api.connect(a.endPoint, A.DRIVER_OUTPUT_ATTR, line, "generator.startPosition", true);
      api.connect(b.endPoint, A.DRIVER_OUTPUT_ATTR, line, "generator.endPosition", true);
      var seed = GeoCurve.handles(GeoRuntime.projectPoint(a.lon, a.lat, cam), GeoRuntime.projectPoint(b.lon, b.lat, cam), { arc: arc, lean: 0, flip: false });
      var sources = [[a.holder, "position.x"], [a.holder, "position.y"], [a.circle, "position.x"], [a.circle, "position.y"],
        [b.holder, "position.x"], [b.holder, "position.y"], [b.circle, "position.x"], [b.circle, "position.y"]];
      var handle = {};
      ["start", "end"].forEach(function (which) {
        var h = utility(name + " " + which + " handle", E.HANDLE_INPUTS, { arc: arc, handX: seed[which][0], handY: seed[which][1] },
          E.routeHandleExpression(GEO_CURVE_SRC, meta("legHandle"), which));
        feed(h, sources);
        api.connect(h, A.DRIVER_OUTPUT_ATTR, line, which === "start" ? "generator.startOffset" : "generator.endOffset", true);
        handle[which] = h;
      });
      var fade = utility(name + " fade", E.FADE_INPUTS, {}, E.routeFadeExpression(meta("legFade")));
      feed(fade, [[a.holder, "opacity"], [b.holder, "opacity"]]);
      api.connect(fade, A.DRIVER_OUTPUT_ATTR, line, "opacity", true);
      return { number: idx + 1, line: line, startHandle: handle.start, endHandle: handle.end, fade: fade, from: placeIndex(pair[0]), to: placeIndex(pair[1]) };
    });

    // New layers land on top of their group: legs first, then stops last-to-first, so the
    // first stop ends on top and every stop sits above the legs.
    legData.forEach(function (l) { api.parent(l.line, groupId); api.set(l.line, identityTransform()); });
    for (var i = stopData.length - 1; i >= 0; i--) {
      api.parent(stopData[i].holder, groupId);
      api.set(stopData[i].holder, { "rotation.z": 0, "scale.x": 1, "scale.y": 1 });
    }

    legData.forEach(function (l, i) { l.draw = addLegDraw(map, helpers, l.line, i, legData.length, track); });
    api.setUserData(groupId, ROUTE_KEY, {
      camera: map.cameraId, helpers: helpers,
      stops: stopData.map(function (s) { return { name: s.name, holder: s.holder, circle: s.circle, label: s.label, position: s.position, visibility: s.visibility, endPoint: s.endPoint }; }),
      legs: legData
    });
    return { groupId: groupId, legs: legData.map(function (l) { return l.line; }), stops: stopData.map(function (s) { return s.circle; }) };
  }

  // stops: [{ name, lon, lat }] in travel order; opts: { arc, labels }.
  function createRoute(map, stops, opts) {
    var pairs = routePairs(stops);
    opts = opts || {};
    // Older routes without a number (or sharing one) are numbered first, so this one takes the highest + 1.
    var number = numberRoutes(map, routeGroups(map)) + 1;
    if (typeof api.setGenerator !== "function" || typeof api.primitive !== "function" || typeof api.setUserData !== "function") return createOldRoute(map, stops, pairs, opts, number);
    var made = [];
    function track(id) { made.push(id); return id; }
    try {
      return buildRoute(map, stops, pairs, opts, track, number);
    } catch (e) {
      for (var i = made.length - 1; i >= 0; i--) { try { if (layerThere(made[i])) api.deleteLayer(made[i]); } catch (e2) { /* already gone */ } }
      throw e;
    }
  }

  function findRoutes(map) {
    var out = [];
    if (typeof api.hasUserDataKey !== "function") return out;
    function there(id) { return !!id && layerThere(id); }
    api.getCompLayers(false).forEach(function (id) {
      try {
        if (!api.hasUserDataKey(id, ROUTE_KEY)) return;
        var d = api.getUserDataKey(id, ROUTE_KEY);
        if (!d || d.camera !== map.cameraId) return;
        // title: every stop's name from the record, in full (the group name is capped at 60 characters).
        out.push({
          groupId: id, name: String(api.getNiceName(id)), helpers: d.helpers,
          title: (d.stops || []).map(function (s) { return String(s.name); }).join(" → "),
          stops: (d.stops || []).filter(function (s) { return there(s.holder) && there(s.circle) && there(s.position); }),
          legs: (d.legs || []).filter(function (l) { return there(l.line) && there(l.startHandle) && there(l.endHandle); })
        });
      } catch (e) { /* not a readable route */ }
    });
    return out;
  }

  function xy(v) { return v && v.x !== undefined ? [Number(v.x) || 0, Number(v.y) || 0] : [Number(v && v[0]) || 0, Number(v && v[1]) || 0]; }

  // ids: the user's selection. A stop counts when its circle, holder or label is selected.
  // Its dropped spot becomes its new place (the longitude and latitude on its position
  // driver) and the drag is zeroed. A stop whose spot is past the map's edge (the far side
  // of a globe, outside the Equal Earth outline), or whose camera inputs can't be read as
  // numbers, keeps its place and is listed in offGlobe.
  function pinStops(map, ids) {
    var want = {}, res = { pinned: 0, offGlobe: [] };
    (ids || []).forEach(function (id) { want[id] = true; });
    findRoutes(map).forEach(function (r) {
      r.stops.forEach(function (s) {
        if (!want[s.circle] && !want[s.holder] && !(s.label && want[s.label])) return;
        var h = xy(api.get(s.holder, "position")), c = xy(api.get(s.circle, "position"));
        function v(i) { return Number(api.get(s.position, A.CAMERA_ARRAY_ATTR + "." + i)); }
        var cam = { lat: v(0), lon: v(1), zoom: v(2), rotation: v(3), projection: Math.round(v(4)) };
        var ll = [cam.lat, cam.lon, cam.zoom, cam.rotation, cam.projection].every(isFinite)
          ? GeoProjection.unproject(cam, h[0] + c[0], h[1] + c[1]) : null;
        if (!ll || !isFinite(ll.lon) || !isFinite(ll.lat)) { res.offGlobe.push(s.name); return; }
        var o = {};
        o[A.CAMERA_ARRAY_ATTR + ".5"] = ll.lon;
        o[A.CAMERA_ARRAY_ATTR + ".6"] = ll.lat;
        api.set(s.position, o);
        api.set(s.circle, { position: [0, 0] });
        res.pinned++;
      });
    });
    return res;
  }

  function dataPayloads(prepared, opts) {
    var fmt = { prefix: opts.prefix || "", suffix: opts.suffix || "", format: 0, decimals: 1 };
    return {
      regions: { geo: prepared.regions.geo, series: prepared.regions.series, range: prepared.regions.range, title: prepared.title, fmt: fmt },
      points: { pts: prepared.points.pts, series: prepared.points.series, range: prepared.points.range, title: prepared.title, fmt: fmt },
      legend: { range: prepared.regions.range, title: prepared.title, fmt: fmt }
    };
  }

  function createDataLayer(map, parentId, name, inputs, values, expr, style, cameraLinked) {
    var id = api.create(A.MAP_LAYER_TYPE, name);
    addInputs(id, A.MAP_ARRAY_ATTR, inputs, values);
    setOne(id, A.MAP_EXPR_ATTR, expr);
    if (cameraLinked) connectCamera(map.cameraId, id, A.MAP_ARRAY_ATTR);
    applyStyle(id, style);
    api.parent(id, parentId);
    return id;
  }

  function createDataLayers(map, source, prepared, opts) {
    var E = GeoExpression, src = GEO_DATA_RUNTIME_SRC, p = dataPayloads(prepared, opts), layers = {};
    var look = styleOf(map);
    var year = prepared.years ? prepared.years[1] : 0;
    var groupId = api.create("group", "Data: " + prepared.title);
    api.parent(groupId, map.groupId);
    function meta(display) { return { camera: map.cameraId, category: "data", display: display, source: source }; }
    if (opts.regions) layers.regions = createDataLayer(map, groupId, "Regions: " + prepared.title, E.REGION_INPUTS, { year: year }, E.regionsExpression(src, p.regions, meta("regions")), GeoStyles.layerStyle(look, "regions"), true);
    if (opts.bubbles) {
      layers.bubbles = createDataLayer(map, groupId, "Bubbles: " + prepared.title, E.BUBBLE_INPUTS, { year: year }, E.bubblesExpression(src, p.points, meta("bubbles"), { ellipseScale: A.ELLIPSE_SCALE }), GeoStyles.layerStyle(look, "bubbles"), true);
      if (A.FILL_ALPHA_ATTR) { try { setOne(layers.bubbles, A.FILL_ALPHA_ATTR, 70); } catch (e) { /* opacity is cosmetic */ } }
    }
    if (opts.labels) layers.labels = createDataLayer(map, groupId, "Labels: " + prepared.title, E.VALUE_LABEL_INPUTS, { year: year }, E.valueLabelsExpression(src, p.points, meta("labels")), GeoStyles.layerStyle(look, "valueLabels"), true);
    if (opts.legend) {
      var s = compSize();
      if (layers.regions) {
        layers.legend = createDataLayer(map, groupId, "Legend: " + prepared.title, E.LEGEND_INPUTS, {}, E.legendExpression(src, p.legend, meta("legend")), GeoStyles.layerStyle(look, "legend"), false);
        E.LEGEND_INPUTS.forEach(function (inp, k) {
          api.connect(layers.regions, A.MAP_ARRAY_ATTR + "." + E.inputIndex(E.REGION_INPUTS, inp[0]), layers.legend, A.MAP_ARRAY_ATTR + "." + k, true);
        });
      } else if (layers.bubbles) {
        layers.legend = createDataLayer(map, groupId, "Legend: " + prepared.title, E.BUBBLE_LEGEND_INPUTS, {}, E.bubbleLegendExpression(src, p.legend, meta("bubbleLegend")), GeoStyles.layerStyle(look, "legend"), false);
        api.connect(layers.bubbles, A.MAP_ARRAY_ATTR + "." + E.inputIndex(E.BUBBLE_INPUTS, "maxRadius"), layers.legend, A.MAP_ARRAY_ATTR + ".0", true);
      }
      if (layers.legend) api.set(layers.legend, { position: [s.width / 2 - 340, -s.height / 2 + 60] });
    }
    return { groupId: groupId, layers: layers };
  }

  // Re-downloads every link used by this map's data layers and rewrites their stored data.
  function refreshData(map) {
    var bySource = {}, count = 0, matched = 0, unmatched = [];
    findMapLayers(map).forEach(function (l) {
      if (l.meta.category !== "data" || !l.meta.source) return;
      var key = JSON.stringify(l.meta.source);
      (bySource[key] = bySource[key] || { source: l.meta.source, layers: [] }).layers.push(l);
    });
    Object.keys(bySource).forEach(function (key) {
      var group = bySource[key], s = group.source;
      var table = GeoCsv.parse(GeoNet.fetchCsv(s.url));
      var countriesLayer = GeoNet.neLayer("countries", s.scale || "50m");
      var prepared = GeoDataset.prepare(table, s.choice, countriesLayer);
      if (s.lookup && prepared.unmatched.length) {
        prepared = GeoDataset.prepare(table, s.choice, countriesLayer, GeoNet.geocodePlaces(prepared.unmatched));
      }
      if (!prepared.matched) throw new Error("Refresh found no matching places in " + s.url + " — nothing was changed. Check the sheet's columns.");
      matched += prepared.matched; unmatched = unmatched.concat(prepared.unmatched);
      group.layers.forEach(function (l) {
        var oldExpr = readExpr(l.id, A.MAP_EXPR_ATTR), old = GeoExpression.readData(oldExpr) || {};
        var p = dataPayloads(prepared, { prefix: old.fmt ? old.fmt.prefix : "", suffix: old.fmt ? old.fmt.suffix : "" });
        var data = l.meta.display === "regions" ? p.regions : (l.meta.display === "legend" || l.meta.display === "bubbleLegend") ? p.legend : p.points;
        setOne(l.id, A.MAP_EXPR_ATTR, GeoExpression.replaceData(oldExpr, data));
        count++;
      });
    });
    return { layers: count, matched: matched, unmatched: unmatched };
  }

  function extract(map, sourceLayer, enc, group) {
    var sub = GeoCodec.subset(enc, group.indices);
    var style = layerStyle(map, enc.kind === "line" ? "extractLine" : "extractFill");
    var meta = { camera: map.cameraId, category: "extract", source: sourceLayer.meta.category };
    return createMapLayer(map, group.name || "Feature", sub, meta, style, { pointRadius: 6 });
  }

  function bake(layerId) {
    var meta = layerMeta(layerId);
    if (!meta) throw new Error("Select a Cavalry Geo map layer to bake.");
    if (meta.category === "data") throw new Error("Data layers can't be baked yet.");
    if (meta.category === "highlight") throw new Error("Highlights can't be baked.");
    // Read the camera from the layer's own connected inputs (generator.array.0..4,
    // same order as GeoExpression.MAP_INPUTS: lat, lon, zoom, rotation, projection),
    // not from the stored meta.camera id - the layer's transform reflects whatever
    // the layer is actually connected to right now, including if it was reconnected.
    function v(i) { return Number(api.get(layerId, A.MAP_ARRAY_ATTR + "." + i)); }
    var cam = { lat: v(0), lon: v(1), zoom: v(2), rotation: v(3), projection: Math.round(v(4)) };
    var enc = readLayerData(layerId);
    var detail = v(5);
    var radius = v(6);
    var lift = meta.category === "route" ? v(7) : undefined;
    var path = GeoRuntime.buildPath(enc, cam, detail, { pointRadius: radius, ellipseScale: A.ELLIPSE_SCALE, lift: lift }, cavalry.Path);
    var id = api.createEditable(path, api.getNiceName(layerId) + " (baked)");
    var parent = api.getParent(layerId);
    if (parent) api.parent(id, parent);
    ["position", "rotation", "scale"].forEach(function (attr) {
      try { setOne(id, attr, api.get(layerId, attr)); } catch (e) { /* missing attribute on this layer type; skip */ }
    });
    return id;
  }

  function createLabel(map, text, lon, lat, parentId) {
    var parent = parentId || map.groupId;
    if (A.LABEL_MODE === "driver") {
      var textId = api.create(A.TEXT_LAYER_TYPE, text);
      setOne(textId, A.TEXT_ATTR, text);
      applyStyle(textId, layerStyle(map, "label"));
      var driverId = api.create(A.CAMERA_LAYER_TYPE, text + " position");
      addInputs(driverId, A.CAMERA_ARRAY_ATTR, GeoExpression.LABEL_INPUTS, { labelLon: lon, labelLat: lat });
      setOne(driverId, A.CAMERA_EXPR_ATTR, GeoExpression.labelDriverExpression(GEO_RUNTIME_SRC, { camera: map.cameraId, category: "labelDriver" }, A.DRIVER_RETURN));
      connectCamera(map.cameraId, driverId, A.CAMERA_ARRAY_ATTR);
      api.connect(driverId, A.DRIVER_OUTPUT_ATTR, textId, "position", true);
      // A second helper sets the text's opacity: 0 when its place is behind the globe.
      // It reads lon/lat from the position helper, so editing them there moves both.
      var visId = api.create(A.CAMERA_LAYER_TYPE, text + " visibility");
      addInputs(visId, A.CAMERA_ARRAY_ATTR, GeoExpression.LABEL_INPUTS, { labelLon: lon, labelLat: lat });
      setOne(visId, A.CAMERA_EXPR_ATTR, GeoExpression.labelVisibilityExpression(GEO_RUNTIME_SRC, { camera: map.cameraId, category: "labelVisibility" }));
      connectCamera(map.cameraId, visId, A.CAMERA_ARRAY_ATTR);
      api.connect(driverId, A.CAMERA_ARRAY_ATTR + ".5", visId, A.CAMERA_ARRAY_ATTR + ".5", true);
      api.connect(driverId, A.CAMERA_ARRAY_ATTR + ".6", visId, A.CAMERA_ARRAY_ATTR + ".6", true);
      api.connect(visId, A.DRIVER_OUTPUT_ATTR, textId, "opacity", true);
      api.parent(driverId, parent);
      api.parent(visId, parent);
      api.parent(textId, parent);
      return textId;
    }
    var enc = GeoCodec.encodeLayer({ kind: "text", features: [{ name: text, rank: 1, rings: [[[lon, lat]]] }] });
    return createMapLayer(map, "Label: " + text, enc, { camera: map.cameraId, category: "label" }, layerStyle(map, "label"), { pointRadius: 24 }, parent);
  }

  // Newly created layers land on top of the group, which can bury an existing pin,
  // label or extract under later base layers. Restack so every base layer (one of
  // drawOrder's categories) sits below every overlay, ordered countries-lowest ...
  // cities-highest within the base layers. api.moveToBack's exact scope (within the
  // parent group vs the whole comp) is unverified, so this is best-effort: guarded
  // when the API is missing, and any failure only warns rather than undoing layers.
  // Cavalry's moveToBack / moveBackward take no arguments and act on the selection
  // (confirmed by check 5); getChildren lists a group top-first. Each base layer is
  // selected and sent to the back of its own parent; if that didn't land it last,
  // it is stepped backward until it does. The user's selection is restored after.
  function sendToBack(id) {
    var parent = api.getParent(id);
    var isLast = function () { var k = api.getChildren(parent); return k[k.length - 1] === id; };
    api.select([id]);
    api.moveToBack();
    for (var guardSteps = api.getChildren(parent).length; !isLast() && guardSteps > 0; guardSteps--) {
      if (typeof api.moveBackward !== "function") break;
      api.moveBackward();
    }
  }

  // The Ocean is the bottom of the map: whatever else was sent back, it goes under it.
  function sendOceanToBack(map) {
    var kids = api.getChildren(map.groupId);
    var ocean = kids.filter(function (id) { return api.getNiceName(id) === OCEAN_NAME; })[0];
    if (ocean && kids[kids.length - 1] !== ocean) sendToBack(ocean);
  }

  function restackBaseLayers(map, drawOrder) {
    if (typeof api.moveToBack !== "function" || typeof api.select !== "function") return;
    var previous = [];
    try { previous = api.getSelection(); } catch (e) { /* nothing selected */ }
    try {
      var layers = findMapLayers(map).filter(function (l) { return drawOrder.indexOf(l.meta.category) >= 0; });
      layers.sort(function (a, b) { return drawOrder.indexOf(b.meta.category) - drawOrder.indexOf(a.meta.category); });
      layers.forEach(function (l) { sendToBack(l.id); });
      findImagery(map).forEach(function (i) { sendToBack(i.groupId); });
      sendOceanToBack(map);
    } catch (e) { /* best-effort: leave layers where they landed */ }
    try { api.select(previous); } catch (e) { /* selection restore is cosmetic */ }
  }

  // ---- Imagery ------------------------------------------------------------------
  function compFrameRange() {
    var v = api.get(api.getActiveComp(), A.COMP_FRAME_RANGE_ATTR);
    if (Array.isArray(v)) return { start: Number(v[0]), end: Number(v[1]) };
    return { start: Number(v.x), end: Number(v.y) };
  }

  // Frames outside the keyed range just hold the end values, so they add nothing -
  // sample only from the first to the last camera keyframe (clamped to the comp
  // range); with no keyframes at all, sample just the current frame.
  function sampleCamera(map) {
    var range = compFrameRange(), previous = api.getFrame(), samples = [];
    var times = [];
    [0, 1, 2, 3, 4].forEach(function (i) {
      (api.getKeyframeTimes(map.cameraId, A.CAMERA_ARRAY_ATTR + "." + i) || []).forEach(function (f) { times.push(f); });
    });
    var start = previous, end = previous;
    if (times.length) {
      start = Math.max(range.start, Math.min.apply(null, times));
      end = Math.min(range.end, Math.max.apply(null, times));
      if (end < start) { start = previous; end = previous; } // keyed range falls entirely outside the comp
    }
    try {
      for (var f = start; f <= end; f++) { api.setFrame(f); samples.push(readCamera(map.cameraId)); }
    } finally { api.setFrame(previous); }
    return samples;
  }

  // Every plan item is a rect (GeoBlocks): a large image for EOX/NASA, a 1x1 rect (one
  // tile) for the other sources.
  function itemBase(plan, r) {
    return plan.mode === "images" ? GeoNet.imageBase(plan.cacheKey, r) : GeoNet.tileBase(plan.cacheKey, r.z, r.x0, r.y0);
  }
  function itemUrl(src, opts, plan, r) {
    return plan.mode === "images" ? GeoSources.imageUrl(src, r) : GeoSources.tileUrl(src, opts, r.z, r.x0, r.y0);
  }

  function planImagery(map, src, opts) {
    GeoSources.tileUrl(src, opts, 0, 0, 0); // validates key, style or link before any work
    // Large images need background downloads: one at a time, an EOX image would freeze
    // Cavalry ~15 s, so without curl EOX/NASA plan map tiles instead.
    var s = compSize(), samples = sampleCamera(map), images = GeoSources.usesImages(src) && GeoFetch.available();
    var set = GeoTiles.tileSet(samples, s.width, s.height, src.minZoom, src.maxZoom);
    if (!set.frames) throw new Error("Imagery needs the Web Mercator projection.");
    function itemsFor(ts) { return images ? GeoBlocks.blocksForTiles(ts.tiles) : ts.tiles.map(GeoBlocks.tileRect); }
    // An image covers the bounding box of the tiles it needs, so the image limit counts the
    // tiles' worth of pixels really downloaded (GeoBlocks.totalTiles), not the tiles needed.
    function over(ts, items) {
      return images ? items.length > GeoBlocks.MAX_IMAGES || GeoBlocks.totalTiles(items) > GeoBlocks.MAX_IMAGE_TILES : ts.tiles.length > GeoTiles.MAX_TILES;
    }
    var items = itemsFor(set), uncappedTiles = set.tiles.length, uncappedItems = items.length;
    // Too much: drop the sharpest level until it fits. The top built level never fades
    // out, so deeper zooms just show it magnified (softer, but complete).
    while (over(set, items) && set.hi > set.lo) {
      set = GeoTiles.tileSet(samples, s.width, s.height, src.minZoom, set.hi - 1);
      items = itemsFor(set);
    }
    if (over(set, items)) {
      var end = " — end the flight at a lower zoom or use a smaller composition.";
      if (!images) throw new Error("Too many tiles (" + set.tiles.length + ")" + end);
      throw new Error(items.length > GeoBlocks.MAX_IMAGES ? "Too many images (" + items.length + ")" + end
        : "Too many tiles' worth of images (" + GeoBlocks.totalTiles(items) + ")" + end);
    }
    var plan = { mode: images ? "images" : "tiles", items: items, tiles: set.tiles, lo: set.lo, hi: set.hi, cacheKey: GeoSources.cacheKey(src, opts) };
    if (images) plan.imageTiles = GeoBlocks.totalTiles(items);
    var left = {};
    GeoFetch.leftovers().forEach(function (p) { left[String(p).replace(/\\/g, "/")] = true; });
    plan.missing = items.filter(function (r) {
      var base = itemBase(plan, r), f = GeoNet.cachedTile(base);
      return (!f || left[f.replace(/\\/g, "/")]) && !GeoNet.isEmptyTile(base);
    });
    plan.cached = items.length - plan.missing.length;
    if (set.tiles.length < uncappedTiles) { plan.cappedZoom = set.hi; plan.uncappedTiles = uncappedTiles; plan.uncappedItems = uncappedItems; }
    return plan;
  }

  function findImagery(map) {
    var out = [];
    api.getCompLayers(false).forEach(function (id) {
      var meta = GeoExpression.readTag(readExpr(id, A.CAMERA_EXPR_ATTR), "GEO_META");
      if (meta && meta.category === "imagery" && meta.camera === map.cameraId && (typeof api.layerExists !== "function" || api.layerExists(meta.group))) {
        out.push({ driverId: id, groupId: meta.group, meta: meta });
      }
    });
    return out;
  }

  // Driver-mode labels of this map: each position helper and the text layer it moves.
  function labelDrivers(map) {
    var out = [];
    if (typeof api.getOutConnections !== "function") return out;
    api.getCompLayers(false).forEach(function (id) {
      var meta = GeoExpression.readTag(readExpr(id, A.CAMERA_EXPR_ATTR), "GEO_META");
      if (!meta || meta.category !== "labelDriver" || meta.camera !== map.cameraId) return;
      var conns = [];
      try { conns = api.getOutConnections(id, A.DRIVER_OUTPUT_ATTR) || []; } catch (e) { return; } // skips only this label
      conns.forEach(function (c) {
        var s = String(c), dot = s.indexOf(".");
        if (dot > 0 && s.slice(dot + 1) === "position") out.push({ driver: id, text: s.slice(0, dot) });
      });
    });
    return out;
  }
  function findLabels(map) { return labelDrivers(map).map(function (l) { return l.text; }); }

  function findOcean(map) {
    return api.getChildren(map.groupId).filter(function (id) { return api.getNiceName(id) === OCEAN_NAME; })[0] || null;
  }

  // Assets are reused by path and never deleted: deleting hundreds of assets in one
  // go can hang Cavalry.
  function existingAssets() {
    var byPath = {};
    if (typeof api.getAssetWindowLayers !== "function" || typeof api.getAssetFilePath !== "function") return byPath;
    api.getAssetWindowLayers(false).forEach(function (id) {
      try { byPath[String(api.getAssetFilePath(id)).replace(/\\/g, "/")] = id; } catch (e) { /* not a file asset */ }
    });
    return byPath;
  }

  function imageryDriver(map, parentId, name, expr, targetId, targetAttr) {
    var d = api.create(A.CAMERA_LAYER_TYPE, name);
    addInputs(d, A.CAMERA_ARRAY_ATTR, GeoExpression.IMAGERY_INPUTS);
    setOne(d, A.CAMERA_EXPR_ATTR, expr);
    connectCamera(map.cameraId, d, A.CAMERA_ARRAY_ATTR);
    api.connect(d, A.DRIVER_OUTPUT_ATTR, targetId, targetAttr, true);
    api.parent(d, parentId);
    return d;
  }

  function sendImageryToBack(map) {
    if (typeof api.moveToBack !== "function" || typeof api.select !== "function") return;
    var previous = [];
    try { previous = api.getSelection(); } catch (e) { /* nothing selected */ }
    try { findImagery(map).forEach(function (i) { sendToBack(i.groupId); }); sendOceanToBack(map); } catch (e) { /* best-effort */ }
    try { api.select(previous); } catch (e) { /* cosmetic */ }
  }

  function identityTransform() { return { "position.x": 0, "position.y": 0, "rotation.z": 0, "scale.x": 1, "scale.y": 1 }; }
  function layerThere(id) { return typeof api.layerExists !== "function" || api.layerExists(id); }
  function deleteIfThere(id) { if (layerThere(id)) api.deleteLayer(id); }
  function setHidden(id, hidden) { if (api.hasAttribute(id, "hidden")) api.set(id, { hidden: hidden }); }

  // Deleting a 300-tile imagery group in one call stalls Cavalry for seconds, so it is
  // taken apart in order: the tiles of each "z L" group, then the emptied level groups,
  // then the outer group (which takes its drivers with it).
  function teardownOrder(groupId) {
    var tiles = [], levelGroups = [];
    api.getChildren(groupId).forEach(function (id) {
      if (!/^z -?\d+$/.test(String(api.getNiceName(id)))) return;
      levelGroups.push(id);
      tiles = tiles.concat(api.getChildren(id));
    });
    return tiles.concat(levelGroups, [groupId]);
  }

  // Adding footage layers gets slower as the scene grows, and hundreds in one go freeze
  // Cavalry, so the build is a job the panel steps from a timer. step(budgetMs) works
  // until the budget is used (always at least one unit of work) and returns
  // { done, phase, built, total }, plus `result` ({ groupId, tiles, levels, unreadable })
  // when done or `cancelled: true` when cancelled. Phases, in order:
  //   "tiles"    - the outer group (hidden, so half-built imagery never renders) gets
  //                one tile per unit; level groups are made when their first tile lands.
  //   "drivers"  - rotation and level drivers, show the group, restack (one unit).
  //   "cleanup"  - hide the previous imagery for this source and delete it a layer per unit.
  // cancel() before "cleanup" switches to "discard": the new partial imagery is deleted a
  // layer per unit and the old imagery is left alone. During "cleanup" the new imagery is
  // already complete, so cancel() lets the cleanup finish (and returns false; it returns
  // true when the new imagery is being, or has been, discarded).
  function beginImageryBuild(map, src, opts, plan) {
    var previous = findImagery(map).filter(function (i) { return i.meta.cacheKey === plan.cacheKey; });
    var assetByPath = existingAssets(), base = (plan.mode === "tiles" && src.imagePx === 512) ? 0.5 : 1, built = 0, unreadable = 0;
    // Only items with a downloaded file are built, low level to high so higher levels land
    // on top. A level's origin covers all its files. A file still on the in-flight list may
    // be half written (curl never reported it), so it is skipped.
    var queue = [], inFlight = {};
    GeoFetch.leftovers().forEach(function (p) { inFlight[String(p).replace(/\\/g, "/")] = true; });
    for (var Lx = plan.lo; Lx <= plan.hi; Lx++) {
      var files = [];
      plan.items.forEach(function (r) {
        if (r.z !== Lx) return;
        var path = GeoNet.cachedTile(itemBase(plan, r));
        if (path && !inFlight[path.replace(/\\/g, "/")]) files.push({ L: Lx, rect: r, path: path });
      });
      if (!files.length) continue;
      var origin = GeoBlocks.levelOrigin(files.map(function (f) { return f.rect; }));
      files.forEach(function (f) { f.origin = origin; queue.push(f); });
    }
    var total = queue.length, next = 0, phase = "tiles", outer = null, level = null, builtLevels = [], pending = [], result = null;
    // Adding footage selects it, so the user's selection is put back at the end.
    var userSelection = [];
    try { userSelection = api.getSelection(); } catch (e) { /* nothing selected */ }

    // Measured in Cavalry: any step that loads an asset is followed by a ~3.6 s rescan of
    // all assets, however many it loaded, so every tile's asset is loaded in the first step.
    function loadAssets() {
      queue.forEach(function (f) {
        var key = f.path.replace(/\\/g, "/");
        if (!assetByPath[key]) assetByPath[key] = api.loadAsset(f.path, false);
      });
    }

    function startOuter() {
      loadAssets();
      outer = api.create("group", "Imagery: " + GeoSources.label(src, opts));
      api.parent(outer, map.groupId); // parented immediately so a mid-build throw never leaves it loose at the comp root
      // It may have been created inside a selected, transformed group: api.parent kept
      // that world transform, so reset it to identity before the rotation driver connects.
      api.set(outer, identityTransform());
      setHidden(outer, true);
      // The rotation driver carries the GEO_META tag, so it is made first: if the panel
      // is closed mid-build (stopping its timer), the half-built group is still found,
      // and removed, by the next build.
      var meta = { camera: map.cameraId, category: "imagery", group: outer, cacheKey: plan.cacheKey, sourceMeta: GeoSources.meta(src, opts) };
      imageryDriver(map, outer, "Imagery driver: rotation", GeoExpression.imageryRotationExpression(meta, A.ROTATION_SIGN), outer, "rotation.z");
    }

    function addTile(f) {
      var key = f.path.replace(/\\/g, "/");
      var asset = assetByPath[key] || (assetByPath[key] = api.loadAsset(f.path, false));
      var ids = api.addAssetToComp(asset), id = Array.isArray(ids) ? ids[0] : ids;
      // Palette PNGs load with a zero resolution and draw nothing: drop them.
      var res = null;
      try { res = api.get(id, "resolution"); } catch (e) { res = null; }
      if (res && res.x === 0) { api.deleteLayer(id); unreadable++; return; }
      if (!level || level.L !== f.L) {
        // The level group is made with its first readable tile, so a level whose tiles
        // are all unreadable never gets a group (or a place in the fade range).
        var lg = api.create("group", "z " + f.L);
        api.parent(lg, outer); // created low to high, so higher levels land on top
        // api.parent keeps the world transform and rewrites the local one, so reset
        // the level group to identity after parenting, before its drivers take over.
        api.set(lg, identityTransform());
        level = { L: f.L, group: lg, x0: f.origin.x0, y0: f.origin.y0 };
        builtLevels.push(level);
      }
      // Parent first (it keeps the world transform), then set the local transform.
      api.parent(id, level.group);
      var p = GeoBlocks.rectLocal(f.rect, f.origin), px = GeoBlocks.rectPixels(f.rect);
      // A 2-px overlap on each side hides hairline seams (260/256 for a single tile;
      // 257/256 still showed faint seams in Cavalry), on top of the 512px-source half scale.
      api.set(id, { "position.x": p[0], "position.y": p[1], "rotation.z": 0,
        "scale.x": base * (px[0] + 4) / px[0], "scale.y": base * (px[1] + 4) / px[1] });
      built++;
    }

    function connectDrivers() {
      // The fade range comes from the levels that really ended up with tiles, so an
      // empty top level doesn't blank out the level below it.
      var builtLo = builtLevels.length ? builtLevels[0].L : plan.lo;
      var builtHi = builtLevels.length ? builtLevels[builtLevels.length - 1].L : plan.hi;
      builtLevels.forEach(function (b) {
        var lv = { L: b.L, x0: b.x0, y0: b.y0, lo: builtLo, hi: builtHi };
        ["position", "scale", "opacity"].forEach(function (attr) {
          imageryDriver(map, outer, "Imagery driver: z " + b.L + " " + attr, GeoExpression.imageryLevelExpression(GEO_IMAGERY_RUNTIME_SRC, attr, lv), b.group, attr);
        });
      });
      setHidden(outer, false);
      sendImageryToBack(map);
      try { api.select(userSelection); } catch (e) { /* selection restore is cosmetic */ }
      result = { groupId: outer, tiles: built, levels: builtLevels.length, unreadable: unreadable };
      // Only now, with the new imagery complete, is the old imagery for this cache key
      // queued for deletion (never the group just built, in case an id was reused).
      // It is hidden first so a half-deleted copy never shows.
      previous.forEach(function (i) {
        if (i.groupId === outer || !layerThere(i.groupId)) return;
        setHidden(i.groupId, true);
        pending = pending.concat(teardownOrder(i.groupId));
      });
    }

    function unit() {
      if (phase === "tiles") {
        if (!outer) startOuter();
        if (next < total) addTile(queue[next++]);
        if (next >= total) phase = "drivers";
      } else if (phase === "drivers") {
        connectDrivers();
        phase = pending.length ? "cleanup" : "done";
      } else {
        deleteIfThere(pending.shift());
        if (!pending.length) phase = phase === "cleanup" ? "done" : "cancelled";
      }
    }

    function finished() { return phase === "done" || phase === "cancelled" || phase === "failed"; }

    function step(budgetMs) {
      var start = Date.now(), first = true;
      try {
        while (!finished() && (first || Date.now() - start < budgetMs)) { first = false; unit(); }
      } catch (e) {
        // A failed build or discard tears the new (partial) group down in one call and
        // leaves the old imagery alone. A failed cleanup keeps the finished new imagery.
        if (phase !== "cleanup" && outer) { try { deleteIfThere(outer); } catch (e2) { /* already failing */ } }
        phase = "failed";
        throw e;
      }
      var r = { done: finished(), phase: phase, built: next, total: total };
      if (phase === "done") r.result = result;
      if (phase === "cancelled") r.cancelled = true;
      return r;
    }

    function cancel() {
      if (phase === "discard" || phase === "cancelled") return true;
      if (phase !== "tiles" && phase !== "drivers") return false;
      pending = outer && layerThere(outer) ? teardownOrder(outer) : [];
      phase = pending.length ? "discard" : "cancelled";
      return true;
    }

    return { step: step, cancel: cancel };
  }

  // Builds in one go (no time budget): used where a pause doesn't matter, and by tests.
  function buildImagery(map, src, opts, plan) {
    var job = beginImageryBuild(map, src, opts, plan), r;
    do { r = job.step(Infinity); } while (!r.done);
    return r.result;
  }

  // ---- Fly-to -------------------------------------------------------------------
  // Lengthens the composition to newEnd. Layers already made keep their own out frames (they would
  // cut a longer flight off), so every layer that reached the old end is moved to newEnd + 1 (a
  // layer's out frame is one past its last frame); layers trimmed to end earlier are left alone.
  // The play range follows only when it reached the old end. Returns null when nothing is needed.
  function extendComp(newEnd) {
    var comp = api.getActiveComp(), oldEnd = compFrameRange().end, layers = 0;
    if (!(newEnd > oldEnd)) return null;
    if (typeof api.getOutFrame === "function" && typeof api.setOutFrame === "function") {
      api.getCompLayers(false).forEach(function (id) {
        try {
          if (Number(api.getOutFrame(id)) >= oldEnd) { api.setOutFrame(id, newEnd + 1); layers++; }
        } catch (e) { /* one layer that can't be extended never stops the rest */ }
      });
    }
    var playsToEnd = false;
    try { playsToEnd = Number(api.get(comp, A.COMP_PLAYBACK_END_ATTR)) >= oldEnd; } catch (e) { /* no play range to keep */ }
    var end = {}, play = {};
    end[A.COMP_END_ATTR] = newEnd;
    api.set(comp, end);
    if (playsToEnd) { play[A.COMP_PLAYBACK_END_ATTR] = newEnd; api.set(comp, play); } // after the comp is long enough to hold it
    return { oldEnd: oldEnd, newEnd: newEnd, layers: layers };
  }

  function flyCamera(map, points, startFrame) {
    var end = startFrame + points.length - 1, attrs = [0, 1, 2].map(function (i) { return A.CAMERA_ARRAY_ATTR + "." + i; });
    attrs.forEach(function (attr) {
      (api.getKeyframeTimes(map.cameraId, attr) || []).forEach(function (f) {
        if (f >= startFrame && f <= end) api.deleteKeyframe(map.cameraId, attr, f);
      });
    });
    points.forEach(function (p, k) {
      var o = {};
      o[attrs[0]] = p.lat; o[attrs[1]] = p.lon; o[attrs[2]] = p.zoom;
      api.keyframe(map.cameraId, startFrame + k, o);
    });
    return { start: startFrame, end: end };
  }

  // ---- Remembered flights ---------------------------------------------------------------
  // Each Fly here / Drift is remembered on the camera as { kind, start, end, from, to, ... } so a
  // later "Update flight" can rebuild exactly its keys. A new record replaces any it overlaps;
  // chained flights share one boundary frame (0-20 then 20-40), which is not an overlap.
  var FLIGHTS_KEY = "geoFlights";

  function readFlights(map) {
    var v = userData(map.cameraId, FLIGHTS_KEY);
    return Array.isArray(v) ? v : [];
  }

  function recordFlight(map, rec) {
    if (typeof api.setUserData !== "function") return;
    var all = readFlights(map), kept = all.filter(function (r) { return r.end <= rec.start || r.start >= rec.end; });
    var gone = all.filter(function (r) { return kept.indexOf(r) < 0; });
    // An Update flight replaces exactly its own record: keep it in place so latest-made order holds.
    if (gone.length === 1 && gone[0].start === rec.start && gone[0].end === rec.end) kept.splice(all.indexOf(gone[0]), 0, rec);
    else kept.push(rec);
    api.setUserData(map.cameraId, FLIGHTS_KEY, kept);
  }

  // The latest-made record whose range holds the frame, or null.
  function flightAt(map, frame) {
    var all = readFlights(map);
    for (var i = all.length - 1; i >= 0; i--) if (all[i].start <= frame && frame <= all[i].end) return all[i];
    return null;
  }

  function readCameraAt(map, frame) {
    var back = api.getFrame();
    try {
      api.setFrame(frame);
      return readCamera(map.cameraId);
    } finally {
      api.setFrame(back);
    }
  }

  // Where a flight really begins: the end view of a remembered flight that finishes exactly where
  // this one starts (a chain), else the camera as it is one frame before it (so it joins whatever
  // came before), or the recorded start when it begins on the composition's first frame.
  function flightStart(map, rec) {
    var before = readFlights(map).filter(function (r) { return r.end === rec.start && r !== rec && r.start < rec.start; });
    if (before.length) {
      var p = before[before.length - 1].to;
      return { lat: p.lat, lon: p.lon, zoom: p.zoom };
    }
    if (rec.start > compFrameRange().start) {
      var c = readCameraAt(map, rec.start - 1);
      return { lat: c.lat, lon: c.lon, zoom: c.zoom };
    }
    return { lat: rec.from.lat, lon: rec.from.lon, zoom: rec.from.zoom };
  }

  function hasAttribution(map) {
    return api.getChildren(map.groupId).some(function (id) { return api.getNiceName(id) === ATTRIBUTION_NAME; });
  }

  function createAttribution(map) {
    var s = compSize();
    var id = api.create(A.TEXT_LAYER_TYPE, ATTRIBUTION_NAME);
    setOne(id, A.TEXT_ATTR, "© OpenStreetMap contributors");
    // Only set a font size if this text layer actually has one - never guess an
    // attribute id. The default size plus a centre/baseline-anchored position was
    // pushing the credit text partly outside the frame; inset it enough to keep a
    // ~330x30px centred text fully inside the bottom-left corner.
    if (api.hasAttribute(id, "fontSize")) setOne(id, "fontSize", 24);
    api.set(id, { position: [-s.width / 2 + 200, -s.height / 2 + 40] });
    applyStyle(id, layerStyle(map, "credit"));
    api.parent(id, map.groupId);
    return id;
  }

  var IMAGERY_CREDIT_NAME = "Imagery credit";

  // A separate credit for the imagery source, so it never collides with the OSM
  // credit's name or position: sits one line above it. Pressing "Add attribution"
  // again updates the existing layer's text instead of piling up duplicates.
  function createImageryCredit(map, text) {
    var s = compSize();
    var existing = api.getChildren(map.groupId).filter(function (id) { return api.getNiceName(id) === IMAGERY_CREDIT_NAME; })[0];
    if (existing) { setOne(existing, A.TEXT_ATTR, text || "© OpenStreetMap contributors"); return existing; }
    var id = api.create(A.TEXT_LAYER_TYPE, IMAGERY_CREDIT_NAME);
    setOne(id, A.TEXT_ATTR, text || "© OpenStreetMap contributors");
    if (api.hasAttribute(id, "fontSize")) setOne(id, "fontSize", 24);
    api.set(id, { position: [-s.width / 2 + 200, -s.height / 2 + 80] });
    applyStyle(id, layerStyle(map, "credit"));
    api.parent(id, map.groupId);
    return id;
  }

  // ---- Route travellers ---------------------------------------------------------------
  // A traveller is one marker (a plugin shape or the user's own layer) shown by a one-copy
  // path-distribution duplicator per leg. Per leg, a "tip" utility turns the leg's draw-on
  // into the copy's travel and a "show" utility fades the copy in while its leg is drawing
  // and keeps it visible until a later leg takes over. The marker itself is hidden by Cavalry.
  // A Duplicator ignores its source layer's own scale and rotation, so one "scale" helper
  // (Traveller size x the source's scale) and the source's rotation are wired into every copy.
  var TRAVELLER_KEY = "geoTraveller", TRAVELLER_NAMES = { plane: "Traveller: Plane", arrow: "Traveller: Arrow", dot: "Traveller: Dot" };

  function userData(id, key) {
    try { return typeof api.hasUserDataKey === "function" && api.hasUserDataKey(id, key) ? api.getUserDataKey(id, key) : null; } catch (e) { return null; }
  }

  // True for the map group and anything in it, for the map's Controls (and what's inside them),
  // and for a group that holds any of them.
  function isMapPart(map, id) {
    var starts = [map.groupId];
    for (var cur = id, guard = 0; cur && guard < 64; guard++) {
      if (cur === map.groupId) return true;
      if (userData(cur, "geoControls") === map.cameraId) return true;
      cur = api.getParent(cur);
    }
    // Every Controls component of the map (main, Overlay, Data, Extract), wherever it sits.
    api.getCompLayers(false).forEach(function (l) { if (userData(l, "geoControls") === map.cameraId) starts.push(l); });
    return starts.some(function (start) {
      for (var up = start ? api.getParent(start) : "", guard = 0; up && guard < 64; guard++) {
        if (up === id) return true;
        up = api.getParent(up);
      }
      return false;
    });
  }

  // The legs of a route group in route order: new-style from its geoRoute data, old-style from
  // the script legs inside the group. helpers is where traveller helpers go.
  function routeLegs(map, groupId) {
    var rec = findRoutes(map).filter(function (r) { return r.groupId === groupId; })[0];
    if (rec) {
      return {
        name: rec.name, helpers: rec.helpers && layerThere(rec.helpers) ? rec.helpers : groupId,
        legs: rec.legs.slice().sort(function (a, b) { return a.number - b.number; }).map(function (l) { return { number: l.number, line: l.line }; })
      };
    }
    var legs = findMapLayers(map).filter(function (l) { return l.meta.category === "route" && api.getParent(l.id) === groupId; });
    if (!legs.length) return null;
    legs = legs.map(function (l, i) { var m = /^Leg (\d+)/.exec(String(l.name)); return { number: m ? Number(m[1]) : 1000 + i, line: l.id }; })
      .sort(function (a, b) { return a.number - b.number; });
    legs.forEach(function (l, i) { if (l.number >= 1000) l.number = i + 1; });
    return { name: String(api.getNiceName(groupId)), helpers: groupId, legs: legs };
  }

  function findTravellers(map) {
    var out = [];
    if (typeof api.hasUserDataKey !== "function") return out;
    api.getCompLayers(false).forEach(function (id) {
      var d = userData(id, TRAVELLER_KEY);
      if (!d || d.camera !== map.cameraId) return;
      out.push({
        groupId: id, kind: d.kind, source: d.source, userSource: !!d.userSource,
        scale: d.scale && layerThere(d.scale) ? d.scale : null,
        legs: (d.legs || []).filter(function (l) { return l.dup && layerThere(l.dup); })
      });
    });
    return out;
  }

  // The route group that the first of ids belongs to, or null. A new-style route owns its group,
  // helpers group, stops and legs and their helpers; a traveller's copies, helpers and plugin
  // marker belong to their route; an old-style route is a group holding script legs, and owns
  // whatever sits inside it. The map group and its own parts never count.
  function routeOfSelection(map, ids) {
    var owner = {}, oldGroups = {};
    function claim(group, parts) { parts.forEach(function (p) { if (p && !owner[p]) owner[p] = group; }); }
    findRoutes(map).forEach(function (r) {
      claim(r.groupId, [r.groupId, r.helpers]);
      r.stops.forEach(function (s) { claim(r.groupId, [s.holder, s.circle, s.label, s.position, s.visibility, s.endPoint]); });
      r.legs.forEach(function (l) { claim(r.groupId, [l.line, l.startHandle, l.endHandle, l.fade]); });
      claim(r.groupId, routeDraws(r.groupId));
    });
    findTravellers(map).forEach(function (t) {
      t.legs.forEach(function (l) { claim(t.groupId, [l.dup, l.tip, l.show]); });
      claim(t.groupId, [t.scale]);
      if (!t.userSource) claim(t.groupId, [t.source]);
    });
    findMapLayers(map).forEach(function (l) {
      var g = l.meta.category === "route" ? api.getParent(l.id) : "";
      if (g && g !== map.groupId) oldGroups[g] = true;
    });
    for (var i = 0; i < (ids || []).length; i++) {
      if (owner[ids[i]]) return owner[ids[i]];
      for (var cur = ids[i], guard = 0; cur && cur !== map.groupId && guard < 64; guard++) {
        if (oldGroups[cur]) return cur;
        cur = api.getParent(cur);
      }
    }
    return null;
  }

  // A route's legs in route order ({ line }): new style from its geoRoute record (by leg number),
  // old style from the script legs inside the group (by their "Leg N" names, like routeLegs).
  function legsInOrder(groupId, rec, mapLayers) {
    if (rec && rec.legs) {
      return rec.legs.filter(function (l) { return l.line && layerThere(l.line); })
        .sort(function (a, b) { return a.number - b.number; }).map(function (l) { return { line: l.line }; });
    }
    var legs = mapLayers.filter(function (l) { return l.meta.category === "route" && api.getParent(l.id) === groupId; })
      .map(function (l, i) { var m = /^Leg (\d+)/.exec(String(l.name)); return { line: l.id, number: m ? Number(m[1]) : 1000 + i }; });
    return legs.sort(function (a, b) { return a.number - b.number; }).map(function (l) { return { line: l.line }; });
  }

  // Gives a route's legs without one a draw helper. The record (geoRoute / geoRouteTravel) is
  // saved with every helper made, even when a later leg fails.
  function prepareTravel(map, g, mapLayers) {
    // Legs in route order from what's already read (routeLegs would rescan the comp per route).
    var rec = userData(g, ROUTE_KEY), legs = legsInOrder(g, rec, mapLayers);
    if (!legs.length) return;
    var count = legs.length, changed = false;
    if (rec && rec.legs) {
      try {
        rec.legs.forEach(function (l) {
          if ((l.draw && layerThere(l.draw)) || !l.line || !layerThere(l.line) || trimTaken(l.line)) return;
          var at = 0;
          legs.forEach(function (x, i) { if (x.line === l.line) at = i; });
          l.draw = addLegDraw(map, rec.helpers && layerThere(rec.helpers) ? rec.helpers : g, l.line, at, count);
          changed = true;
        });
      } finally {
        if (changed) api.setUserData(g, ROUTE_KEY, rec);
      }
      return;
    }
    var old = userData(g, ROUTE_TRAVEL_KEY), before = (old && old.legs) || [], have = {};
    // Only this group's own legs whose helper is still there (a duplicated group copies the record).
    var kept = ownTravelLegs(g).filter(function (l) { return l.draw && layerThere(l.draw); });
    var travel = { legs: kept };
    changed = kept.length !== before.length;
    kept.forEach(function (l) { have[l.line] = true; });
    try {
      legs.forEach(function (x, i) {
        if (have[x.line] || trimTaken(x.line)) return;
        travel.legs.push({ line: x.line, draw: addLegDraw(map, g, x.line, i, count) });
        changed = true;
      });
    } finally {
      if (changed) api.setUserData(g, ROUTE_TRAVEL_KEY, travel);
    }
  }

  // Numbers routes made before route numbers (and duplicated ones) and gives legs without one a
  // draw helper. mapLayers / routes / order: the lists and Scene Window order the caller already
  // read (no extra comp scans). A route that fails is left as it is; the others still go ahead.
  function prepareRoutes(map, mapLayers, routes, order) {
    if (typeof api.setUserData !== "function") return;
    routes = routes || findRoutes(map);
    mapLayers = mapLayers || findMapLayers(map);
    var groups = routeGroups(map, mapLayers, routes, order);
    numberRoutes(map, groups);
    groups.forEach(function (g) {
      try { prepareTravel(map, g, mapLayers); } catch (e) { /* the next Controls refresh tries again */ }
    });
  }

  // Whether a route other than groupId (on any map) still sends this user layer along.
  function carriedElsewhere(groupId, layerId) {
    return api.getCompLayers(false).some(function (id) {
      var d = id === groupId ? null : userData(id, TRAVELLER_KEY);
      return !!d && d.userSource === true && d.source === layerId;
    });
  }

  // Deletes the plugin's copies, helpers and marker; the user's own layer is only un-hidden,
  // and only when no other route is still sending it.
  function removeTraveller(map, groupId) {
    var d = userData(groupId, TRAVELLER_KEY);
    if (!d) return false;
    (d.legs || []).forEach(function (l) { [l.dup, l.tip, l.show].forEach(function (x) { if (x && layerThere(x)) api.deleteLayer(x); }); });
    if (d.scale && layerThere(d.scale)) api.deleteLayer(d.scale);
    if (d.source && layerThere(d.source)) {
      if (d.userSource) { if (!carriedElsewhere(groupId, d.source)) api.set(d.source, { hidden: false }); }
      else api.deleteLayer(d.source);
    }
    api.setUserData(groupId, TRAVELLER_KEY, null);
    return true;
  }

  // The route's own line colour as "#rrggbb" (the default route green when it can't be read).
  function routeColour(legs) { return readColour(legs[0].line, A.STROKE_COLOR_ATTR, STYLE.route.stroke); }

  function makeMarker(kind, colour, track) {
    var id;
    if (kind === "dot") {
      id = track(api.primitive("ellipse", TRAVELLER_NAMES.dot));
      setOne(id, "generator.radius", [6, 6]);
    } else {
      var path = new cavalry.Path(), pts = GeoMarkers.outline(kind);
      pts.forEach(function (p, i) { if (i === 0) path.moveTo(p[0], p[1]); else path.lineTo(p[0], p[1]); });
      path.close();
      id = track(api.createEditable(path, TRAVELLER_NAMES[kind]));
    }
    applyStyle(id, { fill: colour });
    return id;
  }

  // Steps a layer down its group until it sits directly above `below`.
  function placeAbove(id, below) {
    if (typeof api.select !== "function" || typeof api.moveBackward !== "function") return;
    var parent = api.getParent(id);
    var at = function (x) { return api.getChildren(parent).indexOf(x); };
    api.select([id]);
    for (var guard = api.getChildren(parent).length; guard > 0 && at(id) < at(below) - 1; guard--) api.moveBackward();
  }

  // kind: "plane" | "arrow" | "dot" | "layer" (userLayerId then names the layer to send).
  // Replaces any traveller the route already had. Returns { routeName, replaced }.
  function addTraveller(map, groupId, kind, userLayerId) {
    // Older Cavalry versions lack the calls a traveller is built from: say so plainly.
    if (["setGenerator", "createEditable", "primitive", "setUserData"].some(function (n) { return typeof api[n] !== "function"; }) ||
        typeof cavalry === "undefined" || !cavalry || typeof cavalry.Path !== "function") {
      throw new Error("This version of Cavalry can't add travellers.");
    }
    var info = routeLegs(map, groupId);
    if (!info || !info.legs.length) throw new Error("Select a route (any part of it) first.");
    if (kind === "layer" && (!userLayerId || !layerThere(userLayerId) || isMapPart(map, userLayerId))) throw new Error("Select the layer to send along the route first.");
    if (kind !== "layer" && !TRAVELLER_NAMES[kind]) throw new Error("Unknown traveller: " + kind);
    var replaced = removeTraveller(map, groupId);
    var E = GeoExpression, CA = A.CAMERA_ARRAY_ATTR, made = [], previous = null;
    function track(id) { made.push(id); return id; }
    try { previous = api.getSelection(); } catch (e) { previous = null; }
    try {
      var source = kind === "layer" ? userLayerId : makeMarker(kind, routeColour(info.legs), track);
      if (kind !== "layer") { api.parent(source, info.helpers); api.set(source, identityTransform()); }
      var meta = function (c) { return { camera: map.cameraId, category: c }; };
      var scale = track(api.create(A.CAMERA_LAYER_TYPE, "Traveller scale"));
      addInputs(scale, CA, E.TRAVELLER_SCALE_INPUTS);
      setOne(scale, A.CAMERA_EXPR_ATTR, E.travellerScaleExpression(meta("travellerScale")));
      api.connect(source, "scale.x", scale, CA + ".1", true);
      api.connect(source, "scale.y", scale, CA + ".2", true);
      api.parent(scale, info.helpers);
      var legs = info.legs.map(function (leg, i) {
        var dup = track(api.create("duplicator", "Leg " + leg.number + " traveller"));
        api.setGenerator(dup, "generator", "pathDistribution");
        api.set(dup, { "generator.count": 1, "generator.calculateRotations": true });
        api.connect(leg.line, "id", dup, "generator.inputShape", true);
        api.connect(source, "id", dup, "shapes", true);
        api.connect(scale, A.DRIVER_OUTPUT_ATTR, dup, "shapeScale", true);
        api.connect(source, "rotation.z", dup, "shapeRotation", true);
        var tip = track(api.create(A.CAMERA_LAYER_TYPE, "Leg " + leg.number + " traveller tip"));
        addInputs(tip, CA, E.TRAVELLER_TIP_INPUTS);
        setOne(tip, A.CAMERA_EXPR_ATTR, E.travellerTipExpression(meta("travellerTip")));
        api.connect(leg.line, "stroke.trimEnd", tip, CA + ".0", true);
        api.connect(tip, A.DRIVER_OUTPUT_ATTR, dup, "generator.travel", true);
        var later = info.legs.slice(i + 1);
        var show = track(api.create(A.CAMERA_LAYER_TYPE, "Leg " + leg.number + " traveller show"));
        addInputs(show, CA, E.travellerShowInputs(later.length));
        setOne(show, A.CAMERA_EXPR_ATTR, E.travellerShowExpression(meta("travellerShow"), later.length));
        api.connect(leg.line, "stroke.trimEnd", show, CA + ".0", true);
        api.connect(leg.line, "opacity", show, CA + ".1", true);
        later.forEach(function (m, k) { api.connect(m.line, "stroke.trimEnd", show, CA + "." + (k + 2), true); });
        api.connect(show, A.DRIVER_OUTPUT_ATTR, dup, "opacity", true);
        // Helpers are utilities (no transform to reset); the duplicator is reset after parenting.
        api.parent(tip, info.helpers); api.parent(show, info.helpers);
        api.parent(dup, groupId); api.set(dup, identityTransform());
        return { number: leg.number, line: leg.line, dup: dup, tip: tip, show: show };
      });
      // Copies sit directly above the topmost leg, so the stops and pins stay above them.
      var order = api.getChildren(groupId);
      var top = info.legs.map(function (l) { return l.line; }).filter(function (id) { return order.indexOf(id) >= 0; })
        .sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); })[0];
      // Stacking is cosmetic (like restackBaseLayers): a failure here never undoes the traveller.
      if (top) { try { legs.forEach(function (l) { placeAbove(l.dup, top); }); } catch (e5) { /* left on top of the group */ } }
      api.setUserData(groupId, TRAVELLER_KEY, { camera: map.cameraId, kind: kind, source: source, userSource: kind === "layer", scale: scale, legs: legs });
      return { routeName: stripRoute(info.name), replaced: replaced };
    } catch (e) {
      for (var i = made.length - 1; i >= 0; i--) { try { if (layerThere(made[i])) api.deleteLayer(made[i]); } catch (e2) { /* already gone */ } }
      if (kind === "layer" && userLayerId && layerThere(userLayerId) && !carriedElsewhere(groupId, userLayerId)) { try { api.set(userLayerId, { hidden: false }); } catch (e3) { /* cosmetic */ } }
      throw e;
    } finally {
      if (previous && typeof api.select === "function") { try { api.select(previous); } catch (e4) { /* cosmetic */ } }
    }
  }

  // ---- Highlights ----------------------------------------------------------------------------
  // A highlight is a group next to its extract: a highlight shape (the extract's outline, following
  // the camera) plus, for Pulse, an Oscillator and a fade helper, and for Glow, a Fast Blur. All of
  // them sit inside the group, so deleting the group removes the highlight completely. Its Amount %
  // is keyed on an ordinary attribute (a script input renamed for the Controls stops working).
  var HIGHLIGHT_KEY = "geoHighlight", HIGHLIGHT_NUMBER_KEY = "geoHighlightNumber";
  var HIGHLIGHT_EFFECTS = [{ id: "fill", name: "Fill in" }, { id: "outline", name: "Outline draw-on" }, { id: "pulse", name: "Pulse" }, { id: "glow", name: "Glow" }];
  var HIGHLIGHT_COLOUR = "#1F8F4E", HIGHLIGHT_WIDTH = 3, HIGHLIGHT_SPEED = 1, HIGHLIGHT_SIZE = 20;

  function highlightNumber(groupId) { return numberOf(groupId, HIGHLIGHT_NUMBER_KEY); }
  // Where a highlight's Amount % is keyed: [layer, attribute].
  function amountTarget(rec, groupId) {
    if (rec.effect === "pulse") return [groupId, "opacity"];
    return [rec.shape, rec.effect === "outline" ? "stroke.trimEnd" : "opacity"];
  }
  // The map's highlight groups (the parents of its highlight shapes that carry a record), from the
  // map layers already read, in Scene Window order (top first).
  function highlightGroups(map, mapLayers, order) {
    var seen = {}, out = [];
    (mapLayers || findMapLayers(map)).forEach(function (l) {
      if (l.meta.category !== "highlight") return;
      var g = api.getParent(l.id);
      if (g && !seen[g] && userData(g, HIGHLIGHT_KEY)) { seen[g] = true; out.push(g); }
    });
    return out.sort(order || mapOrder(map));
  }
  function there(id) { return id && layerThere(id) ? id : null; }
  // A highlight group's own members. A recorded member counts only while it is a child of the
  // group (a duplicated group copies the record, which still names the original's layers);
  // otherwise the group's own child of that kind is used: the map layer tagged "highlight" (shape),
  // the Oscillator, the JS utility tagged "highlightFade", the Fast Blur. A member the record
  // never had is not looked for.
  function highlightMembers(g) {
    var rec = userData(g, HIGHLIGHT_KEY) || {}, kids = null, taken = {};
    function own(id) { return id && layerThere(id) && api.getParent(id) === g ? id : null; }
    function typed(type) { return function (k) { return typeof api.getLayerType === "function" && api.getLayerType(k) === type; }; }
    function tagged(attr, tag, category) { return function (k) { var m = GeoExpression.readTag(readExpr(k, attr), tag); return !!m && m.category === category; }; }
    function pick(name, test) {
      if (!rec[name]) return null;
      var id = own(rec[name]);
      if (!id) {
        kids = kids || api.getChildren(g);
        for (var i = 0; i < kids.length && !id; i++) { if (!taken[kids[i]] && test(kids[i])) id = kids[i]; }
      }
      if (id) taken[id] = true;
      return id || null;
    }
    return {
      rec: rec, extract: there(rec.extract),
      shape: pick("shape", tagged(A.MAP_EXPR_ATTR, "GEO_META", "highlight")),
      osc: pick("osc", typed("oscillator")),
      fade: pick("fade", tagged(A.CAMERA_EXPR_ATTR, "GEO_META", "highlightFade")),
      blur: pick("blur", typed("blurFilter"))
    };
  }
  function findHighlights(map, mapLayers, order) {
    return highlightGroups(map, mapLayers, order).map(function (g) {
      var m = highlightMembers(g), ex = m.extract;
      return { groupId: g, number: highlightNumber(g), effect: m.rec.effect, extract: ex,
        name: ex ? String(api.getNiceName(ex)) : String(api.getNiceName(g)).replace(/^Highlight( \d+)?: /, ""),
        shape: m.shape, osc: m.osc, fade: m.fade, blur: m.blur };
    });
  }
  function highlightParts(map, mapLayers) {
    var out = {};
    findHighlights(map, mapLayers).forEach(function (h) { [h.groupId, h.shape, h.osc, h.fade, h.blur].forEach(function (id) { if (id) out[id] = true; }); });
    return out;
  }
  // Removes highlights whose extract is gone (only groups carrying the plugin's record; the
  // plugin's own members go, a group still holding the user's layers stays), then numbers the
  // rest like routes (a duplicated group copies its number) and points a copied group's record at
  // its own members. Returns how many highlights it removed.
  function prepareHighlights(map, mapLayers, order) {
    var removed = 0;
    var groups = highlightGroups(map, mapLayers, order).filter(function (g) {
      var m = highlightMembers(g), rec = m.rec;
      if (rec.extract && !layerThere(rec.extract)) {
        [m.shape, m.osc, m.fade, m.blur].forEach(function (id) { if (id) { try { if (layerThere(id)) api.deleteLayer(id); } catch (e) { /* next refresh */ } } });
        try { if (!api.getChildren(g).length) api.deleteLayer(g); } catch (e2) { /* next refresh */ }
        removed++;
        return false;
      }
      var fixed = {}, changed = false;
      Object.keys(rec).forEach(function (k) { fixed[k] = rec[k]; });
      ["shape", "osc", "fade", "blur"].forEach(function (k) {
        if (rec[k] && m[k] !== rec[k]) { changed = true; if (m[k]) fixed[k] = m[k]; else delete fixed[k]; }
      });
      if (changed && typeof api.setUserData === "function") { try { api.setUserData(g, HIGHLIGHT_KEY, fixed); } catch (e3) { /* read again next time */ } }
      return true;
    });
    numberGroups(groups, HIGHLIGHT_NUMBER_KEY, "Highlight");
    return removed;
  }
  // Puts a layer directly below `above` in their shared group (placeAbove, then one more step down).
  function placeBelow(id, above) {
    placeAbove(id, above);
    if (typeof api.select !== "function" || typeof api.moveBackward !== "function") return;
    var parent = api.getParent(id), kids = api.getChildren(parent);
    if (kids.indexOf(id) >= 0 && kids.indexOf(id) < kids.indexOf(above)) { api.select([id]); api.moveBackward(); }
  }

  // What a new highlight (not Glow) goes directly above, so the newest one sits on top: the
  // topmost earlier highlight of this extract in the same group that is above the extract, else
  // the extract itself.
  function topHighlightAbove(parent, extractId, selfId) {
    var kids = api.getChildren(parent), floor = kids.indexOf(extractId), anchor = extractId;
    kids.forEach(function (k, i) {
      if (k === selfId || i >= floor) return;
      var rec = userData(k, HIGHLIGHT_KEY);
      if (rec && rec.extract === extractId && rec.effect !== "glow" && i < kids.indexOf(anchor)) anchor = k;
    });
    return anchor;
  }

  // Builds a highlight's own layers inside group g: the shape (the extract's outline, styled for
  // the effect in `colour`), plus the Pulse oscillator and fade helper or the Glow blur, all wired
  // up. Every layer made goes through track(). Returns the record fields (no keys are made).
  function buildHighlightMembers(map, g, extractId, effect, label, colour, track) {
    var enc = readLayerData(extractId);
    var shape = track(api.create(A.MAP_LAYER_TYPE, label + " shape"));
    addInputs(shape, A.MAP_ARRAY_ATTR, GeoExpression.HIGHLIGHT_SHAPE_INPUTS, {});
    setOne(shape, A.MAP_EXPR_ATTR, GeoExpression.highlightLayerExpression(GEO_RUNTIME_SRC, enc, { camera: map.cameraId, category: "highlight", effect: effect }, { ellipseScale: A.ELLIPSE_SCALE }));
    connectCamera(map.cameraId, shape, A.MAP_ARRAY_ATTR);
    // The extract's own detail and dot size, followed live (Detail in its Controls moves the
    // highlight too); if the link can't be made the current value is copied instead.
    ["detail", "pointRadius"].forEach(function (n) {
      var at = A.MAP_ARRAY_ATTR + "." + GeoExpression.inputIndex(GeoExpression.MAP_INPUTS, n);
      try { api.connect(extractId, at, shape, at, true); return; } catch (e) { /* copy the value */ }
      try { var v = api.get(extractId, at); if (v !== undefined && v !== null) setOne(shape, at, v); } catch (e2) { /* default */ }
    });
    var line = effect === "outline" || effect === "pulse";
    applyStyle(shape, line ? { stroke: colour, width: HIGHLIGHT_WIDTH } : { fill: colour });
    api.parent(shape, g);
    var rec = { extract: extractId, effect: effect, shape: shape };
    if (effect === "outline") setOne(shape, "stroke.trim", true);
    if (effect === "pulse") {
      rec.osc = track(api.create("oscillator", label + " pulse"));
      api.set(rec.osc, { waveType: 3, minimum: 0, maximum: 1, strengthToZero: false, frequency: HIGHLIGHT_SPEED });
      api.parent(rec.osc, g);
      api.connect(rec.osc, "id", shape, A.MAP_ARRAY_ATTR + "." + GeoExpression.inputIndex(GeoExpression.HIGHLIGHT_SHAPE_INPUTS, "phase"), true);
      rec.fade = track(api.create(A.CAMERA_LAYER_TYPE, label + " fade"));
      addInputs(rec.fade, A.CAMERA_ARRAY_ATTR, GeoExpression.HIGHLIGHT_FADE_INPUTS, {});
      setOne(rec.fade, A.CAMERA_EXPR_ATTR, GeoExpression.highlightFadeExpression({ camera: map.cameraId, category: "highlightFade" }));
      api.parent(rec.fade, g);
      api.connect(rec.osc, "id", rec.fade, A.CAMERA_ARRAY_ATTR + ".0", true);
      api.connect(rec.fade, A.DRIVER_OUTPUT_ATTR, shape, "opacity", true);
    }
    if (effect === "glow") {
      rec.blur = track(api.create("blurFilter", label + " glow"));
      setOne(rec.blur, "amount", { x: HIGHLIGHT_SIZE, y: HIGHLIGHT_SIZE });
      api.connect(rec.blur, "id", shape, "filters");
      api.parent(rec.blur, g);
    }
    return rec;
  }
  function knownEffect(effect) {
    var e = HIGHLIGHT_EFFECTS.filter(function (x) { return x.id === effect; })[0];
    if (!e) throw new Error("Unknown highlight effect: " + effect);
    return e;
  }
  // Keys the Amount attribute 0 at start and 100 at start + duration, eased on the first key.
  function keyAmount(t, keys) {
    keys.forEach(function (k) { var o = {}; o[t[1]] = k[1]; api.keyframe(t[0], k[0], o); });
    if (keys.length && typeof api.magicEasing === "function") { try { api.magicEasing(t[0], t[1], keys[0][0], "SlowInSlowOut"); } catch (e) { /* linear */ } }
  }

  function createHighlight(map, extractId, effect, opts) {
    opts = opts || {};
    knownEffect(effect);
    var meta = layerMeta(extractId);
    if (!meta || meta.category !== "extract" || meta.camera !== map.cameraId) throw new Error("Pick an extracted feature of this map to highlight.");
    var made = [], previous = null;
    function track(id) { made.push(id); return id; }
    var number = numberGroups(highlightGroups(map), HIGHLIGHT_NUMBER_KEY, "Highlight") + 1;
    var name = String(api.getNiceName(extractId)), parent = api.getParent(extractId) || map.groupId, label = "Highlight " + number;
    try { previous = api.getSelection(); } catch (e0) { previous = null; }
    try {
      var g = track(api.create("group", capTitle(label + ": " + name)));
      api.parent(g, parent);
      var rec = buildHighlightMembers(map, g, extractId, effect, label, HIGHLIGHT_COLOUR, track);
      api.setUserData(g, HIGHLIGHT_KEY, rec);
      api.setUserData(g, HIGHLIGHT_NUMBER_KEY, number);
      var start = Math.max(0, Math.round(Number(opts.start) || 0)), duration = Math.max(1, Math.round(Number(opts.duration) || 25));
      keyAmount(amountTarget(rec, g), [[start, 0], [start + duration, 100]]);
      if (effect === "glow") placeBelow(g, extractId); else placeAbove(g, topHighlightAbove(parent, extractId, g));
      return g;
    } catch (e) {
      made.slice().reverse().forEach(function (id) { try { if (layerThere(id)) api.deleteLayer(id); } catch (e2) { /* gone */ } });
      throw e;
    } finally {
      if (previous && typeof api.select === "function") { try { api.select(previous); } catch (e4) { /* cosmetic */ } }
    }
  }

  // The highlight group (of this map) that owns the first of `ids` that is a highlight's group
  // or one of its layers; null when none is.
  function highlightOfSelection(map, ids) {
    var owner = {};
    findHighlights(map).forEach(function (h) { [h.groupId, h.shape, h.osc, h.fade, h.blur].forEach(function (id) { if (id && !owner[id]) owner[id] = h.groupId; }); });
    for (var i = 0; i < (ids || []).length; i++) { if (owner[ids[i]]) return owner[ids[i]]; }
    return null;
  }

  // Moves a layer to sit directly above (or, with `below`, directly below) `other` in their
  // shared group, stepping up or down as needed. Best effort: needs select and both step calls.
  function stackNextTo(id, other, below) {
    if (typeof api.select !== "function" || typeof api.bringForward !== "function" || typeof api.moveBackward !== "function") return;
    var parent = api.getParent(id);
    api.select([id]);
    for (var guard = api.getChildren(parent).length + 1; guard > 0; guard--) {
      var kids = api.getChildren(parent), at = kids.indexOf(id), o = kids.indexOf(other);
      if (at < 0 || o < 0) return;
      var want = below ? o + 1 : o - 1;
      if (at === want) return;
      if (at < want) api.moveBackward(); else api.bringForward();
    }
  }

  // "#rrggbb" from a colour attribute (Cavalry may hand back { r, g, b }); `fallback` when unreadable.
  function readColour(id, attr, fallback) {
    var v = null;
    try { v = api.get(id, attr); } catch (e) { v = null; }
    if (v && typeof v === "object" && v.r !== undefined) {
      v = "#" + [v.r, v.g, v.b].map(function (n) { var s = Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
    }
    return typeof v === "string" && v ? v : fallback;
  }

  // Rebuilds a highlight with another effect, in place: same group, number, name and colour, and
  // the Amount % keys (times and values) moved onto the new effect's Amount attribute. The new
  // layers are built first, so a failure there leaves the old highlight untouched.
  function changeHighlightEffect(map, groupId, effect) {
    var target = knownEffect(effect);
    var h = findHighlights(map).filter(function (x) { return x.groupId === groupId; })[0];
    if (!h) throw new Error("Select a highlight in the Scene Window first.");
    numberGroups(highlightGroups(map), HIGHLIGHT_NUMBER_KEY, "Highlight");
    var number = highlightNumber(groupId), label = "Highlight " + number, m = highlightMembers(groupId), rec = m.rec;
    if (rec.effect === effect) throw new Error(label + " already uses " + target.name + ".");
    if (!m.extract || !m.shape) throw new Error(label + "'s place is gone. Press Refresh controls (Layers tab) to tidy it away.");
    var oldLine = rec.effect === "outline" || rec.effect === "pulse";
    var colour = readColour(m.shape, oldLine ? A.STROKE_COLOR_ATTR : A.FILL_COLOR_ATTR, HIGHLIGHT_COLOUR);
    // Outline draw-on and Pulse both have a width; it carries over between them (everything else starts at its default).
    var width = null;
    if (oldLine && (effect === "outline" || effect === "pulse")) {
      try { var w = Number(api.get(m.shape, A.STROKE_WIDTH_ATTR)); if (isFinite(w) && w > 0) width = w; } catch (e7) { width = null; }
    }
    // The old Amount keys: times and values (read by moving the playhead, then putting it back).
    var oldT = amountTarget({ effect: rec.effect, shape: m.shape }, groupId), keys = [], playhead = 0;
    try { playhead = api.getFrame(); } catch (e0) { playhead = 0; }
    try {
      (api.getKeyframeTimes(oldT[0], oldT[1]) || []).slice().sort(function (a, b) { return a - b; }).forEach(function (f, i) {
        api.setFrame(f);
        var v = Number(api.get(oldT[0], oldT[1]));
        keys.push([f, isFinite(v) ? v : (i ? 100 : 0)]);
      });
    } finally { try { api.setFrame(playhead); } catch (e1) { /* cosmetic */ } }
    if (!keys.length) { var at = Math.max(0, Math.round(Number(playhead) || 0)); keys = [[at, 0], [at + 25, 100]]; }

    var made = [], previous = null, olds = [m.shape, m.osc, m.fade, m.blur].filter(Boolean), fresh;
    function track(id) { made.push(id); return id; }
    try { previous = api.getSelection(); } catch (e2) { previous = null; }
    try {
      try {
        fresh = buildHighlightMembers(map, groupId, m.extract, effect, label, colour, track);
        if (width !== null) setOne(fresh.shape, A.STROKE_WIDTH_ATTR, width);
      } catch (e3) {
        made.slice().reverse().forEach(function (id) { try { if (layerThere(id)) api.deleteLayer(id); } catch (e4) { /* gone */ } });
        throw e3;
      }
      // Swap: the new record goes in first (so a later failure never leaves one naming the old
      // effect), then the old layers and the old Amount keys go and the new keys come in.
      api.setUserData(groupId, HIGHLIGHT_KEY, fresh);
      olds.forEach(function (id) { if (layerThere(id)) api.deleteLayer(id); });
      if (oldT[0] === groupId) {
        keys.forEach(function (k) { try { api.deleteKeyframe(groupId, oldT[1], k[0]); } catch (e5) { /* already gone */ } });
        setOne(groupId, "opacity", 100);
      }
      keyAmount(amountTarget(fresh, groupId), keys);
      var parent = api.getParent(groupId);
      if (parent === api.getParent(m.extract)) {
        if (effect === "glow") stackNextTo(groupId, m.extract, true);
        else stackNextTo(groupId, topHighlightAbove(parent, m.extract, groupId), false);
      }
      return { number: number };
    } finally {
      if (previous && typeof api.select === "function") {
        // The user's selection, with a removed old layer swapped for the new shape (or the group).
        var swap = {};
        olds.forEach(function (id) { swap[id] = fresh ? (id === m.shape ? fresh.shape : groupId) : id; });
        var keep = [];
        previous.forEach(function (id) { var x = swap[id] || id; if (layerThere(x) && keep.indexOf(x) < 0) keep.push(x); });
        try { api.select(keep); } catch (e6) { /* cosmetic */ }
      }
    }
  }

  // ---- Callouts ------------------------------------------------------------------------------
  // A callout is a group in the map group: a text label that the user drags in the viewport, with
  // Cavalry's own text background (a Custom Shape fed by the text, sitting directly below it as its
  // sibling and following its position, rotation and scale), a dot at the place following the
  // camera, and two Basic Lines (box edge -> bend -> place) whose ends small helper scripts work out
  // every frame from the dot and a Bounding Box reading the label and its box together. Deleting the
  // group removes it all.
  var CALLOUT_KEY = "geoCallout", CALLOUT_NUMBER_KEY = "geoCalloutNumber";
  var CALLOUT_NAMES = ["label", "box", "dot", "line1", "line2", "size", "place", "fade", "edge", "bend"];
  var CALLOUT_OFFSET = [160, 100], CALLOUT_MARGIN = 40, CALLOUT_DOT = 6, CALLOUT_LINE_WIDTH = 3, CALLOUT_LABEL_W = 240;
  var CALLOUT_PADDING = [12, 8], CALLOUT_CORNER = 6, CALLOUT_DOCUMENT_BACKGROUND = 4;

  function calloutNumber(groupId) { return numberOf(groupId, CALLOUT_NUMBER_KEY); }
  // This map's callout groups, straight from the map group's children (top first, Scene Window order).
  function calloutGroups(map) {
    return api.getChildren(map.groupId).filter(function (id) {
      var rec = userData(id, CALLOUT_KEY);
      return !!rec && typeof rec === "object" && rec.camera === map.cameraId;
    });
  }
  // Gives every callout a lasting number (a duplicated group copies its number and takes the next free one).
  // A copied group's record is pointed at its own members (nothing is written while it already is).
  function prepareCallouts(map) {
    var groups = calloutGroups(map);
    numberGroups(groups, CALLOUT_NUMBER_KEY, "Callout");
    if (typeof api.setUserData !== "function") return;
    groups.forEach(function (g) {
      var rec = userData(g, CALLOUT_KEY) || {}, m = calloutMembers(g, rec), fixed = {}, changed = false;
      Object.keys(rec).forEach(function (k) { fixed[k] = rec[k]; });
      CALLOUT_NAMES.forEach(function (k) { if (rec[k] && m[k] && m[k] !== rec[k]) { fixed[k] = m[k]; changed = true; } });
      if (rec.draws) {
        fixed.draws = rec.draws.map(function (id, i) { if (m.draws[i] && m.draws[i] !== id) changed = true; return m.draws[i] || id; });
      }
      if (changed) { try { api.setUserData(g, CALLOUT_KEY, fixed); } catch (e) { /* read again next time */ } }
    });
  }

  // A callout group's own members. A recorded member counts only while it belongs to this group: the
  // label, box, dot and lines are its children, the helpers children of a group inside it (a duplicated
  // group copies the record, which still names the original's layers). Otherwise the group's own
  // member of that kind is used, as for highlights: the label is the Text child, the box the Custom
  // Shape child, the dot and the two lines the children named "... dot", "... line 1" and
  // "... line 2"; in the helpers group the size is the Bounding Box and the place, fade, edge, bend
  // and the two draws the scripts tagged with their category (a draw by its Index input, else by
  // the "... draw 1" / "... draw 2" name). A member the record never had is not looked for.
  var CALLOUT_DIRECT = ["label", "box", "dot", "line1", "line2"];
  var CALLOUT_HELPER_CATEGORY = { place: "calloutPlace", fade: "calloutFade", edge: "calloutEdge", bend: "calloutBend" };
  function calloutMembers(g, rec) {
    var kids = null, helperKids = null, taken = {};
    function type(k) { return typeof api.getLayerType === "function" ? String(api.getLayerType(k)) : ""; }
    function nameEnds(k, tail) { var n = String(api.getNiceName(k)); return n.slice(n.length - tail.length) === tail; }
    function own(id, isDirect) {
      if (!id || !layerThere(id)) return null;
      var parent = api.getParent(id);
      if (isDirect) return parent === g ? id : null;
      return parent && parent !== g && api.getParent(parent) === g ? id : null;
    }
    function direct() { kids = kids || api.getChildren(g); return kids; }
    // The helpers group's children: the group inside this one that holds them (named "... helpers", else the first).
    function helpers() {
      if (!helperKids) {
        var groups = direct().filter(function (k) { return type(k) === "group"; });
        var holder = groups.filter(function (k) { return nameEnds(k, " helpers"); })[0] || groups[0];
        helperKids = holder ? api.getChildren(holder) : [];
      }
      return helperKids;
    }
    function category(k) { var m = GeoExpression.readTag(readExpr(k, A.CAMERA_EXPR_ATTR), "GEO_META"); return m ? m.category : ""; }
    function drawIndex(k) {
      var v = NaN;
      try { v = Number(api.get(k, A.CAMERA_ARRAY_ATTR + "." + GeoExpression.inputIndex(GeoExpression.CALLOUT_DRAW_INPUTS, "index"))); } catch (e) { v = NaN; }
      if (v === 0 || v === 1) return v;
      return nameEnds(k, " draw 1") ? 0 : nameEnds(k, " draw 2") ? 1 : -1;
    }
    var tests = {
      label: function (k) { return type(k) === "textShape"; },
      box: function (k) { return type(k) === "customShape"; },
      dot: function (k) { return (type(k) === "basicShape" || type(k) === "ellipse") && nameEnds(k, " dot"); },
      line1: function (k) { return type(k) === "basicLine" && nameEnds(k, " line 1"); },
      line2: function (k) { return type(k) === "basicLine" && nameEnds(k, " line 2"); },
      size: function (k) { return type(k) === "boundingBox"; }
    };
    Object.keys(CALLOUT_HELPER_CATEGORY).forEach(function (name) { tests[name] = function (k) { return category(k) === CALLOUT_HELPER_CATEGORY[name]; }; });
    function pick(id, isDirect, test) {
      var found = own(id, isDirect);
      if (!found) {
        var pool = isDirect ? direct() : helpers();
        for (var i = 0; i < pool.length && !found; i++) { if (!taken[pool[i]] && test(pool[i])) found = pool[i]; }
      }
      if (found) taken[found] = true;
      return found || null;
    }
    var out = {};
    CALLOUT_NAMES.forEach(function (k) { out[k] = rec[k] ? pick(rec[k], CALLOUT_DIRECT.indexOf(k) >= 0, tests[k]) : null; });
    out.draws = (rec.draws || []).map(function (id, i) {
      return id ? pick(id, false, function (k) { return category(k) === "calloutDraw" && drawIndex(k) === i; }) : null;
    });
    return out;
  }

  function findCallouts(map) {
    return calloutGroups(map).map(function (g) {
      var rec = userData(g, CALLOUT_KEY) || {}, out = calloutMembers(g, rec);
      out.groupId = g; out.number = calloutNumber(g); out.text = String(rec.text == null ? "" : rec.text);
      // The notes follow the label's words as they are now (the record holds the text it started with).
      if (out.label && api.hasAttribute(out.label, A.TEXT_ATTR)) { try { out.text = String(api.get(out.label, A.TEXT_ATTR)); } catch (e) { /* the recorded words */ } }
      return out;
    });
  }
  // Every callout group and member (helpers group included): what Bake leaves alone and what counts as a callout in a selection.
  function calloutParts(map) {
    var out = {};
    findCallouts(map).forEach(function (c) {
      out[c.groupId] = true;
      CALLOUT_NAMES.concat(["draws"]).forEach(function (k) { [].concat(c[k]).forEach(function (id) { if (id) out[id] = true; }); });
      var helper = [c.size, c.place, c.fade, c.edge, c.bend].concat(c.draws).filter(Boolean)[0];
      var holder = helper ? api.getParent(helper) : "";
      if (holder && holder !== c.groupId) out[holder] = true;
    });
    return out;
  }

  // text: the label's words; place: { lon, lat }. Returns the new group's id; a callout that can't be
  // wired is deleted again before the error goes on, and the user's selection is put back.
  function createCallout(map, place, text) {
    if (typeof api.setGenerator !== "function" || typeof api.primitive !== "function" || typeof api.setUserData !== "function") throw new Error("This Cavalry can't make callouts.");
    var E = GeoExpression, CA = A.CAMERA_ARRAY_ATTR, look = styleOf(map), lon = Number(place.lon), lat = Number(place.lat);
    var words = String(text == null ? "" : text);
    var made = [], previous = null;
    function track(id) { made.push(id); return id; }
    var number = numberGroups(calloutGroups(map), CALLOUT_NUMBER_KEY, "Callout") + 1, label0 = "Callout " + number;
    try { previous = api.getSelection(); } catch (e0) { previous = null; }
    try {
      var g = track(api.create("group", capTitle(label0 + ": " + words)));
      api.parent(g, map.groupId);
      api.set(g, identityTransform());
      var helpers = track(api.create("group", label0 + " helpers"));
      api.parent(helpers, g);
      api.set(helpers, identityTransform());
      var meta = function (category) { return { camera: map.cameraId, category: category }; };
      var utility = function (name, inputs, values, expr) {
        var id = track(api.create(A.CAMERA_LAYER_TYPE, label0 + " " + name));
        addInputs(id, CA, inputs, values);
        setOne(id, A.CAMERA_EXPR_ATTR, expr);
        api.parent(id, helpers);
        return id;
      };
      var feed = function (id, sources) { sources.forEach(function (s, i) { api.connect(s[0], s[1], id, CA + "." + i, true); }); };

      // The label (its position stays the user's) and its background box, the label's sibling just below it.
      var label = track(api.create(A.TEXT_LAYER_TYPE, label0 + " label"));
      setOne(label, A.TEXT_ATTR, words);
      applyStyle(label, { fill: look.colors.text });
      api.set(label, { backgroundMode: CALLOUT_DOCUMENT_BACKGROUND, backgroundPadding: CALLOUT_PADDING, cornerRadius: CALLOUT_CORNER });
      // The box is the label's sibling (a child of the label would draw over the text); it follows the
      // label through connections, so its own transform is never set.
      var box = track(api.create("customShape", label0 + " box"));
      api.connect(label, "backgroundShape", box, "inputShape", true);
      applyStyle(box, { fill: GeoStyles.calloutBox(look) });
      var size = track(api.create("boundingBox", label0 + " size"));
      api.connect(label, A.DRIVER_OUTPUT_ATTR, size, "inputShapes");
      api.connect(box, A.DRIVER_OUTPUT_ATTR, size, "inputShapes");
      api.parent(size, helpers);

      // The dot at the place, and the drivers that keep it (and the lines) on it.
      var dot = track(api.primitive("ellipse", label0 + " dot"));
      setOne(dot, "generator.radius", [CALLOUT_DOT, CALLOUT_DOT]);
      applyStyle(dot, { fill: look.colors.accent });
      var placeId = utility("place", E.LABEL_INPUTS, { labelLon: lon, labelLat: lat }, E.labelDriverExpression(GEO_RUNTIME_SRC, meta("calloutPlace"), A.DRIVER_RETURN));
      connectCamera(map.cameraId, placeId, CA);
      api.connect(placeId, A.DRIVER_OUTPUT_ATTR, dot, "position", true);
      var fade = utility("fade", E.LABEL_INPUTS, { labelLon: lon, labelLat: lat }, E.labelVisibilityExpression(GEO_RUNTIME_SRC, meta("calloutFade")));
      connectCamera(map.cameraId, fade, CA);
      api.connect(placeId, CA + ".5", fade, CA + ".5", true);
      api.connect(placeId, CA + ".6", fade, CA + ".6", true);
      api.connect(fade, A.DRIVER_OUTPUT_ATTR, dot, "opacity", true);

      // Edge / bend / draw helpers: the dot (place) and the label's centre and size in, line points and trim out.
      var geom = [[dot, "position.x"], [dot, "position.y"], [size, "position.x"], [size, "position.y"], [size, "size.x"], [size, "size.y"]];
      var edge = utility("edge", E.CALLOUT_GEOM_INPUTS, {}, E.calloutEdgeExpression(meta("calloutEdge")));
      var bend = utility("bend", E.CALLOUT_GEOM_INPUTS, {}, E.calloutBendExpression(meta("calloutBend")));
      var draws = [0, 1].map(function (i) { return utility("draw " + (i + 1), E.CALLOUT_DRAW_INPUTS, { index: i }, E.calloutDrawExpression(meta("calloutDraw"))); });
      [edge, bend].concat(draws).forEach(function (h) { feed(h, geom); });

      var lines = [[edge, bend], [bend, placeId]].map(function (ends, i) {
        var line = track(api.create("basicLine", label0 + " line " + (i + 1)));
        api.setGenerator(line, "generator", "bezierLine");
        applyStyle(line, { stroke: look.colors.accent, width: CALLOUT_LINE_WIDTH });
        if (A.STROKE_CAP_ATTR) { try { setOne(line, A.STROKE_CAP_ATTR, A.ROUND_CAP_VALUE); } catch (e1) { /* default caps */ } }
        setOne(line, "stroke.trim", true);
        api.set(line, { "generator.startOffset": [0, 0], "generator.endOffset": [0, 0] });
        api.connect(ends[0], A.DRIVER_OUTPUT_ATTR, line, "generator.startPosition", true);
        api.connect(ends[1], A.DRIVER_OUTPUT_ATTR, line, "generator.endPosition", true);
        api.connect(draws[i], A.DRIVER_OUTPUT_ATTR, line, "stroke.trimEnd", true);
        api.connect(fade, A.DRIVER_OUTPUT_ATTR, line, "opacity", true);
        return line;
      });

      // Bottom to top: lines, dot, box, label (a new layer lands on top, so the box ends directly below the label). Parenting keeps the world
      // transform, so each layer is reset afterwards; the dot's position is driven, so it is left alone.
      lines.forEach(function (line) { api.parent(line, g); api.set(line, identityTransform()); });
      api.parent(dot, g);
      api.set(dot, { "rotation.z": 0, "scale.x": 1, "scale.y": 1 });
      api.parent(box, g);
      ["position", "rotation.z", "scale.x", "scale.y"].forEach(function (attr) { api.connect(label, attr, box, attr, true); });
      api.parent(label, g);
      var s = compSize(), p = GeoRuntime.projectPoint(lon, lat, readCamera(map.cameraId));
      api.set(label, {
        "rotation.z": 0, "scale.x": 1, "scale.y": 1,
        position: [Math.max(-s.width / 2 + CALLOUT_MARGIN, Math.min(s.width / 2 - CALLOUT_LABEL_W, p[0] + CALLOUT_OFFSET[0])),
          Math.max(-s.height / 2 + CALLOUT_MARGIN, Math.min(s.height / 2 - CALLOUT_MARGIN, p[1] + CALLOUT_OFFSET[1]))]
      });

      api.setUserData(g, CALLOUT_KEY, {
        camera: map.cameraId, lon: lon, lat: lat, text: words, label: label, box: box, dot: dot, line1: lines[0], line2: lines[1],
        size: size, place: placeId, fade: fade, edge: edge, bend: bend, draws: draws
      });
      api.setUserData(g, CALLOUT_NUMBER_KEY, number);
      return g;
    } catch (e) {
      made.slice().reverse().forEach(function (id) { try { if (layerThere(id)) api.deleteLayer(id); } catch (e2) { /* already gone */ } });
      throw e;
    } finally {
      if (previous && typeof api.select === "function") { try { api.select(previous); } catch (e3) { /* cosmetic */ } }
    }
  }

  // ---- Day & night ---------------------------------------------------------------------------
  // One overlay per map: a group "Day & night" in the map group holding four night layers (one per
  // twilight depression, since a Cavalry shape has a single opacity) and a helpers group with one
  // opacity helper per layer. An optional "Time label" sits in the map group like map furniture.
  // The group's user data records every member (geoDayNight).
  var DAYNIGHT_KEY = "geoDayNight", TIME_LABEL_NAME = "Time label", NIGHT_DEPRESSIONS = [0, 6, 12, 18];

  // This map's day & night group, straight from the map group's children (top first).
  function dayNightGroups(map) {
    return api.getChildren(map.groupId).filter(function (id) {
      var rec = userData(id, DAYNIGHT_KEY);
      return !!rec && typeof rec === "object" && rec.camera === map.cameraId;
    });
  }
  // A recorded time label counts only while it is a child of the map group, a time label of this map.
  function ownTimeLabel(map, id) {
    if (!id || !layerThere(id) || api.getParent(id) !== map.groupId) return null;
    var m = GeoExpression.readTag(readExpr(id, A.MAP_EXPR_ATTR), "GEO_META");
    return m && m.category === "timeLabel" && m.camera === map.cameraId ? id : null;
  }
  // { groupId, layers: [4], helpers: [4], label } or null. A recorded layer counts while it is a child
  // of the group, a helper while it is a child of a group inside it (a missing one reads as null).
  function findDayNight(map) {
    var g = dayNightGroups(map)[0];
    if (!g) return null;
    var rec = userData(g, DAYNIGHT_KEY) || {};
    function own(id, depth) {
      if (!id || !layerThere(id)) return null;
      var p = api.getParent(id);
      if (depth === 1) return p === g ? id : null;
      return p && p !== g && api.getParent(p) === g ? id : null;
    }
    return {
      groupId: g,
      layers: NIGHT_DEPRESSIONS.map(function (a, i) { return own((rec.layers || [])[i], 1); }),
      helpers: NIGHT_DEPRESSIONS.map(function (a, i) { return own((rec.helpers || [])[i], 2); }),
      label: ownTimeLabel(map, rec.label)
    };
  }
  // Every part of the overlay (group, layers, helpers group and helpers, label): what a style colours and Bake leaves alone.
  function dayNightParts(map) {
    var out = {}, f = findDayNight(map);
    if (!f) return out;
    out[f.groupId] = true;
    f.layers.concat(f.helpers, [f.label]).forEach(function (id) { if (id) out[id] = true; });
    f.helpers.forEach(function (id) { var p = id ? api.getParent(id) : ""; if (p && p !== f.groupId) out[p] = true; });
    return out;
  }

  function utcToday() {
    var d = new Date(), day = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
    return { dayOfYear: Math.min(365, day), utcTime: Math.round((d.getUTCHours() + d.getUTCMinutes() / 60) * 4) / 4 };
  }
  function clampNumber(v, lo, hi, dflt) { var n = Number(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }

  // Sets a layer's day of year and UTC time; an input a Controls value drives is set on that value.
  function setDayNightTime(map, id, inputs, arrayAttr, day, time) {
    [["dayOfYear", day], ["utcTime", time]].forEach(function (p) {
      var attr = arrayAttr + "." + GeoExpression.inputIndex(inputs, p[0]), d = drivenBy(map, { layer: id, attr: attr });
      if (d.src) setOne(d.src, d.attr, p[1]); else setOne(id, attr, p[1]);
    });
  }

  // The time label: a script shape in the map group, in the style's text colour, fed the camera.
  function createTimeLabel(map, day, time, track) {
    var E = GeoExpression, s = compSize(), id = track(api.create(A.MAP_LAYER_TYPE, TIME_LABEL_NAME));
    addInputs(id, A.MAP_ARRAY_ATTR, E.TIME_LABEL_INPUTS, { dayOfYear: day, utcTime: time, compW: s.width, compH: s.height });
    setOne(id, A.MAP_EXPR_ATTR, E.timeLabelExpression(GEO_SUN_SRC, { camera: map.cameraId, category: "timeLabel" }));
    connectCamera(map.cameraId, id, A.MAP_ARRAY_ATTR);
    applyStyle(id, layerStyle(map, "timeLabel"));
    api.parent(id, map.groupId);
    api.set(id, identityTransform());
    return id;
  }

  // Puts the overlay directly above the map's lowest layers (base layers, imagery, Ocean) and so below
  // everything else. Cosmetic, like restackBaseLayers: a failure never undoes the overlay.
  function stackDayNight(map, groupId) {
    var base = {};
    findMapLayers(map).forEach(function (l) { if (GeoControls.BASE.indexOf(l.meta.category) >= 0) base[l.id] = true; });
    findImagery(map).forEach(function (i) { base[i.groupId] = true; });
    var ocean = findOcean(map);
    if (ocean) base[ocean] = true;
    var anchor = api.getChildren(map.groupId).filter(function (id) { return base[id]; })[0];
    if (anchor) placeAbove(groupId, anchor);
    else if (typeof api.moveToBack === "function" && typeof api.select === "function") sendToBack(groupId);
  }

  // opts: { dayOfYear, utcTime, label }. Makes the overlay, or (one per map) sets the existing one's
  // time on every layer and the label, adding the label when asked and missing. Returns { groupId, created }.
  // Whatever it made is deleted again if it fails, and the user's selection is put back.
  function addDayNight(map, opts) {
    if (typeof api.setUserData !== "function") throw new Error("This Cavalry can't make a day & night overlay.");
    opts = opts || {};
    var E = GeoExpression, CA = A.CAMERA_ARRAY_ATTR, MA = A.MAP_ARRAY_ATTR, today = utcToday();
    var day = Math.round(clampNumber(opts.dayOfYear, 1, 365, today.dayOfYear)), time = clampNumber(opts.utcTime, 0, 24, today.utcTime);
    var found = findDayNight(map), made = [], previous = null;
    function track(id) { made.push(id); return id; }
    try { previous = api.getSelection(); } catch (e0) { previous = null; }
    try {
      if (found) {
        var label = found.label || (opts.label ? createTimeLabel(map, day, time, track) : null);
        found.layers.forEach(function (id) { if (id) setDayNightTime(map, id, E.NIGHT_INPUTS, MA, day, time); });
        if (found.label) setDayNightTime(map, found.label, E.TIME_LABEL_INPUTS, MA, day, time);
        if (label !== found.label) {
          var old = userData(found.groupId, DAYNIGHT_KEY) || {}, fixed = {};
          Object.keys(old).forEach(function (k) { fixed[k] = old[k]; });
          fixed.label = label;
          api.setUserData(found.groupId, DAYNIGHT_KEY, fixed);
        }
        return { groupId: found.groupId, created: false };
      }
      var look = styleOf(map), colour = GeoStyles.nightColour(look);
      var g = track(api.create("group", "Day & night"));
      api.parent(g, map.groupId);
      api.set(g, identityTransform());
      var holder = track(api.create("group", "Day & night helpers"));
      api.parent(holder, g);
      api.set(holder, identityTransform());
      var layers = [], helpers = [];
      NIGHT_DEPRESSIONS.forEach(function (a, i) {
        var id = track(api.create(A.MAP_LAYER_TYPE, "Night " + a + "°"));
        addInputs(id, MA, E.NIGHT_INPUTS, { dayOfYear: day, utcTime: time, depression: a });
        setOne(id, A.MAP_EXPR_ATTR, E.nightExpression(GEO_SUN_SRC, { camera: map.cameraId, category: "dayNight", depression: a }));
        connectCamera(map.cameraId, id, MA);
        applyStyle(id, { fill: colour });
        var h = track(api.create(A.CAMERA_LAYER_TYPE, "Night opacity " + a + "°"));
        addInputs(h, CA, E.NIGHT_OPACITY_INPUTS, { step: i });
        setOne(h, A.CAMERA_EXPR_ATTR, E.nightOpacityExpression({ camera: map.cameraId, category: "dayNightOpacity", step: i }));
        api.connect(h, A.DRIVER_OUTPUT_ATTR, id, "opacity", true);
        api.parent(h, holder);
        api.parent(id, g);
        api.set(id, identityTransform());
        layers.push(id); helpers.push(h);
      });
      var tl = opts.label ? createTimeLabel(map, day, time, track) : null;
      api.setUserData(g, DAYNIGHT_KEY, { camera: map.cameraId, layers: layers, helpers: helpers, label: tl });
      try { stackDayNight(map, g); } catch (e1) { /* cosmetic: it stays where it landed */ }
      return { groupId: g, created: true };
    } catch (e) {
      made.slice().reverse().forEach(function (id) { try { if (layerThere(id)) api.deleteLayer(id); } catch (e2) { /* already gone */ } });
      throw e;
    } finally {
      if (previous && typeof api.select === "function") { try { api.select(previous); } catch (e3) { /* cosmetic */ } }
    }
  }

  // ---- Map styles: apply a style to a map, or read a map's colours back ------------------
  var LINE_SOURCES = ["states", "coastlines", "rivers", "roads", "railways"];
  var CREDIT_NAMES = [ATTRIBUTION_NAME, IMAGERY_CREDIT_NAME];

  // ---- Map furniture: a scale bar and a north arrow pinned to a frame corner -------------------
  var FURNITURE_NAMES = { scaleBar: "Scale bar", northArrow: "North arrow" }, FADE_NAME = "Scale bar fade";
  function findFurniture(map, layers) {
    var out = { scaleBar: null, northArrow: null, fade: null };
    (layers || findMapLayers(map)).forEach(function (l) {
      if (l.meta.category === "scaleBar" && !out.scaleBar) out.scaleBar = l.id;
      if (l.meta.category === "northArrow" && !out.northArrow) out.northArrow = l.id;
    });
    // The fade is the one wired to the bar's opacity (and made for this map), never found by scanning the comp.
    if (out.scaleBar) {
      try {
        var from = String(api.getInConnection(out.scaleBar, "opacity") || ""), dot = from.indexOf("."), fid = dot > 0 ? from.slice(0, dot) : "";
        if (fid && isFade(map, fid)) out.fade = fid;
      } catch (e) { /* no fade */ }
    }
    return out;
  }
  function isFade(map, id) {
    if (!layerThere(id)) return false;
    var m = GeoExpression.readTag(readExpr(id, A.CAMERA_EXPR_ATTR), "GEO_META");
    return !!m && m.category === "scaleBarFade" && m.camera === map.cameraId;
  }
  // Fades left behind when their bar was deleted: this map's fades (children of its group) that drive nothing.
  function deleteOrphanFades(map) {
    api.getChildren(map.groupId).forEach(function (id) {
      try {
        if (!isFade(map, id)) return;
        if (typeof api.getOutConnections === "function" && (api.getOutConnections(id, A.DRIVER_OUTPUT_ATTR) || []).length) return;
        api.deleteLayer(id);
      } catch (e) { /* left in place */ }
    });
  }
  // Makes one furniture layer (camera-linked script shape in the map's text colour); cleans up on failure.
  function makeFurniture(map, kind, inputs, values, expr) {
    var made = [];
    try {
      var id = api.create(A.MAP_LAYER_TYPE, FURNITURE_NAMES[kind]); made.push(id);
      addInputs(id, A.MAP_ARRAY_ATTR, inputs, values);
      setOne(id, A.MAP_EXPR_ATTR, expr);
      connectCamera(map.cameraId, id, A.MAP_ARRAY_ATTR);
      applyStyle(id, layerStyle(map, "furniture"));
      api.parent(id, map.groupId);
      return { id: id, made: made };
    } catch (e) {
      made.forEach(function (x) { try { if (layerThere(x)) api.deleteLayer(x); } catch (e2) { /* already gone */ } });
      throw e;
    }
  }
  function addScaleBar(map) {
    if (findFurniture(map).scaleBar) throw new Error("This map already has a scale bar.");
    var E = GeoExpression, s = compSize(), r = makeFurniture(map, "scaleBar", E.SCALE_BAR_INPUTS,
      { compW: s.width, compH: s.height, raise: hasAttribution(map) ? 40 : 0 },
      E.scaleBarExpression(GEO_FURNITURE_SRC, { camera: map.cameraId, category: "scaleBar" }));
    try {
      deleteOrphanFades(map);
      var fade = api.create(A.CAMERA_LAYER_TYPE, FADE_NAME); r.made.push(fade);
      addInputs(fade, A.CAMERA_ARRAY_ATTR, E.FURNITURE_FADE_INPUTS);
      setOne(fade, A.CAMERA_EXPR_ATTR, E.furnitureFadeExpression({ camera: map.cameraId, category: "scaleBarFade" }));
      api.connect(map.cameraId, A.CAMERA_ARRAY_ATTR + ".2", fade, A.CAMERA_ARRAY_ATTR + ".0", true);
      api.connect(fade, A.DRIVER_OUTPUT_ATTR, r.id, "opacity", true);
      api.parent(fade, map.groupId);
    } catch (e) {
      r.made.forEach(function (x) { try { if (layerThere(x)) api.deleteLayer(x); } catch (e2) { /* already gone */ } });
      throw e;
    }
    return r.id;
  }
  function addNorthArrow(map) {
    if (findFurniture(map).northArrow) throw new Error("This map already has a north arrow.");
    var E = GeoExpression, s = compSize();
    return makeFurniture(map, "northArrow", E.NORTH_ARROW_INPUTS, { compW: s.width, compH: s.height },
      E.northArrowExpression(GEO_FURNITURE_SRC, { camera: map.cameraId, category: "northArrow" })).id;
  }
  // Keeps the furniture's comp size in step with the composition (it can't read it itself).
  // found is { scaleBar, northArrow } when the caller already knows them (no comp scan then).
  function fitFurniture(map, found) {
    var f = found || findFurniture(map), s = compSize(), E = GeoExpression;
    [[f.scaleBar, E.SCALE_BAR_INPUTS], [f.northArrow, E.NORTH_ARROW_INPUTS]].forEach(function (x) {
      if (!x[0]) return;
      var o = {}, w = A.MAP_ARRAY_ATTR + "." + E.inputIndex(x[1], "compW"), h = A.MAP_ARRAY_ATTR + "." + E.inputIndex(x[1], "compH");
      if (Number(api.get(x[0], w)) !== s.width) o[w] = s.width;
      if (Number(api.get(x[0], h)) !== s.height) o[h] = s.height;
      if (Object.keys(o).length) api.set(x[0], o);
    });
  }

  // The ids of every part of a map a style colours (see GeoStyles.targets).
  function styleParts(map) {
    var parts = { ocean: findOcean(map), layers: [], pins: [], stops: [], legs: [], markers: [], labels: [], valueLabels: [], legends: [], credits: [], furniture: [], regions: [], calloutLines: [], calloutDots: [], calloutBoxes: [], nightLayers: [], timeLabels: [] };
    var layers = findMapLayers(map);
    layers.forEach(function (l) {
      var c = l.meta.category;
      if (GeoControls.BASE.indexOf(c) >= 0) parts.layers.push({ id: l.id, category: c });
      else if (c === "extract") parts.layers.push({ id: l.id, category: c, line: LINE_SOURCES.indexOf(l.meta.source) >= 0 });
      else if (c === "pin") parts.pins.push(l.id);
      else if (c === "route") parts.legs.push(l.id);
      else if (c === "label") parts.labels.push(l.id);
      else if (c === "data" && l.meta.display === "regions") parts.regions.push(l.id);
      else if (c === "data" && l.meta.display === "labels") parts.valueLabels.push(l.id);
      else if (c === "data" && (l.meta.display === "legend" || l.meta.display === "bubbleLegend")) parts.legends.push(l.id);
    });
    findRoutes(map).forEach(function (r) {
      r.stops.forEach(function (s) { parts.stops.push(s.circle); if (s.label && layerThere(s.label)) parts.labels.push(s.label); });
      r.legs.forEach(function (l) { parts.legs.push(l.line); });
    });
    findTravellers(map).forEach(function (t) { if (!t.userSource && t.source && layerThere(t.source)) parts.markers.push(t.source); });
    findLabels(map).forEach(function (id) { parts.labels.push(id); });
    findCallouts(map).forEach(function (c) {
      [c.line1, c.line2].forEach(function (id) { if (id) parts.calloutLines.push(id); });
      if (c.dot) parts.calloutDots.push(c.dot);
      if (c.label) parts.labels.push(c.label);
      if (c.box) parts.calloutBoxes.push(c.box);
    });
    var dn = findDayNight(map);
    if (dn) { dn.layers.forEach(function (id) { if (id) parts.nightLayers.push(id); }); if (dn.label) parts.timeLabels.push(dn.label); }
    api.getChildren(map.groupId).forEach(function (id) { if (CREDIT_NAMES.indexOf(api.getNiceName(id)) >= 0) parts.credits.push(id); });
    var fu = findFurniture(map, layers); [fu.scaleBar, fu.northArrow].forEach(function (id) { if (id) parts.furniture.push(id); });
    return parts;
  }

  function keyed(id, attr) { try { return (api.getKeyframeTimes(id, attr) || []).length > 0; } catch (e) { return false; } }

  function hasIn(id, attr) { try { return !!api.getInConnection(id, attr); } catch (e) { return false; } }

  // What drives a target's attribute: { src, attr } when it is wired from this map's Controls
  // values utility, { other: true } when it is wired to anything else, {} when it is not wired.
  function drivenBy(map, t) {
    var from = "";
    try { from = String(api.getInConnection(t.layer, t.attr) || ""); } catch (e) { from = ""; }
    if (!from) return {};
    var dot = from.indexOf("."), src = dot > 0 ? from.slice(0, dot) : "";
    if (src && userData(src, "geoValues") === map.cameraId) return { src: src, attr: from.slice(dot + 1) };
    return { other: true };
  }

  // Where a target's value is written: { layer, attr } on the layer itself or on the Controls
  // value that drives it; { skip: key } (the real attribute, so a value shared by N layers counts
  // once) when it is animated or wired to anything else.
  function styleSlot(map, t) {
    var own = t.layer + "." + t.attr, d = drivenBy(map, t);
    if (d.other) return { skip: own };
    if (d.src) return keyed(d.src, d.attr) || hasIn(d.src, d.attr) ? { skip: d.src + "." + d.attr } : { layer: d.src, attr: d.attr };
    return keyed(t.layer, t.attr) ? { skip: own } : { layer: t.layer, attr: t.attr };
  }

  function applyMapStyle(map, style) {
    style = GeoStyles.clean(style);
    var done = {}, skipped = {};
    GeoStyles.targets(styleParts(map)).forEach(function (t) {
      var slot = styleSlot(map, t);
      if (slot.skip) { skipped[slot.skip] = true; return; }
      var k = slot.layer + "." + slot.attr;
      if (done[k]) return;
      done[k] = true;
      var v = GeoStyles.valueFor(style, t);
      setOne(slot.layer, slot.attr, t.kind === "color" ? A.COLOR_VALUE(v) : v);
    });
    setMapStyle(map, style);
    return { skipped: Object.keys(skipped).length };
  }

  function readMapStyle(map, name) {
    var readings = GeoStyles.targets(styleParts(map)).map(function (t) {
      var d = drivenBy(map, t), value;
      try { value = d.src ? api.get(d.src, d.attr) : api.get(t.layer, t.attr); } catch (e) { value = null; }
      return { role: t.role, kind: t.kind, value: value };
    });
    return GeoStyles.fromReadings(name, readings, styleOf(map));
  }

  // ---- Previews: what the panel's map previews draw for a map ------------------------------
  // A number input as it currently reads: through its incoming connection (a Controls value)
  // when it has one, else its own value. NaN when unreadable.
  function inputValue(id, attr) {
    var from = "";
    try { from = String(api.getInConnection(id, attr) || ""); } catch (e) { from = ""; }
    var dot = from.indexOf(".");
    try { return Number(dot > 0 ? api.get(from.slice(0, dot), from.slice(dot + 1)) : api.get(id, attr)); } catch (e) { return NaN; }
  }
  function lonLat(lon, lat) { return isFinite(lon) && isFinite(lat) ? { lon: lon, lat: lat } : null; }

  // The map's street-level layers for the previews (ids, how to draw, colour); data is read
  // separately (readPreviewLayer) so the panel can keep it.
  // Bottom first (the map's stacking): parks, water, railways, roads, then extracts. layers is an
  // optional findMapLayers(map) result, so a caller reading several things scans the comp once.
  // sig changes when the layer's data does.
  var STREET_ORDER = ["parks", "water", "railways", "roads", "extract"];
  function previewStreets(map, layers) {
    var look = styleOf(map), out = [];
    (layers || findMapLayers(map)).forEach(function (l) {
      var c = l.meta.category, rank = STREET_ORDER.indexOf(c);
      if (rank < 0) return;
      if (c === "roads" || c === "railways") out.push({ id: l.id, sig: l.size, rank: rank, kind: "line", color: look.colors[c] });
      else if (c === "water" || c === "parks") out.push({ id: l.id, sig: l.size, rank: rank, kind: "fill", color: look.colors[c] });
      else if (l.meta.source !== "cities") out.push({ id: l.id, sig: l.size, rank: rank, kind: LINE_SOURCES.indexOf(l.meta.source) >= 0 ? "line" : "fill", color: look.colors.extract });
    });
    out.forEach(function (s, i) { s.i = i; });
    out.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
    out.forEach(function (s) { delete s.rank; delete s.i; });
    return out;
  }
  function readPreviewLayer(id) { return GeoCodec.decodeLayer(readLayerData(id)); }
  function previewModel(map, layers) {
    var look = styleOf(map), E = GeoExpression, CA = A.CAMERA_ARRAY_ATTR + ".";
    var out = { colors: { accent: look.colors.accent, text: look.colors.text }, pins: [], labels: [], routes: [] };
    var LIFT = A.MAP_ARRAY_ATTR + "." + E.inputIndex(E.ROUTE_INPUTS, "lift"), oldRoutes = {}, oldOrder = [];
    function sameSpot(a, b) { return Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9; }
    (layers || findMapLayers(map)).forEach(function (l) {
      var c = l.meta.category;
      if (c !== "pin" && c !== "label" && c !== "route") return;
      var layer;
      try { layer = GeoCodec.decodeLayer(readLayerData(l.id)); } catch (e) { return; }
      (layer.features || []).forEach(function (f) {
        var ring = f.rings && f.rings[0];
        if (!ring || !ring.length) return;
        if (c === "pin") { var p = lonLat(ring[0][0], ring[0][1]); if (p) out.pins.push(p); }
        else if (c === "label") { var q = lonLat(ring[0][0], ring[0][1]); if (q) out.labels.push({ lon: q.lon, lat: q.lat, text: String(f.name || "") }); }
        else {
          var a = lonLat(ring[0][0], ring[0][1]), b = lonLat(ring[ring.length - 1][0], ring[ring.length - 1][1]), g = api.getParent(l.id);
          if (!a || !b) return;
          if (!oldRoutes[g]) { oldRoutes[g] = { stops: [], legs: [] }; oldOrder.push(g); }
          var lift = inputValue(l.id, LIFT);
          oldRoutes[g].legs.push({ from: a, to: b, arc: isFinite(lift) ? lift : 30, lean: 0, flip: false });
          [a, b].forEach(function (s) { if (!oldRoutes[g].stops.some(function (t) { return sameSpot(s, t); })) oldRoutes[g].stops.push(s); });
        }
      });
    });
    oldOrder.forEach(function (g) { out.routes.push(oldRoutes[g]); });
    labelDrivers(map).forEach(function (l) {
      var p = lonLat(inputValue(l.driver, CA + "5"), inputValue(l.driver, CA + "6"));
      var text = "";
      try { text = String(api.get(l.text, A.TEXT_ATTR) || ""); } catch (e) { text = ""; }
      if (p) out.labels.push({ lon: p.lon, lat: p.lat, text: text });
    });
    // A callout's place: read live from its place driver (like a label's), else from its record.
    findCallouts(map).forEach(function (c) {
      var rec = userData(c.groupId, CALLOUT_KEY) || {}, drv = c.place;
      var p = (drv ? lonLat(inputValue(drv, CA + "5"), inputValue(drv, CA + "6")) : null) || lonLat(Number(rec.lon), Number(rec.lat));
      if (p) out.pins.push(p);
    });
    findRoutes(map).forEach(function (r) {
      var d = userData(r.groupId, ROUTE_KEY) || {};
      var places = (d.stops || []).map(function (s) {
        return s && s.position && layerThere(s.position) ? lonLat(inputValue(s.position, CA + "5"), inputValue(s.position, CA + "6")) : null;
      });
      var route = { stops: places.filter(function (p) { return !!p; }), legs: [] };
      (d.legs || []).forEach(function (l) {
        var a = places[l.from], b = places[l.to];
        if (!a || !b || !l.line || !layerThere(l.line)) return;
        var h = l.startHandle && layerThere(l.startHandle) ? l.startHandle : null;
        function hv(name, dflt) { if (!h) return dflt; var v = inputValue(h, CA + E.inputIndex(E.HANDLE_INPUTS, name)); return isFinite(v) ? v : dflt; }
        route.legs.push({ from: a, to: b, arc: hv("arc", 30), lean: hv("lean", 0), flip: !!hv("flip", 0) });
      });
      if (route.stops.length) out.routes.push(route);
    });
    return out;
  }

  return {
    STYLE: STYLE,
    styleOf: styleOf, setMapStyle: setMapStyle, layerStyle: layerStyle, createMap: createMap, findMaps: findMaps, readCamera: readCamera, setCamera: setCamera,
    compSize: compSize, createMapLayer: createMapLayer, findMapLayers: findMapLayers, readLayerData: readLayerData, readLayerMeta: layerMeta,
    addPin: addPin, extract: extract, bake: bake, createLabel: createLabel, createRoute: createRoute, findRoutes: findRoutes, routeNumber: routeNumber, routeDraws: routeDraws, stripRoute: stripRoute, prepareRoutes: prepareRoutes, numberRoutes: numberRoutes, sceneOrder: sceneOrder, pinStops: pinStops,
    isMapPart: isMapPart, routeOfSelection: routeOfSelection, addTraveller: addTraveller, removeTraveller: removeTraveller, findTravellers: findTravellers,
    hasAttribution: hasAttribution, createAttribution: createAttribution, createImageryCredit: createImageryCredit, restackBaseLayers: restackBaseLayers,
    createDataLayers: createDataLayers, refreshData: refreshData,
    compFrameRange: compFrameRange, sampleCamera: sampleCamera, planImagery: planImagery, itemBase: itemBase, itemUrl: itemUrl, buildImagery: buildImagery, beginImageryBuild: beginImageryBuild,
    findImagery: findImagery, flyCamera: flyCamera, recordFlight: recordFlight, flightAt: flightAt, flightStart: flightStart, readCameraAt: readCameraAt, extendComp: extendComp, findLabels: findLabels, findOcean: findOcean,
    applyMapStyle: applyMapStyle, readMapStyle: readMapStyle,
    HIGHLIGHT_EFFECTS: HIGHLIGHT_EFFECTS, createHighlight: createHighlight, changeHighlightEffect: changeHighlightEffect, highlightOfSelection: highlightOfSelection, findHighlights: findHighlights, prepareHighlights: prepareHighlights, highlightParts: highlightParts, highlightNumber: highlightNumber,
    createCallout: createCallout, findCallouts: findCallouts, prepareCallouts: prepareCallouts, calloutParts: calloutParts, calloutNumber: calloutNumber,
    addDayNight: addDayNight, findDayNight: findDayNight, dayNightParts: dayNightParts,
    addScaleBar: addScaleBar, addNorthArrow: addNorthArrow, findFurniture: findFurniture, fitFurniture: fitFurniture,
    previewModel: previewModel, previewStreets: previewStreets, readPreviewLayer: readPreviewLayer
  };
})();

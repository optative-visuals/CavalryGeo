// Creates, connects and reads Cavalry Geo layers. Panel-only: uses `api` and `cavalry`.
var GeoScene = (function () {
  var A = GeoAttrs;
  var ATTRIBUTION_NAME = "OpenStreetMap credit";
  var OCEAN_NAME = "Ocean";
  var OCEAN_COLOR = "#1d2a33";
  var CREDIT_STYLE = { fill: "#e6e6e6" };
  // Same palette as the Map tab preview; pins and routes use the panel's button green.
  var STYLE = {
    countries: { fill: "#4a5a50", stroke: "#2a3530", width: 1 }, states: { stroke: "#3a4a40", width: 0.5 }, lakes: { fill: "#1d2a33" },
    coastlines: { stroke: "#2a3530", width: 0.5 }, rivers: { stroke: "#3d6178", width: 1.5 }, cities: { fill: "#e6e6e6" },
    buildings: { fill: "#5c6b61" }, water: { fill: "#1d2a33" }, parks: { fill: "#56705a" },
    roads: { stroke: "#8a948e", width: 2 }, railways: { stroke: "#a0a7a3", width: 1.5 },
    extractFill: { fill: "#e4572e" }, extractLine: { stroke: "#e4572e", width: 3 },
    pin: { fill: "#1F8F4E" }, label: { fill: "#e6e6e6" },
    stop: { fill: "#1F8F4E" },
    route: { stroke: "#1F8F4E", width: 3 }
  };
  var STOP_RADIUS = 8, ROUTE_KEY = "geoRoute";

  function setOne(id, attr, value) { var o = {}; o[attr] = value; api.set(id, o); }

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

  function createMap(name, cam) {
    var groupId = api.create("group", name);
    var cameraId = api.create(A.CAMERA_LAYER_TYPE, name + " Camera");
    setOne(cameraId, A.CAMERA_EXPR_ATTR, GeoExpression.cameraExpression({ name: name }, A.CAMERA_BODY));
    addInputs(cameraId, A.CAMERA_ARRAY_ATTR, GeoExpression.CAMERA_INPUTS, camValues(cam));
    api.parent(cameraId, groupId);
    try { createOcean(groupId); } catch (e) { /* the Ocean is cosmetic: never fail the map over it */ }
    return { name: name, cameraId: cameraId, groupId: groupId };
  }

  // The canvas has no water layer (the sea is the composition background), so each new
  // map gets a dark rectangle at the bottom of its group, twice the comp size so it
  // still covers the frame when the map group is moved or scaled. Optional: skipped
  // when this Cavalry has no api.primitive.
  function createOcean(groupId) {
    // Read the selection before anything is created (Cavalry may select new layers) and
    // put it back however this returns, so the user's selection is never changed.
    var previous = null;
    try { previous = api.getSelection(); } catch (e) { /* nothing to restore */ }
    try {
      if (typeof api.primitive !== "function") return;
      var s = compSize();
      var id = api.primitive("rectangle", OCEAN_NAME);
      setOne(id, "generator.dimensions", [2 * s.width, 2 * s.height]);
      applyStyle(id, { fill: OCEAN_COLOR });
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
      var meta = layerMeta(id);
      if (meta && meta.camera === map.cameraId) out.push({ id: id, name: api.getNiceName(id), meta: meta });
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
    return createMapLayer(map, "Pin: " + name, enc, { camera: map.cameraId, category: "pin" }, STYLE.pin, { pointRadius: 8 }, parentId);
  }

  function createRouteLeg(map, parentId, name, enc, lift) {
    var id = api.create(A.MAP_LAYER_TYPE, name);
    addInputs(id, A.MAP_ARRAY_ATTR, GeoExpression.ROUTE_INPUTS, { lift: lift });
    setOne(id, A.MAP_EXPR_ATTR, GeoExpression.routeLayerExpression(GEO_RUNTIME_SRC, enc, { camera: map.cameraId, category: "route" }, { ellipseScale: A.ELLIPSE_SCALE }));
    connectCamera(map.cameraId, id, A.MAP_ARRAY_ATTR);
    applyStyle(id, STYLE.route);
    if (A.STROKE_CAP_ATTR) { try { setOne(id, A.STROKE_CAP_ATTR, A.ROUND_CAP_VALUE); } catch (e) { /* default caps */ } }
    api.parent(id, parentId);
    return id;
  }

  function routeTitle(stops) {
    var t = "Route: " + stops.map(function (s) { return s.name; }).join(" → ");
    return t.length > 60 ? t.slice(0, 59) + "…" : t;
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
  function createOldRoute(map, stops, pairs, opts) {
    var groupId = api.create("group", routeTitle(stops));
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
    return { groupId: groupId, legs: legs };
  }

  // A new-style route: stops (holder following the camera + a circle to drag) joined by
  // Bézier legs whose ends and handles are worked out by small helper scripts.
  // api.create / api.primitive make a layer beside the selection and api.parent keeps the
  // world transform (rewriting the local one), so every layer is reset right after it is
  // parented. A holder's position is driven, so only its rotation and scale are reset; the
  // helper utilities have no transform at all.
  function buildRoute(map, stops, pairs, opts, track) {
    var E = GeoExpression, CA = A.CAMERA_ARRAY_ATTR, arc = opts.arc != null ? opts.arc : 30;
    var groupId = track(api.create("group", routeTitle(stops)));
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
      applyStyle(circle, STYLE.stop);
      api.parent(circle, holder);
      api.set(circle, identityTransform());
      var label = null;
      if (opts.labels) {
        label = track(api.create(A.TEXT_LAYER_TYPE, p.name));
        setOne(label, A.TEXT_ATTR, p.name);
        applyStyle(label, STYLE.label);
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
      applyStyle(line, STYLE.route);
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
    if (typeof api.setGenerator !== "function" || typeof api.primitive !== "function" || typeof api.setUserData !== "function") return createOldRoute(map, stops, pairs, opts);
    var made = [];
    function track(id) { made.push(id); return id; }
    try {
      return buildRoute(map, stops, pairs, opts, track);
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
        out.push({
          groupId: id, name: String(api.getNiceName(id)), helpers: d.helpers,
          stops: (d.stops || []).filter(function (s) { return there(s.holder) && there(s.circle) && there(s.position); }),
          legs: (d.legs || []).filter(function (l) { return there(l.line) && there(l.startHandle) && there(l.endHandle); })
        });
      } catch (e) { /* not a readable route */ }
    });
    return out;
  }

  function xy(v) { return v && v.x !== undefined ? [Number(v.x) || 0, Number(v.y) || 0] : [Number(v && v[0]) || 0, Number(v && v[1]) || 0]; }

  // ids: the user's selection. A stop counts when its circle, holder or label is selected.
  function pinStops(map, ids) {
    var want = {}, res = { pinned: 0, offGlobe: [] };
    (ids || []).forEach(function (id) { want[id] = true; });
    findRoutes(map).forEach(function (r) {
      r.stops.forEach(function (s) {
        if (!want[s.circle] && !want[s.holder] && !(s.label && want[s.label])) return;
        var h = xy(api.get(s.holder, "position")), c = xy(api.get(s.circle, "position"));
        function v(i) { return Number(api.get(s.position, A.CAMERA_ARRAY_ATTR + "." + i)); }
        var cam = { lat: v(0), lon: v(1), zoom: v(2), rotation: v(3), projection: Math.round(v(4)) };
        var ll = GeoProjection.unproject(cam, h[0] + c[0], h[1] + c[1]);
        if (!ll) { res.offGlobe.push(s.name); return; }
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

  var DATA_STYLE = {
    regions: { stroke: "#1d2a33", width: 0.5 },
    bubbles: { fill: "#bc4749", stroke: "#ffffff", width: 1 },
    labels: { fill: "#e6e6e6" },
    legend: { fill: "#e6e6e6" }
  };

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
    var year = prepared.years ? prepared.years[1] : 0;
    var groupId = api.create("group", "Data: " + prepared.title);
    api.parent(groupId, map.groupId);
    function meta(display) { return { camera: map.cameraId, category: "data", display: display, source: source }; }
    if (opts.regions) layers.regions = createDataLayer(map, groupId, "Regions: " + prepared.title, E.REGION_INPUTS, { year: year }, E.regionsExpression(src, p.regions, meta("regions")), DATA_STYLE.regions, true);
    if (opts.bubbles) {
      layers.bubbles = createDataLayer(map, groupId, "Bubbles: " + prepared.title, E.BUBBLE_INPUTS, { year: year }, E.bubblesExpression(src, p.points, meta("bubbles"), { ellipseScale: A.ELLIPSE_SCALE }), DATA_STYLE.bubbles, true);
      if (A.FILL_ALPHA_ATTR) { try { setOne(layers.bubbles, A.FILL_ALPHA_ATTR, 70); } catch (e) { /* opacity is cosmetic */ } }
    }
    if (opts.labels) layers.labels = createDataLayer(map, groupId, "Labels: " + prepared.title, E.VALUE_LABEL_INPUTS, { year: year }, E.valueLabelsExpression(src, p.points, meta("labels")), DATA_STYLE.labels, true);
    if (opts.legend) {
      var s = compSize();
      if (layers.regions) {
        layers.legend = createDataLayer(map, groupId, "Legend: " + prepared.title, E.LEGEND_INPUTS, {}, E.legendExpression(src, p.legend, meta("legend")), DATA_STYLE.legend, false);
        E.LEGEND_INPUTS.forEach(function (inp, k) {
          api.connect(layers.regions, A.MAP_ARRAY_ATTR + "." + E.inputIndex(E.REGION_INPUTS, inp[0]), layers.legend, A.MAP_ARRAY_ATTR + "." + k, true);
        });
      } else if (layers.bubbles) {
        layers.legend = createDataLayer(map, groupId, "Legend: " + prepared.title, E.BUBBLE_LEGEND_INPUTS, {}, E.bubbleLegendExpression(src, p.legend, meta("bubbleLegend")), DATA_STYLE.legend, false);
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
    var style = enc.kind === "line" ? STYLE.extractLine : STYLE.extractFill;
    var meta = { camera: map.cameraId, category: "extract", source: sourceLayer.meta.category };
    return createMapLayer(map, group.name || "Feature", sub, meta, style, { pointRadius: 6 });
  }

  function bake(layerId) {
    var meta = layerMeta(layerId);
    if (!meta) throw new Error("Select a Cavalry Geo map layer to bake.");
    if (meta.category === "data") throw new Error("Data layers can't be baked yet.");
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
    return createMapLayer(map, "Label: " + text, enc, { camera: map.cameraId, category: "label" }, STYLE.label, { pointRadius: 24 }, parent);
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

  // The text layers of this map's labels: each label's position helper drives its text's
  // position, so the text is whatever that helper's output is connected to.
  function findLabels(map) {
    var out = [];
    if (typeof api.getOutConnections !== "function") return out;
    api.getCompLayers(false).forEach(function (id) {
      var meta = GeoExpression.readTag(readExpr(id, A.CAMERA_EXPR_ATTR), "GEO_META");
      if (!meta || meta.category !== "labelDriver" || meta.camera !== map.cameraId) return;
      var conns = [];
      try { conns = api.getOutConnections(id, A.DRIVER_OUTPUT_ATTR) || []; } catch (e) { return; } // skips only this label
      conns.forEach(function (c) {
        var s = String(c), dot = s.indexOf(".");
        if (dot > 0 && s.slice(dot + 1) === "position") out.push(s.slice(0, dot));
      });
    });
    return out;
  }

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
    applyStyle(id, CREDIT_STYLE);
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
    applyStyle(id, CREDIT_STYLE);
    api.parent(id, map.groupId);
    return id;
  }

  return {
    STYLE: STYLE, createMap: createMap, findMaps: findMaps, readCamera: readCamera, setCamera: setCamera,
    compSize: compSize, createMapLayer: createMapLayer, findMapLayers: findMapLayers, readLayerData: readLayerData, readLayerMeta: layerMeta,
    addPin: addPin, extract: extract, bake: bake, createLabel: createLabel, createRoute: createRoute, findRoutes: findRoutes, pinStops: pinStops,
    hasAttribution: hasAttribution, createAttribution: createAttribution, createImageryCredit: createImageryCredit, restackBaseLayers: restackBaseLayers,
    createDataLayers: createDataLayers, refreshData: refreshData,
    compFrameRange: compFrameRange, sampleCamera: sampleCamera, planImagery: planImagery, itemBase: itemBase, itemUrl: itemUrl, buildImagery: buildImagery, beginImageryBuild: beginImageryBuild,
    findImagery: findImagery, flyCamera: flyCamera, findLabels: findLabels, findOcean: findOcean
  };
})();

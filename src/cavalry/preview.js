// The Map tab's preview: a ui.Draw showing a flat Web Mercator map (GeoPreview does the maths)
// with a fixed green frame in the middle. Dragging only updates the view; a 40 ms timer redraws
// the latest state while something changed (or only on release, if Cavalry draws too slowly).
// Land is one fill path plus one border path per redraw; detail follows the zoom (one level
// lower while dragging), and 50m data is read the first time it's needed.
var GeoPreviewPanel = (function () {
  var WATER = "#1d2a33", LAND = "#4a5a50", BORDER = "#2a3530", FRAME = "#33CE70", DIM = "#00000059";
  var CAMERA = "#e6e6e6", DOT = "#33CE70", RING = "#000000", NAME = "#ffffff", OTHER_NAME = "#a6a6a6";
  var PILL = "#000000a6", GLYPH = "#e6e6e6"; // the zoom readout and − / + drawn inside the map
  var SPOT = "#ffffff", DRAFT = "#1F8F4E";
  var TICK_MS = 40, SETTLE_MS = 150, DOT_HIT = 6, MIN_LAKE_PX = 6, SAME_PLACE_KM = 5, STREET_POINTS = 15000;
  var HINT = "Drag to move · double-click or + / − to zoom";

  function create(opts) {
    var p = {}, draw = null, error = null;
    var view = { lat: 20, lon: 0, zoom: 0, width: 320, height: 180 }, source = null, places = [], picked = -1, current = null;
    var dirty = false, dragging = false, lastMove = 0, drag = null, timer = null, running = false, failed = false, sized = false;
    var levels = {}, lakes = null, streets = null;
    var colors = { water: WATER, land: LAND, border: BORDER };
    var overlay = null, draft = null, spot = null, press = null, panning = false;

    function comp() { return opts.compSize(); }
    function sy(y) { return opts.yUp ? view.height - y : y; }

    p.layout = new ui.VLayout();
    if (typeof p.layout.setMargins === "function") p.layout.setMargins(0, 0, 0, 0);
    error = GeoStyle.note("");
    if (typeof error.setHidden === "function") error.setHidden(true);

    // opts.onFail (optional) hears about the first failure, so the panel can update at once.
    p.fail = function (message) {
      var first = !failed;
      failed = true;
      if (timer) timer.stop();
      running = false;
      error.setText(message);
      if (draw && typeof draw.setHidden === "function") draw.setHidden(true);
      if (typeof error.setHidden === "function") error.setHidden(false);
      if (first && typeof opts.onFail === "function") {
        try { opts.onFail(message); } catch (e) { console.log("[CavalryGeo] Map preview: onFail failed: " + (e && e.message ? e.message : e)); }
      }
    };
    p.available = function () { return !failed; };
    // The picked map style's water, land and border colours (the frame, dots and names keep theirs).
    p.setColors = function (c) {
      colors = { water: c.water || WATER, land: c.land || LAND, border: c.border || BORDER };
      if (draw && typeof draw.setBackgroundColor === "function") { try { draw.setBackgroundColor(colors.water); } catch (e) { /* cosmetic */ } }
      if (!failed) changed();
    };

    function guarded(fn) {
      return function () {
        if (failed) return;
        try { return fn.apply(null, arguments); } catch (e) { p.fail("Map preview unavailable: " + (e && e.message ? e.message : e)); }
      };
    }

    function level(i) {
      if (levels[i]) return levels[i];
      var spec = GeoPreview.LEVELS[i];
      var base = spec.data === "110m" ? (levels.raw110 || (levels.raw110 = GeoPreview.prepare(GeoCodec.decodeLayer(GeoNet.neLayer("countries", "110m")))))
        : (levels.raw50 || (levels.raw50 = GeoPreview.prepare(GeoCodec.decodeLayer(GeoNet.neLayer("countries", "50m")))));
      return (levels[i] = GeoPreview.simplify(base, spec.tolerance));
    }
    function lakeData() { return lakes || (lakes = GeoPreview.prepare(GeoCodec.decodeLayer(GeoNet.neLayer("lakes", "50m")))); }

    function ringsPath(rings) {
      var path = new cavalry.Path();
      rings.forEach(function (r) {
        for (var i = 0; i < r.length; i += 2) { if (i === 0) path.moveTo(r[0], sy(r[1])); else path.lineTo(r[i], sy(r[i + 1])); }
        path.close();
      });
      return path.toObject();
    }
    function rectInto(path, r, reverse) {
      var pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
      if (reverse) pts.reverse();
      pts.forEach(function (q, i) { if (i === 0) path.moveTo(q[0], sy(q[1])); else path.lineTo(q[0], sy(q[1])); });
      path.close();
      return path;
    }
    function rectPath(r, reverse) { return rectInto(new cavalry.Path(), r, reverse); }
    // The places that get a dot: one per spot (indices into places).
    function shown() { return GeoPreview.distinctPlaces(places, picked, SAME_PLACE_KM); }
    // The zoom readout (bottom left) and the − / + squares (bottom right), in view coordinates (y down).
    function readoutText() { return "Zoom " + p.frameCamera().zoom.toFixed(1); }
    function overlayRects() {
      var plus = { x: view.width - 8 - 20, y: view.height - 8 - 20, w: 20, h: 20 };
      var minus = { x: plus.x - 4 - 20, y: plus.y, w: 20, h: 20 };
      return { readout: { x: 8, y: plus.y, w: readoutText().length * 6 + 12, h: 20 }, minus: minus, plus: plus };
    }
    function inside(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
    function drawOverlay() {
      var o = overlayRects(), text = readoutText(), glyphs = new cavalry.Path(), label = new cavalry.Path();
      [o.readout, o.minus, o.plus].forEach(function (r) { draw.addPath(rectPath(r, false).toObject(), { color: PILL }); });
      [o.minus, o.plus].forEach(function (r) { rectInto(glyphs, { x: r.x + 5, y: r.y + 9, w: 10, h: 2 }, false); });
      rectInto(glyphs, { x: o.plus.x + 9, y: o.plus.y + 5, w: 2, h: 10 }, false);
      draw.addPath(glyphs.toObject(), { color: GLYPH });
      label.addText(text, 10, o.readout.x + 6, sy(o.readout.y + 14));
      draw.addPath(label.toObject(), { color: GLYPH });
    }

    function polyline(path, pts) { pts.forEach(function (q, i) { if (i === 0) path.moveTo(q[0], sy(q[1])); else path.lineTo(q[0], sy(q[1])); }); }
    // The map's own pins, labels and routes (GeoScene.previewModel), in its style colours.
    function drawModel() {
      if (!overlay) return;
      var accent = overlay.colors.accent, legs = new cavalry.Path(), stopRings = new cavalry.Path(), pins = new cavalry.Path(), labels = new cavalry.Path();
      var has = { legs: false, stops: false, pins: false, labels: false };
      (overlay.routes || []).forEach(function (r) {
        (r.legs || []).forEach(function (l) { polyline(legs, GeoPreview.legCurve(view, l.from, l.to, { arc: l.arc, lean: l.lean, flip: l.flip })); has.legs = true; });
        (r.stops || []).forEach(function (s) { var q = GeoPreview.toPx(view, s.lon, s.lat); stopRings.addEllipse(q[0], sy(q[1]), 3, 3); has.stops = true; });
      });
      (overlay.pins || []).forEach(function (s) { var q = GeoPreview.toPx(view, s.lon, s.lat); pins.addEllipse(q[0], sy(q[1]), 3, 3); has.pins = true; });
      (overlay.labels || []).forEach(function (s) { var q = GeoPreview.toPx(view, s.lon, s.lat); labels.addText(String(s.text), 10, q[0] + 5, sy(q[1] - 3)); has.labels = true; });
      if (has.legs) draw.addPath(legs.toObject(), { color: accent, stroke: true, strokeWidth: 1.5 });
      if (has.stops) draw.addPath(stopRings.toObject(), { color: accent, stroke: true, strokeWidth: 1.5 });
      if (has.pins) draw.addPath(pins.toObject(), { color: accent });
      if (has.labels) draw.addPath(labels.toObject(), { color: overlay.colors.text });
    }
    // The route being built on the Routes page: its stops in order, joined by a dashed line.
    function drawDraft() {
      if (!draft || !draft.length) return;
      var accent = overlay ? overlay.colors.accent : DRAFT, pts = draft.map(function (s) { return GeoPreview.toPx(view, s.lon, s.lat); });
      if (pts.length > 1) {
        var dash = new cavalry.Path();
        GeoPreview.dashPolyline(pts, 5, 4).forEach(function (sg) { dash.moveTo(sg[0], sy(sg[1])); dash.lineTo(sg[2], sy(sg[3])); });
        draw.addPath(dash.toObject(), { color: accent, stroke: true, strokeWidth: 1.5 });
      }
      var dots = new cavalry.Path();
      pts.forEach(function (q) { dots.addEllipse(q[0], sy(q[1]), 3, 3); });
      draw.addPath(dots.toObject(), { color: accent });
    }
    // Where the last click on the Pins page set the spot.
    function drawSpot() {
      if (!spot) return;
      var q = GeoPreview.toPx(view, spot.lon, spot.lat), ring = new cavalry.Path();
      ring.addEllipse(q[0], sy(q[1]), 5, 5);
      draw.addPath(ring.toObject(), { color: SPOT, stroke: true, strokeWidth: 1.5 });
    }
    // The panel's callback may throw; that must not take the preview down with it.
    function click(lon, lat) { try { opts.onClick(lon, lat); } catch (e) { console.log("[CavalryGeo] Map preview: onClick failed: " + (e && e.message ? e.message : e)); } }

    function render() {
      var c = comp(), settling = dragging && Date.now() - lastMove < SETTLE_MS, li = GeoPreview.detailFor(view.zoom, settling);
      if (!settling) dragging = false; // a full-detail render ends the drag's low-detail phase
      draw.clearPaths();
      var land = GeoPreview.project(GeoPreview.visible(level(li), view), view);
      if (land.length) {
        var obj = ringsPath(land);
        draw.addPath(obj, { color: colors.land });
        draw.addPath(obj, { color: colors.border, stroke: true, strokeWidth: 0.6 });
      }
      if (GeoPreview.LEVELS[li].lakes) {
        var s = Math.pow(2, view.zoom);
        var big = GeoPreview.visible(lakeData(), view).filter(function (f) { return (f.bbox.x1 - f.bbox.x0) * s >= MIN_LAKE_PX || (f.bbox.y1 - f.bbox.y0) * s >= MIN_LAKE_PX; });
        if (big.length) draw.addPath(ringsPath(GeoPreview.project(big, view)), { color: colors.water });
      }
      if (streets && !dragging) {
        GeoPreview.budget(streets, view, STREET_POINTS).forEach(function (l) {
          var rings = GeoPreview.project(l.features, view);
          if (!rings.length) return;
          if (l.kind === "fill") { draw.addPath(ringsPath(rings), { color: l.color }); return; }
          var path = new cavalry.Path();
          rings.forEach(function (r) { for (var i = 0; i < r.length; i += 2) { if (i === 0) path.moveTo(r[0], sy(r[1])); else path.lineTo(r[i], sy(r[i + 1])); } });
          draw.addPath(path.toObject(), { color: l.color, stroke: true, strokeWidth: 1 });
        });
      }
      var f = GeoPreview.frameRect(view, c.width, c.height);
      if (opts.dim) draw.addPath(appendPaths(rectPath({ x: 0, y: 0, w: view.width, h: view.height }, false), rectPath(f, true)), { color: DIM });
      if (opts.frame !== false) draw.addPath(rectPath(f, false).toObject(), { color: FRAME, stroke: true, strokeWidth: 2 });
      if (current) {
        var dash = new cavalry.Path();
        GeoPreview.dashes(GeoPreview.cameraRect(view, current, c.width, c.height), 4, 3).forEach(function (sg) { dash.moveTo(sg[0], sy(sg[1])); dash.lineTo(sg[2], sy(sg[3])); });
        draw.addPath(dash.toObject(), { color: CAMERA, stroke: true, strokeWidth: 1.2 });
      }
      drawModel(); drawDraft(); drawSpot();
      if (places.length) {
        var dot = new cavalry.Path(), rings = new cavalry.Path(), names = new cavalry.Path(), label = new cavalry.Path();
        var hasDot = false, hasRing = false;
        shown().forEach(function (i) {
          var q = GeoPreview.toPx(view, places[i].lon, places[i].lat), name = String(places[i].name || "");
          if (i === picked) {
            dot.addEllipse(q[0], sy(q[1]), 4, 4);
            label.addText(name.split(",")[0], 11, q[0] + 7, sy(q[1] - 4));
            hasDot = true;
          } else {
            rings.addEllipse(q[0], sy(q[1]), 3, 3);
            names.addText(name.split(",").slice(0, 2).join(",").replace(/\s+/g, " ").trim(), 10, q[0] + 7, sy(q[1] - 4));
            hasRing = true;
          }
        });
        if (hasRing) {
          draw.addPath(rings.toObject(), { color: DOT, stroke: true, strokeWidth: 1.2 });
          draw.addPath(names.toObject(), { color: OTHER_NAME });
        }
        if (hasDot) {
          var dotObj = dot.toObject();
          draw.addPath(dotObj, { color: DOT });
          draw.addPath(dotObj, { color: RING, stroke: true, strokeWidth: 1 });
          draw.addPath(label.toObject(), { color: NAME });
        }
      }
      drawOverlay();
      draw.redraw();
    }
    // One path holding both outlines (the dim with the frame cut out; the hole is wound the other way).
    function appendPaths(a, b) { if (typeof a.append === "function") { a.append(b); return a.toObject(); } var o = a.toObject(); o.cmds = (o.cmds || []).concat(b.toObject().cmds || []); return o; }

    function Tick() {
      this.onTimeout = guarded(function () {
        if (dirty) { dirty = false; render(); return; }
        if (dragging && Date.now() - lastMove >= SETTLE_MS) { dragging = false; render(); return; }
        timer.stop();
        running = false;
      });
    }
    function changed() {
      if (failed) return;
      if (opts.redraw === "release" && drag) return; // redrawn on release
      dirty = true;
      if (!timer) { timer = new api.Timer(new Tick()); timer.setRepeating(true); timer.setInterval(TICK_MS); }
      if (!running) { running = true; timer.start(); }
    }
    // The panel's callback may throw; that must not take the preview down with it.
    function pick(i) { try { opts.onPick(i); } catch (e) { console.log("[CavalryGeo] Map preview: onPick failed: " + (e && e.message ? e.message : e)); } }
    function setView(v, src) { view = v; source = src; changed(); }

    p.setWidth = guarded(function (px) {
      px = Math.round(px);
      if (!(px >= 16)) return; // not laid out yet (width 0): keep the current view
      if (sized && Math.abs(px - view.width) < 2) return;
      var cam = p.frameCamera(), c = comp();
      view = GeoPreview.viewForCamera(cam, c.width, c.height, px, Math.round(px * 9 / 16));
      draw.setSize(view.width, view.height);
      // Cavalry's setSize also locks the minimum size; re-apply a small minimum width (so the panel can shrink) and the real height (so the map isn't squeezed).
      if (typeof draw.setMinimumWidth === "function") draw.setMinimumWidth(120);
      if (typeof draw.setMinimumHeight === "function") draw.setMinimumHeight(view.height);
      sized = true;
      changed();
    });
    p.showCamera = guarded(function (cam, src) {
      var c = comp();
      setView(GeoPreview.viewForCamera(cam, c.width, c.height, view.width, view.height), src || null);
    });
    p.setPlaces = guarded(function (list, index) { places = list || []; picked = typeof index === "number" ? index : -1; changed(); });
    p.setStreets = guarded(function (list) { streets = list && list.length ? list : null; changed(); });
    p.setOverlay = guarded(function (model) { overlay = model || null; changed(); });
    p.setDraft = guarded(function (list) { draft = list && list.length ? list.slice() : null; changed(); });
    p.setSpot = guarded(function (s) { spot = s || null; changed(); });
    p.setCurrentCamera = guarded(function (cam) { current = cam || null; changed(); });
    p.frameCamera = function () { var c = comp(); return GeoPreview.frameCamera(view, c.width, c.height); };
    p.source = function () { return source; };
    p.zoomBy = guarded(function (steps) { var c = comp(); setView(GeoPreview.zoomAt(view, steps, view.width / 2, view.height / 2, c.width, c.height), null); });
    p._render = guarded(function () { render(); });
    p._timer = function () { return timer; }; // test hook
    p._view = function () { return view; }; // test hook
    p._overlay = function () { return overlayRects(); }; // test hook

    if (typeof ui.Draw !== "function" || typeof cavalry === "undefined" || typeof cavalry.Path !== "function") {
      p.layout.add(error);
      p.fail("The map preview needs a newer version of Cavalry.");
      return p;
    }

    // A Cavalry missing some Draw method must not take the whole panel down at load.
    try {
      draw = new ui.Draw();
      p._draw = draw;
      // Cavalry's Draw won't get narrower than its setSize unless a small minimum is set,
      // and then the panel couldn't shrink back either.
      if (typeof draw.setMinimumWidth === "function") draw.setMinimumWidth(120);
      if (typeof draw.setMinimumHeight === "function") draw.setMinimumHeight(view.height);
      draw.setSize(view.width, view.height);
      draw.setBackgroundColor(colors.water);
      draw.onMousePress = guarded(function (pos, button) {
        if (button && button !== "left") return;
        var y = sy(pos.y), o = overlayRects();
        if (inside(o.minus, pos.x, y)) { drag = null; p.zoomBy(-1); return; }
        if (inside(o.plus, pos.x, y)) { drag = null; p.zoomBy(1); return; }
        if (inside(o.readout, pos.x, y)) { drag = null; return; }
        var keep = shown(), hit = GeoPreview.hitDot(view, keep.map(function (i) { return places[i]; }), pos.x, y, DOT_HIT);
        if (hit >= 0) hit = keep[hit]; // back to the place's own index
        if (hit >= 0) { picked = hit; changed(); pick(hit); return; }
        drag = { x: pos.x, y: y }; press = { x: pos.x, y: y }; panning = false;
      });
      draw.onMouseMove = guarded(function (pos) {
        if (!drag) return;
        var y = sy(pos.y);
        if (!panning && press && GeoPreview.isClick(press, { x: pos.x, y: y })) return; // still a click
        panning = true;
        view = GeoPreview.pan(view, pos.x - drag.x, y - drag.y);
        drag = { x: pos.x, y: y };
        source = null; dragging = true; lastMove = Date.now();
        changed();
      });
      draw.onMouseRelease = guarded(function () {
        var was = drag, at = !panning ? press : null;
        drag = null; press = null; panning = false;
        if (at && typeof opts.onClick === "function") {
          var ll = GeoPreview.fromPx(view, at.x, at.y);
          click(GeoPreview.wrapLon(ll.lon), ll.lat);
          return;
        }
        if (was) changed();
      });
      draw.onMouseDoubleClick = guarded(function (pos) {
        if (opts.doubleClickZoom === false) return;
        var c = comp(), o = overlayRects();
        if (inside(o.minus, pos.x, sy(pos.y)) || inside(o.plus, pos.x, sy(pos.y)) || inside(o.readout, pos.x, sy(pos.y))) return; // the presses already zoomed
        drag = null;
        setView(GeoPreview.zoomAt(view, 1, pos.x, sy(pos.y), c.width, c.height), null);
      });

      if (typeof draw.setToolTip === "function") draw.setToolTip(opts.hint || HINT);
      p.layout.add(draw);
    } catch (e) {
      p.fail("Map preview unavailable: " + (e && e.message ? e.message : e));
    }
    p.layout.add(error);
    return p;
  }

  return { create: create };
})();

// The Map tab's preview: a ui.Draw showing a flat Web Mercator map (GeoPreview does the maths)
// with a fixed green frame in the middle. Dragging only updates the view; a 40 ms timer redraws
// the latest state while something changed (or only on release, if Cavalry draws too slowly).
// Land is one fill path plus one border path per redraw; detail follows the zoom (one level
// lower while dragging), and 50m data is read the first time it's needed.
var GeoPreviewPanel = (function () {
  var WATER = "#1d2a33", LAND = "#4a5a50", BORDER = "#2a3530", FRAME = "#33CE70", DIM = "#00000059";
  var CAMERA = "#e6e6e6", DOT = "#33CE70", RING = "#000000", NAME = "#ffffff", OTHER_NAME = "#a6a6a6";
  var TICK_MS = 40, SETTLE_MS = 150, DOT_HIT = 6, MIN_LAKE_PX = 6, SAME_PLACE_KM = 5;

  function create(opts) {
    var p = {}, draw = null, note = null, error = null, controls = null;
    var view = { lat: 20, lon: 0, zoom: 0, width: 320, height: 180 }, source = null, places = [], picked = -1, current = null;
    var dirty = false, dragging = false, lastMove = 0, drag = null, timer = null, running = false, failed = false, sized = false;
    var levels = {}, lakes = null;

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
      [draw, controls && controls.minus, controls && controls.plus, note].forEach(function (w) { if (w && typeof w.setHidden === "function") w.setHidden(true); });
      if (typeof error.setHidden === "function") error.setHidden(false);
      if (first && typeof opts.onFail === "function") {
        try { opts.onFail(message); } catch (e) { console.log("[CavalryGeo] Map preview: onFail failed: " + (e && e.message ? e.message : e)); }
      }
    };
    p.available = function () { return !failed; };

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
    function rectPath(r, reverse) {
      var path = new cavalry.Path(), pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
      if (reverse) pts.reverse();
      pts.forEach(function (q, i) { if (i === 0) path.moveTo(q[0], sy(q[1])); else path.lineTo(q[0], sy(q[1])); });
      path.close();
      return path;
    }
    // The places that get a dot: one per spot (indices into places).
    function shown() { return GeoPreview.distinctPlaces(places, picked, SAME_PLACE_KM); }
    function updateNote() {
      if (note) note.setText("Zoom " + p.frameCamera().zoom.toFixed(1) + " · drag to move, double-click to zoom in");
    }

    function render() {
      var c = comp(), settling = dragging && Date.now() - lastMove < SETTLE_MS, li = GeoPreview.detailFor(view.zoom, settling);
      if (!settling) dragging = false; // a full-detail render ends the drag's low-detail phase
      draw.clearPaths();
      var land = GeoPreview.project(GeoPreview.visible(level(li), view), view);
      if (land.length) {
        var obj = ringsPath(land);
        draw.addPath(obj, { color: LAND });
        draw.addPath(obj, { color: BORDER, stroke: true, strokeWidth: 0.6 });
      }
      if (GeoPreview.LEVELS[li].lakes) {
        var s = Math.pow(2, view.zoom);
        var big = GeoPreview.visible(lakeData(), view).filter(function (f) { return (f.bbox.x1 - f.bbox.x0) * s >= MIN_LAKE_PX || (f.bbox.y1 - f.bbox.y0) * s >= MIN_LAKE_PX; });
        if (big.length) draw.addPath(ringsPath(GeoPreview.project(big, view)), { color: WATER });
      }
      var f = GeoPreview.frameRect(view, c.width, c.height);
      if (opts.dim) draw.addPath(appendPaths(rectPath({ x: 0, y: 0, w: view.width, h: view.height }, false), rectPath(f, true)), { color: DIM });
      draw.addPath(rectPath(f, false).toObject(), { color: FRAME, stroke: true, strokeWidth: 2 });
      if (current) {
        var dash = new cavalry.Path();
        GeoPreview.dashes(GeoPreview.cameraRect(view, current, c.width, c.height), 4, 3).forEach(function (sg) { dash.moveTo(sg[0], sy(sg[1])); dash.lineTo(sg[2], sy(sg[3])); });
        draw.addPath(dash.toObject(), { color: CAMERA, stroke: true, strokeWidth: 1.2 });
      }
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
      draw.redraw();
      updateNote();
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
      sized = true;
      changed();
    });
    p.showCamera = guarded(function (cam, src) {
      var c = comp();
      setView(GeoPreview.viewForCamera(cam, c.width, c.height, view.width, view.height), src || null);
    });
    p.setPlaces = guarded(function (list, index) { places = list || []; picked = typeof index === "number" ? index : -1; changed(); });
    p.setCurrentCamera = guarded(function (cam) { current = cam || null; changed(); });
    p.frameCamera = function () { var c = comp(); return GeoPreview.frameCamera(view, c.width, c.height); };
    p.source = function () { return source; };
    p.zoomBy = guarded(function (steps) { var c = comp(); setView(GeoPreview.zoomAt(view, steps, view.width / 2, view.height / 2, c.width, c.height), null); });
    p._render = guarded(function () { render(); });
    p._timer = function () { return timer; }; // test hook

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
      if (typeof draw.setMinimumHeight === "function") draw.setMinimumHeight(68);
      draw.setSize(view.width, view.height);
      draw.setBackgroundColor(WATER);
      draw.onMousePress = guarded(function (pos, button) {
        if (button && button !== "left") return;
        var y = sy(pos.y), keep = shown(), hit = GeoPreview.hitDot(view, keep.map(function (i) { return places[i]; }), pos.x, y, DOT_HIT);
        if (hit >= 0) hit = keep[hit]; // back to the place's own index
        if (hit >= 0) { picked = hit; changed(); pick(hit); return; }
        drag = { x: pos.x, y: y };
      });
      draw.onMouseMove = guarded(function (pos) {
        if (!drag) return;
        var y = sy(pos.y);
        view = GeoPreview.pan(view, pos.x - drag.x, y - drag.y);
        drag = { x: pos.x, y: y };
        source = null; dragging = true; lastMove = Date.now();
        changed();
      });
      draw.onMouseRelease = guarded(function () { var was = drag; drag = null; if (was) changed(); });
      draw.onMouseDoubleClick = guarded(function (pos) {
        var c = comp();
        drag = null;
        setView(GeoPreview.zoomAt(view, 1, pos.x, sy(pos.y), c.width, c.height), null);
      });

      note = GeoStyle.note("");
      controls = { minus: GeoStyle.button("−"), plus: GeoStyle.button("+") };
      [controls.minus, controls.plus].forEach(function (b) { if (typeof b.setFixedWidth === "function") b.setFixedWidth(24); });
      controls.minus.onClick = function () { p.zoomBy(-1); };
      controls.plus.onClick = function () { p.zoomBy(1); };
      var row = new ui.HLayout();
      if (typeof row.setMargins === "function") row.setMargins(0, 0, 0, 0);
      row.add(note);
      if (typeof row.addStretch === "function") row.addStretch();
      row.add(controls.minus); row.add(controls.plus);
      p.layout.add(draw); p.layout.add(row);
      updateNote();
    } catch (e) {
      p.fail("Map preview unavailable: " + (e && e.message ? e.message : e));
    }
    p.layout.add(error);
    return p;
  }

  return { create: create };
})();

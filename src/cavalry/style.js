// The panel's look in one place, borrowed from Cavalry and Easey: Cavalry's own greys (from its
// theme), one green for the main actions, small grey section headings with a thin line, toggle
// buttons for picking categories, and a segmented tab bar. Cavalry's ui.SegmentedControl isn't
// used: it keeps room for an icon left of every label, so the text sits off-centre.
var GeoStyle = (function () {
  var GREEN = "#33CE70", HEADING_GREY = "#8a8a8a";
  var FALLBACK = { Window: "#272727", Base: "#373737", Mid: "#3a3a3a", Shadow: "#1c1c1c", Text: "#dddddd" };

  function color(name) {
    try {
      var c = typeof ui.getThemeColor === "function" ? ui.getThemeColor(name) : "";
      if (c) return c;
    } catch (e) { /* older Cavalry */ }
    return FALLBACK[name];
  }
  // Calls an optional widget method only when this Cavalry has it.
  function maybe(widget, method) {
    if (typeof widget[method] === "function") widget[method].apply(widget, Array.prototype.slice.call(arguments, 2));
    return widget;
  }
  function hasContainer() { return typeof ui.Container === "function"; }

  function heading(text) {
    var label = new ui.Label(String(text).toUpperCase());
    maybe(label, "setFontSize", 10);
    maybe(label, "setTextColor", HEADING_GREY);
    var h = new ui.HLayout();
    h.add(label);
    if (hasContainer()) {
      var line = new ui.Container();
      line.setLayout(new ui.HLayout());
      maybe(line, "setFixedHeight", 1);
      line.setBackgroundColor(color("Mid"));
      h.add(line);
    }
    return h;
  }
  function note(text) {
    var label = new ui.Label(text);
    maybe(label, "setFontSize", 11);
    maybe(label, "setTextColor", HEADING_GREY);
    return label;
  }

  function primaryButton(text) {
    var b = new ui.Button(text);
    b.setBackgroundColor(GREEN);
    return b;
  }
  function quietButton(text) {
    var b = new ui.Button(text);
    b.setBackgroundColor(color("Window"));
    maybe(b, "setDrawStroke", false);
    return b;
  }

  // A button that stays on or off, read like a checkbox (getValue / setValue).
  function toggle(text, on) {
    var t = { widget: new ui.Button(text), onValueChanged: null }, value = !!on;
    function paint() { t.widget.setBackgroundColor(value ? GREEN : color("Base")); }
    t.getValue = function () { return value; };
    t.setValue = function (v) { value = !!v; paint(); };
    t.widget.onClick = function () {
      t.setValue(!value);
      if (typeof t.onValueChanged === "function") t.onValueChanged(value);
    };
    paint();
    return t;
  }
  function toggleGrid(toggles, columns) {
    var grid = new ui.VLayout();
    maybe(grid, "setMargins", 0, 0, 0, 0);
    for (var i = 0; i < toggles.length; i += columns) {
      var r = new ui.HLayout();
      toggles.slice(i, i + columns).forEach(function (t) { r.add(t.widget); });
      grid.add(r);
    }
    return grid;
  }

  // Easey-style tabs: borderless buttons in a dark rounded box; the selected one is lighter.
  function tabBar(names, onSelect) {
    var bar = { buttons: [] }, current = null, row = new ui.HLayout();
    maybe(row, "setMargins", 2, 2, 2, 2);
    maybe(row, "setSpaceBetween", 2);
    bar.select = function (name) {
      current = name;
      bar.buttons.forEach(function (b, i) { b.setBackgroundColor(names[i] === name ? color("Base") : color("Shadow")); });
    };
    bar.selected = function () { return current; };
    names.forEach(function (name, i) {
      var b = new ui.Button(name);
      maybe(b, "setDrawStroke", false);
      b.onClick = function () { bar.select(name); if (onSelect) onSelect(name, i); };
      bar.buttons.push(b);
      row.add(b);
    });
    bar.widget = row;
    if (hasContainer()) {
      bar.widget = new ui.Container();
      bar.widget.setBackgroundColor(color("Shadow"));
      maybe(bar.widget, "setRadius", 6, 6, 6, 6);
      bar.widget.setLayout(row);
    }
    bar.select(names[0]);
    return bar;
  }

  return { GREEN: GREEN, HEADING_GREY: HEADING_GREY, color: color, heading: heading, note: note,
    primaryButton: primaryButton, quietButton: quietButton, toggle: toggle, toggleGrid: toggleGrid, tabBar: tabBar };
})();

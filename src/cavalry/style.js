// The panel's look in one place, borrowed from Cavalry and Easey: Cavalry's own greys (from its
// theme), one deep green for the main actions, small sentence-case section headings with a thin line,
// toggle buttons for picking categories, and a segmented tab bar. Every button is a little taller
// than Cavalry's default. A native button only shows its hover highlight while it has never had
// setBackgroundColor called, so only the main actions and the tab bar are painted; toggles show
// their state with a tick icon instead. Cavalry's ui.SegmentedControl isn't used: it keeps room
// for an icon left of every label, so the text sits off-centre. Nor is ui.PageView: it reserves
// the height of its tallest page for every page, so pageStack() hides the pages it isn't showing.
// Headings are kept in a private list so the panel's columns can leave more room before one than
// after it, which groups a heading with the controls it introduces.
var GeoStyle = (function () {
  var GREEN = "#33CE70", PRIMARY = "#1F8F4E", HEADING_GREY = "#8a8a8a", HEADING_COLOR = "#a6a6a6";
  var BUTTON_HEIGHT = 24, TAB_HEIGHT = 24, ICON_SIZE = 16;
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

  var headings = []; // the rows heading() made; Cavalry's objects get no extra properties
  function isHeading(item) { return headings.indexOf(item) >= 0; }
  function heading(text) {
    var label = new ui.Label(String(text));
    maybe(label, "setFontSize", 11);
    maybe(label, "setTextColor", HEADING_COLOR);
    maybe(label, "setFixedHeight", 16);
    var h = new ui.HLayout();
    maybe(h, "setMargins", 0, 0, 0, 0);
    maybe(h, "setSpaceBetween", 6);
    headings.push(h);
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

  // A plain native button, a little taller (it keeps Cavalry's hover highlight).
  function button(text) {
    var b = new ui.Button(text);
    maybe(b, "setFixedHeight", BUTTON_HEIGHT);
    return b;
  }
  function primaryButton(text) {
    var b = button(text);
    b.setBackgroundColor(PRIMARY);
    return b;
  }
  // Housekeeping: nothing to paint, so it stays a plain button; the name keeps call sites readable.
  function quietButton(text) { return button(text); }

  // A button that stays on or off, read like a checkbox (getValue / setValue). A tick icon shows
  // the state; without the icon files (or Button.setImage) the text carries a tick instead. The
  // icon size is set once, up front, so the button doesn't change size on its first click.
  function toggle(text, on) {
    var t = { widget: button(text), onValueChanged: null }, value = !!on;
    maybe(t.widget, "setImageSize", ICON_SIZE, ICON_SIZE);
    function paint() {
      var icon = GeoAttrs.ASSETS_DIR() + "/icons/toggle-" + (value ? "on" : "off") + ".png";
      if (typeof t.widget.setImage === "function" && api.filePathExists(icon)) {
        t.widget.setImage(icon);
        t.widget.setText(" " + text); // the space is the gap after the icon
      } else t.widget.setText(value ? "✓ " + text : text);
    }
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
      maybe(r, "setMargins", 0, 0, 0, 0);
      toggles.slice(i, i + columns).forEach(function (t) { r.add(t.widget); });
      grid.add(r);
    }
    return grid;
  }

  // Pages shown one at a time, like ui.PageView, but only as tall as the shown page: each page sits
  // in a Container that is hidden (and so takes no room) unless it's the current one.
  function pageStack() {
    var stack = { pages: [] }, current = 0, view;
    if (hasContainer()) {
      view = new ui.VLayout();
      maybe(view, "setMargins", 0, 0, 0, 0);
      var boxes = [];
      stack.add = function (layout) {
        var box = new ui.Container();
        box.setLayout(layout);
        box.setHidden(boxes.length !== current);
        view.add(box);
        boxes.push(box);
        stack.pages.push(layout);
      };
      stack.setPage = function (i) {
        if (i < 0 || i >= boxes.length) return;
        current = i;
        boxes.forEach(function (box, n) { box.setHidden(n !== i); });
      };
    } else {
      view = new ui.PageView(); // an older Cavalry without Container: every page as tall as the tallest
      stack.add = function (layout) { view.add(layout); stack.pages.push(layout); };
      stack.setPage = function (i) {
        if (i < 0 || i >= stack.pages.length) return;
        current = i;
        view.setPage(i);
      };
    }
    stack.widget = view;
    stack.currentPage = function () { return current; };
    stack.pageCount = function () { return stack.pages.length; };
    return stack;
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
      maybe(b, "setFixedHeight", TAB_HEIGHT);
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

  return { GREEN: GREEN, PRIMARY: PRIMARY, HEADING_GREY: HEADING_GREY, HEADING_COLOR: HEADING_COLOR, color: color, heading: heading, isHeading: isHeading, note: note,
    button: button, primaryButton: primaryButton, quietButton: quietButton, toggle: toggle, toggleGrid: toggleGrid, pageStack: pageStack, tabBar: tabBar };
})();

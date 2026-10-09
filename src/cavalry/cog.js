// The settings cog: a small button beside the tab bar that opens the settings. Panel-only: uses `ui`, `api`
// and GeoAttrs / GeoStyle.
var GeoCog = (function () {
  var COG_WIDTH = 22;
  var ICON = "/icons/cog.png";
  // The cog button: its icon when the icon file is there (and Button.setImage exists), else a gear character.
  function button(onClick) {
    var b = new ui.Button("");
    // Cavalry left-aligns a button's image 2 px in, so the button is just wide enough for the 16 px icon to sit centred.
    if (typeof b.setImageSize === "function") b.setImageSize(16, 16);
    var icon = GeoAttrs.ASSETS_DIR() + ICON;
    if (typeof b.setImage === "function" && api.filePathExists(icon)) b.setImage(icon);
    else b.setText("⚙");
    if (typeof b.setFixedWidth === "function") b.setFixedWidth(COG_WIDTH);
    if (typeof b.setFixedHeight === "function") b.setFixedHeight(GeoStyle.TAB_HEIGHT);
    b.onClick = onClick;
    return b;
  }
  // Shows the settings under the cog: a popover from the cog's bottom middle when `content` can show one, else
  // fallback() (the panel shows its Settings page). Without either, this Cavalry can't show the settings.
  function open(content, anchor, fallback) {
    if (content && typeof content.showAsPopover === "function") {
      var g = anchor.geometry();
      content.showAsPopover(g.x + g.width / 2, g.y + g.height);
      return;
    }
    if (typeof fallback === "function") { fallback(); return; }
    throw new Error("This Cavalry can't show the settings window.");
  }
  return { button: button, open: open };
})();

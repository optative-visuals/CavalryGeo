// Update check: once a day a detached curl asks GitHub for the latest release, and a timer
// waits for its reply, so opening the panel never waits on the network. The answer is kept in
// settings.json (latestVersion, updateCheckedAt), so the reminder shows on every panel open
// until the user updates, without asking GitHub again. Any failure stays silent.
// "checkForUpdates": false in settings.json switches it off.
var GeoUpdateCheck = (function () {
  var TICK_MS = 1000, MAX_TICKS = 30;
  function replyFile() { return GeoAttrs.ASSETS_DIR() + "/cache/downloads/latest-release.json"; }

  function Callbacks(tick) { this.onTimeout = tick; }

  // tell(message) shows a notice. Returns the timer waiting for GitHub, or null.
  function run(tell) {
    var settings = GeoNet.loadSettings(), now = Date.now();
    if (settings.checkForUpdates === false) return null;
    var shown = GeoUpdate.notice(settings.latestVersion, GEO_VERSION);
    if (shown) tell(shown);
    if (!GeoUpdate.parts(GEO_VERSION) || !GeoUpdate.due(settings, now) || !GeoFetch.available()) return null;
    settings.updateCheckedAt = now; // a failed check isn't retried until tomorrow either
    GeoNet.saveSettings(settings);
    var out = replyFile();
    GeoFetch.discard(out);
    GeoNet.ensureDir(out.slice(0, out.lastIndexOf("/")));
    api.runDetachedProcess("curl", ["-s", "-L", "--fail", "--max-time", "20", "-A", GeoNet.USER_AGENT,
      "-H", "Accept: application/vnd.github+json", "-o", out, GeoUpdate.API_URL]);
    var ticks = 0, timer = new api.Timer(new Callbacks(function () {
      try {
        // The file appears while curl is still writing it; only a whole reply parses.
        var latest = api.filePathExists(out) ? GeoUpdate.versionFromRelease(api.readFromFile(out)) : null;
        if (!latest && ++ticks < MAX_TICKS) return;
        timer.stop();
        GeoFetch.discard(out);
        if (!latest) return;
        var s = GeoNet.loadSettings();
        s.latestVersion = latest;
        GeoNet.saveSettings(s);
        var msg = GeoUpdate.notice(latest, GEO_VERSION);
        if (msg && msg !== shown) tell(msg);
      } catch (e) { timer.stop(); }
    }));
    timer.setRepeating(true);
    timer.setInterval(TICK_MS);
    timer.start();
    return timer;
  }

  return { run: run, MAX_TICKS: MAX_TICKS };
})();

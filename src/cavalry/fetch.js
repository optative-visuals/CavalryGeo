// Background downloads: one detached curl process fetches a whole batch in parallel and
// logs "<http code> <curl exit code> <content type> <output path>" per file to a status file
// the panel timer polls, so Cavalry never waits on the network. Check 12 (2026-10-02): no
// console window on Windows, paths with spaces fine, and curl echoes the config's output path
// exactly.
// inflight.json lists every batch whose curl may still be writing files:
// { "batches": [{ id, cfg, status, paths, started, lastLine, lines }] }. A path stays listed until a status
// line reports it, so plans treat it as missing and builds skip it (it may be half written),
// and a later batch never starts a second curl on it (it is adopted instead).
var GeoFetch = (function () {
  // curl gives up on a file after --max-time 120 s x 3 tries plus back-off, so a batch is only
  // stalled after 400 s without a line; 20 min after a batch started its curl is certainly gone.
  var STALL_MS = 400000, FIRST_LINE_MS = 90000, MAX_BATCH_MS = 1200000, support = null, batchSeq = 0;
  var LINE = /^(\d{3}) (\d+) (\S*) (.*)$/;
  function dir() { return GeoAttrs.ASSETS_DIR() + "/cache/downloads"; }
  function inflightFile() { return dir() + "/inflight.json"; }
  function del(p) { if (p && typeof api.deleteFilePath === "function" && api.filePathExists(p)) { try { api.deleteFilePath(p); } catch (e) { /* harmless leftover */ } } }

  function available() {
    if (support !== null) return support;
    support = false;
    // curl.exe's handling of non-ASCII paths in a config file is unverified.
    if (/[^\x20-\x7e]/.test(GeoAttrs.ASSETS_DIR())) return support;
    if (typeof api.runDetachedProcess !== "function" || typeof api.runProcess !== "function") return support;
    try {
      var r = api.runProcess("curl", ["--version"]);
      var m = /curl (\d+)\.(\d+)/.exec(typeof r === "string" ? r : JSON.stringify(r));
      support = !!m && (Number(m[1]) > 7 || (Number(m[1]) === 7 && Number(m[2]) >= 75)); // %{exitcode} needs 7.75
    } catch (e) { support = false; }
    return support;
  }
  // Called when a batch shows curl isn't working: the rest of the session downloads one
  // file at a time (and EOX/NASA plan map tiles).
  function disable() { support = false; }

  function readState() {
    var f = inflightFile(), s = null;
    if (api.filePathExists(f)) { try { s = JSON.parse(api.readFromFile(f)); } catch (e) { s = null; } }
    // The first format was a plain list of paths: read it as one long-gone batch.
    if (Array.isArray(s)) return { batches: s.length ? [{ id: "legacy", cfg: null, status: null, paths: s, started: 0 }] : [] };
    return s && Array.isArray(s.batches) ? s : { batches: [] };
  }
  function writeState(state) {
    GeoNet.ensureDir(dir());
    api.writeToFile(inflightFile(), JSON.stringify(state), true);
  }
  // Drops a batch with its config (which may hold a MapTiler/Mapbox key) and status files.
  function dropFiles(b) { del(b.cfg); del(b.status); }

  // Every path some batch's curl may still be writing.
  function leftovers() {
    var out = [];
    readState().batches.forEach(function (b) {
      (b.paths || []).forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    });
    return out;
  }
  function quote(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

  // Only complete lines count: curl may be part-way through writing the last one.
  function readLines(file) {
    var lines = (file && api.filePathExists(file) ? String(api.readFromFile(file) || "") : "").split("\n");
    lines.pop();
    return lines;
  }
  // One status line -> { path, status, exit, type }. An empty content type leaves two spaces.
  // A content type may hold spaces ("text/html; charset=utf-8"), so when the last field isn't
  // one of `paths` the line is matched against them by its ending.
  function parse(line, paths) {
    line = String(line).replace(/\r$/, "");
    var m = LINE.exec(line);
    if (!m) return null;
    var r = { path: m[4], status: Number(m[1]), exit: Number(m[2]), type: m[3] }, head = m[1] + " " + m[2] + " ";
    if (paths.indexOf(r.path) >= 0) return r;
    for (var i = 0; i < paths.length; i++) {
      var tail = " " + paths[i];
      if (line.length >= head.length + tail.length && line.slice(line.length - tail.length) === tail) {
        r.type = line.slice(head.length, line.length - tail.length);
        r.path = paths[i];
        return r;
      }
    }
    return r;
  }
  // A download is whole only when the server sent a JPEG or PNG (any type the one-at-a-time
  // path accepts, image/jpg included) with 200, curl finished the transfer (exit 0) and the
  // file is there. Anything else is deleted and fetched again.
  function isOk(r) { return r.status === 200 && r.exit === 0 && GeoSources.extForContentType(r.type) !== null && api.filePathExists(r.path); }
  function isEmpty(r) { return r.status === 404 || r.status === 204; }
  // A batch's curl is certainly gone MAX_BATCH_MS after its last status line (`lastLine`
  // starts at the batch's start; batches written before it existed fall back to `started`).
  function lastSign(b) { return typeof b.lastLine === "number" ? b.lastLine : (b.started || 0); }

  // Applies the earlier batches' status lines: a reported path leaves its batch, and a file
  // that didn't arrive whole is deleted. Results for `want` paths that arrived (whole, or
  // 404/204) are returned so they aren't fetched again; failed ones are fetched again. Lines
  // not seen before count as progress (`lines`, `lastLine`). A batch with nothing left, or no
  // progress for MAX_BATCH_MS (its curl is gone), is dropped; the files it never reported may
  // be half written, so they are deleted and fetched again when needed.
  function reconcile(state, want, now) {
    var settled = [];
    state.batches = state.batches.filter(function (b) {
      b.paths = b.paths || [];
      var lines = readLines(b.status);
      if (lines.length > (b.lines || 0)) { b.lines = lines.length; b.lastLine = now; }
      b.linesRead = lines.length;
      lines.forEach(function (line) {
        var r = parse(line, b.paths);
        if (!r || b.paths.indexOf(r.path) < 0) return;
        b.paths = b.paths.filter(function (p) { return p !== r.path; });
        r.ok = isOk(r);
        if (!r.ok) del(r.path);
        if (want[r.path] && (r.ok || isEmpty(r))) settled.push(r);
      });
      if (b.paths.length && now - lastSign(b) <= MAX_BATCH_MS) return true;
      b.paths.forEach(del);
      dropFiles(b);
      return false;
    });
    return settled;
  }

  // Starts a stage's downloads. Files a live earlier batch is still fetching are adopted (that
  // batch's status file is read too), files it already reported whole are not fetched again,
  // and only the rest go to a new curl (none at all when nothing is left).
  function start(jobs) {
    var now = Date.now(), want = {}, owned = {}, state = readState();
    jobs.forEach(function (j) { want[j.path] = true; });
    var settled = reconcile(state, want, now), sources = [];
    settled.forEach(function (r) { owned[r.path] = true; });
    state.batches.forEach(function (b) {
      var adopt = b.paths.filter(function (p) { return want[p]; });
      adopt.forEach(function (p) { owned[p] = true; });
      if (adopt.length) sources.push({ id: b.id, status: b.status, seen: b.linesRead });
      delete b.linesRead;
    });
    var fresh = jobs.filter(function (j) { return !owned[j.path]; });
    var batch = { id: null, cfg: null, status: null, paths: jobs.map(function (j) { return j.path; }), total: jobs.length,
      sources: sources, pending: settled, reported: {}, count: 0, seen: 0, started: now, lastProgress: now };
    if (fresh.length) {
      batch.id = now + "-" + (++batchSeq);
      batch.cfg = dir() + "/batch-" + batch.id + ".cfg";
      batch.status = dir() + "/batch-" + batch.id + ".status";
      GeoNet.ensureDir(dir());
      api.writeToFile(batch.cfg, fresh.map(function (j) { return "url = " + quote(j.url) + "\noutput = " + quote(j.path) + "\n"; }).join(""), true);
      api.writeToFile(batch.status, "", true);
      state.batches.push({ id: batch.id, cfg: batch.cfg, status: batch.status, paths: fresh.map(function (j) { return j.path; }),
        started: now, lastLine: now, lines: 0 });
      sources.push({ id: batch.id, status: batch.status, seen: 0, own: true });
    }
    writeState(state); // the in-flight list is written before curl starts
    if (fresh.length) {
      api.runDetachedProcess("curl", ["--parallel", "--parallel-max", "4", "-s", "-L", "--fail", "--create-dirs", "--retry", "2",
        "--max-time", "120", "-A", GeoNet.USER_AGENT, "-w", "%{stderr}%{http_code} %{exitcode} %{content_type} %{filename_effective}\\n",
        "--stderr", batch.status, "-K", batch.cfg]);
    }
    return batch;
  }

  // New results for this stage's paths, each with `ok`, from its own curl and the batches it
  // adopted. A path counts once however many lines name it; lines for other paths are
  // skipped. `seen` counts the lines read. New lines are recorded in inflight.json as the
  // batch's progress (`lines`, `lastLine`), which keeps a slow batch from expiring.
  function poll(batch) {
    var results = [], now = Date.now(), candidates = batch.pending.splice(0, batch.pending.length), progressed = {}, any = false;
    if (candidates.length) batch.lastProgress = now;
    batch.sources.forEach(function (s) {
      var lines = readLines(s.status);
      for (var i = s.seen; i < lines.length; i++) candidates.push(parse(lines[i], batch.paths));
      if (lines.length > s.seen) {
        batch.seen += lines.length - s.seen; s.seen = lines.length; batch.lastProgress = now;
        progressed[s.id] = lines.length; any = true;
      }
    });
    if (any) noteProgress(progressed, now);
    candidates.forEach(function (r) {
      if (!r || batch.paths.indexOf(r.path) < 0 || batch.reported[r.path]) return;
      batch.reported[r.path] = true;
      batch.count++;
      r.ok = isOk(r);
      results.push(r);
    });
    var own = batch.sources.filter(function (s) { return s.own; })[0];
    return { results: results, count: batch.count, done: batch.count >= batch.total, stalled: now - batch.lastProgress > STALL_MS,
      silent: !!own && own.seen === 0 && now - batch.started > FIRST_LINE_MS };
  }

  function noteProgress(linesById, now) {
    if (!api.filePathExists(inflightFile())) return;
    var state = readState(), changed = false;
    state.batches.forEach(function (b) {
      var n = linesById[b.id];
      if (n !== undefined && n > (b.lines || 0)) { b.lines = n; b.lastLine = now; changed = true; }
    });
    if (changed) writeState(state);
  }

  // Takes `paths` off the in-flight list (whichever batch lists them); a batch left with
  // nothing is dropped.
  function release(paths) {
    if (!paths.length || !api.filePathExists(inflightFile())) return;
    var state = readState(), changed = false;
    state.batches = state.batches.filter(function (b) {
      var kept = (b.paths || []).filter(function (p) { return paths.indexOf(p) < 0; });
      changed = changed || kept.length !== (b.paths || []).length;
      b.paths = kept;
      if (kept.length) return true;
      dropFiles(b);
      changed = true;
      return false;
    });
    if (changed) writeState(state);
  }

  // Ends a stage: the files that got a result leave the in-flight list. Files curl never
  // reported stay listed (it may still be writing them) until a later batch reports or drops them.
  function finish(batch) { release(Object.keys(batch.reported)); }

  // Stops waiting on a stage whose curl looks broken. Like finish, its reported files leave
  // the list; its unreported files stay listed, because a slow but working curl may still be
  // writing them, so plans keep counting them missing and builds keep skipping them until a
  // later start reconciles or expires the batch. Only its config is deleted (curl read it at
  // start, and it may hold a key).
  function abandon(batch) {
    finish(batch);
    if (!batch.id || !api.filePathExists(inflightFile())) return;
    var state = readState(), changed = false;
    state.batches.forEach(function (b) {
      if (b.id !== batch.id || !b.cfg) return;
      del(b.cfg);
      b.cfg = null;
      changed = true;
    });
    if (changed) writeState(state);
  }

  return { STALL_MS: STALL_MS, FIRST_LINE_MS: FIRST_LINE_MS, MAX_BATCH_MS: MAX_BATCH_MS, available: available, leftovers: leftovers,
    disable: disable,
    start: start, poll: poll, finish: finish, abandon: abandon, release: release, discard: del,
    _reset: function () { support = null; } };
})();

# Developing Cavalry Geo

Needs Node.js 20 or newer; there are no dependencies to install.

- `npm test` — runs the unit tests.
- `npm run build` — builds `dist/CavalryGeo.js` and `dist/CavalryGeo_assets/` without installing.
- `npm run install-cavalry` — builds and copies the result into Cavalry's Scripts folder.
- `npm run package` — builds `dist/CavalryGeo-v<version>.zip` for a GitHub release.
- `npm run ne-data` — re-downloads and re-encodes the bundled Natural Earth data into `assets/ne/`.

## How it fits together

- Source lives in `src/core/` (pure, unit-tested logic: projections, parsing, ranking, encoding,
  tile maths) and `src/cavalry/` (the Cavalry-specific panel glue).
- The build step in `tools/buildlib.js` inlines the core modules into the panel and into each map
  layer's expression, so the panel and the layers it creates always share the same code.
- Plugin data (bundled Natural Earth files and the download cache) lives in
  `CavalryGeo_assets` inside Cavalry's Scripts folder.
- `docs/cavalry-api-notes.md` records Cavalry API behaviour confirmed in real Cavalry;
  `docs/manual-test-checklist.md` is the manual test pass to run in Cavalry after a change.

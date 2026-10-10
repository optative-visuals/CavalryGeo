# Cavalry API notes

Cavalry behaviours the plugin relies on, each confirmed by small test scripts run inside Cavalry
Pro on Windows. The `GeoAttrs` values in `src/cavalry/attrs.js` come from here.

## GeoAttrs Mapping

| Key | Value | Evidence |
|-----|-------|----------|
| MAP_LAYER_TYPE | "javaScriptShape" | P3.createShape: javaScriptShape#1 |
| MAP_EXPR_ATTR | "generator.expression" | spike-verified |
| MAP_ARRAY_ATTR | "generator.array" | spike-verified; P3 uses it for inputs |
| CAMERA_LAYER_TYPE | "javaScript" | P2.create: javaScript#1 type=javaScript |
| CAMERA_EXPR_ATTR | "expression" | P2.exprAttr: expression |
| CAMERA_ARRAY_ATTR | "array" | P2.CAMERA_ARRAY_ATTR: array |
| CAMERA_BODY | "0;" | camera is a JavaScript Utility, not a Shape |
| FILL_COLOR_ATTR | "material.materialColor" | P4.has.material.materialColor: color = {...} |
| COLOR_VALUE | function (hex) { return hex; } | P4.setColorHex: hex accepted, returns {"a":255,"b":0,"g":0,"r":255} |
| STROKE_COLOR_ATTR | "stroke.strokeColor" | probe 2 Q2.strokeAttrsOnShape contains stroke.strokeColor after api.setStroke |
| STROKE_WIDTH_ATTR | "stroke.width" | probe 2 Q2.strokeAttrsOnShape contains stroke.width after api.setStroke |
| COMP_RESOLUTION_ATTR | "resolution" | P5.comp: resolution: {"x":1920,"y":1080} |
| readResolution | function (v) { ... } | P5 shows {x, y} format |
| TEXT_LAYER_TYPE | "textShape" | probe 2 P7.create.textShape: textShape#2 created |
| TEXT_ATTR | "text" | probe 2 P7.create.textShape: textAttrs: ["text"] |
| LABEL_MODE | "driver" | probe 2 P8.array.id returns {"x":100,"y":50,"z":0} ✓ |
| DRIVER_OUTPUT_ATTR | "id" | probe 2 P8.array.id first to produce correct position |
| DRIVER_RETURN | "array" | probe 2 P8: [100, 50] form works with output id |
| ELLIPSE_SCALE | 1 | probe 2 P6.ellipse: addEllipse(10, 20, 5, 5) → width 10, so scale = 10/10 = 1 |
| ASSETS_DIR | function () { ... } | Q1.getAppDataFolder: <user folder>/AppData/Roaming/Cavalry (Windows) → Scripts/CavalryGeo_assets |

## Key Findings

Confirmed for v0.1.1 (checks 3 and 4, run in Cavalry Pro, 2026-09-27):

- **New script layers already have one dynamic slot.** A fresh `javaScript` layer has `array.0` and a fresh `javaScriptShape` has `generator.array.0`; each `api.addDynamic` appends one more. `api.getAttributes` does not list these slots — check them with `api.hasAttribute`. `api.removeArrayIndex(layerId, "array.N")` takes two arguments.
- **Files:** `api.deleteFilePath` deletes files and **empty** folders; a folder that still contains files is left in place. `api.listDirectoryPaths` lists files only; `api.listDirectoryRecursive` lists files and folders; `api.isDirectory` exists; `api.getFileSize` reports **kilobytes**.
- **Layer order:** `api.getChildren(group)` lists children top-first (as shown in the Scene Window). `api.moveToBack()` and `api.moveBackward()` take **no arguments** and act on the current selection (`api.select([id])`); passing a layer id throws "Expected 0 but got 1". `api.reorder(id, index)` had no visible effect (check 5).
- **Opacity:** a JavaScript Utility's `id` output connected to a text layer's `opacity` drives it live (value 37, then 0).

- **ui.scriptLocation is undefined** in Cavalry scripts; use `api.getAppDataFolder()` for stable data paths.
- **Renaming a dynamic attribute** (P2.rename) keeps its index id `array.0` valid and makes expressions see the new name instead of `nN`.
- **Expression variable access** (P3b): renamed vars are read first; `nN` fallback shows undefined. Box is 200 wide (renamed var `probeW` seen) and 10 tall (no `n1` fallback).
- **api.connect between utility and shape inputs** works (P3.connect returns 12.5 correctly).
- **Fill and stroke are controlled** by `api.setFill` / `api.setStroke`, not by direct attribute manipulation.
- **P6.addText("Probe", 40, 0, 0)** (signature: addText(text, size, x, y)) produces a bounding box ~30 px tall (actual: 29.74 px).
- **api.makeFolder** creates nested folders in one call.
- **Large expressions work**: 5,000,028-char expression stored and read back (5000028 chars) in 56 ms.
- **P8 caveat**: Only the first combination (array/"id") proven to drive position correctly; subsequent connections may reflect the first.

Confirmed for v0.2.0 (check 6, 2026-09-27):

- **Trim direction**: `stroke.trim`, `stroke.trimStart`, `stroke.trimEnd` draw from the path's **first point** (Trim does not run in reverse). Trim values are percentages 0–100; `trimEnd: 25` shows a quarter of the path. Both attributes are `double` type.
- **Cap style**: `stroke.capStyle` is an enum (default 0 = Flat). Values 1 and 2 produce Round and Projecting caps respectively (strings "round" and "Round" are ignored and read back as 0). Value 1 = Round was confirmed visually in the v0.2.0 manual test; 2 = Projecting is from the dropdown order only and has not itself been visually confirmed.

Confirmed for v0.3.0 (check 9, 2026-09-27):

- **Colour input types**: Dynamic "color" inputs arrive in expressions as an object `{r, g, b, a}` (values 0–255, including alpha). `api.getAttrType()` returns "color" for colour inputs and "string" for string inputs.
- **Fill opacity attribute**: Neither `material.alpha` nor `material.opacity` exist on Mesh materials. Fill opacity is controlled via the `opacity` attribute on the layer itself, which reads/writes numeric values (e.g., 70 for 70% opacity).
- **CSV export redirects**: Google Sheets export API answers with HTTP 307 (temporary redirect). `api.WebClient` does **not** follow redirects; you must call `getHeaders()` to read the `Location` header, then make a second request to the redirected URL.
- **Mesh with layer fill off**: Check 9's bounding box (350×150) shows both paths were drawn. Stroke on Mesh paths is **provisional — re-check in manual test item 29**. If borders are missing, choropleth sets `mat.stroke = true`, `mat.strokeColor = '#ffffff'`, `mat.strokeWidth = 0.5` on each country's Material.
- **measureText**: not verified — the code falls back to an estimate.

Confirmed for v0.4.0 (check 11 + live imagery test, 2026-10-02):

- **`api.parent(child, parent)` keeps the world transform**: it rewrites the child's local position/rotation (a rectangle parented into a group at (100, 50) turned 30° got local rotation −30 and a compensating position). Parent a layer first, then set its local transform. The imagery build does this for level groups and tiles.
- **New layers appear next to the selection**: `api.create`, `api.primitive` and `api.addAssetToComp` create the layer beside the current selection (inside the selected layer's group), not necessarily at the comp root. A tile created at the root, positioned, then parented into a driven level group landed at local (1179, −769) instead of (128, −128).
- **Seams between tiles**: adjacent 256-px tiles at 257/256 scale still show faint light seams; 260/256 removes them (`SEAM_SCALE`).
- **Palette PNGs draw nothing**: indexed-colour PNGs load with `resolution` {x: 0, y: 0} and render blank; RGBA PNGs and JPEGs load fine. Imagery drops zero-resolution footage and MapTiler tiles are always requested as JPG.
- **Asset de-duplication**: `api.loadAsset` of the same path returns the same asset id, so assets are reused by path.
- **Deleting layers**: `api.deleteLayer` on a group removes its footage layers, drivers and Image Shaders.
- **Bulk asset deletion can hang Cavalry**: deleting about 250 assets in one synchronous script hung the application. Imagery never deletes assets.
- **Comp frame range**: the composition attribute is `frameRange` ({x: start, y: end}) (`COMP_FRAME_RANGE_ATTR`).
- **Rotation sign**: `ROTATION_SIGN` = 1 (the imagery rotation driver and the map rotation use the same direction).
- **Camera sampling**: `api.setFrame` followed by `api.get` reads interpolated (keyframed) values, which is how the flight is sampled to plan tiles.
- **Footage layers get slower as the scene grows**: each tile is a footage layer made by `api.addAssetToComp`, and its cost grows with the number of layers already in the scene — about 14 ms per tile near empty, 55 ms at 350 tiles, 100 ms at 600 — so a build's total time is quadratic. A 998-tile build froze Cavalry ("Not responding") for over 8 minutes. `api.loadAsset`, `api.parent` and `api.set` are about 0–3 ms each. There is no faster way to make a tile: `footageShape` can't be made with `api.create`, and a rectangle with an Image Shader is 16 nodes per tile. Tile imagery (MapTiler, Mapbox, custom links) is therefore limited to 300 tiles (`MAX_TILES`, warning above 150), caps the sharpest level to fit, and builds in time-budgeted timer steps. EOX and NASA avoid the problem by building from a few large images instead (see below).
- **Cavalry's refresh after each script step is a fixed cost** (measured 2026-10-02, ~700-node scene): after a step that loads any assets Cavalry spends ~3.6 s (5 or 20 assets alike); after a step that adds layers (preloaded footage or plain groups) ~1.3 s; a step with no scene change ~30 ms. A visible Scene Window adds ~40%; selection and the Assets panel make no difference. So imagery loads every asset in its first build step and then builds in ~1 s steps (80 ms steps managed ~0.6 tiles/s; 1 s steps built 220 tiles in ~1 min).
- **Deleting a big imagery group is slow**: `api.deleteLayer` on a 302-tile imagery group took about 6.8 s in one call. A rebuild or a cancelled build deletes imagery a layer per step instead.
- **Downloads block**: each `WebClient.get` blocks Cavalry for about 0.1–0.2 s; with a 1 ms timer interval the UI barely gets time between downloads, so tile downloads are spaced 60 ms apart (`DOWNLOAD_GAP_MS`). This is now only the fallback path, used when curl 7.75+ isn't there or isn't working; an EOX WMS image would block for ~15 s, so in that case EOX and NASA plan map tiles instead of large images.
- **Background downloads with curl** (check 12, 2026-10-02, Windows): `api.runDetachedProcess("curl", […])` runs curl with no console window and returns at once. `--parallel -K cfg -w "%{stderr}%{http_code} %{exitcode} %{content_type} %{filename_effective}\n" --stderr <file>` writes one status line per finished file, so the panel polls that log; `%{filename_effective}` echoes the config's `output` path exactly, and an empty content type leaves two spaces before the path. `%{exitcode}` needs curl 7.75. A download counts only for `200` with exit code 0, a JPEG or PNG type (`image/jpeg`, `image/jpg` or `image/png`, as the one-at-a-time path accepts) and the file on disk: a 200 can still be a broken-off transfer (exit 56 or 28) or an XML error page, and those files are deleted. A 404 with `--fail` writes no file. Paths containing spaces work; paths with non-ASCII characters in a config file are unverified, so background downloads are off for such an assets folder. `api.runProcess("curl", ["--version"])` tells whether curl is there. Deleting plain files with `api.deleteFilePath` is fine (only deleting assets crashes).
- **Windows can't read a file curl holds open** (2026-10-08, Windows): with `--stderr <file>`, curl keeps the status file open for its whole run, and `api.readFromFile` then logs "File not found or cannot be read." and returns "" on every poll until curl exits, so progress stays at 0. curl's `-w "%output{>><file>}%{http_code} …"` (curl 8.3+, no `--stderr`) opens, appends and closes the file per line, and polling works while curl runs. Paths containing `}` keep `--stderr`.
- **WMS large images**: EOX (`s2cloudless-2024_3857`) and NASA GIBS (`BlueMarble_NextGeneration`, EPSG:3857) serve 2048×2048 px images for any bounding box (EOX takes about 15 s, GIBS about 2 s). An 8×8-tile block is one such image, which cuts a world → Paris flight from about 560 footage layers to 40–60.
- **Never delete assets**: `api.deleteLayer(assetId)` on a loaded asset crashed Cavalry three times (in three separate test scripts). Assets are only ever reused by path.

Confirmed for the Night filter (Day & night probe, run inside Cavalry):

- **One plugin folder, two filters**: one `definitions.json` array can hold two filter objects (Reproject and Night) that share one folder.
- **A filter paints over a plain rectangle**: a third-party filter on a plain rectangle layer reads the rectangle's fill colour from its input image and draws over it, so the Night layer needs no script or composition.
- **Filter coordinates**: a filter's coordinates are centred on the layer, with +y up.
- **Track mattes use filtered output**: a track matte takes the matte layer's filtered result, also while Cavalry auto-hides the matte layer (the matte source is unhidden after connecting, as before).

Confirmed for the panel (settings cog and canvas catch-up, 2026-10-10):

- **The panel `ui` module** is only available to Scripts-menu scripts; the JavaScript Editor (and the MCP connector) only has `ui.Modal`, which has showMessage, showQuestion, showConfirmation, showWarning, showIntInput and showStringInput and can't hold widgets.
- **Application callbacks** (`ui.addCallbackObject`): onCompChanged, onSceneChanged, onSelectionChanged, onAttrChanged, onAttrConnected, onAttrDisconnected, onLayerAdded, onLayerRemoved, onAssetAdded / Updated / Removed / AsyncLoadFinished, onAttributeSelectionChanged, onPointSelectionChanged, onKeySelectionChanged, onJSError, onAppStateChanged, onToolChanged, onLicenceUpdated, onCavalryPreferenceChanged. There is no callback for the playhead moving, and no keyboard-shortcut API. `ui.Container` and `ui.Draw` get onMousePress / onMouseRelease (the panel catches up with the canvas on any press inside it).
- **Popovers**: `Container.showAsPopover(x, y)` takes exactly two numbers; `(g.x + g.width / 2, g.y + g.height)` from `button.geometry()` opens it centred under the button. `setPreferredPopoverSide(n)`: 3 below (default), 2 above, 1 right, 0 left (strings are ignored). The popover grows to fit its contents; its corner icon tears it off into a floating window.
- **Button images**: `Button.setImage(png)` with `setImageSize(16, 16)` works; Cavalry left-aligns the image 2 px in, so size the button to the icon to centre it. A padded, wider image is shrunk, so don't pad.
- **Opening folders and links**: `api.runDetachedProcess("explorer", [path with backslashes])` opens a folder (spaces are fine) or a URL with no console flash; macOS uses `open`.
- **Save dialog**: `ui.chooseFileToSave(startPath, "JSON (*.json)")` returns the chosen path, or "" on cancel; it can't pre-fill a file name.
- **Plugin icons**: an 18×18 PNG plus an `@2x` 36×36, named in the filter's `"UI": { "icon": … }` in `definitions.json`; optional Attribute Editor icons are 16×16 / 32×32 with `_ae` / `_ae@2x`.
- **Track-matte sources are auto-hidden**: connecting a layer into another layer's `trackMattes` sets the source layer's hidden to true; setting it back to false sticks and the matte keeps working. Several track mattes on one layer combine; a group ignores track mattes, a composition reference honours them.
- **A deleted driver bakes its last value**: when the layer driving an attribute is deleted, the attribute keeps the last driven value rather than its stored one.
- Unverified: whether `api.listDirectory` returns full paths or bare names (the style-file code copes with both and prefers `listDirectoryPaths`).

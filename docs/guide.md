# Cavalry Geo guide

Everything the panel does, section by section. New here? Start with the
[quick start](../README.md#quick-start) in the README.

The panel's sections — **Map, Layers, Imagery, Label, Data** — are tabs along the top. Extract and
Bake are in Layers, below Add layers; Label has its own **Pins / Routes** switch.

- [Map](#map)
- [Layers](#layers)
- [Imagery](#imagery)
- [Extract and Bake](#extract-and-bake)
- [Label: pins and labels](#label-pins-and-labels)
- [Label: routes](#label-routes)
- [Data](#data)
- [Cache and settings](#cache-and-settings)
- [Known limits](#known-limits)

## Map

A map is a group with a **Camera** layer. Everything you add to the map follows that camera.

- **Making a map:** with **New map** picked in the Map list (the only entry in a scene without
  maps), choose a projection — **Web Mercator** for streets and cities, **Equal Earth** for a flat
  world map, or **Orthographic** for a globe — optionally type a name, then type a place and press
  **Search**. The map is made centred on the first result and named after the place (or your
  name). If that name is taken, a number is added. The name and projection fields only show
  while **New map** is picked. New maps start with **Countries** and **Coastlines** (and the
  **Ocean** layer) already added; add more on **Layers**.
- **Ocean:** new maps include an **Ocean** layer, the dark water behind the land. Restyle or delete it
  like any layer. The default colours match the preview.
- **Enter searches:** in the Map, Pins and Routes search boxes, pressing Enter does the same as
  the Search button. With **New map** picked, Enter only lists the results; press **Search** to make
  the map at the first one (it reuses those results, so nothing is searched twice).
  Enter also runs **Find** in the Extract box (Layers tab) and **Load** in the Data link box, when
  the text changed since the last time.
- **Moving the camera:** with a map picked, Search just finds places. Pick one and press
  **Jump here**. The first entry, **World view**, is always there and jumps back out to the whole
  world.
- **Preview:** a flat map under the search results. Drag it to move and use the **+** / **−**
  squares in its bottom right corner (or double-click) to zoom; the zoom level reads out in its
  bottom left corner, and the heading reads **Preview (drag to move)**. The green frame in the middle is
  exactly where the camera will go, and the dashed outline is where it is now. Search results show as green dots — click one to pick
  that result and centre the preview on it. **Jump here** and **Fly here** take the camera to the
  green frame. With **New map** picked, **Create map here** makes a map at the frame.
- **Flying the camera:** pick a place, set **From:** and **To:** (the first and last frame of the
  flight; they open on the playhead and 100 frames later) and press **Fly here** — the camera zooms
  out, travels and zooms in smoothly, leaving from where the camera is at the From frame (with
  World view picked it flies back out). The two fields then move on, so pick another place and
  press **Fly here** again to chain a second flight that starts where the first ended. If the
  flight ends after your composition's last frame, Fly here asks first; on Yes it lengthens the
  composition, the layers that reach its end and the play range to the end of the flight, and on
  No it changes nothing. Build imagery afterwards for sharp imagery along the way.
- **Animating by hand:** keyframe **Camera · Zoom**, **Camera · Centre latitude / longitude** or
  **Camera · Rotation** on the map's Controls layer (or on the Camera layer). Everything in the map
  follows.

## Map controls

Every map has a **<map> Controls** layer, just above the map's group in the Scene Window (not
inside it). The plugin selects it when you make a map, so the Attribute Editor opens on it. Open
the **Controls** tab there to find the map's settings in one place:

- **Camera:** zoom, centre, rotation and projection (0 flat, 1 Equal Earth, 2 globe).
- **Ocean**, and each map layer: hide, opacity, fill / outline colour, outline width, detail and
  (for cities) dot size.
- **Pins** and **Labels:** one hide, colour and size for all of them.
- **Routes:** colour, width, arc height, lean and flip side for each route, and for each leg its
  **draw on %** to animate and **shape by hand** for exact control of its curve.
- **Stops:** one **Hide**, **Colour** and **Size** for every route stop.
- **Data:** one **Year** for the whole map, plus each data set's colours, bubble size and label size.
- **Imagery:** opacity and hide.

The list updates whenever the plugin adds something to the map. If you change the map yourself,
press **Refresh controls** (Layers tab). Settings you promote onto the Controls layer yourself are
kept, after the plugin's — including settings of the map's own layers, such as a pin's Position.

- **Moving it:** once the Controls layer exists the plugin never moves it again. Drag it wherever
  you like (another group, further down the stack); the plugin still finds it and keeps it up to date.
- **Deleting a map:** deleting a map's group does not delete its Controls layer, because it sits
  outside the group. Delete that layer too.
- **Maps made before this change:** their Controls layer sat inside the map's group. Press
  **Refresh controls** once and it moves out to just above the group, keeping its settings.

- **One layer, its own value:** to give one layer its own value for a shared setting (one pin's
  colour, one leg's width, one data layer's Year…), right-click that setting on the layer and
  choose **Disconnect**; it then stays separate.
- **Maps made before the Controls:** the first **Refresh controls** links only the layers that
  already show the same value. A layer you had set differently (say, one red pin) keeps its value
  and stays separate, as if you had disconnected it.
- **Imagery:** building imagery again replaces its group, so keyframes on its
  `<imagery> · Opacity` and `<imagery> · Hide` rows are lost — key them again after a rebuild.

## Layers

Turn on the categories you want (each shows a green tick) and press **Add layers**.

- **World categories** (Countries, States, Coastlines, Lakes, Rivers, Cities) come from the
  bundled Natural Earth data, at medium detail, or high detail downloaded on demand.
- **Street categories** (Buildings, Roads, Water, Parks, Railways) download from OpenStreetMap for
  the camera's current view — zoom in before adding them.
- Each map layer has a **Detail** setting in the map's Controls: lower it to thin out small or
  minor features, and keyframe it for a "map filling in" effect.
- Keep the **© OpenStreetMap contributors** credit (added for you) in any scene that uses street
  data.

## Imagery

Put satellite photos, styled maps or terrain under a Web Mercator map.

- **Sources:** **EOX Sentinel‑2** (free for non‑commercial use) and **NASA Blue Marble** (public
  domain) work straight away; **MapTiler** and **Mapbox** need your own free key; **Custom tile
  link** takes any `{z}/{x}/{y}` address. Keys stay on your computer
  (`CavalryGeo_assets/settings.json`), never in the scene.
- **Building:** animate the camera first, then press **Build imagery**. It works out how many
  images (or tiles) the animation needs and asks once, showing the count and download size —
  **Yes** downloads them and builds the imagery at the bottom of the map with a progress bar;
  **No** downloads nothing. When everything is already downloaded it builds straight away. (In an
  older Cavalry without that dialog, the button changes to "Download N images" — press it again.)
- **Large images:** EOX and NASA imagery is built from a few large images (each covering up to
  8×8 map tiles), so even a flight from the whole world down to a street builds quickly (limit 150
  images, warning above 80).
- **Tiles:** MapTiler, Mapbox and custom links use map tiles, one layer each, and Cavalry slows
  down as they add up, so they're limited to 300 tiles (warning above 150). When a flight needs
  more, the sharpest zoom level is capped and the status says so — imagery then gets softer as the
  camera zooms in past that level.
- **Zooming:** like web maps, each sharper level fades in just before its own zoom. The imagery
  turns with the camera and hides itself on Equal Earth and the globe.
- **Downloads** run in the background, so Cavalry stays usable. **Cancel** stops waiting and
  leaves any earlier imagery as it was; files that finish anyway are kept, and pressing Build
  again picks them up. Background downloads need curl 7.75 or newer (built into current
  Windows 10/11 and macOS 12+); without it imagery downloads one file at a time, and EOX and NASA
  use map tiles instead of large images.
- **Rebuild** after changing the camera animation — downloaded images and tiles are reused when a
  rebuild needs the same areas.
- **Add attribution** adds the source's credit as its own "Imagery credit" layer.
- **Clear imagery tiles** (press twice to confirm) deletes the downloaded imagery; built imagery
  shows missing images until you rebuild.

## Extract and Bake

Both are in the **Layers** section, below **Add layers** (Refresh controls and Clear download
cache come after them).

- **Extract:** pick a layer, search by name (for example "France" or a street name), and extract
  the matching features into their own layer to style or animate separately.
- **Bake:** select a map layer in the Scene Window and press **Bake** to turn it into a plain
  editable shape at the current frame. Baked shapes stop following the camera. The legs and stops
  of a new-style route are already ordinary Cavalry shapes, so Bake skips them (it still bakes the
  legs of routes made by earlier versions).

## Label: pins and labels

- Search for a place under **Label → Pins** (a Map search fills it in for you) and press
  **Pin here** or **Label here**, or place them at exact coordinates.
- Labels hide automatically when their place turns to the far side of a globe.

## Label: routes

- Under **Label → Routes**, search stops and press **Add stop** for each place in order — two
  stops make a flight, more make a journey. Set **Arc height %** (how far the legs bow to start
  with), tick **Labels at stops** if you want a label beside each circle (it follows when you drag
  the stop), and press **Create route**.
- Each stop is a green circle you can drag in the viewer, and the circles ride along with the
  camera. Each leg is a Bézier line attached to its two stops, so dragging a stop bends its legs
  with it. Until you press **Pin here**, a dragged stop is a fixed offset on screen, so it slides
  against the map when the camera zooms or flies. When a dragged stop is where you want it,
  select it and press **Pin here**: the spot you dropped it on becomes its new place, so from then
  on it stays on that spot of the map as the camera moves. If a stop's place is animated
  (keyframed), Pin here sets a key at the current frame.
- The curve is shaped from the map's Controls: per route, **Arc height**, **Lean** and
  **Flip side** change every leg at once. For one leg, tick `<route> · Leg N shape by hand` and
  set its start and end handle X / Y numbers (in pixels, relative to each stop) — handy for still
  shots. Untick it to go back to the plugin's shape.
- To draw a leg on, animate its `<route> · Leg N draw on %` row (0 → 100) in the map's Controls.
  For a journey, stagger the legs' draw on % keys (leg 2 starts where leg 1 ends) to draw the
  route leg by leg. `Stops · Hide`, `Stops · Colour` and `Stops · Size` style every circle.
- On a globe, a stop on the far side of the Earth fades out with its legs, and a long leg is a
  simple curve rather than a bow. Routes made by earlier versions keep working as before.
- On Web Mercator, a leg passing very close to a pole flattens along the edge of the map, as
  Mercator itself does. On flat maps, a leg crossing the date line runs off the side of the frame
  rather than wrapping round.

## Data

- Paste a **Google Sheet** link (Share → "Anyone with the link") or any **CSV** link and press
  **Load**. Cavalry Geo finds the country/place, value and year columns (it understands Our World
  in Data and World Bank downloads, latitude/longitude columns and simple tables) and lists rows
  it couldn't match. Tick **Look up unmatched names** to place cities.
- Turn on **Coloured regions**, **Bubbles**, **Value labels** and **Legend**, then **Add to map**.
  Each goes in its own layer inside a `Data: <column>` group and moves with the camera.
- Keyframe **Data · Year** in the map's Controls to animate through time: it drives every data
  layer of the map, so regions, bubbles and labels stay in step. Each set's colours and sizes are
  there too (`<set> · Low colour`, `<set> · Bubble size`…); the range is on the layers. After
  editing the sheet, press **Refresh data** — your styling and keyframes are kept.

## Cache and settings

- Downloads are cached in `CavalryGeo_assets/cache` inside the Scripts folder
  (**Help → Show Scripts Folder** in Cavalry).
- **Clear download cache** (Layers) deletes downloaded map data and shows how much space was
  freed. It keeps imagery (built imagery points at those files) and waits until imagery has
  finished downloading and building; use **Clear imagery tiles** (Imagery) for imagery.
- **Updates:** once a day, opening the panel asks GitHub (in the background) whether a newer
  version is out. If one is, the status line and Cavalry's console say so, with the download
  link, each time the panel opens until you update. To switch it off, add
  `"checkForUpdates": false` to `CavalryGeo_assets/settings.json`.
- Place search and street downloads use OpenStreetMap's Nominatim and Overpass services under
  their fair‑use policies: keep searches occasional and don't script bulk requests.

## Known limits

- Tested on Windows; macOS hasn't been tried yet.
- Street downloads use Web Mercator maths for the camera's view, whatever projection the map
  shows. The download cache grows as you work in new areas (high-detail world data is 10–40 MB per
  category).
- Imagery shows on Web Mercator maps only and doesn't wrap across the date line. Check each
  imagery provider's licence for your use (EOX and MapTiler's free plan are non‑commercial).
- Data maps colour whole countries only (not states or provinces), value labels use Cavalry's
  default font, and private sheets can't be read.
- Data layers show Detail and Point Radius inputs they don't use, and the legend's numbers always
  use the compact format.

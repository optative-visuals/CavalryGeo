# Cavalry Geo guide

Everything the panel does, section by section. New here? Start with the
[quick start](../README.md#quick-start) in the README.

The panel's sections — **Map, Layers, Imagery, Label, Data** — are tabs along the top. Extract and
Bake are in Layers, below Add layers; Label has its own **Pins / Routes** switch.

- [Map](#map)
- [Layers](#layers)
- [Imagery](#imagery)
- [Extract and Bake](#extract-and-bake) (with [Highlights](#highlights))
- [Label: pins and labels](#label-pins-and-labels)
- [Label: routes](#label-routes)
- [Data](#data)
- [Cache and settings](#cache-and-settings)
- [Known limits](#known-limits)

## Map

A map is a group with a **Camera** layer. Everything you add to the map follows that camera.

The first time you open the panel, a **Start here** box at the top of this tab gives four quick steps
(make a map, add layers, mark places, animate). Press **Got it** to hide it; it stays hidden next time.
The small **Tips** button at the bottom of the Map tab brings it back.

- **Making a map:** with **New map** picked in the Map list (the only entry in a scene without
  maps), choose a projection — **Web Mercator** for streets and cities, **Equal Earth** for a flat
  world map, or **Orthographic** for a globe — optionally type a name, then type a place and press
  **Search**. The map is made centred on the first result and named after the place (or your
  name). If that name is taken, a number is added. With **Create map here** and no name typed, maps are
  called **Map 1**, **Map 2** and so on: the lowest number not already used by another map. Maps you already have are never renamed. The name and projection fields only show
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
  squares in its bottom right corner (or double-click) to zoom — or press the scroll wheel and drag up / down to zoom around the point you pressed; the zoom level reads out in its
  bottom left corner, and the heading reads **Preview (drag to move)**. The green frame in the middle is
  exactly where the camera will go, and the dashed outline is where it is now. Search results show as green dots — click one to pick
  that result and centre the preview on it. **Jump here** and **Fly here** take the camera to the
  green frame. With **New map** picked, **Create map here** makes a map at the frame. The previews also draw the picked map's pins, labels and routes — and, zoomed in, its roads, railways, water, parks and extracts — in its style colours.
- **Flying the camera:** pick a place, set **From:** and **To:** (the first and last frame of the
  flight; they open on the playhead and 100 frames later) and press **Fly here** — the camera zooms
  out, travels and zooms in smoothly, leaving from where the camera is at the From frame (with
  World view picked it flies back out). The two fields then move on, so pick another place and
  press **Fly here** again to chain a second flight that starts where the first ended. If the
  flight ends after your composition's last frame, Fly here asks first; on Yes it lengthens the
  composition, the layers that reach its end and the play range to 3 seconds after the end of the
  flight (so playback doesn't snap back to the start), and on No it changes nothing. Build imagery afterwards for sharp imagery along the way.
- **Easing and Zoom-out:** under the Fly row, **Easing** sets how a flight accelerates —
  **Smooth** (the classic ease in and out), **Gentle** (a softer, rounder start and finish),
  **Snappy** (slow, then a quick dash, then a firm stop) or **Overshoot** (arrives a little too
  close, then settles back to the place). **Zoom-out** sets how far the camera pulls back on a
  long flight: **Low** stays close to the ground, **Normal** is the usual arc, **High** rises
  higher for a bigger view of the trip. Both are remembered for next time, and so is the Drift move.
- **Update flight:** put the playhead anywhere inside a flight you made with **Fly here**, change
  Easing or Zoom-out, and press **Update flight** — the same flight is redone with the new choices,
  keeping its frames and its destination. If the playhead is not inside a flight, or is inside a
  drift, it tells you so.
- **Drift:** for a small, calm move on the spot. Pick a **Drift move** — **Push in** or **Pull out**
  (a little closer or further) or **Pan left / right / up / down** (a slide of about 5 % of the
  frame) — set **From:** and **To:**, and press **Drift**. It starts from where the camera is at
  From, moves gently, and the two fields move on, so drifts chain after flights and after each
  other. Like a flight it asks before lengthening the composition. Pans follow the map's own directions (west / east / north / south), so on a rotated camera
  they won't line up with the screen edges. Everything Fly here and Drift
  make is ordinary keyframes on the camera, so you can still edit them by hand.
- **Animating by hand:** keyframe **Camera · Zoom**, **Camera · Centre latitude / longitude** or
  **Camera · Rotation** on the map's Controls layer (or on the Camera layer). Everything in the map
  follows.

### Styles

The **Style** section at the bottom of the Map tab colours a whole map in one go: ocean, land, borders, coastlines, water, rivers, parks, buildings, cities, roads, railways, pins, stops, routes, travellers, labels, extracts and credits, plus line widths. Data colours (low / high / no-data, bubbles) and imagery are never changed.

- **Pick a style** — Dark (the original look), Light, Blueprint, Vintage, Mono or Neon night. The preview shows its colours, and the next map you make uses it.
- **Apply to map** — restyles the map picked at the top of the tab. Colours shared in the map's Controls change there; a colour you animated or connected to something else is left alone (the status line says how many).
- **Save as style** — type a name and press it to save the picked map's current colours (fine-tune them in its Controls first) as your own style. It is kept in `CavalryGeo_assets/settings.json` in the Scripts folder. When you update, merge the new CavalryGeo_assets folder into yours rather than replacing it, or your saved styles go with it (on a Mac, hold Option while dragging and choose Merge). **Delete style** removes the saved style picked in the list; the built-in styles can't be deleted.

Each map remembers its style, so pins, routes, labels and layers you add later match it.

## Map controls

Every map has a **Map controls** layer (named after the map, for example "Paris Map controls"), just above the map's group in the Scene Window (not
inside it). The plugin selects it when you make a map, so the Attribute Editor opens on it. Open
the **Controls** tab there to find the map's settings in one place:

- **Camera:** zoom, centre, rotation and projection (0 flat, 1 Equal Earth, 2 globe).
- **Ocean**, and each map layer: hide, opacity, fill / outline colour, outline width, detail and
  (for cities) dot size.
- **Pins** and **Labels:** one hide, colour and size for all of them.
- **Routes:** each route is numbered ("Route 1: Paris → Rome") and gets five rows, **Route n · Travel %**,
  **Arc height**, **Shape**, **Colour** and **Width** (plus its traveller rows). Hover a row to see the route's stops.
- **Stops:** one **Hide**, **Colour** and **Size** for every route stop.
- **Data:** one **Year** for the whole map, plus each data set's colours, bubble size and label size
  (**Data 1 · …**, **Data 2 · …**; hover a row to see which set it is).
- **Imagery:** opacity and hide.

A map's settings are split over up to four components, stacked above the map group: **Map controls**
(named after the map: camera, ocean, base layers, imagery), **Overlay controls** (pins, labels, routes,
travellers, scale bar, north arrow), **Data controls** (data maps) and **Extract controls**
(extracted features). Each appears once it has something to show. Maps made with earlier versions
are split the next time their controls refresh (any action in the panel, or Refresh controls);
anything you promoted yourself stays where it is. A main component still called "Map name Controls"
is renamed to "Map name Map controls" then; a name you gave it yourself is kept.

The list updates whenever the plugin adds something to the map. If you change the map yourself,
press **Refresh controls** (Layers tab). Settings you promote onto the Controls layer yourself are
kept, after the plugin's — including settings of the map's own layers, such as a pin's Position.

- **Moving it:** once the Controls layer exists the plugin never moves it again. Drag it wherever
  you like (another group, further down the stack); the plugin still finds it and keeps it up to date.
- **Deleting a map:** deleting a map's group does not delete its Controls layers (the main one
  and, if the map has them, the Overlay, Data and Extract ones: up to four), because they sit
  outside the group. Delete those layers too.
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
  the camera's current view — zoom in before adding them. Add one street layer at a time: once a
  street layer is added, its box unticks by itself. (If nothing was found for a layer, or the add
  was cancelled or failed, the box stays ticked so you can try again.)
- Each map layer has a **Detail** setting in the map's Controls: lower it to thin out small or
  minor features, and keyframe it for a "map filling in" effect.
- Keep the **© OpenStreetMap contributors** credit (added for you) in any scene that uses street
  data.

### Map furniture

**Add scale bar** and **Add north arrow** (Layers tab) put them on the picked map, pinned to a corner of the frame. The scale bar always shows a round distance (metric, imperial or both) that's right at the centre of the frame as the camera moves, and fades out when you zoom out past **Hide below zoom**; the north arrow always points north. Change Units, Style (Line / Segmented; Arrow / Compass / N), Corner, Margin, Max width and Size in the map's Controls. They take the map style's text colour.

The scale bar sits above the © OpenStreetMap credit when that credit is there as the bar is added; if you add a credit (or the imagery credit) later, raise the bar with its **Margin** in the Controls.

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
  legs of routes made by earlier versions). Highlights and callouts are skipped too.

### Highlights

A highlight draws attention to a place with an animated effect, as its own layer next to the
extracted place.

1. Press **Find**, then select one or more places in the list.
2. Under the list, choose an **Effect**, a **Start** frame and a number of **Frames** (the
   duration). Start opens on the playhead and moves on after each highlight, so the next one
   follows straight after. Frames opens at one second of your comp.
3. Press **Highlight selected**. A place that isn't extracted yet is extracted first; one that
   already is gets reused.

The effects:

- **Fill in:** the place fades in as a solid colour.
- **Outline draw-on:** the outline draws itself around the place.
- **Pulse:** a ring grows outward from the outline and fades, over and over. It keeps pinging
  after the Amount reaches 100 %.
- **Glow:** a soft halo around the place. It sits just below the extracted layer, so the place
  itself stays crisp.

Each highlight is a group named "Highlight 1: France" (then 2, 3 and so on). Its timing is an
**Amount %** that runs from 0 at Start to 100 at Start plus Frames. The keys are on the timeline:
drag them to re-time, or ease them in the graph editor.

The map's **Extract controls** get a row for each highlight: **Highlight n · Amount %** and
**Colour**, plus **Width** (Outline draw-on), **Speed** (Pulse) or **Size** (Glow). Hover a row to
see which place it belongs to.

To try another effect on a highlight you already have, select its group (or any layer inside it)
in the Scene Window, pick the new **Effect** and press **Change effect** (next to **Highlight
selected**). The highlight is rebuilt in place: it keeps its number, name and colour, and its
Amount % keys stay at the same frames with the same values. A Glow moves just below the
extracted place; the other effects sit above it. Width, Speed and Size go back to their
defaults when the effect changes (the stroke width stays when you switch between Outline
draw-on and Pulse). The highlight has to belong to the map picked in the Map tab.

To remove a highlight, delete its group. If you delete the extracted place instead, its
highlights go away the next time the Controls refresh (press **Refresh controls**). Highlights
can't be baked: Bake skips them.

## Label: pins and labels

- Search for a place under **Label → Pins** (a Map search fills it in for you) and press
  **Pin here** or **Label here**, or place them at exact coordinates.
- **Preview.** The preview under the search shows the picked map with its pins, labels and routes. Click it to set a spot: Lat and Lon are filled in, a white ring marks the spot, and the place's name is looked up and put in the text box (unless you typed your own). Then press **Pin at coordinates** or **Label at coordinates**. Drag to move; − / + zoom, or press the scroll wheel and drag up / down to zoom around the point you pressed.
- Labels hide automatically when their place turns to the far side of a globe.
- **Callouts.** **Callout here** (or **Callout at coordinates**) makes a numbered group, "Callout 1: Paris": a text label in a box, a dot on the place, and a line joining them. The label stays put on screen while the line follows the place as the camera moves, so you can drag the label anywhere you like; the line leaves the side of the box that faces the place. The label starts a little above and to the right of the place. The type of line is set under **Line style** in the map's Overlay controls (**Elbow** or **Straight**), and **Draw %** draws the line on: key it from 0 to 100. The box is the text's own **Background**: set its padding and corner radius on the text layer, and its colour or hide it with **Box colour** and **Hide box** (the box layer sits just below the label and follows it); **Hide box** hides only the box, so the line still ends at the spot where the hidden box's edge would be. A callout expects the map group itself to stay as it is: don't move, rotate or scale it. To frame the map differently, move the camera instead. The line and dot fade out when the place turns to the far side of a globe. Map styles recolour a callout (its box takes a slightly lighter shade of the ocean colour, so it stands out from the water), and Bake skips callouts, since they are already ordinary Cavalry layers.

- **Day & night.** The **Day & night** section at the bottom of the Pins page shades the night side of the Earth for any date and time. Type a day and pick a month, give the **UTC time** in hours (0 to 24, decimals allowed: 14.5 is 14:30), and press **Add day & night**. The boxes start at today's date and the current time in UTC. The overlay is a group called "Day & night" holding four night layers, one for each step of twilight, and it follows the camera on all three projections. On the flat map the shadow keeps going past the date line, so places on the far side are covered too. On Equal Earth it stays inside the oval and follows its curved edges. On the globe you see just the night on the side facing you: its edge runs along the rim of the globe, and a view of the sunlit side shows no night at all. A map has one overlay: press the button again to set its date and time (it also adds the time label if you ticked it and it is missing, and remakes any night layer you deleted). If you animated Day of year or UTC time, pressing the button again leaves your keys alone and says so.
- **Keying the date and time.** Open the map's **Time controls** and animate **Day of year (1–365)** and **UTC time (0–24)** to run the shadow across the map; they drive the night layers and the time label together. The same component has **Night colour**, **Night opacity**, **Twilight** and **Hide**. Twilight is 0 for a hard edge or 1 for a soft one that fades out in steps.
- **Time label.** With **Time label** ticked, a text layer reads out the date and time, like "21 Jun · 14:30 UTC". A UTC time of 24 shows as 00:00 of the same date (the day doesn't roll over). Its controls (Hide, Colour, Size and Corner) sit in Time controls too; Corner is 0 top-left, 1 top-right, 2 bottom-left or 3 bottom-right.
- **Styles.** Map styles recolour the overlay: the night is the style's ocean colour mixed toward black, and the time label takes the style's text colour. Bake and Extract leave the overlay alone, since it redraws itself from its time.

## Label: routes

- Under **Label → Routes**, search stops and press **Add stop** for each place in order — two
  stops make a flight, more make a journey. Pick a **Shape**: **Arc** (a simple bow, the default)
  or **Great circle** (each leg follows the shortest path over the Earth, the way a real flight
  does). Set **Arc height %** (how far the legs bow to start with), tick **Labels at stops** if you want a label beside each circle (it follows when you drag
  the stop), and press **Create route**.
- **Click to add stops.** Each click on the Routes preview adds the next stop, named after the place you clicked (or its coordinates). The route you're building is drawn as a dashed line; Remove selected and Clear still edit the list. Create route makes it. Zoom the preview with − / + or by pressing the scroll wheel and dragging up / down (around the point you pressed).
- Each stop is a green circle you can drag in the viewer, and the circles ride along with the
  camera. Each leg is a Bézier line attached to its two stops, so dragging a stop bends its legs
  with it. Until you press **Pin here**, a dragged stop is a fixed offset on screen, so it slides
  against the map when the camera zooms or flies. When a dragged stop is where you want it,
  select it and press **Pin here**: the spot you dropped it on becomes its new place, so from then
  on it stays on that spot of the map as the camera moves. If a stop's place is animated
  (keyframed), Pin here sets a key at the current frame.
- Routes are numbered: "Route 1: Paris → Rome", "Route 2: …". Routes made before numbers are
  numbered the next time the Controls refresh (or when you make a route), oldest first (from the
  bottom of the Scene Window up), and a name that still reads "Route: …" is renamed; a name you
  gave a route yourself is kept. A duplicated route takes the next free number.
- **Great circle** legs look like a gentle sweep: on a flat map they bow toward the nearer pole
  (London to Tokyo climbs over the north), and on the globe they hug the surface. **Arc height**
  still works: it adds extra lift on top of the great circle. Change your mind later with
  **Route n · Shape** in the map's Controls (0 is arc, 1 is great circle). Routes made by an
  earlier version get the Shape setting when you press **Refresh controls**. Very long legs are a
  close fit rather than exact, and on a flat map a leg that crosses the date line still goes the
  long way round.
- The curve is shaped from the map's Controls: **Route n · Arc height** changes every leg at
  once. **Lean**, **Flip side** and shaping a leg by hand (its handle X / Y) are no longer in the
  Controls: their values live on the route's handle helpers (inside its "Route helpers" group),
  and on a map from an older version the Controls hand their values over to those helpers. One
  you had animated (keyed) stays on "<Map> control values", still driving the helpers.
- To draw the route on, animate **Route n · Travel %** from 0 to 100 (two keyframes): the legs
  draw on one after another, and a traveller rides along. Each leg's draw is a small helper
  ("Leg k draw") driving its Trim end; a leg whose Trim end you had already animated, connected
  or set below 100 yourself is left alone. On a new route every leg's Trim end is driven by its
  draw helper, so to animate one leg by hand, disconnect its helper first. `Stops · Hide`,
  `Stops · Colour` and `Stops · Size` style every circle.
- Hover any route row in the Controls to see the route's stops (its notes). A note you type
  there yourself is never overwritten.
- **Travellers.** Pick a **Traveller** (Plane, Arrow, Dot or Selected layer) before **Create route**
  and it rides the route, leg by leg, sitting at the tip of each leg as it draws on and facing the
  way the leg is heading. To add one to a route you already have, pick a Traveller, select any
  part of the route in the viewer and press **Add to route**; adding again replaces it, and
  **None** + **Add to route** removes it. **Selected layer** sends your own layer along the
  route: select it (as well as the route part, when adding to an existing route). Your layer is
  kept, and Cavalry hides it while the copies ride; choose None to bring it back, visible. If you
  delete a route that carried your own layer, Cavalry leaves that layer hidden: un-hide it
  yourself (or pick None and press **Add to route** before deleting the route). Your layer
  keeps its own scale and rotation; Traveller size multiplies it. With Faces direction on,
  your layer's rotation is added to the direction of travel: rotate an icon drawn pointing up
  by −90° so it points along the route. In the map's Controls the route gets four rows: `Traveller hide`, `Traveller size`,
  `Traveller colour` (for the Plane, Arrow and Dot only) and `Traveller faces direction`.
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
  there too (`Data 1 · Low colour`, `Data 1 · Bubble size`…); the range is on the layers. After
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

- Tested on Windows and macOS.
- Street downloads use Web Mercator maths for the camera's view, whatever projection the map
  shows. The download cache grows as you work in new areas (high-detail world data is 10–40 MB per
  category).
- Imagery shows on Web Mercator maps only and doesn't wrap across the date line. Check each
  imagery provider's licence for your use (EOX and MapTiler's free plan are non‑commercial).
- Data maps colour whole countries only (not states or provinces), value labels use Cavalry's
  default font, and private sheets can't be read.
- Data layers show Detail and Point Radius inputs they don't use, and the legend's numbers always
  use the compact format.

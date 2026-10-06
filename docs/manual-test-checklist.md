# Cavalry Geo — manual test checklist

Run these in Cavalry itself, in order, after `npm run install-cavalry`. Open a new scene
and run **Scripts → CavalryGeo** unless a step says otherwise. Check off each box as it
passes; note any failure (status-line message + Cavalry's console output) so it can be
fixed before release.

## Map tab

- [ ] 1. The panel opens on the Map section, with section tabs along the top (Map,
      Layers, Imagery, Label, Data; Map selected, lighter than the other tabs) and a status
      line. Clicking a tab shows that section and moves the selection; the tab text has
      no extra symbols. On Layers, clicking a category (Countries, Cities, …) or, on Data,
      a Show option gives it a green tick; click again → tick gone. Buttons (toggles
      included) show a hover highlight. Label has a Pins / Routes switch that changes the
      page.
- [ ] 1b. Narrow the panel → the tab bar stays on one row and the tab text stays centred
      (check nothing is clipped at the narrowest width); widen it again.
- [ ] 2. The Map dropdown shows only "New map", and there is no Create map, Drop pin or
      Centre button. Press Jump here or Fly here → "Pick a map, or search for a place
      first — that creates the map (Map tab)."
- [ ] 3. Leave the name blank, pick Web Mercator, search "Notre-Dame, Paris" → a group
      with a "Notre-Dame… Camera" layer appears, centred on the cathedral, selected in the
      Map dropdown (with "New map" last), and the status says "Created map "…" centred on
      …". Its inputs are named centerLat/centerLon/zoom/rotation/projection (or n0..n4 if
      renaming turned out to be display-only). Pick "New map" again → no error ("New map:
      type a place and press Search to make it."); search the same place → the new map is
      named "… 2". Type a name and search again with "New map" picked → the map takes that name.
      The map name and projection fields hide once a map is picked and come back when
      "New map" is picked.
- [ ] 3b. Type a place in the Map search box and press Enter → results appear and the first is
      picked; with "New map" picked no map is made until you press Search (which then makes it
      at the first result). Press Enter again with the same text → nothing happens; with an empty
      box → nothing happens. The same goes for the Pins and Routes search boxes.
- [ ] 4. Label → Pins → the search field and result list already show the Map tab's search →
      **Pin here** → a red dot at the centre of the frame.
- [ ] 5. Keyframe the camera's zoom from ~16 to ~19 over 50 frames → the pin stays
      centred; change centerLon slightly → the pin moves.
- [ ] 5b. **World view**: with the map picked, search "Louvre" → no new map is made and the
      status says "Pick one, then Jump here or Fly here". Pick the result → **Jump here** →
      the camera moves there. Open the result dropdown → index 0 is "World view"; pick it →
      Jump here → the camera jumps to the world view. A search with no results makes no map.
- [ ] 5c. Preview: drag at world, country and city zoom (smooth), double-click and the + / −
      squares inside the map (bottom right) zoom, the "Zoom N.N" readout (bottom left) follows,
      hovering the map shows its tooltip, a result dot click picks it, resize the panel wider and narrower (preview follows both ways), Jump / Fly /
      Create map here land where the green frame showed.

## Layers tab

Street downloads use the camera's *current* view, so zoom in (roughly 15–18) before
adding street layers.

- [ ] 6. Create a world map ("New map", Equal Earth, search any place, then pick World view
      and Jump here) → Layers: Countries + Coastlines +
      Cities, Medium → three layers appear, the world roughly fills the frame,
      coastlines are strokes with no fill.
- [ ] 6b. Layer stacking: on that world map, cities draw on top of countries (not hidden
      underneath); on a street map with Buildings + Roads, roads draw on top of
      buildings.
- [ ] 6c. Credit text: on a street map with any OSM category added and the credit
      checkbox on, the "© OpenStreetMap contributors" text sits bottom-left and is
      fully inside the frame (not clipped or spilling off the edge), and is readable
      at its font size.
- [ ] 6d. Add a pin (Label → Pins → Pin here) on a map *before* adding any layers, then Add layers (e.g.
      Buildings + Roads) → the pin stays visible on top of the new base layers instead
      of being buried underneath.
- [ ] 6e. Find a courtyard building (an OSM building with an inner ring, e.g. a large
      block with a central courtyard) or a river/lake with an island → it renders with
      a visible hole, not as a solid filled blob.
- [ ] 7. In the map's Controls, drag Countries · Detail (or Cities · Detail) from 100 to 20 →
      small countries/cities disappear first; keyframe it → it animates.
- [ ] 7b. Countries show a thin white border between every neighbouring country;
      States / provinces add thinner, lighter lines only (no darker patches).
- [ ] 8. Set the camera projection to 2 (Orthographic) → a globe; animate centerLon → it
      spins, and the far side is hidden. Coastlines and rivers stop at the globe's edge
      (no thin ring running round the outline).
- [ ] 9. New map: pick "New map", Web Mercator, search "Notre-Dame, Paris", zoom the camera in to
      ~15–18, then Layers: Buildings + Roads + Water + Parks, Everything → street layers
      appear with the credit text; playback while animating zoom is smooth.
- [ ] 9b. On your normal network, add a street layer that isn't already cached → the
      download succeeds (the retry fix means an occasional flaky connection doesn't
      surface as an error).
- [ ] 10. Run the same Add again → it is near-instant (cache).
- [ ] 11. Zoom the camera out to a whole city and add Buildings with Everything → the
      large-area question appears; Cancel adds nothing.
- [ ] 11b. Zoom the camera out to a world or near-world view and try to add a street
      layer → it is refused immediately with a "too large for street data" message and
      a suggestion to zoom in to 14–18; no confirm dialog and no download attempt.
- [ ] 12. Disconnect the network (optional) and add an uncached street layer → an error
      in the status line, nothing added.

## Extract (Layers)

- [ ] 13. World map with Countries → Extract: pick the Countries layer, find "France",
      Extract → an orange France layer appears on top and stays aligned while the
      camera animates.
- [ ] 14. Paris street map with Roads → find "Rivoli" → one entry with "(N parts)" →
      Extract → the whole street as one line layer; enable Trim on its stroke and
      animate it → the street draws on.
- [ ] 15. Select the extracted France layer in the Scene Window → **Bake** → an
      editable "France (baked)" shape appears, matching the current frame; moving the
      camera no longer moves it.
- [ ] 16. Bake with a non-map layer selected → a clear error, nothing created.

## Label → Pins

- [ ] 16b. Search results come back in English (e.g. "Tokyo, Japan"), so layer names
      show correctly in Cavalry's timeline.
- [ ] 17. On the Paris map, under **Label → Pins** search "Eiffel Tower", pick the result,
      **Label here** → a text label appears at the tower (zoom the camera out to ~13 to
      see it) and stays there while the camera zooms and pans. **Pin here** puts a pin
      at the same place.
- [ ] 18. Enter Lat 48.8606, Lon 2.3376 → **Pin at coordinates** → a pin at the Louvre;
      **Label at coordinates** with text "Louvre" → the label sits on the pin.
- [ ] 19. On a globe (Orthographic) map, add a label (e.g. search "Tokyo") and spin the
      camera → the label follows, and disappears while Tokyo is on the far side.
- [ ] 19b. Select a camera or a label's "position" helper → its settings end at the last
      named one (no extra unnamed n5 / n7 setting).
- [ ] 19d. Date line: Map tab → "New map", Web Mercator, search "Taveuni, Fiji" (makes the map), set
      centerLon to 180 and zoom to ~13, Layers → Roads (Main) → roads appear on both
      sides of the frame's centre line (two downloads merged into one layer).
- [ ] 19c. Layers tab → **Clear download cache** → the status line reports how many
      files and how much space were freed; adding a street layer again re-downloads it.

## Label → Routes

- [ ] 22. World map (Web Mercator): Label → Routes → add Paris, Lyon and Marseille → Create route
      → a "Route 1: Paris → Lyon → Marseille" group with 3 green stop circles above 2 legs, each
      leg attached to its two stops.
- [ ] 22b. Select a stop circle, then Create route again → the new route's stops sit on their
      places and its legs stay attached.
- [ ] 23. Drag a stop in the viewer → its legs follow it. In the map's Controls, animate
      Route 1 · Travel % 0 → 100 → leg 1 draws on from Paris to Lyon, then leg 2 to Marseille.
- [ ] 24. Play a Fly here with the route in view → the stops ride along with the map and the curves
      keep their shape.
- [ ] 25. Drag a stop and play a Fly here → the dragged stop slides against the map (it is a fixed
      offset on screen). Select it, press **Pin here**, then play the Fly here again → it now
      stays on the spot of the map where you dropped it. A stop on the far side of a globe, or
      outside a flat map, says it is past the map's edge and keeps its place. With **Labels at
      stops** ticked, each label sits beside its circle and follows when you drag the stop. If a
      stop's place is keyframed, Pin here sets a key at the current frame.
- [ ] 25b. In Controls, change Route 1 · Arc height → every leg of the route changes.
- [ ] 25c. Select a leg's handle helper and change Lean, Flip side or shape by hand there → only
      that leg changes (those values live on the handle helpers). Open a map made by v0.6.0 with
      Lean / Flip side / shape by hand set in its Controls → Refresh controls: the rows are gone,
      the curves look the same and the values are on the handle helpers; one you had animated
      (keyed) stays on "<Map> control values" and still animates. Stops · Hide / Colour / Size
      change every circle.
- [ ] 25c2. On a new route every leg's Trim end is driven by its "Leg k draw" helper: to animate
      one leg by hand, disconnect its helper first, then key its Trim end → Refresh controls
      leaves that leg alone.
- [ ] 25d. Set the camera projection to 2 (globe) and rotate so a stop goes behind the Earth →
      the stop and its legs fade out.
- [ ] 26. Bake an old-style leg (a route from v0.5.0, or one made where Bézier lines aren't
      available) → an editable path with the same shape as the current frame (stroke style is
      not copied).
- [ ] 26a. Select a new route's leg (or a stop) and press **Bake** → "Route legs and stops are
      already Cavalry shapes, so there's nothing to bake." New legs are native Bézier lines that
      Bake skips; with a map layer selected as well, the layer bakes and the status says how many
      route parts were skipped.
- [ ] 26b. An old-style route made by v0.5.0 still draws, and its Controls rows (Travel %, Arc
      height, Colour, Width) work.
- [ ] 27. Create route with one stop → "Add at least 2 stops to make a route.", nothing created.
- [ ] 27b. Label → Routes: add 3 stops, select #2, **Remove selected** → list renumbers to
      1. A, 2. C; **Clear** empties it.
- [ ] 27c. Adding the same place twice in a row is refused (status: "That's already the
      last stop."), and the stop is not added again.
- [ ] 27d. Label → Routes: Traveller = Plane, add 2 or 3 stops, Create route → a plane sits at the
      destination. In Controls key Route 1 · Travel % 0 → 100 → the plane rides
      leg 1 then leg 2, facing forward.
- [ ] 27e. Select a text layer and a route part, Traveller = Selected layer, **Add to route** →
      the text rides the route. Traveller = None, **Add to route** → the route has no traveller
      and the text is back, visible. With nothing usable selected, Create route with Selected
      layer refuses ("Select the layer to send along the route first.") and makes no route.
- [ ] 27e2. Selected layer with a scaled-down layer (say scale 0.13) → the copy matches its size;
      rescale the original → the copy follows. Rotate the original → the copy's angle changes.
- [ ] 27f. In Controls, change Traveller size, Traveller hide and Traveller faces direction →
      every copy follows; Traveller colour changes a Plane, Arrow or Dot.

## Data tab

- [ ] 28. World map (Equal Earth). Data tab → paste the test sheet link → Load → "6 rows, 3 place(s)
      matched, 0 unmatched"; Place = Code, Value = Population, Year = Year.
- [ ] 29. Turn on Coloured regions + Legend → Add to map → France, Japan and Brazil coloured, every other
      country light grey; legend bottom-right with "Population", min and max.
- [ ] 30. Keyframe Data · Year (map's Controls) 2000 → 2020 → colours change smoothly; the legend
      doesn't change (auto range covers all years).
- [ ] 31. Change Population · Low colour / High colour in the Controls → the map and legend follow.
- [ ] 32. Add Bubbles and Value labels → circles sized by population at each country; labels like
      "67.6"; both animate with Year.
- [ ] 33. Edit a number in the Google Sheet → Refresh data → the map updates; your colours and Year
      keyframes are kept.
- [ ] 34. Add a row "World, OWID_WRL, 2020, 7800" to the sheet → Refresh → "1 unmatched" and "World"
      in the Unmatched list.
- [ ] 35. A private (not shared) sheet link → Load → the "Anyone with the link" message.
- [ ] 36. Regions off, Bubbles + Legend on → the bubble legend shows two reference circles with their values.
- [ ] 37. With data layers present, the Extract source list (Layers tab) doesn't offer them; Bake on a data layer gives "Data layers can't be baked yet." (or skips it).
- [ ] 38. A city list (e.g. "Location,Visitors" with Paris, Lyon) with "Look up unmatched names" ticked → bubbles at the cities; Refresh data keeps them.
- [ ] 39. A World Bank download (API_…csv from data.worldbank.org, hosted at a public link) → Load detects Country Code and the year columns.

## Imagery and Fly here

- [ ] 40. Web Mercator map of Europe → Imagery tab → EOX → Build imagery → one press opens a
      "Build imagery" question with the plan ("N images needed (M tiles' worth, …)", size, and any
      slower / limited-detail note) ending "Download and build now?"; the button still reads
      "Build imagery" → **No** → "Nothing downloaded.", nothing downloads → Build imagery again →
      **Yes** → progress bar runs through the download, then "Building imagery: n / N images…";
      Cavalry stays usable throughout (no "Not responding") → satellite imagery under the
      countries, coastlines lining up; no half-built imagery shows while it builds.
- [ ] 41. Search Paris → pick it → From: 0, To: 149 → Fly here → play: smooth zoom-out, travel, zoom-in. Build
      imagery from a world view with EOX → about 40–60 images, no "Sharpest detail is limited"
      note → Paris is sharp at the end of the flight; the build takes well under a minute. A
      flight needing more than 150 images (or 2000 tiles' worth) shows "Sharpest detail is
      limited to zoom Z to stay under 150 images — imagery gets softer as the flight zooms in
      further."
- [ ] 41b. Fly here with **To:** past the composition's end → a dialog "Extend the timeline" asks; **Yes**
      extends the composition, the layers reaching its end and the play range, and the flight plays
      to the end (nothing cut off); **No** changes nothing (no keys, composition unchanged). A
      **To:** not after **From:**, or a **From:** before the composition's first frame, is refused
      with a message.
- [ ] 41c. Fly to a place, then search another place and press Fly here again → the second flight
      starts where the first ended (the fields moved on: From: = the old **To:**).
- [ ] 42. Build imagery again → the question counts only the new images → Yes → only those download → the old imagery stays until the new
      one is built, then swaps at once and "Removing the old imagery…" shows → play: sharper levels
      fade in, no flashes or see-through frames; past zoom Z the top level just gets softer.
- [ ] 43. Rotate the camera 20° → imagery turns with the map.
- [ ] 44. NASA Blue Marble on a world view → whole-Earth imagery.
- [ ] 45. MapTiler with your key (if you have one) → the plan counts tiles (limit 300, warning
      above 150) → satellite, then `streets-v2`; a wrong key → "MapTiler rejected your key".
- [ ] 46. Switch the camera to the globe → imagery disappears; back to Web Mercator → it returns.
- [ ] 47. Cancel during a download → "Download cancelled. Files still downloading in the
      background are kept; nothing was built."; Build again finishes quickly. Pressing Build
      imagery while it downloads → "Imagery is already downloading — press Cancel to stop." Build again and
      Cancel during "Building imagery…" → the partial imagery is removed over a moment,
      "Cancelled — no imagery was built.", and the previous imagery is untouched.
- [ ] 47b. Once everything for the current camera is already downloaded (e.g. press Build imagery
      again right after a build), Build imagery → builds straight away with no question.
- [ ] 48. Add attribution → an "Imagery credit" line appears above the OSM credit; Clear download cache →
      built imagery still shows; Clear imagery tiles → asks for a second press (and refuses while
      downloading or building); confirm → tiles and downloaded images are removed and re-download on the next Build.

## Map controls

- [ ] C1. Make a new map (Search, or Create map here) → "Map Map controls" (the map's name plus " Map controls") sits just above the map
      group, not inside it, and is selected, so the Attribute Editor opens on it; its Controls tab
      lists Camera, Ocean, Countries and Coastlines settings with "Layer · setting" names. Add a
      pin → the selection stays where it was.
- [ ] C2. Change Countries · Fill colour and Countries · Detail there → the map updates.
- [ ] C3. Add two pins → one Pins · Colour changes both; disconnect one pin's colour on the pin,
      press Refresh controls → that pin stays separate.
- [ ] C3b. Open a scene saved before the Controls existed, with two pins where one was recoloured
      by hand → Refresh controls → the other pin follows Pins · Colour, the recoloured one keeps
      its colour (and stays separate on later refreshes).
- [ ] C4. Make a route → Route 1 · Travel % animates the whole route drawing on.
- [ ] C5. Add a data set → Data · Year changes regions, bubbles and labels together.
- [ ] C6. Promote any other setting onto the Controls layer yourself (also try a pin's Position),
      then add a layer → your settings are still there, at the end, with their names.
- [ ] C7. Save, reopen the scene, add a pin → no duplicate controls; the pin links to Pins · Colour.
- [ ] C8. Open a map made before this change (Controls inside the map group) → press Refresh
      controls → the Map controls layer moves out to just above the group, with its promotions intact.
- [ ] C9. Drag a Controls layer into another group, then add a pin → the layer stays there and
      still gets the new Pins settings; no second Controls layer appears.

## Controls split

- [ ] CS1. On a map with a base layer, a pin, a route, a data set and an extracted feature, press
      Refresh controls → four components sit in this order directly above the map group: Map controls,
      Overlay controls, Data controls, Extract controls, each with its own settings (camera and
      base layers in Controls; pins, routes and scale bar in Overlay; Data · Year in Data; the
      feature in Extract).
- [ ] CS2. A plain map (no pins, routes, data or extracts) has just its Map controls component.
- [ ] CS3. Open a scene saved before the split (every setting in one Controls), with one setting
      you promoted yourself, and press Refresh controls → the pin, route and data settings move to
      their new components; your own promoted setting stays in Map controls.
- [ ] CS4. Delete all the pins, routes and scale bar / north arrow, then Refresh controls →
      Overlay controls disappears (unless you promoted something onto it).
- [ ] CS5. Change a setting in each component (Overlay: Pins · Colour; Data: Data · Year; Extract:
      a feature's Hide) → the map follows.
- [ ] CS6. Open a scene whose main component is still called "Map Controls" → Refresh controls →
      it is renamed "Map Map controls" and the status line reads "Controls updated: N settings
      across Map Map controls, Overlay controls ..."; a main component you renamed yourself keeps
      its name.

## Map styles

- [ ] Style list shows Dark, Light, Blueprint, Vintage, Mono, Neon night; picking one recolours the preview (water, land, borders).
- [ ] New map (Search with New map, and Create map here) is made in the picked style; Countries and Coastlines match it.
- [ ] Apply to map on a full map (layers, pins, labels, a route with a traveller, a data map, the OSM credit): everything recolours; data colours and bubbles don't.
- [ ] Animate one colour, Apply another style: that colour stays and the status line says 1 was left alone.
- [ ] Add a pin and a route after applying: they match the style.
- [ ] Change colours in the Controls, Save as style "Mine", Apply "Mine" to a second map: same look. Reopen the panel: "Mine" is still listed and picked.
- [ ] Save "Mine" again: asked to replace; No keeps the old one. Delete style removes "Mine"; Delete on a built-in refuses.
- [ ] Imagery keys and source are still there after saving a style (and vice versa).

## Scale bar and north arrow

- [ ] Add scale bar and Add north arrow (Layers tab) each work once on a map; a second press says the map already has one.
- [ ] The bar's label changes as you zoom and is right (compare a known distance, e.g. two cities).
- [ ] Units 0 / 1 / 2 (metric, imperial, both) and Style 0 / 1 (line, segmented) all draw; try all four corners.
- [ ] Fly here from a street view out to the world view fades the bar out (below Hide below zoom).
- [ ] The north arrow turns with the camera Rotation and on the globe; Style 0 / 1 / 2 all draw.
- [ ] Apply style recolours both (they take the style's text colour).
- [ ] Resize the comp, then press any panel action: both move to the new corners.
- [ ] Bake with only the bar / arrow selected says they can't be baked; Extract's layer list doesn't show them.

## Simpler route controls

- [ ] Create two routes → they are named "Route 1: …" and "Route 2: …", and the Overlay controls show only Route n · Travel %, Arc height, Colour and Width for each (plus the traveller rows when it has one). No Lean, Flip side, per-leg draw on % or handle rows.
- [ ] Open a scene saved before this change → press Refresh controls: its routes are numbered oldest first (the bottom of the Scene Window = 1), a route still named "Route: …" is renamed "Route n: …", a name you gave it is kept, and every leg gets a "Leg k draw" helper. Duplicate a route group and press Refresh controls → the copy takes the next free number.
- [ ] Keyframe Route 1 · Travel % 0 → 100 on a 3-leg route → the legs draw on one after another; with a traveller, it rides all three legs.
- [ ] Hover a route row and a Data n row in the Controls → the notes tooltip shows the route's stops / the data set's name. Type your own note on a row, press Refresh controls → your note stays.
- [ ] In a scene saved before this change, a leg whose Trim end you keyframed by hand, connected, or set below 100 is left alone (no helper added, still animates / keeps its value).
- [ ] An old-style route (made where Bézier lines are not available, or by v0.5.0) gets the same four rows and a working Travel %.

## Previews

- [ ] Map, Pins and Routes previews show the picked map's pins, labels and routes (curved like the real legs) in the map's style colours.
- [ ] On a street map (roads, water, parks added), zoom the previews in: the streets show; dragging stays smooth (they hide while dragging and come back).
- [ ] Pins: a click fills Lat / Lon, shows a white ring and the place name; Pin at coordinates puts the pin there. Typed text is kept.
- [ ] Routes: clicking three places adds three named stops and a dashed draft route; Create route makes it; the previews then show it.
- [ ] Double-clicking on the Routes preview adds one stop and doesn't zoom; − / + still zoom; dragging moves without adding.
- [ ] Picking another map recentres the Label previews on its camera; Pin here on dragged stops moves them in the previews after switching tabs.

## Scene persistence and install

- [ ] 20. Save the scene, close Cavalry, reopen the `.cv` → maps still render and
      animate (the scenes are self-contained; no re-download needed to view them).
- [ ] 21. Uninstall check: rename `CavalryGeo.js` in the Cavalry Scripts folder (or
      delete it), reopen the saved scene → the maps in the scene still render, even
      though the script is gone.
- [ ] 22. Type a name in Extract's Find box and press Enter → matches appear; paste a sheet link
      and press Enter → it loads.

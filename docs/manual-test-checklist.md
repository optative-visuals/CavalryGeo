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
      included) show a hover highlight. Layers has an Add / Overlays / Extract switch and
      Label a Pins / Routes switch; each changes the page.
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

## Layers → Add

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

## Layers → Overlays: Day & night

- [ ] 19m. Layers → Overlays → Day & night: the day, month and UTC time boxes show today's date and the current time
      (UTC); **Time label** is ticked. Press **Add day & night** → a "Day & night" group with one "Night"
      layer (a rectangle with the Cavalry Geo Night filter) appears, the status line says "Day & night added to <map> for ... UTC. Key its Day of year and UTC time
      in <map> Time controls.", and the night side is shaded.
- [ ] 19n. Change the date and time, press **Add day & night** again → "Day & night updated to ...", no second
      group, and the shadow and Time label move.
- [ ] 19o. In Time controls, key **Day of year** and **UTC time** → the shadow sweeps across the map and the label
      follows. Try flat, Equal Earth and globe views, and a date near a solstice (the pole stays covered).
      Flat: with the camera over the Pacific (lon 170), land just past the date line (Alaska, Hawaii) is shaded
      when it is night there. Equal Earth: the shadow stays inside the oval and hugs its curved left and right
      edges, with nothing drawn outside it. Globe: the shadow's edge follows the rim of the globe; turn the camera
      to the sunlit side and no night shows; point it at the spot where it is midnight and nearly the whole
      disc is shaded, darkest in the middle. Set UTC time to 24 → the label reads 00:00 of the same date.
- [ ] 19o2. Day & night: the edge of the night is a soft gradient with no visible bands, at zoom 2 and at zoom 4.
      In Time controls set **Twilight** to 0 → a hard edge; set it back to 1 → soft again; 0.5 → a narrower band.
      (The curve itself is checked in NF3.)
- [ ] 19o3. Day & night: on the globe, zoom in so the soft edge of the night reaches the rim → the shading stops
      cleanly at the rim, with no dark halo outside the globe. On Equal Earth the same at the oval's edge. The Time label is
      not clipped, and the group holds no "Night mask" layer.
- [ ] 19p. Select a night layer or the Time label → **Bake** says "Day & night redraws from its time, so it can't be
      baked."; Extract's layer list does not show them.
- [ ] 19o4. Day & night (twilight on): no light ring just inside the globe's rim, the Equal Earth oval or the flat
      map edge on the night side.
- [ ] 19o5. Refresh controls on an overlay made by v0.9 (with the plugin installed) upgrades it to the Night layer
      (see NF8); the night reaches the rim with no ring.

- [ ] 19q. Day & night over satellite imagery (EOX, NASA, MapTiler satellite, Mapbox satellite): after Add day & night,
      Build imagery or Refresh controls (whichever is second), a "Night lights" group sits at the top of the Day & night
      group and the lights show only on the night side. The Time label and the Night layer still work.
- [ ] 19r. Night lights, flat: pan and zoom → the lights fade through the twilight with the terminator and do not show
      on the sunlit side. Zoom past 8 → the status line says NASA's data stops at zoom 8.
- [ ] 19s. Night lights, globe and Equal Earth: without the Cavalry Geo Reproject plugin, Build stops and asks for it;
      on a bent map without the plugin, Add day & night keeps its message and the status reads "Night lights didn't
      download: …needs the Cavalry Geo Reproject plugin…". With it installed, the lights bend to the rim and oval with
      no ring outside them. Flight across the date line (lon 170 to -170) → the lights stay continuous.
- [ ] 19t. Vector map (Mapbox streets, Natural Earth only) or a custom tile link: no Night lights group is added and
      the classic darkening stays.
- [ ] 19u. Time controls: **Night lights %** at 0 → the classic darkening only; at 50 → lights and darkening
      crossfade; at 100 → the night core shows only the lights. Set Twilight to 1 and check the edge at 100.
- [ ] 19v. Rebuild imagery after changing the camera animation → the Night lights are rebuilt to match the new imagery
      (already-downloaded night tiles are reused and not fetched again; the status line says nothing extra about it).
- [ ] 19w. Delete the day imagery, then press **Refresh controls** → the leftover Night lights group and its Night lights %
      row are removed silently (the status gives only the usual "Controls updated" message). Delete Day & night → the
      Night lights go with it.
- [ ] 19x. Night lights tile failure (for example, unplug the network mid-build): the status says "Night lights didn't
      download" with the retry hint. Delete the Night lights group, press **Refresh controls** → the tiles download again.
- [ ] 19y. Press **Cancel** during a night build → it stops like any imagery job; earlier imagery stays as it was.
- [ ] 19z. The imagery credit (Imagery → Add attribution) on a map with night lights names NASA Black Marble 2016.

## Day & night (Night filter)

Needs the Cavalry Geo plugin installed (drag the CavalryGeo_plugin folder in once). The first live compile of the
Night filter is checked here.

- [ ] NF1. Without the plugin (its CavalryGeo_plugin folder not installed), Layers → Overlays → **Add day & night** → nothing is
      built and the status line says "Day & night needs the Cavalry Geo plugin: drag the CavalryGeo_plugin folder from
      the download into the Cavalry window once, then press Add day & night again." Install the plugin, press
      **Add day & night** again → the "Day & night" group builds with one "Night" layer.
- [ ] NF2. The Night filter compiles: no shader error in the status line or the Cavalry window, and the Night layer
      shades the night side on flat, Equal Earth and globe. Live check 2: the terminator sits in the same place as the
      old 0° edge on all three projections, at several dates, rotations and zooms (compare with a v0.9 overlay at the
      same date and view if one is handy).
- [ ] NF3. Live check 2: the twilight curve feels right. With Twilight at 1 the edge darkens fast just past the terminator
      and reaches full Night opacity about 18° below the horizon, with no visible bands. Twilight 0 → hard edge; 0.5 →
      a narrower band. The slider moves in 0.01 steps. If the feel is wrong, change TAU in
      plugin/CavalryGeo_plugin/night.sksl and in src/core/night.js (both together), rebuild, and repeat this item.
- [ ] NF4. The shading stops cleanly at the Earth's edge: on the globe at the rim, on Equal Earth at the oval, and on the
      flat map at its top and bottom (zoom in so the soft edge reaches them). No dark halo outside. On the flat map the
      night continues past the date line (camera at lon 170).
- [ ] NF5. Live check 3: a 1080p comp with Day & night plays at about 25 fps (it was about 9 with the four-layer overlay).
      Note the fps with and without Day & night.
- [ ] NF6. Night colour and Night opacity rows change the Night layer's fill and the darkness. A map style recolours the
      Night layer's fill. Bake and Extract leave the overlay alone.
- [ ] NF7. Satellite map with night lights: the "Night lights" group sits at the top of the Day & night group and its
      matte is the one Night layer; the lights show only on the night side. Delete the Night layer, press **Refresh
      controls** → the night lights are removed (no matte). Press **Add day & night** → the Night layer comes back and
      the night lights rebuild from the cache.
- [ ] NF8. Live check 4: a v0.9 project with Day & night and night lights, opened with the plugin installed, press
      **Refresh controls** → the Day & night group holds one "Night" layer; the old four night layers, the blurs, the
      "Night blur" helper and the "Night mask" are gone; the date, time, Night colour, Night opacity and Twilight look
      the same (the new curve makes a small difference); the Time controls rows keep their values and keys; the night
      lights are matted by the Night layer. A second Refresh controls changes nothing. Keys put directly on an old night
      layer's own settings are not carried over (expected).
- [ ] NF9. The same v0.9 project without the plugin → Refresh controls leaves the old overlay and its night lights exactly
      as they were, and the status says "This Day & night was made by an older version of Cavalry Geo, so it is left as
      it is. Install the Cavalry Geo plugin (drag the CavalryGeo_plugin folder from the download into the Cavalry window
      once), then press Refresh controls to upgrade it." Its Time controls rows still drive it.
- [ ] NF10. Delete the Day & night group → the Night layer and the Night lights go with it, and no leftover layers
      remain. The time label sits outside the group and is not removed.

## Extract (Layers → Extract)

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

### Highlights

- [ ] 16h1. Find "France", select it, pick each Effect in turn (Fill in, Outline draw-on, Pulse, Glow) with Start at the playhead and press Highlight selected → France is extracted if needed and a "Highlight n: France" group appears; step through a few frames (before Start, mid, after the end) and each effect looks right. Start moves on to Start + Frames after each press.
- [ ] 16h2. Pulse: the ring follows the outline (including an irregular country) and keeps looping after Amount % reaches 100.
- [ ] 16h3. Glow: the halo is clearly visible on a light map, and the place itself stays crisp above it.
- [ ] 16h4. Amount % keys sit on the timeline at Start and Start + Frames; drag them and the effect re-times.
- [ ] 16h5. The map's Extract controls show Highlight n · Amount % and Colour (plus Width for Outline draw-on, Speed for Pulse, Size for Glow); hover a row → the note names the place. Changing each row changes the effect.
- [ ] 16h6. Highlight the same place twice → one extract, two highlights, numbered 1 and 2.
- [ ] 16h7. Delete the extracted place, press Refresh controls → its highlight group and rows are gone. Delete a highlight group on its own → no leftover oscillator, helper or blur layers.
- [ ] 16h8. Select a highlight's shape or group → Bake says "Highlights can't be baked."; Find's layer list doesn't offer highlights.
- [ ] 16h9. Make a Fill in highlight, change its Colour row, move its Amount % keys. Select the highlight's group (or its shape), pick Pulse and press Change effect → "Highlight n now uses Pulse."; same group, number and name, the same colour on the ring, and the Amount % keys at the same frames (now on the group). The Extract controls now have a Speed row for it. Pick Fill in and press Change effect again → back to a fill with the same colour and timing. Press it once more with Fill in still picked → "Highlight n already uses Fill in."
- [ ] 16h10. Change a highlight to Glow → its group moves just below the extracted place; change it back → above again. With nothing highlighted selected, Change effect says "Select a highlight in the Scene Window first."

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
- [ ] 19c. Layers → Add → **Clear download cache** (in the Streets panel) → the status line reports how many
      files and how much space were freed; adding a street layer again re-downloads it.
- [ ] 19e. Search "Eiffel Tower", pick the result, **Callout here** → a "Callout 1: Eiffel Tower" group:
      a boxed text label, a dot on the tower and a line joining them; the status asks you to drag the
      label and key Draw % in Overlay controls. **Callout at coordinates** with Lat 48.8606, Lon 2.3376
      and text "Louvre" → "Callout 2: Louvre".
- [ ] 19f. Drag the label to the left and right of the place → the line always leaves the point of the box
      nearest the place (**Anchor** 1, Auto). Switch **Callout 1 · Line style** between 1 (Elbow) and 0
      (Straight) → the line changes between a right-angled bend and a straight line.
- [ ] 19f2. Set **Callout 1 · Anchor** to 0 (Side) → the line leaves the middle of the side facing the place,
      as before. Try 2 to 9 → the line joins the top-left, top, top-right, right, bottom-right, bottom,
      bottom-left and left points of the box and stays there while you drag the label or move the camera;
      from 3 and 7 the Elbow bends straight up or down, from the others sideways. Draw % still draws the
      line on evenly. On a callout made before Anchor existed, **Refresh controls** adds the Anchor row at 0
      and the line looks unchanged.
- [ ] 19g. Key **Callout 1 · Draw %** from 0 to 100 → the line draws on from the label to the dot, evenly,
      in both styles.
- [ ] 19h. Zoom and pan the camera → the label stays where it is on screen while the dot and line follow
      the place. On a globe, spin the place to the far side → the line and dot fade out and come back.
- [ ] 19i. Edit the label text, then change its Background padding / corner radius on the text layer → the
      box follows the text and sits just below the label; **Hide box** hides it, **Box colour** recolours it.
- [ ] 19j. Pick a different style and **Apply to map** (Map tab → Style) → the callout's line, dot, text and box recolour.
- [ ] 19k. Select a callout's label, dot or line → **Bake** says "Callouts are already Cavalry layers, so
      there's nothing to bake."; selected with a map layer, the layer bakes and the callout parts are skipped.
- [ ] 19l. Select the Callout 1 group and press Ctrl+D, then **Refresh controls** → the copy is a "Callout 2: ..."
      group with its own "Callout 2 · ..." rows in Overlay controls; dragging the copy's label moves only the copy,
      and the copy's line and dot still follow its place when the camera moves.

## Label → Routes

- [ ] 21z. Globe (try Shape = Arc and Great circle), London → Tokyo, camera west of London (lon −30): the leg runs from London and
      stops exactly at the edge of the globe (no gap, no hairline across the disc); rotate the camera towards
      Tokyo → the visible part slides along the leg until the whole leg shows, then the London end is cut off
      at the edge; rotate to the far side → the leg is gone. Animate Travel % with a Plane traveller → it
      rides the visible part and disappears at the edge instead of travelling round the back. Flat and
      Equal Earth: legs look exactly as before. An older route: Refresh controls → it clips the same way, and a
      second refresh changes nothing (the draw-on keeps working).

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
- [ ] 25b2. Label → Routes: set Shape = Great circle, add London and Tokyo, Create route → on a
      flat map the leg bows toward the north pole; on the globe it hugs the surface. Raise Arc
      height → extra lift on top (picking Great circle set Arc height to 0; picking Arc again
      brings back 30). Add Tokyo and Los Angeles as a route on a flat map → the leg is a plain arc
      across the Pacific, not a streak the long way round; on the globe it follows the great
      circle. Very long legs may sit tens of pixels off the true path. In Controls, set Route 1 · Shape to 0 → it becomes the plain
      arc again. Reopen Cavalry → the Shape dropdown remembers Great circle. Refresh controls on
      an older map → its routes gain a Route n · Shape row.
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
- [ ] 37. With data layers present, the Extract source list (Layers → Extract) doesn't offer them; Bake on a data layer gives "Data layers can't be baked yet." (or skips it).
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
      extends the composition, the layers reaching its end and the play range to 3 seconds after
      the flight ends (the dialog and the status name that frame), and the flight plays to the end
      with room to spare (no snap back to the start); **No** changes nothing (no keys, composition unchanged). A
      **To:** not after **From:**, or a **From:** before the composition's first frame, is refused
      with a message.
- [ ] 41c. Fly to a place, then search another place and press Fly here again → the second flight
      starts where the first ended (the fields moved on: From: = the old **To:**).
- [ ] 41d. Fly here with Easing **Snappy** and Zoom-out **High** → play: a quick dash, a higher pull-back
      than the default. Close and reopen the panel → Easing and Zoom-out show the same choices.
      Easing **Overshoot** → the flight arrives slightly too close, then settles back to the place.
- [ ] 41e. Make a flight, put the playhead inside it, change Easing and Zoom-out, press **Update
      flight** → "Flight to … updated: …"; the flight keeps its frames and destination and plays with
      the new feel. With the playhead outside every flight → asks you to put it inside one.
- [ ] 41f. Pick **Pan left**, set From: and To: → **Drift** → "Drift (pan left) from frame … to …";
      the view slides gently left. Try Push in, Pull out, Pan right / up / down. From: and To: move on
      so a second Drift chains. Put the playhead inside a drift and press **Update flight** → "That's
      a drift …". A **To:** past the composition's end asks to extend, like Fly here (3 seconds of padding after the drift).
- [ ] 42. Build imagery again → the question counts only the new images → Yes → only those download → the old imagery stays until the new
      one is built, then swaps at once and "Removing the old imagery…" shows → play: sharper levels
      fade in, no flashes or see-through frames; past zoom Z the top level just gets softer.
- [ ] 43. Rotate the camera 20° → imagery turns with the map.
- [ ] 44. NASA Blue Marble on a world view → whole-Earth imagery.
- [ ] 45. MapTiler with your key (if you have one) → the plan counts tiles (limit 300, warning
      above 150) → satellite, then `streets-v2`; a wrong key → "MapTiler rejected your key".
- [ ] 46. Bent imagery, globe: with the Cavalry Geo Reproject plugin installed (drag `CavalryGeo_plugin`
      into Cavalry and confirm), a world flight on the globe → Build imagery → a group "Imagery: <source>"
      holding "Imagery source", and an "Imagery source: <source> · <map name>" composition in Assets →
      imagery wraps the globe, lining up with the borders; poles filled by stretching, no gaps.
- [ ] 46b. Same on Equal Earth → imagery fills the outline, lining up with the borders.
- [ ] 46c. Date line: a flight from longitude 170 to −170 (globe and Equal Earth) → Build imagery →
      imagery is continuous across the date line, no seam or gap.
- [ ] 46d. Without the plugin installed, Build imagery on the globe → stops with "Imagery on the globe and
      Equal Earth needs the Cavalry Geo Reproject plugin: drag the CavalryGeo_plugin folder…"; nothing
      is downloaded or built. A Web Mercator build still works with no plugin.
- [ ] 46e. Rebuild flat ↔ bent: build on Web Mercator, switch the map to the globe and build again → the
      flat group is replaced by the bent one; and back → the bent group and its composition are replaced.
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

- [ ] Add scale bar and Add north arrow (Layers → Overlays) each work once on a map; a second press says the map already has one.
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

## Start here box

- [ ] On a first open (no `showTips` in settings.json) the Map tab starts with a **Start here** box: four numbered steps and a line about the Map controls in the Scene Window, then a **Got it** button. Nothing in it is cut off (no `<` in any text).
- [ ] Press **Got it** → the box disappears. Close and reopen the panel → it stays hidden.
- [ ] **Got it** is a green button (like Search). The **Tips** button sits at the bottom of the Map tab only (nothing above the status line on the other tabs); press it → the box shows again. Close and reopen → it is still shown.
- [ ] Create map here with the name blank twice → "Map 1", then "Map 2" (and "Map 1 Map controls" in the Scene Window). Delete Map 1, press again → the new one is "Map 1". A typed name is used as typed; the name box hint reads "Map name (blank = the place's name, or Map 1, Map 2…)".
- [ ] Layers → Add: the Streets note reads "Downloads the area the camera shows. Add one street layer at a time; its box unticks once it's added." Tick Roads and Countries, press Add layers → Roads unticks, Countries stays ticked. If a street layer finds nothing, or you cancel, its box stays ticked.
- [ ] The Start here box ends with the line "Every map's settings are in "(map name) Map controls" in the Scene Window." in full. **Refresh controls** is on the Map tab, under the map and projection pickers (it is no longer on Layers); with a map picked it brings that map's Controls up to date.

## Panel layout and hover help

- [ ] Every tab shows its controls in shaded, rounded panels, each with a small grey heading. Map: the map pickers and Refresh controls, Search, Preview, Camera, Style. Layers → Add: World · Natural Earth, Streets · OpenStreetMap. Layers → Overlays: Day & night, Map furniture. Layers → Extract: Extract, Highlight, Bake. Label → Pins: Place, Preview, At coordinates; Label → Routes: Stops, Preview, Style. Imagery: Source, Keys and links, Build. Data: Sheet, Columns, Show, Unmatched rows.
- [ ] Layers has an **Add / Overlays / Extract** switch below the tab bar, Label a **Pins / Routes** switch. Clicking each shows its page and highlights its button. Extract selected, Highlight selected and Bake all work from the Extract page.
- [ ] **Clear download cache** is in the Streets panel (Layers → Add), and **Refresh controls** is on the Map tab; neither is anywhere else.
- [ ] With **New map** picked, the **Camera** panel is gone altogether (no empty box with only a heading); pick a map → it comes back with the Fly and Drift controls.
- [ ] Labels line up: in each panel the field labels (Detail, Day, Place, Shape, Source, MapTiler key and so on) share one left edge and their boxes line up.
- [ ] Hover help: rest the pointer on a button, a dropdown, a text box, a number box, a tick box, a category toggle (Roads) and a list (Stops) on each tab → a short tip appears for each. Tips are plain sentences with no stray symbols. Examples: Detail reads "Bundled detail works offline. High downloads 10–40 MB once."; Refresh controls reads "Brings this map's Controls (Map, Overlay, Data, Extract, Time) up to date, and upgrades layers made by older versions."
- [ ] The tab bars and the previews have no tip of their own (the previews keep their own hint).

## Previews

- [ ] Map, Pins and Routes previews show the picked map's pins, labels and routes (curved like the real legs) in the map's style colours.
- [ ] On a street map (roads, water, parks added), zoom the previews in: the streets show; dragging stays smooth (they hide while dragging and come back).
- [ ] Pins: a click fills Lat / Lon, shows a white ring and the place name; Pin at coordinates puts the pin there. Typed text is kept.
- [ ] Routes: clicking three places adds three named stops and a dashed draft route; Create route makes it; the previews then show it.
- [ ] Double-clicking on the Routes preview adds one stop and doesn't zoom; − / + still zoom; dragging moves without adding.
- [ ] On all three previews, press the scroll wheel and drag up: it zooms in around the press point; drag down: it zooms out. A middle click with no drag changes nothing and picks nothing; left-drag still pans; a quick double middle-click doesn't jump a zoom level.
- [ ] Moving the mouse over a preview with no button held changes nothing: no pan, no zoom, no flicker. Then middle-drag up and down: it really zooms (Cavalry only reports middle-button moves while hover events are on).
- [ ] Picking another map recentres the Label previews on its camera; Pin here on dragged stops moves them in the previews after switching tabs.

## Assets group, settings, redraw and comps

- [ ] Build imagery on a map: its images sit in one Assets group "Cavalry Geo imagery · <map name>". Rename the map and build again: a new group is made and the old one is left alone. Refresh controls gathers older loose assets into the group.
- [ ] Other actions (Add layers, Pin here and so on) feel no slower in a scene with many assets: only Refresh controls gathers imagery assets.
- [ ] Settings: after updating, keys and saved styles are still there; they live in Cavalry's app-data folder (CavalryGeo/settings.json), and an old settings.json in CavalryGeo_assets is left behind untouched.
- [ ] Press a panel button with a layer selected in the Scene Window: groups stay collapsed and the viewport redraws (no black viewport). Changing a dropdown or leaving a text box does not move the playhead or change the selection.
- [ ] Callout here: the new callout's label is selected, ready to drag.
- [ ] Following the comp: with maps in two compositions, switching comp changes the Map list, previews and Extract layers to that comp's maps ("Showing maps in <comp>."). During a bent imagery build the panel does not flicker between comps, and the build's result message is kept when it ends.

## Scene persistence and install

- [ ] 20. Save the scene, close Cavalry, reopen the `.cv` → maps still render and
      animate (the scenes are self-contained; no re-download needed to view them).
- [ ] 21. Uninstall check: rename `CavalryGeo.js` in the Cavalry Scripts folder (or
      delete it), reopen the saved scene → the maps in the scene still render, even
      though the script is gone.
- [ ] 22. Type a name in Extract's Find box and press Enter → matches appear; paste a sheet link
      and press Enter → it loads.

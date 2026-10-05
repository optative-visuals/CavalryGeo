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
- [ ] 4. Label → Pins → the search field and result list already show the Map tab's search →
      **Pin here** → a red dot at the centre of the frame.
- [ ] 5. Keyframe the camera's zoom from ~16 to ~19 over 50 frames → the pin stays
      centred; change centerLon slightly → the pin moves.
- [ ] 5b. **World view**: with the map picked, search "Louvre" → no new map is made and the
      status says "Pick one, then Jump here or Fly here". Pick the result → **Jump here** →
      the camera moves there. Open the result dropdown → index 0 is "World view"; pick it →
      Jump here → the camera jumps to the world view. A search with no results makes no map.
- [ ] 5c. Preview: drag at world, country and city zoom (smooth), double-click and + / −
      zoom, a result dot click picks it, resize the panel wider and narrower (preview follows both ways), Jump / Fly /
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
- [ ] 7. Drag a layer's **detail** from 100 to 20 → small countries/cities disappear
      first; keyframe it → it animates.
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

- [ ] 22. World map (Web Mercator): Label → Routes → add London and New York → Create route →
      a green arc bowing upward between them; turn on Trim and animate End 0 → 100 →
      it draws from London to New York; leg ends are round.
- [ ] 23. Keyframe the leg's **lift** 0 → 60 → the arc rises smoothly; the ends stay put.
- [ ] 24. Set the camera projection to 2 (globe) → the arc rises off the surface; spin the
      globe → it hides behind the globe, and a high arc peeks over the edge.
- [ ] 25. Journey: Paris, Lyon, Marseille with Pins at stops and Labels at stops
      ticked → a "Route: Paris → Lyon → Marseille" group with 2 legs, 3 pins, 3 labels;
      routes stay above map layers after Add layers.
- [ ] 26. Bake a leg → an editable path with the same shape as the current frame (stroke
      style is not copied).
- [ ] 27. Create route with one stop → "Add at least 2 stops to make a route.", nothing created.
- [ ] 27b. Label → Routes: add 3 stops, select #2, **Remove selected** → list renumbers to
      1. A, 2. C; **Clear** empties it.
- [ ] 27c. Adding the same place twice in a row is refused (status: "That's already the
      last stop."), and the stop is not added again.

## Data tab

- [ ] 28. World map (Equal Earth). Data tab → paste the test sheet link → Load → "6 rows, 3 place(s)
      matched, 0 unmatched"; Place = Code, Value = Population, Year = Year.
- [ ] 29. Turn on Coloured regions + Legend → Add to map → France, Japan and Brazil coloured, every other
      country light grey; legend bottom-right with "Population", min and max.
- [ ] 30. Keyframe the regions layer's Year 2000 → 2020 → colours change smoothly; the legend doesn't
      change (auto range covers all years).
- [ ] 31. Change the regions layer's low/high colours → the legend follows.
- [ ] 32. Add Bubbles and Value labels → circles sized by population at each country; labels like
      "67.6"; both animate with Year.
- [ ] 33. Edit a number in the Google Sheet → Refresh data → the map updates; your colours and Year
      keyframes are kept.
- [ ] 34. Add a row "World, OWID_WRL, 2020, 7800" to the sheet → Refresh → "1 unmatched" and "World"
      in the Unmatched list.
- [ ] 35. A private (not shared) sheet link → Load → the "Anyone with the link" message.
- [ ] 36. Regions off, Bubbles + Legend on → the bubble legend shows two reference circles with their values.
- [ ] 37. With data layers present, the Extract source list (bottom of Layers) doesn't offer them; Bake on a data layer gives "Data layers can't be baked yet." (or skips it).
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
- [ ] 41. Search Paris → pick it → Frames 150 → Fly here → play: smooth zoom-out, travel, zoom-in. Build
      imagery from a world view with EOX → about 40–60 images, no "Sharpest detail is limited"
      note → Paris is sharp at the end of the flight; the build takes well under a minute. A
      flight needing more than 150 images (or 2000 tiles' worth) shows "Sharpest detail is
      limited to zoom Z to stay under 150 images — imagery gets softer as the flight zooms in
      further."
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

- [ ] C1. Make a new map → "<map> Controls" sits at the top of the map group; its Controls tab
      lists Camera, Ocean, Countries and Coastlines settings with "Layer · setting" names.
- [ ] C2. Change Countries · Fill colour and Countries · Detail there → the map updates.
- [ ] C3. Add two pins → one Pins · Colour changes both; disconnect one pin's colour on the pin,
      press Refresh controls → that pin stays separate.
- [ ] C4. Make a route → Leg 1 draw on % animates the first leg drawing on.
- [ ] C5. Add a data set → Data · Year changes regions, bubbles and labels together.
- [ ] C6. Promote any other setting onto the Controls layer yourself, then add a layer → your
      setting is still there, at the end.
- [ ] C7. Save, reopen the scene, add a pin → no duplicate controls; the pin links to Pins · Colour.

## Scene persistence and install

- [ ] 20. Save the scene, close Cavalry, reopen the `.cv` → maps still render and
      animate (the scenes are self-contained; no re-download needed to view them).
- [ ] 21. Uninstall check: rename `CavalryGeo.js` in the Cavalry Scripts folder (or
      delete it), reopen the saved scene → the maps in the scene still render, even
      though the script is gone.

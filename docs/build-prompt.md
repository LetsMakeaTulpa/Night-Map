# Build prompt — Night Map

A single, self-contained prompt describing the whole Night Map build. Hand it to a coding
agent with an empty repository and the result should be the application this branch holds:
a mobile-first urban discovery and fieldwork map for a central San Francisco footprint that
never dresses a guess up as a fact.

---

## Role

You are building **Night Map**, a mobile-first progressive web app that helps someone find
public resources, public space, walking routes and civic context in a central San Francisco
footprint — at night, on a phone, with patchy connectivity. Work in the repository given to
you; build the real thing, not a mock.

## Product brief

Night Map combines:

- a detailed vector basemap with clustering and filters,
- sourced records for water, restrooms, meals, shelter, civic facilities, POPOS and
  hand-checked mail/phone/device access,
- Muni stops and walking routes,
- private, on-device field notes and location-locked messages,
- a parcel-level building registry, public-realm maintenance context and opt-in snapshots of
  reported activity,
- terrain, extruded buildings and a camera that can be tilted and turned,
- satellite imagery and street-level imagery,
- an installable shell that keeps the map, records and notes usable offline.

It is a **first slice**, not a citywide directory. The footprint is
`[-122.429, 37.7585, -122.3905, 37.7975]` (Downtown, SoMa, Tenderloin, Civic Center,
Chinatown, Financial District) and the interface says so throughout.

## Non-negotiable honesty rules

These decide more of the design than any framework choice:

1. **Every claim carries its source.** Prices, payment rules, ID/intake requirements and
   published limits store the page they came from and the date it was read. Where a provider
   publishes nothing, the line stays blank and the interface says *the source does not say*.
   Silence is never permission.
2. **No invented availability.** A POPOS or resource record is not "open now" unless its
   hours can be represented exactly. A split schedule with a midday closure stores no hours
   at all and refuses to answer "open now".
3. **Estimates are labelled.** Building heights from footprint type are marked as estimates,
   never as measured heights.
4. **Snapshots are not live feeds.** Dispatched calls and 311 requests are opt-in layers
   cached on first use; the age of the newest record is computed at read time and displayed.
   Police radio and CCTV panels state why they are empty and list the documents that were
   read instead of pretending to stream.
5. **A request is not a defect.** Public-realm 311 counts never become a safe/unsafe rating.
6. **Private data stays private.** Notes, saved places, routes and messages live in
   IndexedDB on the device; there is no publish action, no server delivery, no moderation.
   Never substitute a simulated or map-centre location for a device fix.
7. **Coverage is the visible aperture.** Whether records are "in view" is judged on the
   visible map aperture (including tilt and the area hidden behind the sheet, dock and
   controls), not on `map.getBounds()`. A map merely covered by UI is not "outside coverage",
   and "no records in this view" is a different state from "outside coverage".

## Stack and layout

- React 18 + TypeScript + Vite 5, MapLibre GL 4, `idb`, `zod`; no UI framework.
- Fonts bundled locally through `@fontsource` (IBM Plex Sans, Newsreader).
- Vitest for unit tests (`src/**/*.test.ts`), Playwright for end-to-end tests on `desktop`
  and `mobile` projects (`tests/e2e/*.spec.ts`).
- Vanilla CSS in `src/styles/base.css` with tokens; responsive rules appended in one
  dedicated section rather than scattered.

```
src/
  data/         committed snapshots + typed loaders and validation tests
  domain/       pure rules: hours, status, verification, cost/friction, presets, types
  features/     UI by workspace: map chrome, discovery, layers, library, notes, review, atlas,
                messages, incidents, maintenance, CCTV/radio panels, street level
  map/          MapLibre style, layers, MapView, coverage aperture, buildings, terrain, icons
  services/     routing (OSRM), geocoding, GPS, storage, weather-free externals
  state/        store, layer views, persist/restore (IndexedDB), camera restore requests
  styles/       base.css and map chrome
scripts/        data builders: basemap, terrain, buildings, registry, incidents, sfgov, access
tests/e2e/      Playwright specs, desktop + mobile
public/         generated tiles: terrain, buildings, incidents, road tiles, icons, manifest
```

## Data pipeline

Commit the normalised output, not the raw downloads. Each builder caches its source response
in `scripts/.cache` so re-runs after rule changes need no network.

- `npm run data:basemap` — OpenStreetMap geometry → `src/data/basemap/*`.
- `npm run data:terrain` — public-domain AWS elevation tiles → `public/terrain/*`
  (35 tiles, ~3.2 MB, ~7 m per pixel).
- `npm run data:buildings` — Overpass footprints → `public/buildings/*` (6 tiles at z14,
  ~8 MB) with height rules: tagged height, storey count, else footprint-type estimate.
- `npm run data:building-registry` — DBI complaints (`gm2e-bten`), permits (`i98e-djp9`) and
  notices of violation (`nbtm-fbw5`) joined on City block/lot → `public/buildings/registry.json`.
  Complaints carry no coordinates, which is why the join is on the parcel: 2,043 of 3,847
  dossiers stay searchable but unplotted, 64 are placed at a labelled block centroid.
- `npm run data:incidents` — DataSF dispatched calls + 311 cases with privacy filters,
  40 m coordinate snapping and footprint validation → `public/incidents/*`.
- `npm run data:sfgov` / `data:sfgov -- --refresh` — SODA rows (including the official POPOS
  inventory) → cache.
- `npm run data:build` — normalise, validate, write places/resources/sources; POPOS import
  keeps City-published coordinates, free-text hours, entrance notes and amenities, and marks
  availability unknown until field-verified.
- `npm run data:access` — geocode hand-checked access records through Nominatim and write
  `src/data/access.json` **with the query and matched OSM object** beside each coordinate.
  Refuse records outside the footprint, sources absent from the registry, or friction lines
  that are not individually attributed. Reuse existing coordinates unless `--refresh`.
- `npm run data:validate:incidents` — enforce the privacy/geometry boundary on snapshots.

GitHub Actions refresh the dispatched-call and 311 snapshots daily (17:30 UTC) and commit
only changed files; the app shows generation time and newest-record age.

## Feature specification

**Map.** Vector basemap with clustered records, category and condition filters, legend,
layer presets (Essentials, Resources, Transit, My fieldnotes, History, Reported activity,
Scenes & hideaways), saved views, minimap, map legend strip, zoom, GPS and layers controls.
Presets are chips with live counts of what is in view, and an empty preset offers
"Fit to N matches" rather than a dead end.

**Camera.** MapLibre camera with pitch up to 78°. Tilt up / Tilt down buttons step exactly 10°
per press (a single `TILT_STEP` constant drives buttons and tooltips), rapid presses each
advance a full step, the 3D toggle enables terrain and buildings at 55°, the compass returns
north, and a "Flat & north" chip resets pitch and bearing together. A goal in flight is eased
and hard-cancelled by `dragstart`, so a gesture never fights a timer. Building extrusion
collapses to flat footprints in plan view.

**Coverage aperture.** Build the visible aperture as a polygon from the map corners, then
subtract the sheet, dock, control column and toplines; fall back to a horizon-aware
`getBounds()` at extreme pitch where the quad flips. Use it for counts, empty states and the
boundary hint. At high pitch, if the horizon shows beyond the data footprint, show a
`coverage-tilt-hint` card ("tilt back down to see the covered area") instead of an
"outside coverage" message, and suppress the edge chip while it is shown.

**Tool budget.** Above 50° of pitch, swap terrain and hillshade to z13 "coarse" sources and a
`hillshade-coarse` layer; MapLibre has no per-layer tile cap, so the source swap is the lever.
Never present the coarse sample as full detail — the drawer and README say shading drops to a
14 m sample past 50° of tilt.

**Discovery.** Nearby list with walking distance, filters, alternatives and a source/age chip
on every row; quick-view chips with emoji; place inspector with access, hours, evidence,
sources, observation history and explicit "Not confirmed" / "Open now not confirmed" states;
in-view counts computed from the aperture, and a status row that stays separate from the
coverage notice.

**Routing.** FOSSGIS OSRM demo with multiple stops, reordering, saved routes and an honest
failure state (straight-line distance only). Any plotted feature — incident, landmark, stop —
can be handed to the planner as a stop.

**Field notes and messages.** Private notes with optional photo, drafts, edit/delete, local
IndexedDB storage, no publish action. Messages compose only in the Messages workspace from a
fresh high-accuracy fix (≤15 s old, ±30 m); text and photos are readable, editable or
deletable only within 30 m of where they were left; the map shows locked/nearby state only,
never message text, and an open message relocks when its fix expires.

**GPS.** Turning on GPS lock starts a device watch and follows each fresh fix until the map is
dragged or the lock stops. First follow moves to street zoom; later fixes preserve zoom. The
crosshair stays a one-time realign action.

**Registry and civic layers.** Buildings is a parcelless pin-free registry workspace: table,
search across unplotted dossiers, chronology, counts, a score that lists its inputs, and a
thumbnail row per dossier. Maintenance context filters sanitized 311 categories to coarse
areas and counts. Reported activity plots opt-in dispatched calls (closed within 48 h) and 311
requests with a slow pulse, age chip and information card.

**Saved views.** A view stores layers, filters, pitch and bearing (`CameraPose`) plus map
position. Saving strips the camera into a store request (`cameraRestore`) that the map applies
once on `moveend`, so restore cannot feed back into saving. Titles and tooltips name what the
view restores.

**Imagery.** Satellite (Esri World Imagery) is an independent toggle beneath labels, markers
and routes. Street level is a Mapillary viewer that takes a user-supplied token at runtime,
holds it in component memory only, and never commits or persists it.

**PWA.** Precached shell and bundled records; saved places and notes work offline. Routing,
geocoding and live tiles need a network. Terrain and building tiles are cached on first use,
not installed up front. A missing glyph range must return 404, never the SPA fallback HTML
(the PBF parser would throw and block map load).

## Responsive rules

- Map chrome yields before buttons shrink: hide the minimap below 720 px of desktop height,
  compact the rail below 680 px, and use a two-row control cluster on short phones.
- No touch target below 36 px anywhere, including the tilt pair. The short-phone cluster is
  six 36 px buttons plus 3 px gaps (231 px wide) and clears the attribution line.
- Count chips hide where they would run under the overview map; the cluster starts below the
  minimap when one is present.
- Phone bar exposes the core array; notes and review queue stay in header buttons beside
  search; Map, Library and Review stay in the desktop workspace tabs.
- Focus is managed on workspace switches (Details focus, dialog traps, sheet handle keyboard).

## Testing and verification

- `npm test` — unit tests for hours, status, verification, cost/friction and disclosure rules,
  terrain and building rules, registry rules, routing, selectors, presence/messages, data,
  aperture coverage and camera poses.
- `npx playwright test` — desktop + mobile specs for map chrome, camera/3D, coverage, quick
  views, saved views, incidents, mobile field use, offline shell and verification flows.
- Assert touch behaviour where it matters: `touch-action: manipulation` on controls, a drag
  cancelling a pending tilt, 10° steps and the 78° clamp, and the reset chip landing flat
  and north.
- Measure layout instead of eyeballing it: bounding boxes for touch targets, control cluster
  versus attribution, minimap footprints.
- The offline spec runs against a real service worker and is skipped unless a production URL
  is supplied: build, `npm run preview`, then point `BASE_URL` at it.
- Typecheck before declaring done (`npm run typecheck`), and report checks that were not run.

## Acceptance criteria

1. `npm ci && npm run dev` serves the app; `npm run build` typechecks, bundles and writes
   `dist/sw.js`.
2. Every record, price, limit and count in the UI is traceable to a committed source entry,
   and unsourced fields read as unknown rather than plausible.
3. Tilt steps are 10°, clamped at 78°, surviving rapid presses; compass and "Flat & north"
   land at bearing 0 / pitch 0; a drag during a pending step wins.
4. In-view counts, empty states and coverage notices agree with the visible aperture at any
   pitch, including the tilt-beyond-boundary hint.
5. Saved views restore layers and camera once, with no save/restore loop.
6. On a 360×640 phone: every control is at least 36×36, the control cluster clears the
   attribution, the sheet is reachable, and nothing is clipped without a visible affordance.
7. Offline shell serves the map, records and notes; routing, imagery and street level fail
   with honest messages, not silent blanks.
8. No secrets in the repository, no user data leaving the device, and no fake live feed.

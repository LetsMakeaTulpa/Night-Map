# Night Map roadmap

Status of the central-San Francisco vertical slice, grouped by outcome. **Done**
means implemented and verified in this working tree; it does not mean the current
build has been deployed. Last reviewed **2026-11-17**.

Sources: the project requirements, the working tree, and
[the README](README.md#known-limitations).

## Done

- [x] **Grounded public records.** 176 places and 177 resources in the core
  footprint, plus 605 Muni stops. Prices, payment rules, ID and intake
  requirements carry the page and date they came from.
- [x] **Building registry.** 3,847 parcel dossiers joined from DBI complaints,
  permits and notices of violation. 1,804 have a City-published point; 2,043 stay
  searchable in the table and are deliberately not plotted. Classifications
  describe records, never occupancy.
- [x] **Nocturnal basemap, terrain and 3D.** Dark vector basemap with a very dark
  blue ocean, 35 elevation tiles, and 13,975 extruded footprints. Terrain is drawn
  at true vertical scale (×1, no exaggeration), and the estimated-height split is
  stated in the UI.
- [x] **Desktop and mobile shells.** Full-bleed map, left side rail, floating
  workspace and inspector cards, edge-attached flyouts, bottom menu bar, and a
  draggable mobile bottom sheet. The desktop breakpoint is 960 px.
- [x] **Layers, Settings and Targets as anchored popovers.** Targets includes
  places, stops, dossiers, calls, 311 records, notes and saved items, with counts
  and visibility toggles.
- [x] **Overview minimap.** Citywide geometry with a viewport rectangle,
  click-to-recenter, and a toggle.
- [x] **Nearby survey.** 14-day check freshness, per-place progress, “Check here”,
  and undo, backed by pure helpers and tests.
- [x] **Mapillary street panel.** Nearest-first imagery within 50 m, date,
  distance and heading, panorama embed, attribution, and token setup.
- [x] **Dispatched calls at runtime.** The City CAD feed is queried while the
  layer is open, refreshed every two minutes, filtered for sensitive and
  person-level categories, and snapped to about 40 m.
- [x] **311 snapshot.** Nightly City data, plotted only on request and labelled
  with its computed age rather than presented as live.
- [x] **Privacy-first local state.** No accounts, analytics or tracking pixels.
  Field notes, private messages, saved places, reports, review decisions and
  corrections stay in IndexedDB; photos are re-encoded to strip metadata.
- [x] **Private, location-locked messages.** Compose only in Messages, never from
  the map. A fresh fix (≤15 s old, ±30 m accuracy) is required to write; reading,
  editing and deleting require the same fresh fix within 30 m of the anchor. Map
  markers expose only locked/nearby state, open message text relocks when the fix
  expires, and there is no field-note edit path. Messages are self-addressed notes
  on this device; there is no server delivery, sharing or moderation.
- [x] **Live GPS lock.** Turning on GPS lock starts a device watch and follows
  each fresh fix until the map is dragged or the lock is stopped. The first follow
  moves to street zoom; later fixes preserve zoom. The crosshair remains a
  one-time realign action, and stale cached fixes cannot unlock messages.
- [x] **Correction and review workflow.** Local reports are structure-checked,
  deduplicated, given a status, resolved in the Review queue, and logged.
- [x] **Library.** Private collections of places, routes and notes, with a
  plain-language privacy and limits tab.
- [x] **Routing, search and offline shell.** Walking routes with failure fallback,
  explicit-request address lookup, saved views, and a precached PWA shell.
- [x] **Nightly data pipeline.** `npm run data:refresh` refreshes SF open data,
  rebuilds the bundled dataset, and updates incident snapshots. The scheduled
  workflow runs the light path nightly and the full path, including the building
  registry, on Sundays.
- [x] **Service-worker freshness.** Versioned shell cache, network-first incident
  snapshots, stale-while-revalidate registry, and a stable tile cache.
- [x] **Responsive corrections.** The 992 px viewport now gets the desktop shell,
  the minimap fills its frame and shows the whole city, and the mobile sheet has
  contained scrolling instead of covering the map.
- [x] **Verification.** Typecheck, 165 unit tests across 26 files, and the
  production build pass in the working tree. The Playwright suite contains 47
  tests across 7 specs (desktop, mobile, coverage, 3D, incidents, offline and
  verification).

## Partial

- [ ] **Automatic publishing is not live yet.** The Cloudflare Pages deploy step
  exists, but the Pages project and repository secrets have not been configured,
  and the workflow has not been run. Until then it uploads an artifact only.
- [ ] **Weekly registry carry-over is unexercised.** The Sunday job seeds the
  Actions cache and the nightly job restores it, with a cold-cache rebuild
  fallback. This has not run end to end.
- [ ] **Mapillary is not configured.** The panel and client are implemented, but
  no `VITE_MAPILLARY_TOKEN` is set, so imagery has not been verified against the
  live API.
- [ ] **Registry coverage is incomplete by source.** 2,043 of 3,847 dossiers have
  no City-published point; the window starts in 2022; only three rows of each kind
  travel with a dossier. The full sets remain in the City datasets.
- [ ] **Reported activity is delayed.** Dispatched calls are closed-only and about
  ten minutes behind; 311 is a nightly snapshot. Neither is a live incident feed.
- [ ] **Coverage is a central slice.** Downtown, SoMa, Tenderloin, Civic Center,
  Chinatown and the Financial District only; some categories intentionally show
  zero rather than filler.
- [ ] **No backend or multi-device sync.** Reports, review decisions and
  corrections are per-device and cannot update the bundled dataset or be reviewed
  by anyone else.
- [ ] **Initial bundle is large.** MapLibre and the dataset ship as one ~3.6 MB
  chunk for offline use, cached after first load.
- [ ] **Mobile sheet interaction needs a pass.** The collapsed sheet and scrolling
  are now contained, but drag/peek/full-height transitions have not been
  re-verified after the layout change.
- [ ] **Minimap detail is sparse.** It shows land, green space, water, coastline
  and the viewport, but no road network, which makes orientation harder at a
  glance.

## Refused

These are deliberate exclusions, not backlog items.

- **Live 911 audio, live CCTV and live police radio.** SFPD radio has been
  encrypted since 2021, the City publishes no live incident audio, and there is no
  lawful public live camera feed.
- **A camera, kiosk or plate-reader map layer.** San Francisco publishes no
  register of camera positions, and inferred dots would be surveillance. The feed
  status panels link the official documents instead.
- **Encampment locations.** The 311 log carries over a thousand encampment cases a
  fortnight; mapping where unhoused people sleep would turn a navigation tool into
  a targeting tool.
- **Person-level or sensitive incident records.** Categories describing a person's
  situation are filtered at build time and again at runtime; addresses and free
  text are discarded.
- **A confirmed vacant or abandoned-building register.** No such City dataset
  exists. `Buildings` derives dossiers from DBI records and never labels a
  building “confirmed vacant.”
- **Live food-truck locations.** The City publishes permits and a PDF schedule, not
  a live truck feed.
- **Live injection-supply stock or availability.** No structured live feed exists;
  published schedules and service descriptions are the limit.
- **Safety, crime or lighting route scores.** The app never labels a street or
  route as “safe” and does not score routes by crime or lighting.
- **Server-side messaging or geocaches.** There is no server, so a note for
  another person could not be delivered, verified or moderated. Private messages
  are self-addressed, location-locked notes on this device, not a messaging service.
- **Publishing or sharing notes and messages.** Both are private by default and
  there is no publish action.
- **Recology e-waste and LifeLine enrolment as map markers.** The e-waste site is
  outside this release's footprint, and no verifiable walk-in LifeLine address is
  published; the app says so instead of guessing.

## Next

- [ ] **Finish the Pages setup.** Create the Direct Upload project, add
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then run the workflow
  manually and confirm the production URL serves the new build.
- [ ] **Exercise the weekly-to-nightly registry cache.** Run a full refresh, then a
  light one, and verify the nightly deployment still serves `registry.json`
  without rebuilding it.
- [ ] **Add a data freshness guard.** Fail or warn when the 311 snapshot is more
  than 24 hours old, and put the registry build time and cache result in the
  workflow summary.
- [ ] **Configure and verify Mapillary.** Add the client token, confirm the 50 m
  query and panorama embed against real coverage, and document the key setup.
- [ ] **Add roads and water detail to the minimap.** Use the existing basemap
  geometry so the overview reads as a city, not just parks and a viewport box.
- [ ] **Verify the mobile sheet states.** Check collapsed, peek and expanded
  heights, drag gestures, and keyboard behavior at 390 px and 768 px.
- [ ] **Reduce the initial bundle.** Evaluate deferring MapLibre or splitting the
  dataset while preserving the offline shell and measured first-load behavior.
- [ ] **Decide the backend question.** Shared reports, reviewer accounts and
  multi-device sync need an explicit scope and moderation model before any
  implementation; do not add a server implicitly.

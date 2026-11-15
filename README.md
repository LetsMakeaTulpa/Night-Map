# Night Map

A mobile-first urban discovery and fieldwork map for San Francisco. Night Map
combines a detailed vector basemap, sourced public-resource records, public-space
discovery, walking routes, private field notes, and civic context.

This is a **first slice**, not a citywide directory. It covers a central footprint
(Downtown, SoMa, Tenderloin, Civic Center, Chinatown, Financial District) and says
so throughout the interface.

## Run locally

Requires Node 20+ and npm.

```bash
npm ci
npm run dev          # http://localhost:3000
```

Production build and local preview:

```bash
npm run build        # typecheck, bundle, generate dist/sw.js
npm run preview      # serves the built PWA (default port 3000)
```

`npm run dev` does not register the service worker; use the production preview to
exercise offline behavior.

### Tests

```bash
npm test             # 89 unit tests (hours, status, verification, cost/friction and disclosure rules, terrain/building and incident rules, routing, selectors, data)
npx playwright install chromium
npx playwright test  # acceptance A–K (desktop + mobile)
```

Scenario F (offline) runs against a real service worker and is skipped unless a
production URL is supplied:

```bash
npm run build
npm run preview -- --port 4173
BASE_URL=http://localhost:4173 npx playwright test tests/e2e/offline.spec.ts
```

## Data refresh

The committed GeoJSON/JSON in `src/data` is a snapshot. The scripts rebuild it:

```bash
npm run data:basemap   # OpenStreetMap geometry → src/data/basemap/*
npm run data:terrain   # public-domain elevation tiles → public/terrain/* (35 tiles, ~3.2 MB)
npm run data:buildings # OpenStreetMap footprints → public/buildings/* (6 tiles at z14, ~3.2 MB)
npm run data:incidents # DataSF dispatched calls + 311 cases → public/incidents/* (snapshots)
npm run data:sfgov     # DataSF SODA rows → scripts/.cache/*
npm run data:sfgov -- --refresh # bypass cached API responses and fetch fresh City data
npm run data:build     # normalise, validate and write places/resources/sources
npm run data:access    # geocode the hand-checked access records → src/data/access.json
npm run data:validate:incidents # validate the civic snapshot privacy/geometry boundary
```

The published dispatched-call and 311 snapshots are refreshed by GitHub Actions
once daily at 17:30 UTC after this workflow is merged into the default branch.
It reruns the source query with the privacy filters, validates the output fields,
40 m coordinate snapping and footprint, then commits only changed snapshot files.
You can also run the workflow manually from the Actions tab. The app displays the
snapshot generation time and newest-record age; a refresh does not make either feed live.

`data:access` is separate from `data:build` on purpose. It reads
`scripts/inputs/access-records.json` — the mail, phone, device and printing facts
taken from provider pages, each one naming the page it came from — geocodes every
address through Nominatim, and writes `src/data/access.json` **with the query and
the OSM object that matched** beside each coordinate. The script refuses to write
a record that falls outside the footprint in `meta.json`, that cites a source id
which is not in the registry, or whose friction lines are not individually
attributed, and it will not place a marker by hand. Coordinates already in
`access.json` are reused unless you pass `--refresh`.

`data:build` uses the cached City rows (including the official POPOS inventory)
plus hand-checked provider facts in `scripts/build-dataset.mjs`. The POPOS import
uses City-published coordinates, retains each record's free-text hours, entrance
notes and amenities, and marks availability unknown until field-verified. Run
`npm run data:sfgov -- --refresh` followed by `npm run data:build` to fetch and
install newer City data. Do not present inventory records as live availability.

`data:terrain` and `data:buildings` are independent of the others: the first copies
elevation tiles verbatim from AWS Open Data, the second pulls building ways from
Overpass and applies the height rules in `scripts/lib/building-geometry.mjs`. Both
cache their source responses in `scripts/.cache`, so a re-run after editing the
simplification or the height rules needs no network.

## What is in the release

- **172 places / 102 resources** in the core footprint: 57 water points, 30 public
  restrooms, 3 meal providers, 2 service centers, 1 shelter, 1 civic facility, and
  five hand-checked access records across three medical services, two mail and
  phone services and two device-and-printing records; plus **605 Muni stops** and
  **72 historic features**.
- **Cost and friction, quoted rather than inferred.** Every price, payment rule, ID or
  intake requirement and published limit carries the page it came from and the date that
  page was read — **23 friction lines** across the access records. Where a provider
  publishes nothing, the line stays blank and the interface says *the source does not
  say*, because silence is not permission. A record whose hours cannot be represented
  honestly (a split schedule with a midday closure) stores no hours at all and will not
  answer "open now".
- **Mail, phone and device access as first-class categories** (`Mail & phone`,
  `Devices`), each a sourced record: mail receiving for people without a secure
  address, laptop lending for in-library use, and the rates a library charges to print.
- **Atlas → Disclosures.** Nine official City documents on what it collects, each listed
  with what it says *and* what it does not say. See "No surveillance layer" below.
- **Two feed tabs that tell the truth.** The phone menu ends with **CCTV** and **Radio**. They are
  status panels, not players: San Francisco publishes no live public camera feed and no register
  of camera positions, and police radio has been encrypted since 2021. Each panel says why it is
  empty, lists the documents that were read, and offers the published snapshots it *can* honestly
  plot. The **Map**, **Notes** and **Review** entries were removed from the phone bar at the owner's
  request: notes and the review queue stay reachable from the header buttons beside search, and all
  three remain in the desktop workspace tabs.
- Map with clustering, category/condition filters, a legend, saved views, and
  layer presets (Essentials, Resources, Transit, My fieldnotes, History, Reported activity, Scenes & hideaways).
- Place inspector with access, hours, evidence, sources, observation history and
  explicit "Not confirmed"/"Open now not confirmed" states.
- Nearby list with walking distance, filters, alternatives, and a source/age chip
  on every row.
- Walking routes from the FOSSGIS OSRM demo, with multiple stops, reordering,
  saved routes, and an honest failure state (straight-line distance only).
- Private field notes with optional photo, drafts, edit/delete, and local-only
  storage in IndexedDB. No publish action exists in this release.
- A report and review workflow: reports are structure-checked and screened for
  duplicates, get a visible status, are resolved in the Review queue, and every
  decision is appended to a change log. Corrections are local overrides and never
  overwrite a source value.
- Atlas workspace with three source-backed neighbourhood guides and a history
  layer that stays visually subordinate to navigation.
- **Terrain and a 3D view.** Relief shading and terrain displacement from a public-domain
  elevation model (35 tiles at about 7 m per pixel), rendered at true vertical scale (×1),
  and **13,975 extruded OpenStreetMap building footprints**. 9,996 carry a height tag,
  812 give storey counts, and 3,167 are estimates from footprint type; estimates are stated
  explicitly rather than presented as measured heights.
- **A camera that is not stuck overhead.** Two-finger drag or control-drag tilts and turns
  the map (up to 78°); the 3D control enables terrain and buildings, and the compass returns
  to north. Building extrusion collapses to a flat footprint in plan view.
- **Satellite imagery, independently switchable.** Esri World Imagery sits beneath Night
  Map's road labels, markers and routes. Aerial capture dates and resolution vary by
  location; the imagery layer requires a network connection.
- **Street-level imagery.** A Mapillary viewer searches for a nearby public image around the
  map centre. The user supplies their own access token at runtime; it remains in component
  memory only and is never committed or saved by Night Map. Coverage is community-contributed,
  incomplete and variable by capture date.
- **Public-realm maintenance context, not a risk score.** A separate map layer and coarse-area count filter the sanitized 311 snapshot for exact City service categories covering streetlights, street/sidewalk cleaning, public graffiti, litter receptacles, street defects and blocked public ways. A request is not proof of an outage, ongoing defect, danger or neglect; counts never become a safe/unsafe rating.
- **Reported activity, as snapshots and never as a live feed.** Two real City datasets are
  plotted on demand: 525 dispatched calls that had closed within 48 hours, and 2,358 recent
  311 requests. Both are opt-in layers, both are cached on first use rather than installed,
  and the age of the newest record is computed at read time (`newest 9 h ago`) so a stale
  snapshot cannot present itself as current. Dispatched calls pulse slowly behind their dot
  and open an information card; any plotted feature — incident, landmark or stop — can be
  handed to the route planner as a stop.
- Installable PWA with a precached shell, bundled records, and offline saved
  places/notes. Routing, address lookup, and live tiles require a network. Terrain
  and building tiles are deliberately *not* installed up front: each one is cached
  the first time it is fetched, so the first 3D view costs about 1.4 MB of terrain
  plus 0.4–0.7 MB per building tile on the current view.

## Correction and verification workflow

Reporting is a pipeline, not a dead-end form:

1. **Received.** A report from a record (`Report` in the inspector) is stored with a
   stable id, a received timestamp and an on-device channel marker.
2. **Structure checked.** `validateReport` requires a record that exists, a defined
   issue type, and at least 12 characters of detail. Future-dated observations are
   rejected; missing dates and existing open reports raise warnings.
3. **Duplicate check.** An open report about the same issue at the same record inside
   30 days becomes a *possible duplicate* rather than a second queue item.
4. **Visible status.** Every report carries one of: queued, needs information,
   possible duplicate, resolved, dismissed — plus its full event history.
5. **Review.** The Review workspace lists counts, validation problems, warnings,
   provenance, and the resolution control. Resolutions: record a reported closure,
   attach an hours note, attach an access note, flag for verification, or reviewed with
   no change. A duplicate or unfounded report can be dismissed.
6. **Traceable outcome.** Each resolution writes an immutable change record: field,
   value before, value after, reason, actor and disposition. See it in the Review
   change log and on the record's History tab.

Corrections are applied as a **local override** (`PlaceOverride`) layered over the
bundled record. The dataset's own status, verification label and sources are never
mutated, an override is labelled a report rather than a verified fact, and there is a
single-click removal that is itself logged. Because this release ships no server, all
of this is per-device: nothing is uploaded, and no second reviewer can see it.

## Sources and licensing

| Source | Use | Licence |
| --- | --- | --- |
| [DataSF: Public Bathrooms and Water Fountains](https://data.sf.gov/d/wfq4-upmv) | Water points, restrooms, hours, access notes | PDDL 1.0 |
| [DataSF: Muni Stops](https://data.sf.gov/d/i28k-bkz6) | Transit stop locations | PDDL 1.0 |
| [DataSF: Law Enforcement Dispatched Calls for Service: Real-Time](https://data.sf.gov/d/gnap-fj3t) | Dispatched calls, 48-hour window (the City's `sensitive_call` redaction flag is honoured) | PDDL 1.0 |
| [DataSF: 311 Cases](https://data.sf.gov/d/vw6y-z8j6) | 311 service requests, 7-day window, capped per service type | PDDL 1.0 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Streets, parks, rail, coastline, historic features | ODbL 1.0 |
| [OpenStreetMap building footprints](https://www.openstreetmap.org/copyright) | 3D building geometry, `height`, `building:levels`, `min_height` | ODbL 1.0 |
| [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Elevation for relief shading and 3D terrain | Public domain (USGS 3DEP, NASA SRTM) |
| [GLIDE Daily Free Meals](https://www.glide.org/programs/daily-free-meals/) | Meal service facts | Provider page, paraphrased |
| [St. Anthony's Dining Room](https://www.stanthonysf.org/services/dining-room/) | Meal service facts | Provider page, paraphrased |
| [SFPL Main Library](https://sfpl.org/locations/main-library) | Public facility facts | Provider page, paraphrased |
| [Hospitality House](https://www.hospitalityhouse.org/) | Drop-in services | Provider page, paraphrased |
| [UCSF Health Hyde Hospital](https://sfcommunityhospitals.ucsfhealth.org/saint-francis) | Emergency care | Provider page, paraphrased |
| [Curry Senior Center](https://curryseniorcenter.org/) | Senior meals | Provider page, paraphrased |
| [FOSSGIS OSRM](https://routing.openstreetmap.de/) | Walking routes (public demo) | OSM data, ODbL; demo service, no SLA |
| [Photon](https://photon.komoot.io/) | Address lookup outside the bundled index | OSM data, ODbL; public demo |
| [Nominatim](https://nominatim.openstreetmap.org/) | Coordinates for the hand-checked access records (`data:access`) | OSM data, ODbL 1.0 |
| [Project Homeless Connect](https://www.projecthomelessconnect.org/programs/edc/) | Mail receiving, resource line | Provider page, paraphrased |
| [Compass Family Services](https://www.compass-sf.org/get-help) | Mail pickup, drop-in windows | Provider page, paraphrased |
| [SF DPH: Maria X Martinez](https://www.sf.gov/location--maria-x-martinez-health-resource-center) | Walk-in urgent care, hours | City page, paraphrased |
| [HealthRIGHT 360 street medicine](https://www.healthright360.org/program/mobile-and-street-medicine-program/) | Mobile weekly street sites | Provider page, paraphrased |
| [SFPL: borrowing a laptop](https://sfpl.libanswers.com/faq/133417) | Device lending rules, card and fee thresholds | Provider page, paraphrased |
| [SFPL: printing and copying](https://sfpl.libanswers.com/faq/341987) | Page prices and the daily free credit | Provider page, paraphrased |
| [City #SFWiFi](https://www.sf.gov/sfwifi) | Named free public Wi-Fi sites | City page, paraphrased |
| [Recology transfer station](https://www.recology.com/recology-san-francisco/sf-transfer-station/) | Electronic-waste terms and hours | Operator page, paraphrased |
| [COIT surveillance inventory](https://www.sf.gov/surveillance-technology-inventory) and [SFPD notice 25-041](https://www.sanfranciscopolice.org/your-sfpd/policies/department-bulletins-notices/25-041) | Atlas → Disclosures, with each document's limits stated | City pages, paraphrased |

Every record stores `sourceIds`, a `lastVerifiedAt`/checked date, and a source
type. Provider facts were read on **2026-10-24**, the access records on
**2026-10-27**, and the building and elevation extracts were retrieved on
**2026-10-27** — and they are paraphrased, not copied. `src/data/sources.json`
holds **30 registered sources**; where a fact comes from a third-party directory
rather than the provider itself, the friction line says so, so a directory claim is
never mistaken for the provider's own words. Attribution is displayed on the map
and in the inspector.

## Privacy

- No accounts, analytics, or tracking pixels. No network writes: observations,
  saves, routes, reports, review decisions, local corrections and settings stay in
  this browser's IndexedDB.
- Photos are re-encoded through a canvas before storage, which removes EXIF, GPS,
  device, and timestamp metadata. The UI states that publication/sharing is not
  implemented.
- Field notes are private by default and excluded from map layers unless the user
  enables "My field notes". Nothing is published.
- Location is opt-in per action. There is no continuous tracking, history, or
  background geolocation. Search and lists work without permission.
- Reported activity is published City data, not surveillance. Positions are snapped to about
  40 m, addresses, intersection names and free text are discarded before publication, and
  categories that describe a person's situation rather than a place are excluded — so these
  layers cannot be used to locate anyone.
- The app never labels a street or route as "safe", and routing has no crime or
  lighting scoring.

## Known limitations

- Coverage is a central slice, not a complete inventory. Some categories are
  intentionally empty and show zero rather than filler.
- Opening hours are published schedules, not live availability. A marker does not
  mean a facility is open, stocked, unlocked, or accepting people.
- Routing uses a public demo service with no uptime guarantee and does not model
  stairs, steepness, lighting, closures, or accessibility. When it fails, the app
  shows a straight-line estimate and says it does not follow streets.
- Photon lookup is external and only used on explicit request; results carry no
  Night Map evidence.
- There is no backend. Reports, review decisions and corrections are per-device:
  they are never sent anywhere, so no one else can see or review them, and a
  correction cannot update the bundled dataset. A local override is a labelled report,
  not a verified fact. Multi-device sync, shared moderation, reviewer accounts and
  public contribution remain unbuilt.
- Basemap and records are a snapshot (`meta.json`); offline use shows that build,
  not live changes.
- **Reported activity is a published snapshot, not a feed.** The calls layer holds only calls
  that have already closed, omits every call the City flags sensitive, and places each record
  at an intersection or block; the 311 layer is published nightly and a case is often already
  resolved. Night Map removes person-describing categories, drops addresses and free text,
  and keeps about 40 m of position. A missing record is not evidence that nothing happened at
  a place, and no record here names or locates a person.
- **No surveillance layer, and a Disclosures tab instead.** San Francisco publishes a
department-by-department inventory of surveillance technologies and **no register of camera
positions**; the transport agency's reports describe systems without placing them, and the
Police Department has stated it will not create a registry of non-City cameras. Night Map
could also not verify any City statement about what its street kiosks collect — the City's
privacy pages are scoped to its websites. So rather than plot inferred dots, Atlas →
Disclosures lists the nine official documents with what each one says and what it does not,
and a unit test asserts that no map layer describes cameras, kiosks or plate readers. Two
useful things requested for this release could not become markers for the same reason,
which the guide states plainly: Recology's electronic-waste drop-off at 501 Tunnel Avenue is
in Bayview, *outside this release's footprint*, and no San Francisco walk-in LifeLine
enrolment address is published anywhere Night Map could verify.
- **Declined, and why.** Live 911 audio, live CCTV and live police radio are not built: SFPD
  radio has been encrypted since 2021, the City publishes no live incident audio, and there is
  no lawful public live CCTV feed for San Francisco. Homeless encampments are deliberately not
  plotted — the City's own 311 log carries over a thousand encampment cases a fortnight, and
  mapping where unhoused people sleep would turn a navigation tool into a targeting tool.
  Abandoned and vacant buildings could not be built on real data at all: DataSF publishes no
  vacant-building or code-enforcement dataset, and OpenStreetMap tags exactly one derelict
  building in the whole footprint. The app says so rather than inventing one, and there is no
  messaging or geocache system: this release has no server, so a note left for another person
  could not be delivered, verified or moderated.
- Terrain is a coarse model (~7 m per pixel) drawn with a deliberate **×1.4 vertical
  exaggeration**. It shows landform, not kerbs, stairs, retaining walls or whether a
  slope is walkable, and an exaggerated relief is not a slope measurement.
- Building heights are render heights. Most come from OpenStreetMap tags, but 3,167
  of 13,975 are footprint-type estimates, multipolygon building relations are not
  extracted, and a height says nothing about entrances, accessibility or ground-floor
  use. On extreme terrain the coarse DEM can also place a footprint a metre or two
  off its true elevation.
- The production JS bundle is a single ~3.6 MB chunk because MapLibre and the
  dataset are bundled for offline use. It is cached after first load.

## Structure

```
src/
  domain/      types, zod schemas, hours/status logic, geo helpers
  data/        validated dataset, guides, basemap layers, source records
  map/         MapLibre style, marker sprites, 3D building tiles, map component
  services/    routing, geocoding, search, IndexedDB storage, photo processing
  state/       store, filters, selectors
  features/    map shell, place inspector, nearby, routes, fieldnotes, atlas,
               review queue, layers, settings
  styles/      base tokens and panel/mobile layout
scripts/       basemap/SF open-data imports, elevation + building extracts, dataset
               builder, access-record geocoder, service worker
scripts/inputs/ hand-checked access records: addresses plus the page each fact came from
scripts/lib/   pure build helpers shared with the unit tests
tests/e2e/     Playwright acceptance scenarios
public/fonts/  self-hosted map glyphs (no tile or glyph CDN)
public/terrain/     elevation tiles (cached on demand, never precached)
public/buildings/   3D footprint tiles (cached on demand, never precached)
public/incidents/   published incident snapshots (cached on demand, never precached)
```

The `src/data` split mirrors what is generated and what was checked by hand:
`places/resources/sources/transit.json` come out of `data:build`, `access.json` out
of `data:access` (coordinates included, with the geocode match recorded), while
`guides.json`, `disclosures.json` and `scripts/inputs/` are written by hand and
reviewed as prose.

Map, geocoding, and routing providers sit behind interfaces in `src/services` so a
hosted provider can replace the demos without touching UI code.

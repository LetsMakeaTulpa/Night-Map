#!/usr/bin/env node
/**
 * Build the Night Map fixture dataset from real, cached sources.
 *
 * Inputs (all fetched by scripts/fetch-*.mjs, cached in scripts/.cache):
 *   - sfgov-water-assets.json  — City public bathrooms + drinking water assets
 *   - sfgov-muni-stops.json    — City Muni stop inventory
 *   - sfgov-popos.json         — City-listed POPOS inventory
 *   - base-points.json      — OSM neighbourhood + station labels
 *
 * Outputs (src/data):
 *   places.json, resources.json, sources.json, transit.json, meta.json
 *
 * Every record keeps the source it came from. Nothing is invented: fields the
 * source does not publish are left null and rendered as "Not confirmed".
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'src', 'data');

const retrievedAt = new Date().toISOString().slice(0, 10);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const waterRows = await readJson(path.join(CACHE, 'sfgov-water-assets.json'));
const muniRows = await readJson(path.join(CACHE, 'sfgov-muni-stops.json'));
const poposRows = await readJson(path.join(CACHE, 'sfgov-popos.json'));
const basePoints = await readJson(path.join(OUT, 'basemap', 'base-points.json'));
const landmarks = await readJson(path.join(OUT, 'basemap', 'landmarks.json'));

const sources = [
  {
    id: 'src:sfgov-popos',
    name: 'Privately Owned Public Open Spaces',
    url: 'https://data.sfgov.org/Culture-and-Recreation/Privately-Owned-Public-Open-Spaces/65ik-7wqd',
    provider: 'San Francisco Planning Department (via DataSF)',
    sourceType: 'open_data',
    license: 'Open Data Commons Public Domain Dedication and License (PDDL)',
    licenseUrl: 'https://opendatacommons.org/licenses/pddl/1-0/',
    retrievedAt,
    updateCadence: 'Dataset metadata reports periodic updates; individual rows do not include a verified date',
    fields: ['name', 'popos_address', 'hours', 'type', 'landscaping', 'seating_no', 'food_service', 'art', 'restrooms', 'accessibility', 'location', 'description', 'year', 'latitude', 'longitude'],
    coverage: 'City-listed POPOS records with coordinates inside the Night Map footprint',
    limitations: 'Hours and access notes are provider-recorded free text and may be stale or ambiguous. Several coordinates may represent the building or space rather than its entrance. Availability is not live; users should check current posted signs and verify access.',
    importMethod: 'Socrata SODA API (65ik-7wqd), cached and normalized by scripts/build-dataset.mjs; city geometry used without address geocoding',
  },
  {
    id: 'src:sfgov-water-assets',
    name: 'San Francisco Public Bathrooms and Water Fountains',
    url: 'https://data.sf.gov/d/wfq4-upmv',
    provider: 'City and County of San Francisco (DataSF)',
    sourceType: 'open_data',
    license: 'Open Data Commons Public Domain Dedication and License (PDDL)',
    licenseUrl: 'https://opendatacommons.org/licenses/pddl/1-0/',
    retrievedAt,
    updateCadence: 'Updated as needed; dataset reports its own data_as_of per row',
    fields: ['name', 'resource_type', 'address', 'access', 'public_access_hours_open', 'public_access_hours_close', 'public_access_days', 'latitude', 'longitude', 'data_as_of'],
    coverage: 'Citywide asset inventory filtered to the Night Map core footprint',
    limitations:
      'An inventory of physical assets, not live availability. Hours are missing for some rows, and the dataset does not confirm that a facility is open, stocked, or unlocked at any given moment.',
    importMethod: 'Socrata SODA API (wfq4-upmv), filtered with within_box, cached and normalised by scripts/build-dataset.mjs',
  },
  {
    id: 'src:sfgov-muni-stops',
    name: 'Muni Stops',
    url: 'https://data.sf.gov/d/i28k-bkz6',
    provider: 'San Francisco Municipal Transportation Agency (via DataSF)',
    sourceType: 'open_data',
    license: 'Open Data Commons Public Domain Dedication and License (PDDL)',
    licenseUrl: 'https://opendatacommons.org/licenses/pddl/1-0/',
    retrievedAt,
    updateCadence: 'Periodic inventory refresh (row-level data_as_of supplied)',
    fields: ['stopname', 'stopid', 'latitude', 'longitude', 'onstreet', 'atstreet', 'accessibilitymask'],
    coverage: 'Stops inside the Night Map core footprint; not a service-frequency feed',
    limitations:
      'Stop locations only. This is not a real-time arrivals feed, and the accessibilitymask field is not interpreted because the City does not publish its meaning with the dataset.',
    importMethod: 'Socrata SODA API (i28k-bkz6), filtered with within_box',
  },
  {
    id: 'src:osm-basemap',
    name: 'OpenStreetMap street, park, rail and coastline geometry',
    url: 'https://www.openstreetmap.org/copyright',
    provider: 'OpenStreetMap contributors',
    sourceType: 'open_map',
    license: 'Open Data Commons Open Database License (ODbL) 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    retrievedAt,
    updateCadence: 'Community-maintained continuously; this extract is a snapshot',
    fields: ['highways', 'parks', 'water', 'railways', 'coastline', 'place labels'],
    coverage: 'Bounding box 37.7585–37.7975 N, 122.4275–122.3905 W (downtown, SoMa, Tenderloin, Civic Center, Chinatown, Financial District)',
    limitations:
      'Volunteer-mapped. Street topology, closures and paths may lag reality. The basemap is a snapshot served with the app, not a live tile service.',
    importMethod: 'Overpass API extract, simplified to about 1e-5 degrees, shipped as GeoJSON',
  },
  {
    id: 'src:osm-landmarks',
    name: 'OpenStreetMap historic features',
    url: 'https://www.openstreetmap.org/copyright',
    provider: 'OpenStreetMap contributors',
    sourceType: 'open_map',
    license: 'Open Data Commons Open Database License (ODbL) 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    retrievedAt,
    updateCadence: 'Community-maintained; this extract is a snapshot',
    fields: ['name', 'historic type', 'coordinates'],
    coverage: 'Named historic nodes and ways in the core footprint',
    limitations:
      'Names and locations only. No historical narrative, date or archival source is attached, so these markers are labelled as community-mapped and are not evidence.',
    importMethod: 'Overpass API extract',
  },
  {
    id: 'src:osm-buildings',
    name: 'OpenStreetMap building footprints and heights',
    url: 'https://www.openstreetmap.org/copyright',
    provider: 'OpenStreetMap contributors',
    sourceType: 'open_map',
    license: 'Open Data Commons Open Database License (ODbL) 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    retrievedAt,
    updateCadence: 'Community-maintained continuously; this extract is a snapshot',
    fields: ['building footprints', 'height', 'building:levels', 'min_height', 'building:part'],
    coverage:
      'Building ways inside the Night Map core footprint, split into six tile files loaded on demand at street zoom',
    limitations:
      'Footprints and heights are volunteer-mapped and incomplete: multipolygon building relations are not included, and every feature records whether its height came from a tag, a storey count or a footprint-type default. Render heights are for a visual layer only and say nothing about entrances, accessibility or ground-floor use.',
    importMethod:
      'Overpass API extract (ways only), simplified to about 2 m, height rules applied by scripts/fetch-buildings.mjs',
  },
  {
    id: 'src:aws-terrain-tiles',
    name: 'AWS Open Data Terrain Tiles (terrarium elevation)',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    provider: 'AWS Open Data / Mapzen elevation tiles, assembled from public-domain surveys',
    sourceType: 'open_map',
    license: 'Public domain (source surveys are USGS 3DEP and NASA SRTM, both public domain)',
    licenseUrl: 'https://registry.opendata.aws/terrain-tiles/',
    retrievedAt,
    updateCadence: 'Static dataset, periodically re-published by AWS',
    fields: ['elevation (terrarium-encoded RGB PNG, 256x256)'],
    coverage: 'Zoom levels 10 to 14 over the footprint plus a margin, 35 tiles stored with the app',
    limitations:
      'A coarse terrain model of roughly 7 m per pixel, showing landform only. It cannot resolve kerbs, stairs, retaining walls, underpasses or whether a slope is walkable, and the app draws it with deliberate vertical exaggeration, so it must not be read as a measurement.',
    importMethod:
      "Tiles copied from the public elevation-tiles-prod bucket by scripts/fetch-terrain.mjs and served from the app's own origin",
  },
  {
    id: 'src:glide-meals',
    name: 'GLIDE Daily Free Meals',
    url: 'https://www.glide.org/programs/daily-free-meals/',
    provider: 'GLIDE Foundation',
    sourceType: 'official_web',
    license: 'Provider website — facts paraphrased, no content republished',
    licenseUrl: null,
    retrievedAt,
    updateCadence: 'Provider publishes changes on its own site; no feed',
    fields: ['meal times', 'eligibility', 'intake process', 'address'],
    coverage: '330 Ellis Street, Tenderloin',
    limitations:
      'Holiday schedules and short-notice closures are not reflected. Times were read from the provider page on the retrieval date.',
    importMethod: 'Manual transcription with source link, reviewed in scripts/build-dataset.mjs',
  },
  {
    id: 'src:stanthonys-dining',
    name: "St. Anthony's Dining Room",
    url: 'https://www.stanthonysf.org/services/dining-room/',
    provider: 'St. Anthony Foundation',
    sourceType: 'official_web',
    license: 'Provider website — facts paraphrased, no content republished',
    licenseUrl: null,
    retrievedAt,
    updateCadence: 'Provider publishes changes on its own site; no feed',
    fields: ['service description', 'address', 'weekly operating pattern'],
    coverage: '121 Golden Gate Avenue, Tenderloin',
    limitations:
      'The serving-time block on the provider page is rendered by script and could not be read reliably, so no times are recorded here. Confirm before travelling.',
    importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:phc-every-day-connect', name: 'Project Homeless Connect — Every Day Connect', url: 'https://www.projecthomelessconnect.org/programs/edc/', provider: 'Project Homeless Connect', sourceType: 'official_web', license: 'Provider website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'Provider page; no displayed publication date', fields: ['services', 'address', 'phone', 'mail service'], coverage: '1031 Franklin Street', limitations: 'Check provider for current terms and access.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:one-degree-sf', name: '1Degree service directory listings', url: 'https://www.1degree.org/', provider: 'Tipping Point Community', sourceType: 'official_web', license: 'Third-party directory — facts paraphrased and attributed', licenseUrl: null, retrievedAt, updateCadence: 'Directory updated at publisher discretion', fields: ['services', 'hours', 'fee', 'eligibility'], coverage: 'San Francisco services', limitations: 'Directory, not the service provider; do not use for open-now claims.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:compass-family-services', name: 'Compass Family Services — get help', url: 'https://www.compass-sf.org/get-help', provider: 'Compass Family Services', sourceType: 'official_web', license: 'Provider website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'Provider page; no displayed publication date', fields: ['mail pickup', 'hours', 'phone'], coverage: 'San Francisco', limitations: 'Confirm current service details with provider.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:sfdph-maria-martinez', name: 'Maria X Martinez Health Resource Center', url: 'https://www.sf.gov/location--maria-x-martinez-health-resource-center', provider: 'San Francisco Department of Public Health', sourceType: 'official_web', license: 'City page — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'City page; no displayed publication date', fields: ['services', 'walk-in access', 'hours', 'phone'], coverage: 'San Francisco', limitations: 'Only facts stated by the City are recorded.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:healthright360-street-medicine', name: 'HealthRIGHT 360 mobile and street medicine programme', url: 'https://www.healthright360.org/program/mobile-and-street-medicine-program/', provider: 'HealthRIGHT 360', sourceType: 'official_web', license: 'Provider website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'Provider page; no displayed publication date', fields: ['street sites', 'access model', 'eligibility', 'hours'], coverage: 'San Francisco', limitations: 'Mobile service schedule may change; confirm directly.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:sfpl-laptops', name: 'SFPL — borrowing a laptop', url: 'https://sfpl.libanswers.com/faq/133417', provider: 'San Francisco Public Library', sourceType: 'official_web', license: 'Provider website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'FAQ; displays a publisher update date', fields: ['loan locations', 'loan terms', 'requirements'], coverage: 'San Francisco Public Library branches', limitations: 'No live equipment inventory.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:sfpl-printing', name: 'SFPL — printing, copying, scanning and faxing', url: 'https://sfpl.libanswers.com/faq/341987', provider: 'San Francisco Public Library', sourceType: 'official_web', license: 'Provider website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'FAQ; displays a publisher update date', fields: ['prices', 'allowances', 'locations'], coverage: 'San Francisco Public Library', limitations: 'Prices and credits can change; no live printer availability.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:sfpl-wifi', name: 'SFPL — wireless and computers', url: 'https://sfpl.libanswers.com/faq/88545', provider: 'San Francisco Public Library', sourceType: 'official_web', license: 'Provider website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'FAQ; page may be stale', fields: ['network availability'], coverage: 'Library branches', limitations: 'Page date is old; verify with library.', importMethod: 'Manually transcribed with source link',
  },
  {
    id: 'src:sfgov-sfwifi', name: 'San Francisco free public Wi-Fi sites (#SFWiFi)', url: 'https://www.sf.gov/sfwifi', provider: 'City and County of San Francisco', sourceType: 'official_web', license: 'City page — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'City page updated at its discretion', fields: ['site names', 'network names'], coverage: 'San Francisco public sites', limitations: 'Names are listed without addresses or hours; no locations are guessed.', importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:cpuc-lifeline', name: 'California LifeLine — contacts and how to apply', url: 'https://www.cpuc.ca.gov/consumer-support/financial-assistance-savings-and-discounts/lifeline/california-lifeline-contacts', provider: 'California Public Utilities Commission', sourceType: 'official_web', license: 'State agency page — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'State agency page updated at publisher discretion', fields: ['contact numbers', 'application routes'], coverage: 'California statewide', limitations: 'No SF walk-in enrollment address is given.', importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:fcc-acp', name: 'FCC Affordable Connectivity Program', url: 'https://www.fcc.gov/acp', provider: 'Federal Communications Commission', sourceType: 'official_web', license: 'Federal agency page — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'Federal program page', fields: ['program status', 'enrollment dates'], coverage: 'Nationwide', limitations: 'The program ended; do not rely on old enrollment advertisements.', importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:recology-transfer-station', name: 'Recology San Francisco Transfer Station — hours and fees', url: 'https://www.recology.com/recology-san-francisco/sf-transfer-station/', provider: 'Recology', sourceType: 'official_web', license: 'Operator website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'Operator page updated at its discretion', fields: ['address', 'hours', 'fees'], coverage: 'San Francisco; outside Night Map footprint', limitations: 'Not plotted in the core footprint.', importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:sf-environment-dropoff', name: 'SF Environment — drop-off and bulky item disposal', url: 'https://www.sfenvironment.org/bulky-items', provider: 'San Francisco Environment Department', sourceType: 'official_web', license: 'City page — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'City page updated at its discretion', fields: ['drop-off location', 'accepted materials', 'hours'], coverage: 'San Francisco; facility outside core footprint', limitations: 'Check current city instructions before visiting.', importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:repaircafesf', name: 'Haight-Nopa Repair Cafe', url: 'https://repaircafesf.org/', provider: 'Haight-Nopa Repair Cafe', sourceType: 'official_web', license: 'Organizer website — facts paraphrased', licenseUrl: null, retrievedAt, updateCadence: 'Volunteer-run event listings change', fields: ['event dates', 'venue', 'what can be repaired'], coverage: 'San Francisco events', limitations: 'Event details change; confirm the organizer schedule.', importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:sfpl-main',
    name: 'San Francisco Public Library — Main Library',
    url: 'https://sfpl.org/locations/main-library',
    provider: 'San Francisco Public Library',
    sourceType: 'official_web',
    license: 'Provider website — facts paraphrased, no content republished',
    licenseUrl: null,
    retrievedAt,
    updateCadence: 'Library publishes seasonal hours; closures announced separately',
    fields: ['weekly hours', 'Wi-Fi availability', 'facilities'],
    coverage: '100 Larkin Street, Civic Center',
    limitations:
      'Holiday and emergency closures are not in this record. Hours were read from the branch page on the retrieval date.',
    importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:hospitality-house',
    name: 'Hospitality House programs',
    url: 'https://www.hospitalityhouse.org/',
    provider: 'Hospitality House',
    sourceType: 'official_web',
    license: 'Provider website — facts paraphrased, no content republished',
    licenseUrl: null,
    retrievedAt,
    updateCadence: 'Provider publishes program pages; no feed',
    fields: ['program descriptions', 'locations', 'phone numbers'],
    coverage: '290 Turk St, 146 Leavenworth St, 1009 Market St, 169 Sixth St',
    limitations:
      'Drop-in opening hours and shelter intake procedure are not published on the page used, so neither is recorded. Call before relying on a program.',
    importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:ucsf-hyde',
    name: 'UCSF Health Hyde Hospital (formerly Saint Francis Memorial)',
    url: 'https://sfcommunityhospitals.ucsfhealth.org/saint-francis',
    provider: 'UCSF Health',
    sourceType: 'official_web',
    license: 'Provider website — facts paraphrased, no content republished',
    licenseUrl: null,
    retrievedAt,
    updateCadence: 'Static facility page',
    fields: ['address', 'phone', 'emergency department availability'],
    coverage: '900 Hyde Street, Nob Hill edge of the footprint',
    limitations:
      'Emergency department is reported as 24/7 by the provider; wait times, insurance and eligibility are not published. Call ahead where possible.',
    importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:curry-senior',
    name: 'Curry Senior Center',
    url: 'https://curryseniorcenter.org/',
    provider: 'Curry Senior Center',
    sourceType: 'official_web',
    license: 'Provider website — facts paraphrased, no content republished',
    licenseUrl: null,
    retrievedAt,
    updateCadence: 'Provider publishes program pages; no feed',
    fields: ['address', 'phone', 'meal eligibility', 'center hours'],
    coverage: '333 Turk Street, Tenderloin',
    limitations:
      'Meal service times are not published on the pages used; recorded hours are the center schedule, not the kitchen schedule.',
    importMethod: 'Manual transcription with source link',
  },
  {
    id: 'src:osrm-foot',
    name: 'FOSSGIS OSRM walking router',
    url: 'https://routing.openstreetmap.de/',
    provider: 'FOSSGIS e.V. (public demo instance)',
    sourceType: 'routing_service',
    license: 'Routing data © OpenStreetMap contributors, ODbL; demo service provided under FOSSGIS fair-use terms',
    licenseUrl: 'https://www.osm.org/copyright',
    retrievedAt,
    updateCadence: 'Live service, no availability guarantee',
    fields: ['walking route geometry', 'distance', 'duration', 'maneuvers'],
    coverage: 'Pedestrian network derived from OpenStreetMap',
    limitations:
      'Public demo service with fair-use limits: no bulk requests, no production SLA. Night Map is configured to send one small route request per user action. Any production deployment should self-host OSRM or use a paid routing provider.',
    importMethod: 'HTTPS GET at request time, behind the RoutingProvider interface',
  },
  {
    id: 'src:photon-geocode',
    name: 'Photon geocoder (Komoot)',
    url: 'https://photon.komoot.io/',
    provider: 'Komoot',
    sourceType: 'geocoding_service',
    license: 'Geocoding data © OpenStreetMap contributors, ODbL',
    licenseUrl: 'https://www.osm.org/copyright',
    retrievedAt,
    updateCadence: 'Live service, no availability guarantee',
    fields: ['place name', 'address', 'coordinates'],
    coverage: 'Worldwide, used only for explicit address lookup',
    limitations:
      'Public demo service without an SLA. Only invoked when a user explicitly searches an address outside the Night Map index.',
    importMethod: 'HTTPS GET at request time, behind the GeocodingProvider interface',
  },
];

/* ------------------------------------------------------------------ helpers */

const pad = (n) => String(n).padStart(2, '0');
function parseDays(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'daily' || s === 'every day') return [0, 1, 2, 3, 4, 5, 6];
  if (s === 'weekdays') return [1, 2, 3, 4, 5];
  return null;
}
function parseClock(raw) {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return null;
  return `${pad(Number(m[1]) % 24)}:${pad(Number(m[2]))}`;
}
function hoursFromRow(row) {
  const open = parseClock(row.public_access_hours_open);
  const close = parseClock(row.public_access_hours_close);
  const days = parseDays(row.public_access_days);
  if (!open || !close) return null;
  // 24:00 close means end of day.
  const closeMin = close === '00:00' ? 24 * 60 : Number(close.slice(0, 2)) * 60 + Number(close.slice(3));
  const openMin = Number(open.slice(0, 2)) * 60 + Number(open.slice(3));
  if (closeMin === openMin) return { kind: 'always', note: 'Published as 24 hours' };
  const normalizedClose = close === '24:00' ? '23:59' : close;
  return {
    kind: 'weekly',
    days: days || [0, 1, 2, 3, 4, 5, 6],
    opens: open,
    closes: normalizedClose,
    daysKnown: Boolean(days),
    rawDays: row.public_access_days || null,
  };
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/* ------------------------------------------------------------- city assets */

const places = [];
const resources = [];

const waterSourceId = 'src:sfgov-water-assets';
const poposSourceId = 'src:sfgov-popos';
const waterLicense = 'Public domain (PDDL 1.0)';

for (const row of waterRows) {
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const isRestroom = row.resource_type === 'restroom';
  const updated = (row.data_as_of || '').slice(0, 10) || null;
  const hours = hoursFromRow(row);
  const serviceTypes = [];
  if (isRestroom) serviceTypes.push('public_restroom');
  if (row.water_fountain === '1') serviceTypes.push('drinking_water');
  if (row.bottle_filler === '1') serviceTypes.push('bottle_filler');
  if (row.jug_filler === '1') serviceTypes.push('jug_filler');
  if (serviceTypes.length === 0) serviceTypes.push(isRestroom ? 'public_restroom' : 'drinking_water');

  const placeId = `place:sfgov:${row.uid}`;
  const accessLimited = row.access === 'limited_access';
  const address = (row.address || '').trim();
  // City rows sometimes give a cross-street instead of a street address.
  const isIntersection = / and |&/i.test(address) && !/^\d/.test(address);
  const accessNote = accessLimited
    ? 'The City dataset labels access here as limited access (for example, inside a park with restricted hours). Expect the surrounding site, not the fixture, to govern opening hours.'
    : 'The City dataset labels this asset as publicly accessible. That records the fixture, not a guarantee the surrounding facility is open.';

  places.push({
    id: placeId,
    name: row.name,
    category: isRestroom ? 'bathroom' : 'water',
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    address: address || null,
    addressType: isIntersection ? 'intersection' : 'street_address',
    description: isRestroom
      ? `Public restroom in the City inventory${row.source ? `, maintained under the ${row.source.replace(/_/g, ' ')} program` : ''}. Listing does not confirm that it is open, clean or unlocked.`
      : `Public drinking water asset in the City inventory${row.bottle_filler === '1' ? ' with a bottle filler' : ''}. Listing does not confirm that it is working tonight.`,
    accessibility: { status: 'not_documented', note: 'The City dataset does not publish accessibility details for this asset.' },
    sourceIds: [waterSourceId],
    status: 'active',
    locationPrecision: 'dataset_point',
    neighborhood: row.analysis_neighborhood || null,
    createdAt: retrievedAt,
    updatedAt: updated || retrievedAt,
  });

  resources.push({
    id: `res:sfgov:${row.uid}`,
    placeId,
    name: row.name,
    serviceTypes,
    cost: { kind: 'unknown', note: 'Cost is not stated in the City dataset for this asset.' },
    eligibility: null,
    intake: null,
    hours,
    availability: { status: 'unknown', note: 'The City dataset cannot confirm that this asset is open or stocked right now.' },
    officialContact: null,
    sourceIds: [waterSourceId],
    sourceUpdatedAt: updated,
    lastVerifiedAt: null,
    verification: {
      status: 'official_source',
      label: 'City inventory',
      note: accessNote,
    },
    category: isRestroom ? 'bathroom' : 'water',
    details: {
      access: row.access || null,
      maintainedBy: row.source || null,
      inPark: row.park || null,
      waterFountain: row.water_fountain === '1',
      bottleFiller: row.bottle_filler === '1',
      jugFiller: row.jug_filler === '1',
      rawHours: row.public_access_hours_open
        ? `${row.public_access_days || 'Days not stated'} · ${row.public_access_hours_open}–${row.public_access_hours_close}`
        : null,
    },
    license: waterLicense,
  });
}

/* ------------------------------------------------ official POPOS records */

const cleanText = (value) => typeof value === 'string' ? value.trim() || null : value == null ? null : String(value);
const parsePoposBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  if (/^(yes|y|true)$/i.test(value.trim())) return true;
  if (/^(no|n|false)$/i.test(value.trim())) return false;
  return null;
};
const poposSeen = new Set();
for (const row of poposRows) {
  const lat = Number(row.latitude ?? row.point?.coordinates?.[1]);
  const lon = Number(row.longitude ?? row.point?.coordinates?.[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (lat < 37.735 || lat > 37.82 || lon < -122.475 || lon > -122.345) continue;
  const name = cleanText(row.name) ?? cleanText(row.popos_address) ?? 'Unnamed POPOS';
  const address = cleanText(row.popos_address);
  const slug = `${name}|${address}|${lat.toFixed(6)}|${lon.toFixed(6)}`.toLowerCase();
  if (poposSeen.has(slug)) continue;
  poposSeen.add(slug);
  const stablePart = slug.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  const placeId = `place:sfgov:popos:${stablePart}`;
  const description = cleanText(row.description) ?? `${cleanText(row.type) ?? 'Public open space'} listed in the City POPOS inventory.`;
  places.push({
    id: placeId,
    name,
    category: 'popos',
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    address,
    addressType: 'street_address',
    description: `${description} City inventory access note: ${cleanText(row.location) ?? 'not supplied'}.`,
    accessibility: {
      status: 'not_documented',
      note: cleanText(row.accessibility) ? `City POPOS record: ${cleanText(row.accessibility)}. Confirm route and entrance in the field.` : 'Accessibility is not documented in the City POPOS record.',
    },
    sourceIds: [poposSourceId],
    status: 'unknown',
    locationPrecision: 'dataset_point',
    neighborhood: null,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
  });
  resources.push({
    id: `${placeId}:resource`,
    placeId,
    name,
    category: 'popos',
    serviceTypes: ['public_open_space'],
    cost: { kind: 'free', note: 'Listed as a designated public open space; access conditions and hours vary by site.' },
    eligibility: null,
    intake: null,
    hours: null,
    hoursNote: cleanText(row.hours) ?? 'The City dataset does not list hours for this record.',
    availability: { status: 'unknown', note: 'Not a live status feed. Confirm current posted hours and public access at the site.' },
    officialContact: null,
    sourceIds: [poposSourceId],
    sourceUpdatedAt: retrievedAt,
    lastVerifiedAt: null,
    verification: { status: 'official_source', label: 'City POPOS inventory', note: 'Official inventory record; individual entrance, hours, access and condition have not been field-verified by Night Map.' },
    details: {
      spaceType: cleanText(row.type),
      cityHours: cleanText(row.hours),
      entranceDirections: cleanText(row.location),
      landscaping: cleanText(row.landscaping),
      seating: cleanText(row.seating_no),
      seatingAvailable: parsePoposBool(row.seating),
      foodService: cleanText(row.food_service),
      publicArt: parsePoposBool(row.art),
      restrooms: cleanText(row.restrooms),
      indoor: typeof row.indoor === 'boolean' ? row.indoor : null,
      yearRecorded: cleanText(row.year),
      signage: cleanText(row.signage),
      sourceParcelNumber: cleanText(row.parcel_num),
    },
    license: 'PDDL 1.0',
  });
}

console.log(`POPOS records installed in footprint: ${poposSeen.size}`);

/* ------------------------------------------------ curated provider records */

const geocoded = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
const weeklyHours = (days, opens, closes) => ({ kind: 'weekly', days, opens, closes, daysKnown: true });

const CURATED = [
  {
    slug: 'glide-daily-free-meals',
    place: {
      name: 'GLIDE Daily Free Meals',
      category: 'food',
      coordinates: [-122.4117173, 37.7853266],
      address: '330 Ellis Street',
      addressType: 'street_address',
      description:
        'Free breakfast, lunch and dinner served daily by GLIDE. The provider states there are no eligibility requirements and no intake form before a meal. Special breakfast for seniors, families and adults with disabilities runs 7:30–8:00 am.',
    },
    resource: {
      serviceTypes: ['prepared_meals', 'indoor_seating'],
      cost: { kind: 'free', note: 'Provider states meals are free.' },
      eligibility: 'No eligibility requirements stated by the provider.',
      intake: 'No intake form required before receiving a meal.',
      hours: null,
      hoursNote: 'Meal windows: breakfast 7:30–9:00 am, lunch 11:30 am–1:00 pm, dinner 3:30–5:00 pm daily. These are service windows, not all-day opening hours; Night Map will not claim the dining room is open between meals.',
      availability: { status: 'unknown', note: 'Night Map cannot confirm same-night capacity. Holiday and short-notice closures are not in this record.' },
      officialContact: { phone: '(415) 674-6000', website: 'https://www.glide.org/programs/daily-free-meals/' },
      sourceId: 'src:glide-meals',
      details: {
        meals: 'Breakfast 7:30–9:00 am · Lunch 11:30 am–1:00 pm · Dinner 3:30–5:00 pm',
        eligibility: 'No eligibility requirements stated',
        intake: 'No intake form required',
        cost: 'Free',
        note: 'Holiday meals follow a separate schedule.',
      },
      lastVerifiedAt: retrievedAt,
    },
  },
  {
    slug: 'st-anthonys-dining-room',
    place: {
      name: "St. Anthony's Dining Room",
      category: 'food',
      coordinates: [-122.4125596, 37.781848],
      address: '121 Golden Gate Avenue',
      addressType: 'street_address',
      description:
        'Free dining room operated by St. Anthony Foundation, open seven days a week according to the provider. Breakfast starts at 7 am, lunch runs 10 am–1:30 pm, and a to-go hot meal is served at 2 pm Monday–Friday.',
    },
    resource: {
      serviceTypes: ['prepared_meals'],
      cost: { kind: 'free', note: 'Provider describes the dining room as a free meal service.' },
      eligibility: 'Not stated on the page read.',
      intake: 'Not stated on the page read.',
      hours: null,
      hoursNote: 'Service windows from the provider page: breakfast from 7:00 am, lunch 10:00 am–1:30 pm, afternoon to-go meal 2:00 pm Monday–Friday. These are meal services, not building hours.',
      availability: { status: 'unknown', note: 'Not confirmed. Check the provider page before you go.' },
      officialContact: { phone: null, website: 'https://www.stanthonysf.org/services/dining-room/' },
      sourceId: 'src:stanthonys-dining',
      details: {
        meals: 'Breakfast from 7:00 am · Lunch 10:00 am–1:30 pm · To-go hot meal 2:00 pm Mon–Fri',
        note: 'Service windows are recorded from the provider page; they do not mean the dining room stays open all day.',
      },
      lastVerifiedAt: retrievedAt,
    },
  },
  {
    slug: 'curry-senior-center',
    place: {
      name: 'Curry Senior Center',
      category: 'food',
      coordinates: [-122.4145183, 37.7824784],
      address: '333 Turk Street',
      addressType: 'street_address',
      description:
        'Senior center providing meals, health services, case management and activities for older adults. The provider states breakfast and lunch are served Monday through Friday for people 60 and older.',
    },
    resource: {
      serviceTypes: ['prepared_meals', 'senior_services'],
      cost: { kind: 'unknown', note: 'Cost is not stated; the center is described as serving low-income older adults.' },
      eligibility: 'Provider states meals are for people aged 60 and older.',
      intake: 'Not stated on the pages read. Call to ask about registration.',
      hours: null,
      hoursNote: 'Meals are served Monday–Friday, but the serving times are not published on the pages read. No opening hours are assumed here.',
      availability: { status: 'unknown', note: 'Meal availability tonight is not confirmed by this record.' },
      officialContact: { phone: '(415) 885-2274', website: 'https://curryseniorcenter.org/' },
      sourceId: 'src:curry-senior',
      details: {
        meals: 'Breakfast and lunch, Monday–Friday (serving times not published)',
        eligibility: 'Adults 60+',
        note: 'Call the center for meal times and registration.',
      },
      lastVerifiedAt: retrievedAt,
    },
  },
  {
    slug: 'sfpl-main-library',
    place: {
      name: 'San Francisco Public Library — Main Library',
      category: 'civic',
      coordinates: [-122.4157831, 37.7791882],
      address: '100 Larkin Street',
      addressType: 'street_address',
      description:
        'Central public library with Wi-Fi, restrooms, meeting and study rooms, and a café. A City inventory drinking-water asset is also recorded inside this building.',
    },
    resource: {
      serviceTypes: ['library', 'wifi', 'restroom', 'water', 'seating', 'charging_outlets_unconfirmed'],
      cost: { kind: 'free', note: 'Public library; no admission fee stated.' },
      eligibility: 'Open to the public. Library cards are needed to borrow materials, not to enter.',
      intake: null,
      hours: {
        kind: 'weekly_by_day',
        days: {
          0: { opens: '12:00', closes: '18:00' },
          1: { opens: '09:00', closes: '18:00' },
          2: { opens: '09:00', closes: '20:00' },
          3: { opens: '09:00', closes: '20:00' },
          4: { opens: '09:00', closes: '20:00' },
          5: { opens: '12:00', closes: '18:00' },
          6: { opens: '10:00', closes: '18:00' },
        },
        daysKnown: true,
      },
      hoursNote: 'Hours read from the library branch page on the verification date. Holiday closures are not included.',
      availability: { status: 'unknown', note: 'Building hours are published; unexpected closures are not visible to Night Map.' },
      officialContact: { phone: null, website: 'https://sfpl.org/locations/main-library' },
      sourceId: 'src:sfpl-main',
      details: {
        facilities: 'Wi-Fi, restrooms, café, study and meeting rooms, printing',
        note: 'Charging outlets are commonly available in libraries but are not confirmed by the source page used, so this record does not promise them.',
      },
      lastVerifiedAt: retrievedAt,
      alsoLinkFountain: true,
    },
  },
  {
    slug: 'hospitality-house-self-help',
    place: {
      name: 'Hospitality House — Tenderloin Self-Help Center',
      category: 'services',
      coordinates: [-122.4137611, 37.7825477],
      address: '146 Leavenworth Street',
      addressType: 'street_address',
      description:
        'Low-threshold drop-in center offering peer counseling, case management, harm-reduction groups, help with income support, and referrals to behavioral health and housing services. Drop-in hours are not published on the page read.',
    },
    resource: {
      serviceTypes: ['drop_in', 'case_management', 'peer_counseling', 'harm_reduction', 'housing_referral'],
      cost: { kind: 'unknown', note: 'Cost is not stated by the provider.' },
      eligibility: 'Provider describes services as low-threshold and open to people who may not use traditional services.',
      intake: 'Drop-in is described, but intake steps are not published.',
      hours: null,
      hoursNote: 'Opening hours are not published on the page read. Call before going.',
      availability: { status: 'unknown', note: 'Not confirmed.' },
      officialContact: { phone: '(415) 749-2143', website: 'https://www.hospitalityhouse.org/' },
      sourceId: 'src:hospitality-house',
      details: {
        services: 'Peer counseling, case management, harm-reduction therapy, support groups, income support help, housing and behavioral-health referrals',
        note: 'Phone number and address transcribed from the provider page.',
      },
      lastVerifiedAt: retrievedAt,
    },
  },
  {
    slug: 'hospitality-house-shelter',
    place: {
      name: 'Hospitality House Shelter Program',
      category: 'shelter',
      coordinates: [-122.4137611, 37.7825477],
      address: '146 Leavenworth Street, 2nd floor',
      addressType: 'street_address',
      description:
        'Small emergency shelter for up to 22 men nightly, operated by Hospitality House. Intake process, referral requirements and bed availability are not published on the page read.',
    },
    resource: {
      serviceTypes: ['emergency_shelter', 'overnight'],
      cost: { kind: 'unknown', note: 'Cost is not stated by the provider.' },
      eligibility: 'Provider describes the program as an emergency shelter for up to 22 men nightly.',
      intake: 'Not published. Call the provider to ask about intake and referrals.',
      hours: null,
      hoursNote: 'Overnight check-in times are not published on the page read.',
      availability: { status: 'unknown', note: 'Bed availability is NOT confirmed. Never assume a bed is open — call first.' },
      officialContact: { phone: '(415) 749-2103', website: 'https://www.hospitalityhouse.org/' },
      sourceId: 'src:hospitality-house',
      details: {
        capacity: 'Up to 22 men nightly, per provider',
        intake: 'Not published',
        note: 'This record is a signpost, not a reservation or a guarantee of a bed.',
      },
      lastVerifiedAt: retrievedAt,
    },
  },
  {
    slug: 'hyde-hospital-er',
    place: {
      name: 'UCSF Health Hyde Hospital — Emergency Department',
      category: 'medical',
      coordinates: [-122.4169478, 37.7898079],
      address: '900 Hyde Street',
      addressType: 'street_address',
      description:
        'Hospital emergency department, formerly Saint Francis Memorial Hospital, now part of UCSF Health. The provider lists the emergency department as open 24/7.',
    },
    resource: {
      serviceTypes: ['emergency_care', 'hospital'],
      cost: { kind: 'varies', note: 'Emergency care is billed; the provider does not publish cost or coverage details here. Financial assistance may be available — ask the hospital.' },
      eligibility: 'Emergency departments in the US must provide a medical screening exam regardless of ability to pay (federal EMTALA requirement). Night Map is not a billing or eligibility advisor.',
      intake: 'Emergency Department entrance is at 1150 Bush Street. Walk in. For life-threatening emergencies call 911.',
      hours: { kind: 'always', note: 'Provider lists the emergency department as 24/7.' },
      hoursNote: 'Emergency department open 24 hours per provider page.',
      availability: { status: 'unknown', note: 'Open 24/7 per provider; wait times are not published.' },
      officialContact: { phone: '(415) 353-6300', website: 'https://sfcommunityhospitals.ucsfhealth.org/saint-francis' },
      sourceId: 'src:ucsf-hyde',
      details: {
        emergency: 'Call 911 for a life-threatening emergency',
        entrance: 'Emergency Department entrance: 1150 Bush Street',
        note: 'The hospital campus is at 900 Hyde Street. The ED entrance is around the corner on Bush. Facility renamed: Saint Francis Memorial Hospital is now UCSF Health Hyde Hospital.',
      },
      lastVerifiedAt: retrievedAt,
    },
  },
  {
    slug: 'hospitality-house-community-building',
    place: {
      name: 'Hospitality House — Community Building Program',
      category: 'services',
      coordinates: [-122.4137937, 37.7831005],
      address: '290 Turk Street',
      addressType: 'street_address',
      description:
        'Community organizing, leadership training and civic engagement programs run by Hospitality House, including the HOLD training series and voter engagement work.',
    },
    resource: {
      serviceTypes: ['community_program', 'leadership_training'],
      cost: { kind: 'unknown', note: 'Cost is not stated by the provider.' },
      eligibility: 'Not stated on the page read.',
      intake: 'Not published. Call for program scheduling.',
      hours: null,
      hoursNote: 'Program hours are not published on the page read.',
      availability: { status: 'unknown', note: 'Program schedule not confirmed.' },
      officialContact: { phone: '(415) 749-2122', website: 'https://www.hospitalityhouse.org/' },
      sourceId: 'src:hospitality-house',
      details: { program: 'Community Building Program (HOLD leadership series, voter engagement)', note: 'Not a drop-in service; call ahead.' },
      lastVerifiedAt: retrievedAt,
    },
  },
];

const libraryFountain = resources.find((r) => r.placeId.startsWith('place:sfgov') && r.name === 'Main Library');
const libraryFountainPlace = libraryFountain
  ? places.find((p) => p.id === libraryFountain.placeId)
  : null;
let mergedLibraryFountainPlaceId = null;

for (const entry of CURATED) {
  const placeId = `place:curated:${entry.slug}`;
  const sourceId = entry.resource.sourceId;
  const resourceId = `res:curated:${entry.slug}`;

  const mergedFountain = Boolean(entry.resource.alsoLinkFountain && libraryFountain && libraryFountainPlace);
  if (mergedFountain) mergedLibraryFountainPlaceId = libraryFountainPlace.id;
  if (mergedFountain) {
    libraryFountain.placeId = placeId;
    libraryFountain.name = `${libraryFountain.name} — drinking water`;
    libraryFountain.category = 'water';
    libraryFountain.serviceTypes = ['drinking_water', 'bottle_filler'];
    libraryFountain.verification.note =
      'City water-asset inventory row for the Main Library, linked to the library record at the same address.';
  }

  places.push({
    id: placeId,
    name: entry.place.name,
    category: entry.place.category,
    geometry: geocoded(entry.place.coordinates[0], entry.place.coordinates[1]),
    address: entry.place.address,
    addressType: entry.place.addressType,
    description: entry.place.description,
    accessibility: {
      status: 'not_documented',
      note: 'Night Map has not verified step-free access, elevator availability or bathroom accessibility here.',
    },
    sourceIds: [sourceId],
    status: 'active',
    locationPrecision: 'geocoded_address',
    neighborhood: null,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
  });

  resources.push({
    id: resourceId,
    placeId,
    name: entry.place.name,
    serviceTypes: entry.resource.serviceTypes,
    cost: entry.resource.cost,
    eligibility: entry.resource.eligibility,
    intake: entry.resource.intake,
    hours: entry.resource.hours,
    hoursNote: entry.resource.hoursNote,
    availability: entry.resource.availability,
    officialContact: entry.resource.officialContact,
    sourceIds: [sourceId],
    sourceUpdatedAt: retrievedAt,
    lastVerifiedAt: entry.resource.lastVerifiedAt,
    verification: {
      status: 'recently_verified',
      label: 'Checked against provider page',
      note: `Provider page read on ${retrievedAt}. This records what the provider publishes, not a live check of the door.`,
    },
    category: entry.place.category,
    details: entry.resource.details,
    license: 'Facts paraphrased from provider website',
  });

  if (mergedFountain && libraryFountain) {
    // The fountain resource keeps its own City source and verification status.
    places[places.length - 1].sourceIds = [sourceId, 'src:sfgov-water-assets'];
  }
}

// Drop the original DataSF place whose water resource now belongs to a curated
// building record, so the map shows one marker for one building.
const mergedPlaceId = mergedLibraryFountainPlaceId;
const filteredPlaces = mergedPlaceId ? places.filter((p) => p.id !== mergedPlaceId) : places;

/* ------------------------------------------------------------ transit stops */

const seenStops = new Set();
const transit = [];
for (const row of muniRows) {
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const name = (row.stopname || '')
    .replace(/\s+[NSEW]{1,2}-(FS|NS|TS|SI|S|N|E|W)(\/[A-Z]+)?$/i, '')
    .replace(/&/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) continue;
  const key = `${name}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
  if (seenStops.has(key)) continue;
  seenStops.add(key);
  transit.push({
    id: `stop:muni:${row.stopid}:${row.objectid}`,
    name,
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    onStreet: titleCase((row.onstreet || '').toLowerCase()) || null,
    atStreet: titleCase((row.atstreet || '').toLowerCase()) || null,
    stopId: row.stopid || null,
    sourceId: 'src:sfgov-muni-stops',
    sourceUpdatedAt: (row.data_as_of || '').slice(0, 10) || null,
  });
}

/* --------------------------------------------------------- historic features */

const historicPlaces = landmarks.features
  .filter((f) => f.properties?.name)
  .map((f, index) => ({
    id: `place:osm-historic:${index}:${f.geometry.coordinates[1].toFixed(5)},${f.geometry.coordinates[0].toFixed(5)}`,
    name: f.properties.name,
    category: 'history',
    geometry: f.geometry,
    address: null,
    addressType: 'point',
    description: `Historic feature mapped in OpenStreetMap as "${(f.properties.kind || 'historic').replace(/_/g, ' ')}". Location and name only — Night Map has not researched this site or attached an archival source.`,
    accessibility: { status: 'not_documented', note: 'No accessibility information is available for this feature.' },
    sourceIds: ['src:osm-landmarks'],
    status: 'active',
    locationPrecision: 'osm_node',
    neighborhood: null,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
    verificationOverride: {
      status: 'community_mapped',
      label: 'Community-mapped',
      note: 'Contributed to OpenStreetMap; not reviewed by Night Map and not a historical claim.',
    },
  }));

/* ------------------------------------------------------------ neighbourhoods */

const neighbourhoods = basePoints.features
  .filter((f) => f.properties.kind === 'neighbourhood' && f.properties.name)
  .map((f) => ({
    name: f.properties.name,
    rank: f.properties.rank,
    geometry: f.geometry,
  }));

const allPlaces = filteredPlaces.concat(historicPlaces);
const allResources = resources;

await writeFile(path.join(OUT, 'sources.json'), JSON.stringify(sources, null, 1));
await writeFile(path.join(OUT, 'places.json'), JSON.stringify(allPlaces));
await writeFile(path.join(OUT, 'resources.json'), JSON.stringify(resources));
await writeFile(path.join(OUT, 'transit.json'), JSON.stringify(transit));
await writeFile(path.join(OUT, 'neighbourhoods.json'), JSON.stringify(neighbourhoods));
await writeFile(
  path.join(OUT, 'meta.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      footprint: {
        name: 'Downtown · SoMa · Tenderloin',
        bbox: [-122.429, 37.7585, -122.3905, 37.7975],
        note: 'This release covers a central slice of San Francisco. It is not a citywide or complete directory.',
      },
      counts: {
        places: allPlaces.length,
        historicFeatures: historicPlaces.length,
        popos: poposSeen.size,
        resources: resources.length,
        transitStops: transit.length,
        sources: sources.length,
      },
      coverageNote:
        'Records come from a City asset inventory, a transit stop inventory and a small number of provider pages read by hand. Many categories have no records yet; the app says so instead of filling the gap.',
    },
    null,
    1,
  ),
);

console.log(`places: ${allPlaces.length} (incl. ${historicPlaces.length} historic features and ${poposSeen.size} POPOS)`);
console.log(`resources: ${resources.length}`);
console.log(`transit stops: ${transit.length}`);
console.log(`neighbourhoods: ${neighbourhoods.length}`);
console.log('wrote src/data/{places,resources,sources,transit,neighbourhoods,meta}.json');

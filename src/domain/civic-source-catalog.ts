/**
 * Source inventory for Night Map's neighborhood-awareness system.
 *
 * This is a documented integration plan, not a claim that every source is
 * already ingested. Only sources with an approved public API/feed, published
 * terms and a verified refresh contract should become automatic adapters.
 */
export type CivicSourceStatus = 'integrated_snapshot' | 'adapter_ready' | 'planned' | 'access_requested' | 'link_only';
export type CivicSourceDomain =
  | 'dispatch' | 'crime_reports' | '311' | 'fire_ems' | 'transport'
  | 'street_work' | 'emergency_alerts' | 'public_facilities' | 'community';

export interface CivicSource {
  id: string;
  name: string;
  domain: CivicSourceDomain;
  url: string;
  endpoint?: string;
  cadence: string;
  targetRefresh: string;
  status: CivicSourceStatus;
  auth: 'none' | 'api_key' | 'approval_required' | 'unknown';
  locationPrecision: 'coarse_zone' | 'street_segment' | 'facility_point' | 'varies';
  use: string;
  caveats: string[];
}

export const CIVIC_SOURCES: CivicSource[] = [
  {
    id: 'sfpd-dispatch-live',
    name: 'Law Enforcement Dispatched Calls for Service — Real-Time',
    domain: 'dispatch',
    url: 'https://data.sf.gov/d/gnap-fj3t',
    endpoint: 'https://data.sf.gov/resource/gnap-fj3t.json',
    cadence: 'City updates every 10 minutes; published data has an additional delay and a rolling 48-hour window',
    targetRefresh: 'Every 10–15 minutes when online; use ETag/Last-Modified if supported and back off on errors',
    status: 'integrated_snapshot',
    auth: 'none',
    locationPrecision: 'coarse_zone',
    use: 'Dated, aggregate context about published dispatched calls.',
    caveats: ['Not live dispatch or live unit tracking', 'Calls are not proof of crime', 'Sensitive rows and person-targeting categories must be excluded', 'Never publish call narratives or caller details'],
  },
  {
    id: 'sf311-cases',
    name: 'SF 311 Cases',
    domain: '311',
    url: 'https://data.sf.gov/d/vw6y-z8j6',
    endpoint: 'https://data.sf.gov/resource/vw6y-z8j6.json',
    cadence: 'Nightly refresh, typically around 6 a.m. Pacific',
    targetRefresh: 'Daily after the city refresh; show the dataset timestamp and latest record time separately',
    status: 'integrated_snapshot',
    auth: 'none',
    locationPrecision: 'coarse_zone',
    use: 'Place-condition and service-request context, including closures, street defects, graffiti, noise reports and sanitation requests where appropriate.',
    caveats: ['A complaint is not proof of wrongdoing', 'A case can be resolved, duplicated or incorrectly classified', 'Exclude encampment, homelessness, welfare, medical and other person-targeting categories', 'Do not publish free-text details or exact private addresses'],
  },
  {
    id: 'sfpd-incident-reports',
    name: 'SFPD Incident Reports (2018 to present)',
    domain: 'crime_reports',
    url: 'https://data.sf.gov/d/wg3w-h783',
    endpoint: 'https://data.sf.gov/resource/wg3w-h783.json',
    cadence: 'Dataset is refreshed periodically; verify current metadata before each adapter run',
    targetRefresh: 'Daily incremental update with overlap window for late corrections',
    status: 'planned',
    auth: 'none',
    locationPrecision: 'coarse_zone',
    use: 'Longer-window, broad-category reported-incident context, kept separate from dispatch and 311.',
    caveats: ['Reports are not a complete census', 'Records may be reclassified', 'No person names, narratives, exact addresses or sensitive categories in public map summaries'],
  },
  {
    id: 'sffd-ems-calls',
    name: 'Fire Department and EMS Dispatched Calls for Service',
    domain: 'fire_ems',
    url: 'https://data.sf.gov/d/nuek-vuh3',
    endpoint: 'https://data.sf.gov/resource/nuek-vuh3.json',
    cadence: 'Daily automated pipeline',
    targetRefresh: 'Daily after publication; use broad aggregates only',
    status: 'planned',
    auth: 'none',
    locationPrecision: 'coarse_zone',
    use: 'City activity and emergency-response context; useful for broad fire/traffic event context.',
    caveats: ['Multiple unit rows can represent one incident', 'Medical and welfare calls are highly sensitive; do not map medical call types or person situations', 'Deduplicate by incident/call identifier before aggregate counts'],
  },
  {
    id: 'sfmta-street-closures',
    name: 'Temporary Street Closures',
    domain: 'street_work',
    url: 'https://data.sf.gov/d/8x25-yybr',
    endpoint: 'https://data.sf.gov/resource/8x25-yybr.json',
    cadence: 'Underlying database changes continuously; published report is daily',
    targetRefresh: 'Daily, with start/end-time expiry in the app',
    status: 'planned',
    auth: 'none',
    locationPrecision: 'street_segment',
    use: 'Current/upcoming permitted street closures affecting routes and public-space usability.',
    caveats: ['Covers SFMTA-permitted closures only, not all City departments', 'Only permitted statuses are in the dataset', 'Expire records after end time and mark stale feeds'],
  },
  {
    id: 'sf-public-works-street-permits',
    name: 'SF Public Works Street-Use Permits',
    domain: 'street_work',
    url: 'https://data.sf.gov/d/b6tj-gt35',
    endpoint: 'https://data.sf.gov/resource/b6tj-gt35.json',
    cadence: 'Daily at approximately midnight with about a one-day lag',
    targetRefresh: 'Daily; prefer active-permit subset and filter by permit status/date',
    status: 'planned',
    auth: 'none',
    locationPrecision: 'street_segment',
    use: 'Sidewalk/road occupancy and construction work that can affect access.',
    caveats: ['Includes pending, closed and withdrawn permits unless filtered', 'One permit may appear on multiple rows', 'Permit data is not a guarantee that work is happening at that moment'],
  },
  {
    id: '511-transit-realtime',
    name: '511 SF Bay GTFS-Realtime / service alerts',
    domain: 'transport',
    url: 'https://511.org/open-data/transit',
    endpoint: 'https://api.511.org/transit/servicealerts',
    cadence: 'Real-time feed; access requires a 511 API token',
    targetRefresh: 'Poll according to 511 terms/rate limits; default documented limit is 60 requests/hour/token',
    status: 'planned',
    auth: 'api_key',
    locationPrecision: 'varies',
    use: 'Transit service alerts, trip updates and vehicle-position feeds where relevant to a route.',
    caveats: ['Request a free token and store it server-side', 'Do not poll more frequently than the feed contract permits', 'Vehicle positions are transit operations data, not a substitute for pedestrian safety information'],
  },
  {
    id: 'sf-emergency-alerts',
    name: 'NotifySF / official emergency alerts',
    domain: 'emergency_alerts',
    url: 'https://sf.gov/notify-sf',
    cadence: 'Event-driven publication; public machine-readable feed/API not verified',
    targetRefresh: 'Use an authorized subscription/feed if offered; otherwise link to the official alert channel',
    status: 'link_only',
    auth: 'unknown',
    locationPrecision: 'varies',
    use: 'Official emergency warnings, evacuation instructions and major service disruptions.',
    caveats: ['Do not scrape authenticated or private subscriber content', 'Do not claim completeness until a public API/feed contract is confirmed'],
  },
  {
    id: 'datasf-public-facilities',
    name: 'Public facilities inventory (bathrooms, drinking water, POPOS, transit stops)',
    domain: 'public_facilities',
    url: 'https://data.sf.gov/',
    cadence: 'Dataset-specific; some inventories are periodic rather than real-time',
    targetRefresh: 'Daily metadata check; only re-import when source revision changes',
    status: 'integrated_snapshot',
    auth: 'none',
    locationPrecision: 'facility_point',
    use: 'The core resource map: public places, amenities, access notes and transit stops.',
    caveats: ['Inventory presence does not prove a facility is open, stocked or accessible right now', 'Keep public-access status separate from apparent vacancy'],
  },
  {
    id: 'nextdoor-public-content',
    name: 'Nextdoor public posts and verified agency feed',
    domain: 'community',
    url: 'https://developer.nextdoor.com/reference/introduction',
    cadence: 'API-defined; search can return public posts from the last 30 days',
    targetRefresh: 'Only after developer access approval; respect display and retention requirements',
    status: 'access_requested',
    auth: 'approval_required',
    locationPrecision: 'varies',
    use: 'Potentially useful public agency notices and public neighborhood posts/events with approved access.',
    caveats: ['API access must be requested', 'Do not scrape logged-in feeds or private neighborhood content', 'Do not ingest allegations about identifiable residents as verified facts', 'Preserve source attribution and platform display rules'],
  },
  {
    id: 'spotcrime-api',
    name: 'SpotCrime public crime data / developer API',
    domain: 'crime_reports',
    url: 'https://spotcrime.io/about',
    cadence: 'Vendor-defined; confirm access, cost and licensing before use',
    targetRefresh: 'Only after terms, pricing and API access are verified',
    status: 'access_requested',
    auth: 'approval_required',
    locationPrecision: 'varies',
    use: 'Potential supplementary normalized crime reports; compare against primary official sources before displaying.',
    caveats: ['Do not assume API is free or unrestricted', 'Deduplicate against official reports', 'Keep source provenance and timestamp for every item'],
  },
  {
    id: 'crimemapping',
    name: 'CrimeMapping.com',
    domain: 'crime_reports',
    url: 'https://www.crimemapping.com/',
    cadence: 'Participating agency data is described as refreshed daily',
    targetRefresh: 'No automated ingestion until an authorized API/feed and terms are confirmed',
    status: 'link_only',
    auth: 'unknown',
    locationPrecision: 'coarse_zone',
    use: 'External reference and UX benchmark for categorized crime maps and area alerts.',
    caveats: ['Coverage depends on participating agencies', 'Displayed crime data is not all-inclusive', 'Do not reverse engineer private endpoints or bypass access controls'],
  },
];

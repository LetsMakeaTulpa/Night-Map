/** Shared Night Map / Atlas domain model. IDs are stable and namespaced. */

export type CategoryId =
  | 'food'
  | 'water'
  | 'bathroom'
  | 'hygiene'
  | 'laundry'
  | 'shelter'
  | 'services'
  | 'medical'
  | 'transit'
  | 'charging'
  | 'comms'
  | 'tech'
  | 'civic'
  | 'history'
  | 'passage'
  | 'popos'
  | 'pedestrian_connection'
  | 'urban_clue'
  | 'research_lead'
  | 'nightlife'
  | 'counterculture'
  | 'hangout'
  | 'abandoned'
  | 'mutual_aid';

export type PointGeometry = { type: 'Point'; coordinates: [number, number] };
export type LineGeometry = { type: 'LineString'; coordinates: [number, number][] };

export type SourceType = 'open_data' | 'open_map' | 'official_web' | 'routing_service' | 'geocoding_service';

export interface Source {
  id: string;
  name: string;
  url: string;
  provider: string;
  sourceType: SourceType;
  license: string;
  licenseUrl: string | null;
  retrievedAt: string;
  updateCadence: string;
  fields: string[];
  coverage: string;
  limitations: string;
  importMethod: string;
}

export type VerificationStatus =
  | 'official_source'
  | 'recently_verified'
  | 'community_reported'
  | 'community_mapped'
  | 'unverified'
  | 'temporarily_unavailable'
  | 'permanently_closed'
  | 'unknown';

export interface AccessibilityRecord {
  status: 'documented_accessible' | 'documented_not_accessible' | 'not_documented';
  note: string;
}

export type HoursSpec =
  | { kind: 'always'; note?: string }
  | {
      kind: 'weekly';
      days: number[];
      opens: string;
      closes: string;
      daysKnown: boolean;
      rawDays?: string | null;
    }
  | {
      kind: 'weekly_by_day';
      days: Record<number, { opens: string; closes: string }>;
      daysKnown: boolean;
    };

export type CostKind = 'free' | 'low_cost' | 'varies' | 'paid' | 'unknown';

/**
 * A friction entry is the honest half of an “exploit”: what it actually takes
 * to use a service — its true price, how you pay, whether an ID or an intake
 * step is required, and any published limitation. Every entry names the page it
 * came from. `value: null` means the source does not say, and the app must not
 * fill that silence with a guess.
 */
export type FrictionKind =
  | 'true_price'
  | 'free_allowance'
  | 'payment_methods'
  | 'id_required'
  | 'intake_required'
  | 'availability'
  | 'hours_access'
  | 'other';

export interface FrictionEntry {
  kind: FrictionKind;
  label: string;
  /** The published value, or null when the source is silent on this point. */
  value: string | null;
  sourceId: string;
  /** The date the cited page was read, when one is recorded. */
  asOf: string | null;
  note: string;
}

export interface Resource {
  id: string;
  placeId: string;
  name: string;
  category: CategoryId;
  serviceTypes: string[];
  cost: { kind: CostKind; note: string | null } | null;
  eligibility: string | null;
  intake: string | null;
  hours: HoursSpec | null;
  hoursNote?: string | null;
  availability: { status: 'unknown' | 'reported_available' | 'reported_unavailable' | 'closed'; note: string };
  officialContact: { phone: string | null; website: string | null } | null;
  sourceIds: string[];
  sourceUpdatedAt: string | null;
  lastVerifiedAt: string | null;
  verification: { status: VerificationStatus; label: string; note: string };
  details: Record<string, string | boolean | null>;
  /** Optional sourced cost/friction lines. Omitted records simply have none. */
  friction?: FrictionEntry[];
  license: string;
}

export interface Place {
  id: string;
  name: string;
  category: CategoryId;
  geometry: PointGeometry;
  address: string | null;
  addressType: 'street_address' | 'intersection' | 'point';
  description: string;
  accessibility: AccessibilityRecord;
  sourceIds: string[];
  status: 'active' | 'temporarily_closed' | 'permanently_closed' | 'unknown';
  locationPrecision: 'dataset_point' | 'geocoded_address' | 'osm_node';
  neighborhood: string | null;
  createdAt: string;
  updatedAt: string;
  verificationOverride?: { status: VerificationStatus; label: string; note: string };
}

export interface TransitStop {
  id: string;
  name: string;
  geometry: PointGeometry;
  onStreet: string | null;
  atStreet: string | null;
  stopId: string | null;
  sourceId: string;
  sourceUpdatedAt: string | null;
}

export interface Guide {
  id: string;
  title: string;
  neighborhood: string;
  summary: string;
  updatedAt: string;
  readingTime: string;
  orientation: { heading: string; body: string; sourceIds: string[] }[];
  stopIds: string[];
  walkingNote: string;
  limitations: string;
}

export interface Neighbourhood {
  name: string;
  rank: number;
  geometry: PointGeometry;
}

export type ObservationType =
  | 'resource_present'
  | 'resource_not_found'
  | 'hours_incorrect'
  | 'open_observed'
  | 'closed_observed'
  | 'access_issue'
  | 'infrastructure_change'
  | 'new_resource'
  | 'historical_discovery'
  | 'passage_discovery'
  | 'popos_observation'
  | 'entrance_observation'
  | 'stairs_ramp_observation'
  | 'architectural_detail'
  | 'research_lead'
  | 'follow_up'
  | 'other';

export type ObservationAccess = 'confirmed_public' | 'conditional' | 'private_restricted' | 'temporarily_closed' | 'unknown';

export interface ObservationPhoto {
  dataUrl: string;
  width: number;
  height: number;
  metadataStripped: true;
}

export interface Observation {
  id: string;
  placeId: string | null;
  placeName: string | null;
  geometry: PointGeometry | null;
  type: ObservationType;
  note: string;
  observedAt: string;
  recordedAt: string;
  photo: ObservationPhoto | null;
  accessStatus?: ObservationAccess;
  sourceReference?: string;
  confidence?: 'documented' | 'corroborated' | 'inferred' | 'disputed' | 'unverified';
  visibility: 'private' | 'group' | 'public';
  verificationStatus: 'unverified';
  updatedAt: string;
}

export interface SavedPlace {
  placeId: string;
  savedAt: string;
  collectionIds: string[];
  note: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  itemRefs: { kind: 'place' | 'route' | 'observation'; id: string }[];
  tags: string[];
  visibility: 'private';
  createdAt: string;
  updatedAt: string;
}

export interface RouteStop {
  label: string;
  placeId: string | null;
  coordinates: [number, number];
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  streetName: string | null;
}

export interface RoutePlan {
  id: string;
  name: string;
  stops: RouteStop[];
  geometry: LineGeometry | null;
  distanceMeters: number;
  durationSeconds: number | null;
  steps: RouteStep[];
  provider: string;
  providerNote: string;
  createdAt: string;
  profile: 'walking';
  savedAt?: string;
}

export type ReportIssue =
  | 'hours_wrong'
  | 'closed'
  | 'location_wrong'
  | 'access_wrong'
  | 'service_changed'
  | 'other';

/**
 * Structured report lifecycle. `needs_information` and `duplicate_candidate`
 * are set by validation, never by the reporter's own choice.
 */
export type ReportStatus =
  | 'queued'
  | 'needs_information'
  | 'duplicate_candidate'
  | 'resolved'
  | 'dismissed';

export type ReportResolution =
  | 'record_closure'
  | 'confirm_hours_note'
  | 'confirm_access_note'
  | 'flag_for_verification'
  | 'no_change';

export interface ReportEvent {
  at: string;
  kind:
    | 'received'
    | 'validated'
    | 'needs_information'
    | 'duplicate_flagged'
    | 'resolved'
    | 'dismissed'
    | 'reopened';
  note: string;
  actor: 'this device';
}

export interface CorrectionReport {
  id: string;
  placeId: string;
  placeName: string;
  issue: ReportIssue;
  note: string;
  observedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: ReportStatus;
  validation: { problems: string[]; warnings: string[] };
  duplicateOfId: string | null;
  resolution: { kind: ReportResolution; note: string; at: string } | null;
  history: ReportEvent[];
  /** No submission server exists in this release: every report stays in this browser. */
  channel: 'on_device';
}

/**
 * A reviewer's correction. It is layered on top of the bundled record and never
 * overwrites the source value, so the original evidence survives.
 */
export interface PlaceOverride {
  placeId: string;
  status?: Place['status'];
  verification?: { status: VerificationStatus; label: string; note: string };
  hoursNote?: string;
  accessNote?: string;
  reportIds: string[];
  updatedAt: string;
}

export type ChangeKind =
  | 'closure_reported'
  | 'hours_note_added'
  | 'access_note_added'
  | 'verification_flagged'
  | 'no_change';

/** One immutable line in the local correction log. */
export interface ChangeRecord {
  id: string;
  placeId: string;
  placeName: string;
  reportId: string;
  kind: ChangeKind;
  field: string;
  before: string;
  after: string;
  reason: string;
  at: string;
  actor: 'local reviewer (this device)';
  disposition: 'applied_as_local_override' | 'recorded_only';
}

export interface LayerDefinition {
  id: string;
  name: string;
  description: string;
  group: 'base' | 'transit' | 'resources' | 'personal' | 'context';
  sourceIds: string[];
  defaultVisible: boolean;
  /**
   * `bundled` ships in the install. `cached_on_demand` still works offline, but
   * only after the tiles have been fetched once, which the drawer says plainly.
   */
  offline: 'bundled' | 'cached_on_demand' | 'requires_network';
  minZoom?: number;
}

/**
 * `cctv` and `radio` open an honest status panel, not a player: there is no
 * lawful public live camera feed or radio stream for San Francisco, and the app
 * says so where a person would otherwise expect one.
 */
export type Workspace = 'map' | 'nearby' | 'routes' | 'fieldnotes' | 'atlas' | 'review' | 'cctv' | 'radio';

export type DisclosureDocumentType =
  | 'inventory'
  | 'report'
  | 'policy'
  | 'bulletin'
  | 'news_release'
  | 'privacy_statement';

/**
 * An official document about what the City collects. Night Map lists what these
 * documents say and, just as importantly, what they do not say. No camera or
 * kiosk coordinates are attached, because no official public geometry exists to
 * attach, and the app will not infer it.
 */
export interface Disclosure {
  id: string;
  title: string;
  publisher: string;
  url: string;
  documentType: DisclosureDocumentType;
  /** The date the page itself displays, or null when it displays none. */
  dateShown: string | null;
  whatItCovers: string;
  whatItDoesNotSay: string;
  locationData: 'none_published' | 'not_a_location_register' | 'summary_only';
}

export interface DisclosureFile {
  generatedAt: string;
  statement: string;
  entries: Disclosure[];
}

export interface Filters {
  categories: CategoryId[];
  openNow: boolean;
  freeOnly: boolean;
  verifiedOnly: boolean;
  maxWalkMinutes: number; // 0 = any
  nearTransit: boolean;
  accessibleOnly: boolean;
  afterDark: boolean;
  query: string;
}

export interface Settings {
  routingProvider: 'osrm' | 'disabled';
  geocodingProvider: 'local' | 'photon';
  includePhotos: boolean;
  locationPermission: 'unknown' | 'granted' | 'denied' | 'unsupported';
  backgroundLocation: false;
  units: 'metric' | 'imperial';
  showCoverageNote: boolean;
}

export interface LayerView {
  id: string;
  name: string;
  visible: Record<string, boolean>;
  createdAt: string;
}

/** What the geocoder returned for one access record, kept so it can be re-checked. */
export interface GeocodeRecord {
  query: string;
  coordinates: [number, number];
  osmMatch: string;
  displayName: string;
  retrievedAt: string;
}

/**
 * Hand-checked access records, kept in their own file so a reviewer can see
 * exactly what was added by hand, which page each fact came from, and which
 * geocoder match placed the marker.
 */
export interface AccessFile {
  generatedAt: string;
  note: string;
  geocoder: { name: string; url: string; method: string; note: string };
  places: Place[];
  resources: Resource[];
  geocodes: Record<string, GeocodeRecord>;
}

export interface AppDataset {
  places: Place[];
  resources: Resource[];
  sources: Source[];
  transit: TransitStop[];
  neighbourhoods: Neighbourhood[];
  disclosures: Disclosure[];
  meta: {
    generatedAt: string;
    footprint: { name: string; bbox: number[]; note: string };
    counts: Record<string, number>;
    coverageNote: string;
  };
}

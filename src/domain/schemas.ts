import { z } from 'zod';

const point = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});

const line = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

const hours = z.union([
  z.object({ kind: z.literal('always'), note: z.string().optional() }),
  z.object({
    kind: z.literal('weekly'),
    days: z.array(z.number().int().min(0).max(6)),
    opens: z.string().regex(/^\d{2}:\d{2}$/),
    closes: z.string().regex(/^\d{2}:\d{2}$/),
    daysKnown: z.boolean(),
    rawDays: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('weekly_by_day'),
    days: z.record(
      z.string().regex(/^[0-6]$/),
      z.object({ opens: z.string(), closes: z.string() }),
    ),
    daysKnown: z.boolean(),
  }),
]);

export const placeSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(1),
  category: z.enum([
    'food',
    'water',
    'bathroom',
    'hygiene',
    'laundry',
    'shelter',
    'services',
    'medical',
    'transit',
    'charging',
    'comms',
    'tech',
    'civic',
    'passage',
    'popos',
    'pedestrian_connection',
    'urban_clue',
    'research_lead',
    'nightlife',
    'counterculture',
    'hangout',
    'abandoned',
    'mutual_aid',
  ]),
  geometry: point,
  address: z.string().nullable(),
  addressType: z.enum(['street_address', 'intersection', 'point']),
  description: z.string(),
  accessibility: z.object({
    status: z.enum(['documented_accessible', 'documented_not_accessible', 'not_documented']),
    note: z.string(),
  }),
  sourceIds: z.array(z.string()).min(1),
  status: z.enum(['active', 'temporarily_closed', 'permanently_closed', 'unknown']),
  locationPrecision: z.enum(['dataset_point', 'geocoded_address', 'osm_node']),
  neighborhood: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  verificationOverride: z
    .object({
      status: z.enum([
        'official_source',
        'recently_verified',
        'community_reported',
        'community_mapped',
        'unverified',
        'temporarily_unavailable',
        'permanently_closed',
        'unknown',
      ]),
      label: z.string(),
      note: z.string(),
    })
    .optional(),
});

export const frictionSchema = z.object({
  kind: z.enum([
    'true_price',
    'free_allowance',
    'payment_methods',
    'id_required',
    'intake_required',
    'availability',
    'hours_access',
    'other',
  ]),
  label: z.string().min(1),
  value: z.string().min(1).nullable(),
  /** A friction line without a citation is a defect, so the id is required. */
  sourceId: z.string().min(1),
  asOf: z.string().nullable(),
  note: z.string(),
});

export const resourceSchema = z.object({
  id: z.string().min(3),
  placeId: z.string().min(3),
  name: z.string(),
  category: z.string(),
  serviceTypes: z.array(z.string()),
  cost: z
    .object({
      kind: z.enum(['free', 'low_cost', 'varies', 'paid', 'unknown']),
      note: z.string().nullable(),
    })
    .nullable(),
  eligibility: z.string().nullable(),
  intake: z.string().nullable(),
  hours: hours.nullable(),
  hoursNote: z.string().nullable().optional(),
  availability: z.object({
    status: z.enum(['unknown', 'reported_available', 'reported_unavailable', 'closed']),
    note: z.string(),
  }),
  officialContact: z
    .object({ phone: z.string().nullable(), website: z.string().nullable() })
    .nullable(),
  sourceIds: z.array(z.string()).min(1),
  sourceUpdatedAt: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  verification: z.object({
    status: z.enum([
      'official_source',
      'recently_verified',
      'community_reported',
      'community_mapped',
      'unverified',
      'temporarily_unavailable',
      'permanently_closed',
      'unknown',
    ]),
    label: z.string(),
    note: z.string(),
  }),
  details: z.record(z.union([z.string(), z.boolean(), z.null()])),
  friction: z.array(frictionSchema).optional(),
  license: z.string(),
});

export const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  provider: z.string(),
  sourceType: z.enum(['open_data', 'open_map', 'official_web', 'routing_service', 'geocoding_service']),
  license: z.string(),
  licenseUrl: z.string().url().nullable(),
  retrievedAt: z.string(),
  updateCadence: z.string(),
  fields: z.array(z.string()),
  coverage: z.string(),
  limitations: z.string(),
  importMethod: z.string(),
});

export const transitSchema = z.object({
  id: z.string(),
  name: z.string(),
  geometry: point,
  onStreet: z.string().nullable(),
  atStreet: z.string().nullable(),
  stopId: z.string().nullable(),
  sourceId: z.string(),
  sourceUpdatedAt: z.string().nullable(),
});

export const disclosureSchema = z.object({
  id: z.string().min(3),
  title: z.string().min(3),
  publisher: z.string().min(2),
  url: z.string().url(),
  documentType: z.enum(['inventory', 'report', 'policy', 'bulletin', 'news_release', 'privacy_statement']),
  dateShown: z.string().nullable(),
  whatItCovers: z.string().min(10),
  whatItDoesNotSay: z.string().min(10),
  locationData: z.enum(['none_published', 'not_a_location_register', 'summary_only']),
});

export const disclosureFileSchema = z.object({
  generatedAt: z.string(),
  statement: z.string().min(20),
  entries: z.array(disclosureSchema).min(1),
});

export const geocodeRecordSchema = z.object({
  query: z.string().min(4),
  coordinates: z.tuple([z.number(), z.number()]),
  osmMatch: z.string().min(3),
  displayName: z.string().min(3),
  retrievedAt: z.string(),
});

/**
 * The hand-checked access records, kept apart from the generated City files so a
 * reviewer can see exactly what was added by hand and where it came from.
 */
export const accessFileSchema = z.object({
  generatedAt: z.string(),
  note: z.string().min(20),
  geocoder: z.object({ name: z.string(), url: z.string().url(), method: z.string(), note: z.string() }),
  places: z.array(placeSchema),
  resources: z.array(resourceSchema),
  geocodes: z.record(geocodeRecordSchema),
});

const buildingStatusSchema = z.enum([
  'reported_vacant',
  'vacancy_history',
  'under_demolition',
  'demolition_history',
  'under_construction',
  'code_enforcement',
  'records_only',
]);

const buildingCountsSchema = z.object({
  complaints: z.number().int().min(0),
  permits: z.number().int().min(0),
  notices: z.number().int().min(0),
  vacancyComplaints: z.number().int().min(0),
  vacancyNotices: z.number().int().min(0),
  demolitionPermits: z.number().int().min(0),
  openComplaints: z.number().int().min(0),
  openNotices: z.number().int().min(0),
});

const buildingDossierSchema = z.object({
  // The City's parcel blocks are four digits, sometimes with a letter suffix
  // (3005B is a real block), so both forms are accepted.
  id: z.string().regex(/^bldg:\d{4}[A-Z]?-[A-Z0-9]+$/),
  block: z.string().regex(/^\d{4}[A-Z]?$/),
  lot: z.string().min(1),
  parcelNumber: z.string().nullable(),
  address: z.string().min(1),
  neighborhood: z.string().nullable(),
  coordinates: z.tuple([z.number(), z.number()]).nullable(),
  locationPrecision: z.enum(['permit_primary_address', 'permit', 'notice', 'block_centroid', 'none']),
  stories: z.number().nullable(),
  use: z.string().nullable(),
  permitCount: z.number().int().min(0),
  complaintCount: z.number().int().min(0),
  noticeCount: z.number().int().min(0),
  firstRecordAt: z.string().nullable(),
  lastRecordAt: z.string().nullable(),
  complaints: z.array(
    z.object({
      id: z.string(),
      date: z.string().nullable(),
      description: z.string(),
      status: z.string(),
    }),
  ),
  notices: z.array(
    z.object({
      id: z.string(),
      date: z.string().nullable(),
      item: z.string().min(1),
      category: z.string(),
      status: z.string(),
    }),
  ),
  permits: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      date: z.string().nullable(),
      description: z.string(),
    }),
  ),
  status: buildingStatusSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  score: z.number().min(0).max(100),
  counts: buildingCountsSchema,
  vacancyLatestAt: z.string().nullable(),
  demolitionLatestAt: z.string().nullable(),
});

const buildingRegistryMetaShape = {
  generatedAt: z.string(),
  sources: z.array(
    z.object({ id: z.string(), dataset: z.string(), rows: z.number().int().min(0) }),
  ),
  footprint: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  since: z.string(),
  newestRecordAt: z.string().nullable(),
  classificationNote: z.string().min(40),
  scope: z.string().min(40),
  limitations: z.array(z.string()).min(3),
  counts: z.object({
    dossiers: z.number().int().min(0),
    withCoordinates: z.number().int().min(0),
    withParcelPoint: z.number().int().min(0),
    blockCentroidPlaced: z.number().int().min(0),
    withoutCoordinates: z.number().int().min(0),
    excludedStale: z.number().int().min(0),
    vacancySignalParcels: z.number().int().min(0),
    demolitionParcels: z.number().int().min(0),
    permitsRead: z.number().int().min(0),
    complaintsRead: z.number().int().min(0),
    noticesRead: z.number().int().min(0),
    complaintsUnmatched: z.number().int().min(0),
    byStatus: z.record(z.number().int().min(0)),
  }),
};

export const buildingRegistryMetaSchema = z.object(buildingRegistryMetaShape);

/** The on-demand registry file, validated once when it is fetched. */
export const buildingRegistrySchema = z.object({
  ...buildingRegistryMetaShape,
  dossiers: z.array(buildingDossierSchema).min(1),
});

export const datasetMetaSchema = z.object({
  generatedAt: z.string(),
  footprint: z.object({ name: z.string(), bbox: z.array(z.number()).length(4), note: z.string() }),
  counts: z.record(z.number()),
  coverageNote: z.string(),
});

export const routePlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  stops: z.array(
    z.object({
      label: z.string(),
      placeId: z.string().nullable(),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
  ),
  geometry: line.nullable(),
  distanceMeters: z.number(),
  durationSeconds: z.number().nullable(),
  steps: z.array(z.object({ instruction: z.string(), distanceMeters: z.number(), streetName: z.string().nullable() })),
  provider: z.string(),
  providerNote: z.string(),
  createdAt: z.string(),
  profile: z.literal('walking'),
  savedAt: z.string().optional(),
});

export const observationSchema = z.object({
  id: z.string(),
  placeId: z.string().nullable(),
  placeName: z.string().nullable(),
  geometry: point.nullable(),
  suggestedCategory: placeSchema.shape.category.optional(),
  type: z.enum([
    'resource_present',
    'resource_not_found',
    'hours_incorrect',
    'open_observed',
    'closed_observed',
    'access_issue',
    'infrastructure_change',
    'new_resource',
    'passage_discovery',
    'popos_observation',
    'entrance_observation',
    'stairs_ramp_observation',
    'building_verification',
    'follow_up',
    'other',
  ]),
  note: z.string().max(4000),
  observedAt: z.string(),
  recordedAt: z.string(),
  accessStatus: z.enum(['confirmed_public', 'conditional', 'private_restricted', 'temporarily_closed', 'unknown']).optional(),
  // Optional so notes written before building checks existed still load.
  buildingId: z.string().min(3).nullable().optional(),
  buildingCondition: z
    .enum(['looks_vacant', 'looks_occupied', 'boarded', 'under_construction', 'demolished', 'no_access', 'no_change'])
    .optional(),
  sourceReference: z.string().max(1000).optional(),
  confidence: z.enum(['documented', 'corroborated', 'inferred', 'disputed', 'unverified']).optional(),
  photo: z
    .object({
      dataUrl: z.string().startsWith('data:image/'),
      width: z.number(),
      height: z.number(),
      metadataStripped: z.literal(true),
    })
    .nullable(),
  visibility: z.enum(['private', 'group', 'public']),
  verificationStatus: z.literal('unverified'),
  updatedAt: z.string(),
});

export const collectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  itemRefs: z.array(
    z.object({ kind: z.enum(['place', 'route', 'observation']), id: z.string() }),
  ),
  tags: z.array(z.string()),
  visibility: z.literal('private'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const savedPlaceSchema = z.object({
  placeId: z.string(),
  savedAt: z.string(),
  collectionIds: z.array(z.string()),
  note: z.string(),
});

export const reportIssueSchema = z.enum([
  'hours_wrong',
  'closed',
  'location_wrong',
  'access_wrong',
  'service_changed',
  'other',
]);

export const reportStatusSchema = z.enum([
  'queued',
  'needs_information',
  'duplicate_candidate',
  'resolved',
  'dismissed',
]);

export const reportResolutionSchema = z.enum([
  'record_closure',
  'confirm_hours_note',
  'confirm_access_note',
  'flag_for_verification',
  'no_change',
]);

/** Runtime validation for a report before it is written to local storage. */
export const correctionReportSchema = z.object({
  id: z.string().min(3),
  placeId: z.string().min(3),
  placeName: z.string().min(1),
  issue: reportIssueSchema,
  note: z.string().min(1).max(2000),
  observedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: reportStatusSchema,
  validation: z.object({ problems: z.array(z.string()), warnings: z.array(z.string()) }),
  duplicateOfId: z.string().nullable(),
  resolution: z.object({ kind: reportResolutionSchema, note: z.string(), at: z.string() }).nullable(),
  history: z
    .array(
      z.object({
        at: z.string(),
        kind: z.enum([
          'received',
          'validated',
          'needs_information',
          'duplicate_flagged',
          'resolved',
          'dismissed',
          'reopened',
        ]),
        note: z.string(),
        actor: z.literal('this device'),
      }),
    )
    .min(1),
  channel: z.literal('on_device'),
});

/** A reviewer's correction, layered over the bundled record rather than replacing it. */
export const placeOverrideSchema = z.object({
  placeId: z.string().min(3),
  status: z.enum(['active', 'temporarily_closed', 'permanently_closed', 'unknown']).optional(),
  verification: z
    .object({
      status: z.enum([
        'official_source',
        'recently_verified',
        'community_reported',
        'community_mapped',
        'unverified',
        'temporarily_unavailable',
        'permanently_closed',
        'unknown',
      ]),
      label: z.string().min(1),
      note: z.string(),
    })
    .optional(),
  hoursNote: z.string().optional(),
  accessNote: z.string().optional(),
  reportIds: z.array(z.string()).min(1),
  updatedAt: z.string(),
});

/** The append-only local change log. */
export const changeRecordSchema = z.object({
  id: z.string().min(3),
  placeId: z.string().min(3),
  placeName: z.string().min(1),
  reportId: z.string().min(1),
  kind: z.enum(['closure_reported', 'hours_note_added', 'access_note_added', 'verification_flagged', 'no_change']),
  field: z.string(),
  before: z.string(),
  after: z.string(),
  reason: z.string(),
  at: z.string(),
  actor: z.literal('local reviewer (this device)'),
  disposition: z.enum(['applied_as_local_override', 'recorded_only']),
});

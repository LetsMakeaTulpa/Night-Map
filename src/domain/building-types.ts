/**
 * Building registry types.
 *
 * The registry is deliberately separate from `Place`: a dossier is a parcel with
 * a municipal record history, not a point of interest with opening hours. It is
 * fetched on first use from `/buildings/registry.json` because the bundled
 * dossiers are several megabytes.
 */
export type BuildingStatus =
  | 'reported_vacant'
  | 'vacancy_history'
  | 'under_demolition'
  | 'demolition_history'
  | 'under_construction'
  | 'code_enforcement'
  | 'records_only';

export type BuildingConfidence = 'high' | 'medium' | 'low';

/**
 * A registry filter. `vacancy` groups the two reported-vacancy classes; it is
 * never a finding that a building is empty.
 */
export type BuildingFilter = 'all' | 'vacancy' | BuildingStatus;

/**
 * A field observation of a building's condition. It is deliberately coarse and
 * visual: a person can record what a doorway looks like, not adjudicate vacancy.
 */
export type BuildingCondition =
  | 'looks_vacant'
  | 'looks_occupied'
  | 'boarded'
  | 'under_construction'
  | 'demolished'
  | 'no_access'
  | 'no_change';

export type BuildingLocationPrecision =
  | 'permit_primary_address'
  | 'permit'
  | 'notice'
  | 'block_centroid'
  | 'none';

export interface BuildingComplaint {
  id: string;
  date: string | null;
  description: string;
  status: string;
}

export interface BuildingNotice {
  id: string;
  date: string | null;
  item: string;
  category: string;
  status: string;
}

export interface BuildingPermit {
  id: string;
  type: string;
  status: string;
  date: string | null;
  description: string;
}

export interface BuildingCounts {
  complaints: number;
  permits: number;
  notices: number;
  vacancyComplaints: number;
  vacancyNotices: number;
  demolitionPermits: number;
  openComplaints: number;
  openNotices: number;
}

/** One parcel's dossier. Records are a preserved sample; counts are the full set. */
export interface BuildingDossier {
  id: string;
  block: string;
  lot: string;
  parcelNumber: string | null;
  address: string;
  neighborhood: string | null;
  coordinates: [number, number] | null;
  locationPrecision: BuildingLocationPrecision;
  stories: number | null;
  use: string | null;
  permitCount: number;
  complaintCount: number;
  noticeCount: number;
  firstRecordAt: string | null;
  lastRecordAt: string | null;
  complaints: BuildingComplaint[];
  notices: BuildingNotice[];
  permits: BuildingPermit[];
  status: BuildingStatus;
  confidence: BuildingConfidence;
  score: number;
  counts: BuildingCounts;
  vacancyLatestAt: string | null;
  demolitionLatestAt: string | null;
}

export type AbandonedBuildingStatus = 'reported_vacant' | 'vacancy_history';

/** A located vacancy/abandonment dossier, shipped separately from the full registry. */
export interface AbandonedBuilding {
  id: string;
  address: string;
  status: AbandonedBuildingStatus;
  coordinates: [number, number];
  locationPrecision: BuildingLocationPrecision;
}

export interface AbandonedBuildingFile {
  generatedAt: string;
  totalVacancy: number;
  located: number;
  blockCentroid: number;
  dossiers: AbandonedBuilding[];
}

export interface BuildingRegistrySource {
  id: string;
  dataset: string;
  rows: number;
}

export interface BuildingRegistryMeta {
  generatedAt: string;
  sources: BuildingRegistrySource[];
  footprint: { west: number; south: number; east: number; north: number };
  /** The bundled window; older records remain in the City datasets. */
  since: string;
  newestRecordAt: string | null;
  classificationNote: string;
  scope: string;
  limitations: string[];
  counts: {
    dossiers: number;
    withCoordinates: number;
    withParcelPoint: number;
    blockCentroidPlaced: number;
    withoutCoordinates: number;
    excludedStale: number;
    vacancySignalParcels: number;
    demolitionParcels: number;
    permitsRead: number;
    complaintsRead: number;
    noticesRead: number;
    complaintsUnmatched: number;
    byStatus: Record<string, number>;
  };
}

export interface BuildingRegistry extends BuildingRegistryMeta {
  dossiers: BuildingDossier[];
}

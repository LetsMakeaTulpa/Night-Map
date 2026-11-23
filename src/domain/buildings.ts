/**
 * Reading rules for the building registry.
 *
 * The registry is a set of parcel-linked dossiers derived from three San
 * Francisco Department of Building Inspection datasets. A dossier is a reading
 * of records — never a finding about who is inside a building or whether a door
 * is open today — so every helper here says what it is quoting.
 */
import type { BuildingCondition, BuildingDossier, BuildingStatus, Observation } from './types';
import { formatDate } from './status';

export interface BuildingStatusMeta {
  id: BuildingStatus;
  label: string;
  short: string;
  color: string;
  note: string;
}

export const BUILDING_STATUSES: BuildingStatusMeta[] = [
  {
    id: 'reported_vacant',
    label: 'Reported vacant',
    short: 'Vacancy reported',
    color: '#E0A458',
    note: 'A complaint or notice describing a vacant, abandoned or derelict condition was filed within the last two years.',
  },
  {
    id: 'vacancy_history',
    label: 'Vacancy report on file',
    short: 'Vacancy on file',
    color: '#B98A5A',
    note: 'A vacancy or dereliction record exists, but the newest one is more than two years old.',
  },
  {
    id: 'under_demolition',
    label: 'Demolition permitted',
    short: 'Demolition',
    color: '#D96C4F',
    note: 'A demolition permit is on file and the City has not recorded it as complete, cancelled, withdrawn or expired.',
  },
  {
    id: 'demolition_history',
    label: 'Demolition permit on file',
    short: 'Demolition history',
    color: '#9E7A5A',
    note: 'A demolition permit exists on the parcel, but none is currently open.',
  },
  {
    id: 'under_construction',
    label: 'Construction permitted',
    short: 'Construction',
    color: '#6E9AA8',
    note: 'A construction or alteration permit is open. This is a permitted-work signal, not evidence that work is happening today.',
  },
  {
    id: 'code_enforcement',
    label: 'Open enforcement',
    short: 'Enforcement',
    color: '#C9B27A',
    note: 'One or more complaints or notices are still marked open by the City. The records are not all about vacancy.',
  },
  {
    id: 'records_only',
    label: 'Records only',
    short: 'Records',
    color: '#8A8F86',
    note: 'The parcel has City records but no current vacancy, demolition or open-enforcement signal.',
  },
];

const STATUS_BY_ID = new Map(BUILDING_STATUSES.map((status) => [status.id, status]));

export function buildingStatusMeta(status: BuildingStatus): BuildingStatusMeta {
  return STATUS_BY_ID.get(status) ?? BUILDING_STATUSES[BUILDING_STATUSES.length - 1];
}

/**
 * Condition checks are a person's visual note, not a City finding. The wording
 * keeps that distinction: “looks vacant”, never “vacant”.
 */
export const BUILDING_CONDITIONS: { id: BuildingCondition; label: string; note: string }[] = [
  {
    id: 'looks_vacant',
    label: 'Looks vacant',
    note: 'No visible occupancy or activity — a visual impression from outside, not an inspection.',
  },
  {
    id: 'looks_occupied',
    label: 'Looks occupied',
    note: 'Signs of use: lights, furnishings, people or an active entrance.',
  },
  {
    id: 'boarded',
    label: 'Boarded or secured',
    note: 'Openings covered, barricaded or otherwise secured.',
  },
  {
    id: 'under_construction',
    label: 'Work under way',
    note: 'Scaffolding, posted permits, materials or active work on site.',
  },
  {
    id: 'demolished',
    label: 'Demolished or empty lot',
    note: 'Structure gone or the site cleared.',
  },
  {
    id: 'no_access',
    label: 'Could not observe',
    note: 'No view of the building; nothing about its condition is recorded.',
  },
  {
    id: 'no_change',
    label: 'No change since last check',
    note: 'The condition looks the same as your previous check on this device.',
  },
];

const CONDITION_BY_ID = new Map(BUILDING_CONDITIONS.map((condition) => [condition.id, condition]));

export function buildingConditionLabel(id: BuildingCondition | null | undefined): string {
  if (!id) return 'Condition not recorded';
  return CONDITION_BY_ID.get(id)?.label ?? id;
}

export interface BuildingCheckSummary {
  count: number;
  latest: Observation | null;
}

/** Private checks for one parcel, newest first. Never mixed into City counts. */
export function buildingCheckSummary(observations: Observation[], buildingId: string): BuildingCheckSummary {
  const checks = observations
    .filter((observation) => observation.buildingId === buildingId)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return { count: checks.length, latest: checks[0] ?? null };
}

export const CONFIDENCE_LABELS = {
  high: 'two independent record types, recent',
  medium: 'one record type, recent',
  low: 'older records or a single record',
} as const;

export const LOCATION_PRECISION_LABELS = {
  permit_primary_address: 'permit primary-address point',
  permit: 'permit address point',
  notice: 'notice of violation point',
  block_centroid: 'block centroid — not the parcel',
  none: 'no published point',
} as const;

/**
 * The display counterpart of the build-time scoring. The score itself is
 * computed once from the complete record set, so the app never re-scores a
 * dossier from the trimmed records it ships.
 */
export function buildingScoreInputs(dossier: BuildingDossier): string[] {
  const counts = dossier.counts;
  const rows: string[] = [];
  if (counts.vacancyComplaints > 0) {
    rows.push(
      `${counts.vacancyComplaints} complaint${counts.vacancyComplaints === 1 ? '' : 's'} describing a vacant, abandoned or derelict condition${
        dossier.vacancyLatestAt ? ` (newest ${dossier.vacancyLatestAt})` : ''
      }`,
    );
  }
  if (counts.vacancyNotices > 0) {
    rows.push(
      `${counts.vacancyNotices} notice of violation item${counts.vacancyNotices === 1 ? '' : 's'} about a vacant or secured structure`,
    );
  }
  if (counts.demolitionPermits > 0) {
    rows.push(
      `${counts.demolitionPermits} demolition permit${counts.demolitionPermits === 1 ? '' : 's'} on file${
        dossier.status === 'under_demolition' ? ', at least one not closed' : ''
      }`,
    );
  }
  if (counts.vacancyComplaints > 0 && counts.vacancyNotices > 0) {
    rows.push('A complaint and a notice both describe the condition, which is two independent City records rather than one');
  }
  if (counts.openComplaints + counts.openNotices > 0) {
    rows.push(
      `${counts.openComplaints + counts.openNotices} record${
        counts.openComplaints + counts.openNotices === 1 ? '' : 's'
      } still marked open by the City`,
    );
  }
  if (rows.length === 0) {
    rows.push('The score rests on the records listed below; no single record establishes vacancy.');
  }
  return rows;
}

export interface BuildingTimelineEvent {
  at: string;
  kind: 'complaint' | 'notice' | 'permit';
  title: string;
  detail: string;
  status: string;
  recordId: string;
  sourceId: string;
}

/**
 * Chronology is derived from the preserved records, so the timeline cannot
 * drift from the evidence. Oldest first: a dossier reads as a history.
 */
export function buildingTimeline(dossier: BuildingDossier): BuildingTimelineEvent[] {
  const events: BuildingTimelineEvent[] = [];
  for (const row of dossier.complaints) {
    events.push({
      at: row.date ?? '',
      kind: 'complaint',
      title: `DBI complaint ${row.id}`,
      detail: row.description,
      status: row.status,
      recordId: row.id,
      sourceId: 'src:sfgov-dbi-complaints',
    });
  }
  for (const row of dossier.notices) {
    events.push({
      at: row.date ?? '',
      kind: 'notice',
      title: `Notice of violation ${row.id}`,
      detail: row.item,
      status: row.status,
      recordId: row.id,
      sourceId: 'src:sfgov-dbi-novs',
    });
  }
  for (const row of dossier.permits) {
    events.push({
      at: row.date ?? '',
      kind: 'permit',
      title: `Permit ${row.id} filed`,
      detail: row.description ? `${row.type} — ${row.description}` : row.type,
      status: row.status,
      recordId: row.id,
      sourceId: 'src:sfgov-dbi-permits',
    });
  }
  return events
    .filter((event) => Boolean(event.at))
    .sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title));
}

export function formatParcel(dossier: BuildingDossier): string {
  return `${dossier.block} / ${dossier.lot}`;
}

export function buildingSearchText(dossier: BuildingDossier): string {
  return [
    dossier.address,
    dossier.block,
    dossier.lot,
    dossier.parcelNumber ?? '',
    dossier.neighborhood ?? '',
    dossier.id,
    buildingStatusMeta(dossier.status).label,
    dossier.use ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function filterBuildings(
  dossiers: BuildingDossier[],
  options: { query: string; status: BuildingStatus | 'all' },
): BuildingDossier[] {
  const query = options.query.trim().toLowerCase();
  return dossiers.filter((dossier) => {
    if (options.status !== 'all' && dossier.status !== options.status) return false;
    if (!query) return true;
    return buildingSearchText(dossier).includes(query);
  });
}

/** One line for a list row, quoting the newest record rather than a status claim. */
export function buildingRecordSummary(dossier: BuildingDossier): string {
  const rows = [
    `${dossier.counts.complaints} complaint${dossier.counts.complaints === 1 ? '' : 's'}`,
    `${dossier.counts.notices} notice${dossier.counts.notices === 1 ? '' : 's'}`,
    `${dossier.counts.permits} permit${dossier.counts.permits === 1 ? '' : 's'}`,
  ];
  return `${rows.join(' · ')}${dossier.lastRecordAt ? ` · newest ${formatDate(dossier.lastRecordAt)}` : ''}`;
}

export function describeCoverage(dossier: BuildingDossier): string {
  const precision = LOCATION_PRECISION_LABELS[dossier.locationPrecision];
  if (!dossier.coordinates) return precision;
  return `${precision}`;
}

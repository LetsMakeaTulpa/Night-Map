#!/usr/bin/env node
/**
 * Build the Night Map building registry from three City datasets.
 *
 * The registry is a parcel-linked dossier set, not a set of pins: complaints and
 * notices of violation are joined to permits on the block/lot parcel identifier,
 * so a building keeps its history even when an address is recorded differently
 * across datasets.
 *
 * Scope, stated plainly: a parcel enters the registry if at least one public
 * record describes a vacant, abandoned, boarded or derelict condition, or if a
 * demolition permit has been filed on it. That is deliberately narrower than
 * "every building with a permit" and wider than "confirmed abandoned buildings",
 * because San Francisco publishes no such confirmation.
 *
 * Sources (PDDL 1.0):
 *   - DBI Complaints                   gm2e-bten
 *   - DBI Building Permits             i98e-djp9
 *   - DBI Notices of Violation         nbtm-fbw5
 *
 * Usage:
 *   node scripts/fetch-building-registry.mjs
 *   node scripts/fetch-building-registry.mjs --refresh   # ignore cached SODA pages
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BOARD_RE,
  CLASSIFICATION_NOTE,
  DEMOLITION_RE,
  VACANCY_RE,
  buildingTimeline,
  cleanText,
  formatAddress,
  isOpenComplaint,
  isOpenNotice,
  normalizeBlock,
  normalizeLot,
  parcelId,
  parcelKey,
  sortDossiers,
  vacancyAssessment,
} from './lib/building-registry.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache', 'building-registry');
// The dossiers are a few megabytes, so they ship like the incident snapshots:
// fetched the first time the Buildings workspace or its map layer is opened,
// then cached by the service worker for offline use.
const OUT = path.join(ROOT, 'public', 'buildings');
const META_OUT = path.join(ROOT, 'src', 'data');

const REFRESH = process.argv.includes('--refresh');

// The same footprint the map, basemap and 3D footprints use.
const BBOX = 'within_box(location,37.7975,-122.429,37.7585,-122.3905)';
const WEST = -122.429;
const SOUTH = 37.7585;
const EAST = -122.3905;
const NORTH = 37.7975;

const SINCE = '2005-01-01';
// Only candidates that still matter for a field check enter the bundled registry. A
// vacancy report from 2009 is still in the City's datasets and can be queried
// there; it does not need to sit in every phone's install.
const VACANCY_SINCE = '2022-01-01';
const PAGE = 50_000;
// Three records of each kind beside the full counts: enough for a chronological
// read, small enough to bundle eight thousand parcels.
const RECORDS_KEPT = 3;
const RECORD_TEXT = 120;

const DATASETS = {
  permits: {
    id: 'i98e-djp9',
    select: [
      'permit_number',
      'permit_type_definition',
      'block',
      'lot',
      'street_number',
      'street_name',
      'street_suffix',
      'status',
      'filed_date',
      'issued_date',
      'last_permit_activity_date',
      'description',
      'existing_use',
      'proposed_use',
      'number_of_existing_stories',
      'number_of_proposed_stories',
      'existing_units',
      'proposed_units',
      'estimated_cost',
      'primary_address_flag',
      'neighborhoods_analysis_boundaries',
      'location',
      'data_as_of',
    ].join(','),
    where: `${BBOX} AND filed_date > '${SINCE}'`,
    order: ':id',
  },
  notices: {
    id: 'nbtm-fbw5',
    select: [
      'complaint_number',
      'item_sequence_number',
      'primary_key',
      'date_filed',
      'block',
      'lot',
      'street_number',
      'street_name',
      'street_suffix',
      'status',
      'nov_category_description',
      'item',
      'neighborhoods_analysis_boundaries',
      'location',
      'data_as_of',
    ].join(','),
    where: `${BBOX} AND date_filed > '${SINCE}'`,
    order: ':id',
  },
  complaints: {
    id: 'gm2e-bten',
    select: [
      'complaint_number',
      'date_filed',
      'last_inspection_date',
      'date_abated',
      'block',
      'lot',
      'parcel_number',
      'street_number',
      'street_name',
      'street_suffix',
      'complaint_description',
      'status',
      'nov_type',
      'data_as_of',
    ].join(','),
    // Complaints carry no point, so they cannot be filtered with within_box.
    // Keyword selection is the only spatial join available before block/lot
    // matching, and the unmatched remainder is reported at the end.
    where: `date_filed > '${SINCE}' AND (lower(complaint_description) like '%vacant%' OR lower(complaint_description) like '%abandon%' OR lower(complaint_description) like '%derelict%' OR lower(complaint_description) like '%boarded%' OR lower(complaint_description) like '%unsecured%' OR lower(complaint_description) like '%squat%' OR lower(complaint_description) like '%nuisance%')`,
    order: ':id',
  },
};

async function readCache(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchPage(dataset, offset) {
  const file = path.join(CACHE, `${dataset}-${offset}.json`);
  if (!REFRESH) {
    const cached = await readCache(file);
    if (cached) return cached;
  }
  const url =
    `https://data.sfgov.org/resource/${DATASETS[dataset].id}.json` +
    `?$select=${encodeURIComponent(DATASETS[dataset].select)}` +
    `&$where=${encodeURIComponent(DATASETS[dataset].where)}` +
    `&$order=${encodeURIComponent(DATASETS[dataset].order)}` +
    `&$limit=${PAGE}&$offset=${offset}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NightMap-SF/0.1 (civic field map; contact: nightmap@example.org)',
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('unexpected payload');
      await writeFile(file, JSON.stringify(rows));
      return rows;
    } catch (error) {
      console.log(`  retry ${dataset} offset ${offset} (${attempt}/4): ${error.message}`);
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  return [];
}

async function fetchAll(dataset) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(dataset, offset);
    rows.push(...page);
    console.log(`  ${dataset}: ${rows.length} rows${page.length < PAGE ? ' (last page)' : ''}`);
    if (page.length < PAGE) break;
  }
  return rows;
}

function pointOf(row) {
  const point = row?.location;
  if (!point || point.type !== 'Point' || !Array.isArray(point.coordinates)) return null;
  const [lon, lat] = point.coordinates.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < WEST || lon > EAST || lat < SOUTH || lat > NORTH) return null;
  return [lon, lat];
}

function normalizePermit(row) {
  return {
    id: String(row.permit_number ?? ''),
    type: cleanText(row.permit_type_definition, 60),
    status: cleanText(row.status, 24),
    date: String(row.filed_date ?? row.issued_date ?? '').slice(0, 10) || null,
    description: cleanText(row.description, RECORD_TEXT),
    use: row.proposed_use ? cleanText(row.proposed_use, 50) : row.existing_use ? cleanText(row.existing_use, 50) : null,
    stories: Number(row.number_of_proposed_stories ?? row.number_of_existing_stories) || null,
    address: formatAddress(row),
    neighborhood: row.neighborhoods_analysis_boundaries || null,
    coordinates: pointOf(row),
    primary: row.primary_address_flag === 'Y',
  };
}

function normalizeComplaint(row) {
  return {
    id: String(row.complaint_number ?? ''),
    date: String(row.date_filed ?? '').slice(0, 10) || null,
    description: cleanText(row.complaint_description, RECORD_TEXT),
    status: cleanText(row.status, 24),
    parcel: row.parcel_number ? String(row.parcel_number) : null,
    address: formatAddress(row),
  };
}

function normalizeNotice(row) {
  const sequence = row.item_sequence_number ? String(row.item_sequence_number) : '';
  return {
    id: `${row.complaint_number ?? ''}${sequence ? `-${sequence}` : ''}`,
    date: String(row.date_filed ?? '').slice(0, 10) || null,
    item: cleanText(row.item, RECORD_TEXT),
    category: cleanText(row.nov_category_description, 50),
    status: cleanText(row.status, 24),
    address: formatAddress(row),
    neighborhood: row.neighborhoods_analysis_boundaries || null,
    coordinates: pointOf(row),
  };
}

/** The most common non-empty value, so one stray address cannot rename a parcel. */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function buildRegistry({ permits, complaints, notices }) {
  const parcels = new Map();
  const ensure = (block, lot) => {
    const key = parcelKey(block, lot);
    if (!key) return null;
    let parcel = parcels.get(key);
    if (!parcel) {
      parcel = {
        key,
        block: normalizeBlock(block),
        lot: normalizeLot(lot),
        permits: [],
        complaints: [],
        notices: [],
        parcelNumbers: [],
        addresses: [],
        neighborhoods: [],
        coordinates: null,
        coordinateSource: null,
        locations: [],
      };
      parcels.set(key, parcel);
    }
    return parcel;
  };

  for (const row of permits) {
    const parcel = ensure(row.block, row.lot);
    if (!parcel) continue;
    const permit = normalizePermit(row);
    parcel.permits.push(permit);
    if (permit.address) parcel.addresses.push(permit.address);
    if (permit.neighborhood) parcel.neighborhoods.push(permit.neighborhood);
    if (permit.coordinates) {
      parcel.locations.push({
        coordinates: permit.coordinates,
        kind: permit.primary ? 'permit_primary_address' : 'permit',
        date: permit.date,
      });
    }
  }

  for (const row of notices) {
    const parcel = ensure(row.block, row.lot);
    if (!parcel) continue;
    const notice = normalizeNotice(row);
    parcel.notices.push(notice);
    if (notice.address) parcel.addresses.push(notice.address);
    if (notice.neighborhood) parcel.neighborhoods.push(notice.neighborhood);
    if (notice.coordinates) {
      parcel.locations.push({ coordinates: notice.coordinates, kind: 'notice', date: notice.date });
    }
  }

  for (const row of complaints) {
    const parcel = ensure(row.block, row.lot);
    if (!parcel) continue;
    const complaint = normalizeComplaint(row);
    parcel.complaints.push(complaint);
    if (complaint.address) parcel.addresses.push(complaint.address);
    if (complaint.parcel) parcel.parcelNumbers.push(complaint.parcel);
  }

  // Parcels the City never placed on a map still get a dossier, and the block's
  // own geocoded parcels give a coarse position for them. It is labelled a block
  // centroid everywhere it appears, never a parcel point.
  const blockPoints = new Map();
  for (const parcel of parcels.values()) {
    for (const location of parcel.locations) {
      const list = blockPoints.get(parcel.block) ?? [];
      list.push(location.coordinates);
      blockPoints.set(parcel.block, list);
    }
  }
  const blockCentroid = new Map();
  for (const [block, points] of blockPoints.entries()) {
    if (points.length < 2) continue;
    const lon = points.reduce((total, point) => total + point[0], 0) / points.length;
    const lat = points.reduce((total, point) => total + point[1], 0) / points.length;
    blockCentroid.set(block, [Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
  }

  const kept = [];
  let droppedNoCoordinates = 0;
  let blockPlaced = 0;
  let excludedStale = 0;
  let vacancyParcels = 0;
  let demolitionParcels = 0;

  // The same permit can appear on more than one City row (a permit with two
  // addresses, for instance), and a notice header arrives with no item text.
  // De-duplicate before anything is counted, so a repeated row can never look
  // like a second independent record.
  const unique = (rows, key) => {
    const seen = new Map();
    for (const row of rows) {
      const id = key(row);
      if (!seen.has(id)) seen.set(id, row);
    }
    return [...seen.values()];
  };

  for (const parcel of parcels.values()) {
    parcel.permits = unique(parcel.permits, (row) => `${row.id}|${row.date}|${row.description}`);
    parcel.complaints = unique(parcel.complaints, (row) => `${row.id}|${row.date}|${row.description}`);
    parcel.notices = unique(
      parcel.notices.filter((row) => row.item.length > 0),
      (row) => `${row.id}|${row.item}`,
    );

    const vacancyComplaints = parcel.complaints.filter((row) => VACANCY_RE.test(row.description));
    const vacancyNotices = parcel.notices.filter((row) => VACANCY_RE.test(row.item));
    const boardNotices = parcel.notices.filter((row) => BOARD_RE.test(row.item));
    const demolitionPermits = parcel.permits.filter(
      (row) => DEMOLITION_RE.test(row.type) || DEMOLITION_RE.test(row.description),
    );
    const vacancyRecords = [...vacancyComplaints, ...vacancyNotices, ...boardNotices];
    const latestVacancyDate = vacancyRecords
      .map((row) => row.date)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const latestDemolitionDate = demolitionPermits
      .map((row) => row.date)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const openEnforcement =
      parcel.complaints.some((row) => isOpenComplaint(row.status)) ||
      parcel.notices.some((row) => isOpenNotice(row.status));
    const include =
      (latestVacancyDate && latestVacancyDate >= VACANCY_SINCE) ||
      (latestDemolitionDate && latestDemolitionDate >= VACANCY_SINCE) ||
      openEnforcement;
    if (!include) {
      if (vacancyRecords.length + demolitionPermits.length > 0) excludedStale += 1;
      continue;
    }
    if (vacancyRecords.length > 0) vacancyParcels += 1;
    if (demolitionPermits.length > 0) demolitionParcels += 1;

    // Prefer a permit's primary-address point, then any permit point, then a
    // notice point. Never invent a coordinate for a parcel the City placed
    // nowhere: the dossier keeps its place in the table and is left off the map.
    const ordered = [...parcel.locations].sort((a, b) => {
      const rank = (kind) => (kind === 'permit_primary_address' ? 0 : kind === 'permit' ? 1 : 2);
      return rank(a.kind) - rank(b.kind) || String(a.date ?? '').localeCompare(String(b.date ?? ''));
    });
    let location = ordered[0] ?? null;
    if (!location) {
      const centroid = blockCentroid.get(parcel.block);
      if (centroid) {
        location = { coordinates: centroid, kind: 'block_centroid', date: null };
        blockPlaced += 1;
      } else {
        droppedNoCoordinates += 1;
      }
    }

    const newestFirst = (field) => (a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? ''));
    const permits = parcel.permits.sort(newestFirst('date'));
    const complaints = parcel.complaints.sort(newestFirst('date'));
    const notices = parcel.notices.sort(newestFirst('date'));

    // Score and count from the complete record set, before the bundled sample
    // is trimmed. Trimming first would quietly turn a parcel with twelve
    // complaints into a parcel with three.
    const assessment = vacancyAssessment({ complaints, permits, notices });
    const allDates = [...complaints, ...notices, ...permits]
      .map((row) => row.date)
      .filter(Boolean)
      .sort();

    const dossier = {
      id: parcelId(parcel.block, parcel.lot),
      block: parcel.block,
      lot: parcel.lot,
      parcelNumber: mostCommon(parcel.parcelNumbers),
      address: mostCommon(parcel.addresses) ?? `${parcel.block}-${parcel.lot}`,
      neighborhood: mostCommon(parcel.neighborhoods),
      coordinates: location?.coordinates ?? null,
      locationPrecision: location ? location.kind : 'none',
      stories: permits.find((row) => row.stories)?.stories ?? null,
      use: permits.find((row) => row.use)?.use ?? null,
      // Counts describe the full set; the arrays below are the bundled sample.
      permitCount: permits.length,
      complaintCount: complaints.length,
      noticeCount: notices.length,
      firstRecordAt: allDates[0] ?? null,
      lastRecordAt: allDates.at(-1) ?? null,
      complaints: complaints.slice(0, RECORDS_KEPT).map(({ address, parcel, ...rest }) => rest),
      notices: notices.slice(0, RECORDS_KEPT).map(({ address, neighborhood, coordinates, ...rest }) => rest),
      permits: permits
        .slice(0, RECORDS_KEPT)
        .map(({ coordinates, primary, address, neighborhood, use, stories, ...rest }) => rest),
      status: assessment.status,
      confidence: assessment.confidence,
      score: assessment.score,
      counts: assessment.counts,
      vacancyLatestAt: assessment.latestVacancy,
      demolitionLatestAt: assessment.latestDemolition,
    };

    // A parcel whose only records are stale construction history is not a
    // vacancy candidate; the City still publishes it, and the app can link to it.
    if (dossier.status === 'records_only') {
      excludedStale += 1;
      continue;
    }
    kept.push(dossier);
  }

  return {
    dossiers: sortDossiers(kept),
    droppedNoCoordinates,
    blockPlaced,
    excludedStale,
    vacancyParcels,
    demolitionParcels,
  };
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  console.log('Fetching DBI permits, notices of violation and complaints…');
  const [permitRows, noticeRows, complaintRows] = [
    await fetchAll('permits'),
    await fetchAll('notices'),
    await fetchAll('complaints'),
  ];

  console.log('Joining records on block/lot…');
  const {
    dossiers,
    droppedNoCoordinates,
    blockPlaced,
    excludedStale,
    vacancyParcels,
    demolitionParcels,
  } = buildRegistry({
    permits: permitRows,
    complaints: complaintRows,
    notices: noticeRows,
  });

  const generatedAt = new Date().toISOString();
  const newest = dossiers.reduce(
    (latest, dossier) => (dossier.lastRecordAt && dossier.lastRecordAt > latest ? dossier.lastRecordAt : latest),
    '',
  );

  const byStatus = {};
  for (const dossier of dossiers) byStatus[dossier.status] = (byStatus[dossier.status] ?? 0) + 1;

  const header = {
    generatedAt,
    sources: [
      { id: 'src:sfgov-dbi-complaints', dataset: 'gm2e-bten', rows: complaintRows.length },
      { id: 'src:sfgov-dbi-permits', dataset: 'i98e-djp9', rows: permitRows.length },
      { id: 'src:sfgov-dbi-novs', dataset: 'nbtm-fbw5', rows: noticeRows.length },
    ],
    footprint: { west: WEST, south: SOUTH, east: EAST, north: NORTH },
    since: SINCE,
    newestRecordAt: newest || null,
    classificationNote: CLASSIFICATION_NOTE,
    scope:
      'Parcels in the footprint with at least one public record describing a vacant, abandoned, boarded or derelict condition, or with a demolition permit on file. Every dossier keeps its underlying records; the classification is a reading of those records, not a finding that a building is empty today.',
    counts: {
      dossiers: dossiers.length,
      // Counted from what was actually written, so a parcel dropped from the
      // build can never inflate a total.
      withCoordinates: dossiers.filter((dossier) => dossier.coordinates).length,
      withParcelPoint: dossiers.filter(
        (dossier) => dossier.locationPrecision === 'permit_primary_address' || dossier.locationPrecision === 'permit' || dossier.locationPrecision === 'notice',
      ).length,
      blockCentroidPlaced: dossiers.filter((dossier) => dossier.locationPrecision === 'block_centroid').length,
      withoutCoordinates: dossiers.filter((dossier) => !dossier.coordinates).length,
      excludedStale: excludedStale,
      vacancySignalParcels: vacancyParcels,
      demolitionParcels,
      permitsRead: permitRows.length,
      complaintsRead: complaintRows.length,
      noticesRead: noticeRows.length,
      complaintsUnmatched: complaintRows.length - dossiers.reduce((total, dossier) => total + dossier.complaintCount, 0),
      byStatus,
    },
    limitations: [
      'The City publishes no vacant-building register, so this registry is derived from complaint, permit and violation records. It cannot establish that a building is empty today.',
      'Only the newest three records of each kind are bundled with a dossier; the counts and dates describe the full set the City returned. Older rows stay queryable in the City datasets.',
      'A dossier without a City-published point is placed at the centroid of the geocoded parcels on the same block. That is a block-level position and is labelled as one.',
      'A complaint is a report, not an inspection finding, and a notice of violation is a notice, not a court decision.',
      'Complaints are selected by keyword because the dataset carries no coordinates, then joined on block/lot. A complaint whose wording avoids the keyword list is not in this build, and a parcel the City never placed on a map has no point of its own.',
      'The bundled window starts in 2022. Earlier complaints, permits and notices remain in the City datasets and are not deleted; they are simply not bundled in every install.',
      'Addresses are composed from the number, street name and suffix columns; the City does not publish a unit or a canonical address string in these datasets.',
    ],
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'registry.json'), `${JSON.stringify({ ...header, dossiers })}\n`);
  // The map needs vacancy/abandonment parcels by default; the full registry is
  // several megabytes and stays on demand. This file carries positions only.
  const abandoned = dossiers
    .filter(
      (dossier) =>
        (dossier.status === 'reported_vacant' || dossier.status === 'vacancy_history') &&
        dossier.coordinates,
    )
    .map((dossier) => ({
      id: dossier.id,
      address: dossier.address,
      status: dossier.status,
      coordinates: dossier.coordinates,
      locationPrecision: dossier.locationPrecision,
    }));
  await writeFile(
    path.join(OUT, 'abandoned.json'),
    `${JSON.stringify({
      generatedAt: header.generatedAt,
      totalVacancy: (byStatus.reported_vacant ?? 0) + (byStatus.vacancy_history ?? 0),
      located: abandoned.length,
      blockCentroid: abandoned.filter((dossier) => dossier.locationPrecision === 'block_centroid').length,
      dossiers: abandoned,
    })}\n`,
  );
  await writeFile(
    path.join(META_OUT, 'building-registry-meta.json'),
    `${JSON.stringify({ ...header, dossiers: undefined }, null, 1)}\n`,
  );

  console.log(`\nWrote ${dossiers.length} dossiers`);
  console.log(`  vacancy-signal parcels: ${vacancyParcels}`);
  console.log(`  demolition parcels:    ${demolitionParcels}`);
  console.log(`  with parcel point:     ${dossiers.filter((d) => d.locationPrecision !== 'block_centroid' && d.locationPrecision !== 'none').length}`);
  console.log(`  block centroid:        ${blockPlaced}`);
  console.log(`  without a point:       ${droppedNoCoordinates}`);
  console.log(`  excluded as stale:     ${excludedStale}`);
  console.log(`  by status:             ${JSON.stringify(byStatus)}`);
  console.log(`  newest record:         ${newest}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

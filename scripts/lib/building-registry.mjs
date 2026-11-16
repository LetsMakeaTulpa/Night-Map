/**
 * Pure rules for the building registry.
 *
 * The registry is built from three public Department of Building Inspection
 * datasets — complaints, permits and notices of violation — joined on the
 * block/lot parcel identifier. Nothing here decides that a building is
 * abandoned. The rules only report what a record says, how old it is, and how
 * many independent records agree, so the app can show its work instead of a
 * single confident label.
 */

/** Language that describes a vacant, boarded or neglected structure. */
export const VACANCY_RE =
  /vacant|abandon|derelict|boarded|unsecured|squatt|not occupied|no one (living|there)/i;

/** Language that describes securing a building rather than merely reporting it. */
export const BOARD_RE =
  /board[- ]?up|barricad|secure (the )?vacant|secured vacant|seal(ed)? (the )?opening|premises remain secured/i;

export const DEMOLITION_RE = /demoli/i;

const STATUS_LABELS = {
  under_demolition: 'Demolition permitted',
  reported_vacant: 'Reported vacant',
  vacancy_history: 'Vacancy report on file',
  demolition_history: 'Demolition permit on file',
  under_construction: 'Construction permitted',
  code_enforcement: 'Open enforcement',
  records_only: 'Records only',
};

/**
 * A dossier's headline is a records classification, not an occupancy finding.
 * The UI must show this wording beside the label so no reader mistakes it for a
 * site visit.
 */
export const CLASSIFICATION_NOTE =
  'A classification of City records attached to a parcel. It is not a field check: a building with a vacancy complaint can be occupied, and a boarded building can be under legitimate construction.';

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? STATUS_LABELS.records_only;
}

export function normalizeLot(lot) {
  return String(lot ?? '').trim().toUpperCase();
}

export function normalizeBlock(block) {
  const raw = String(block ?? '').trim();
  return raw ? raw.padStart(4, '0') : '';
}

export function parcelKey(block, lot) {
  const b = normalizeBlock(block);
  const l = normalizeLot(lot);
  return b && l ? `${b}/${l}` : '';
}

export function parcelId(block, lot) {
  const key = parcelKey(block, lot);
  return key ? `bldg:${key.replace('/', '-')}` : '';
}

export function cleanText(value, max = 180) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

const SUFFIX = {
  ST: 'St',
  STREET: 'St',
  AVE: 'Ave',
  AVENUE: 'Ave',
  BLVD: 'Blvd',
  BOULEVARD: 'Blvd',
  RD: 'Rd',
  DR: 'Dr',
  LN: 'Ln',
  WAY: 'Way',
  PL: 'Pl',
  CT: 'Ct',
  TER: 'Ter',
  ALY: 'Aly',
  HWY: 'Hwy',
};

function titleCase(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "1638 Powell St" from the separate address columns the City publishes. */
export function formatAddress(row) {
  const number = String(row?.street_number ?? '').trim();
  const name = String(row?.street_name ?? '').trim();
  if (!number || !name) return '';
  const suffixRaw = String(row?.street_suffix ?? '').trim().toUpperCase();
  const suffix = SUFFIX[suffixRaw] ?? (suffixRaw ? titleCase(suffixRaw) : '');
  return `${number} ${titleCase(name)}${suffix ? ` ${suffix}` : ''}`;
}

function dateOf(row, field) {
  const value = row?.[field];
  if (!value) return null;
  const at = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : null;
}

function latest(dates) {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

function inLastYears(date, years, now) {
  if (!date) return false;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return date >= cutoff.toISOString().slice(0, 10);
}

/** A complaint is open only while the City's own status says Active. */
export function isOpenComplaint(status) {
  const text = String(status ?? '').toLowerCase();
  return text.includes('active') && !text.includes('not active') && !text.includes('inactive');
}

export function isOpenNotice(status) {
  const text = String(status ?? '').toLowerCase();
  return text.length > 0 && !text.includes('not active') && !text.includes('inactive') && !text.includes('abated');
}

export function isOpenPermit(status) {
  const text = String(status ?? '').toLowerCase();
  if (!text) return false;
  return !/complete|cancell|withdraw|expire|disapprov|denied|suspend/.test(text);
}

/**
 * The score is a record-priority hint, not a probability. Every point comes
 * with the record that earned it, and the app renders the list.
 */
export function vacancyAssessment(dossier, now = new Date()) {
  const { complaints, permits, notices } = dossier;
  const vacancyComplaints = complaints.filter((row) => VACANCY_RE.test(row.description));
  const vacancyNotices = notices.filter((row) => VACANCY_RE.test(row.item));
  const boardNotices = notices.filter((row) => BOARD_RE.test(row.item));
  const demolitionPermits = permits.filter(
    (row) => DEMOLITION_RE.test(row.type) || DEMOLITION_RE.test(row.description),
  );
  const constructionPermits = permits.filter(
    (row) =>
      /new construction|additions alterations or repairs/i.test(row.type) &&
      !DEMOLITION_RE.test(row.description),
  );
  const openComplaints = complaints.filter((row) => isOpenComplaint(row.status));
  const openNotices = notices.filter((row) => isOpenNotice(row.status));
  const activeDemolition = demolitionPermits.filter((row) => isOpenPermit(row.status));
  const activeConstruction = constructionPermits.filter((row) => isOpenPermit(row.status));

  const latestVacancy = latest([...vacancyComplaints, ...vacancyNotices].map((row) => row.date));
  const latestBoard = latest(boardNotices.map((row) => row.date));
  const latestDemolition = latest(demolitionPermits.map((row) => row.date));
  const latestEnforcement = latest([...openComplaints, ...openNotices].map((row) => row.date));

  let status = 'records_only';
  if (activeDemolition.length > 0) status = 'under_demolition';
  else if (latestVacancy && inLastYears(latestVacancy, 2, now)) status = 'reported_vacant';
  else if (latestVacancy) status = 'vacancy_history';
  else if (demolitionPermits.length > 0) status = 'demolition_history';
  else if (activeConstruction.length > 0) status = 'under_construction';
  else if (latestEnforcement) status = 'code_enforcement';

  const inputs = [];
  let score = 0;
  const add = (points, label) => {
    score += points;
    inputs.push({ points, label });
  };
  if (vacancyComplaints.length > 0) {
    add(30, `${vacancyComplaints.length} complaint${vacancyComplaints.length === 1 ? '' : 's'} describing a vacant, abandoned or derelict condition (newest ${latestVacancy ?? 'date unknown'})`);
  }
  if (vacancyNotices.length > 0) {
    add(25, `${vacancyNotices.length} notice of violation item${vacancyNotices.length === 1 ? '' : 's'} about a vacant or secured structure`);
  }
  if (boardNotices.length > 0) {
    add(15, `${boardNotices.length} notice${boardNotices.length === 1 ? '' : 's'} requiring board-up or securing (newest ${latestBoard ?? 'date unknown'})`);
  }
  if (demolitionPermits.length > 0) {
    add(activeDemolition.length > 0 ? 20 : 10, `${demolitionPermits.length} demolition permit${demolitionPermits.length === 1 ? '' : 's'} on file${activeDemolition.length > 0 ? ', at least one not closed' : ''}`);
  }
  if (vacancyComplaints.length > 0 && vacancyNotices.length > 0) {
    add(10, 'A complaint and a notice of violation both describe the same condition, which is two independent City records rather than one');
  }
  if (latestVacancy && inLastYears(latestVacancy, 1, now)) {
    add(10, `A vacancy-related record was filed within the last year (${latestVacancy})`);
  }
  if (openComplaints.length + openNotices.length > 0) {
    add(5, `${openComplaints.length + openNotices.length} record${openComplaints.length + openNotices.length === 1 ? '' : 's'} still marked open by the City`);
  }
  score = Math.min(100, score);
  if (inputs.length === 0) {
    inputs.push({
      points: 0,
      label: 'No vacancy, demolition or open-enforcement record is attached to this parcel',
    });
  }

  const recordTypes = [vacancyComplaints.length > 0, vacancyNotices.length > 0, demolitionPermits.length > 0].filter(Boolean).length;
  const newestSignal = latest([latestVacancy, latestDemolition]);
  let confidence = 'low';
  if (recordTypes >= 2 && inLastYears(newestSignal, 6, now)) confidence = 'high';
  else if (newestSignal && inLastYears(newestSignal, 5, now)) confidence = 'medium';

  return {
    status,
    statusLabel: statusLabel(status),
    confidence,
    score,
    inputs,
    counts: {
      complaints: complaints.length,
      permits: permits.length,
      notices: notices.length,
      vacancyComplaints: vacancyComplaints.length,
      vacancyNotices: vacancyNotices.length,
      demolitionPermits: demolitionPermits.length,
      openComplaints: openComplaints.length,
      openNotices: openNotices.length,
    },
    latestVacancy,
    latestBoard,
    latestDemolition,
  };
}

/**
 * Attach a timeline without storing one: every event is derived from a record
 * that is already preserved, so the narrative cannot drift from the evidence.
 */
export function buildingTimeline(dossier) {
  const events = [];
  for (const row of dossier.complaints ?? []) {
    events.push({
      at: row.date,
      kind: 'complaint',
      title: `DBI complaint ${row.id}`,
      detail: row.description,
      status: row.status,
      recordId: row.id,
      sourceId: 'src:sfgov-dbi-complaints',
    });
  }
  for (const row of dossier.notices ?? []) {
    events.push({
      at: row.date,
      kind: 'notice',
      title: `Notice of violation ${row.id}`,
      detail: row.item,
      status: row.status,
      recordId: row.id,
      sourceId: 'src:sfgov-dbi-novs',
    });
  }
  for (const row of dossier.permits ?? []) {
    events.push({
      at: row.date,
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
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.title.localeCompare(b.title));
}

export function sortDossiers(dossiers) {
  return [...dossiers].sort(
    (a, b) =>
      b.score - a.score ||
      String(b.lastRecordAt ?? '').localeCompare(String(a.lastRecordAt ?? '')) ||
      String(a.address ?? '').localeCompare(String(b.address ?? '')),
  );
}

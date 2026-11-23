import { describe, expect, it } from 'vitest';
import {
  BOARD_RE,
  DEMOLITION_RE,
  formatAddress,
  normalizeBlock,
  normalizeLot,
  parcelId,
  parcelKey,
  vacancyAssessment,
} from '../../scripts/lib/building-registry.mjs';
import { observationSchema } from './schemas';
import {
  BUILDING_CONDITIONS,
  BUILDING_STATUSES,
  buildingCheckSummary,
  buildingConditionLabel,
  buildingFilterLabel,
  buildingMatchesFilter,
  buildingRecordSummary,
  buildingScoreInputs,
  buildingStatusMeta,
  buildingTimeline,
  filterBuildings,
  formatParcel,
} from './buildings';
import type { BuildingDossier } from './types';

const NOW = new Date('2026-11-15T00:00:00Z');

function makeDossier(overrides: Partial<BuildingDossier> = {}): BuildingDossier {
  return {
    id: 'bldg:0117-016',
    block: '0117',
    lot: '016',
    parcelNumber: '0117016',
    address: '1638 Powell St',
    neighborhood: 'Chinatown',
    coordinates: [-122.4093, 37.7982],
    locationPrecision: 'permit_primary_address',
    stories: 3,
    use: 'retail',
    permitCount: 2,
    complaintCount: 1,
    noticeCount: 1,
    firstRecordAt: '2024-07-08',
    lastRecordAt: '2026-03-10',
    complaints: [
      {
        id: '202425692',
        date: '2024-07-08',
        description: 'Vacant building',
        status: 'Not Active',
      },
    ],
    notices: [
      {
        id: '202425692-1',
        date: '2024-07-09',
        item: 'secure vacant building (102.16 sfbc)',
        category: 'other section',
        status: 'not active',
      },
    ],
    permits: [
      {
        id: '202401023305',
        type: 'otc alterations permit',
        status: 'issued',
        date: '2024-01-02',
        description: 'reroofing',
      },
    ],
    status: 'reported_vacant',
    confidence: 'high',
    score: 75,
    counts: {
      complaints: 1,
      permits: 2,
      notices: 1,
      vacancyComplaints: 1,
      vacancyNotices: 1,
      demolitionPermits: 0,
      openComplaints: 0,
      openNotices: 0,
    },
    vacancyLatestAt: '2024-07-09',
    demolitionLatestAt: null,
    ...overrides,
  };
}

describe('parcel identity', () => {
  it('joins records on block and lot, not on a typed address', () => {
    expect(normalizeBlock('117')).toBe('0117');
    // A letter suffix is part of the block, not a typo to strip.
    expect(normalizeBlock('3005B')).toBe('3005B');
    expect(normalizeLot(' 16a ')).toBe('16A');
    expect(parcelKey('117', '16')).toBe('0117/16');
    expect(parcelId('117', '16')).toBe('bldg:0117-16');
    // A missing half of the parcel identifier cannot make a dossier.
    expect(parcelKey('', '16')).toBe('');
    expect(parcelId('0117', '')).toBe('');
  });

  it('composes the address from the City columns and does not invent a suffix', () => {
    expect(formatAddress({ street_number: '1638', street_name: 'POWELL', street_suffix: 'ST' })).toBe('1638 Powell St');
    expect(formatAddress({ street_number: '44', street_name: 'Montgomery' })).toBe('44 Montgomery');
    expect(formatAddress({ street_number: '44' })).toBe('');
  });
});

describe('record reading', () => {
  it('distinguishes a vacant report from a demolition permit', () => {
    const vacant = vacancyAssessment(
      {
        complaints: [{ date: '2026-03-10', description: 'Vacant commercial storefront', status: 'Not Active' }],
        notices: [],
        permits: [],
      },
      NOW,
    );
    expect(vacant.status).toBe('reported_vacant');
    expect(vacant.confidence).toBe('medium');
    expect(vacant.score).toBeGreaterThan(0);
    expect(vacant.inputs.some((row) => row.label.includes('vacant'))).toBe(true);

    const demolition = vacancyAssessment(
      {
        complaints: [],
        notices: [],
        permits: [
          {
            type: 'demolitions',
            status: 'issued',
            date: '2026-05-01',
            description: 'demolish a 2 story building',
          },
        ],
      },
      NOW,
    );
    expect(demolition.status).toBe('under_demolition');
    expect(DEMOLITION_RE.test('demolitions')).toBe(true);
  });

  it('ages an old vacancy report into history rather than deleting it', () => {
    const old = vacancyAssessment(
      {
        complaints: [{ date: '2019-04-01', description: 'Vacant storefront', status: 'Not Active' }],
        notices: [],
        permits: [],
      },
      NOW,
    );
    expect(old.status).toBe('vacancy_history');
    expect(old.confidence).toBe('low');
    expect(old.latestVacancy).toBe('2019-04-01');
  });

  it('raises confidence only when two record types agree', () => {
    const both = vacancyAssessment(
      {
        complaints: [{ date: '2026-03-10', description: 'Vacant building', status: 'Not Active' }],
        notices: [
          {
            date: '2026-03-11',
            item: 'board-up or barricade all openings. premises remain secured vacant',
            status: 'not active',
          },
        ],
        permits: [],
      },
      NOW,
    );
    expect(both.status).toBe('reported_vacant');
    expect(both.confidence).toBe('high');
    expect(BOARD_RE.test('secure vacant building')).toBe(true);
  });

  it('never turns a closed permit into a vacancy claim', () => {
    const quiet = vacancyAssessment(
      {
        complaints: [],
        notices: [],
        permits: [
          { type: 'otc alterations permit', status: 'complete', date: '2026-01-02', description: 'reroofing' },
        ],
      },
      NOW,
    );
    expect(quiet.status).toBe('records_only');
    expect(quiet.score).toBe(0);
    expect(quiet.inputs[0].points).toBe(0);
  });
});

describe('dossier reading in the app', () => {
  it('keeps the chronology oldest first and derives it from preserved records', () => {
    const events = buildingTimeline(makeDossier());
    expect(events.map((event) => event.at)).toEqual(['2024-01-02', '2024-07-08', '2024-07-09']);
    expect(events.map((event) => event.kind)).toEqual(['permit', 'complaint', 'notice']);
    expect(events.every((event) => event.sourceId.startsWith('src:sfgov-dbi-'))).toBe(true);
  });

  it('shows score inputs rather than a bare number', () => {
    const lines = buildingScoreInputs(makeDossier());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toContain('complaint');
    expect(lines.join(' ')).toContain('notice');
  });

  it('searches address, parcel and neighbourhood, and filters by classification', () => {
    const dossier = makeDossier();
    expect(filterBuildings([dossier], { query: 'powell', status: 'all' })).toHaveLength(1);
    expect(filterBuildings([dossier], { query: '0117', status: 'all' })).toHaveLength(1);
    expect(filterBuildings([dossier], { query: 'tenderloin', status: 'all' })).toHaveLength(0);
    expect(filterBuildings([dossier], { query: '', status: 'under_demolition' })).toHaveLength(0);
    expect(filterBuildings([dossier], { query: '', status: 'reported_vacant' })).toHaveLength(1);
  });

  it('groups the two reported-vacancy classes and searches dossiers with no point', () => {
    const located = makeDossier();
    const unplotted = makeDossier({
      id: 'bldg:9999-001',
      address: '88 Nowhere St',
      coordinates: null,
      locationPrecision: 'none',
      status: 'vacancy_history',
    });
    const demolition = makeDossier({ id: 'bldg:1000-001', status: 'under_demolition' });

    expect(
      filterBuildings([located, unplotted, demolition], { query: '', status: 'vacancy' }).map((d) => d.id),
    ).toEqual([located.id, unplotted.id]);
    expect(filterBuildings([unplotted], { query: 'nowhere', status: 'all' })).toHaveLength(1);
    expect(filterBuildings([unplotted], { query: '', status: 'vacancy' })).toHaveLength(1);
    expect(buildingMatchesFilter('reported_vacant', 'vacancy')).toBe(true);
    expect(buildingMatchesFilter('under_demolition', 'vacancy')).toBe(false);
    expect(buildingFilterLabel('vacancy')).toBe('reported vacant / derelict');
  });

  it('keeps private checks separate from the City record and summarises the newest', () => {
    const base = {
      id: 'obs:1',
      placeId: null,
      placeName: '1638 Powell St',
      geometry: { type: 'Point' as const, coordinates: [-122.4093, 37.7982] as [number, number] },
      type: 'infrastructure_change' as const,
      observedAt: '2026-11-10T18:00:00.000Z',
      recordedAt: '2026-11-10T18:05:00.000Z',
      photo: null,
      visibility: 'private' as const,
      verificationStatus: 'unverified' as const,
      updatedAt: '2026-11-10T18:05:00.000Z',
    };
    const older = { ...base, id: 'obs:0', note: 'Door open, lights off', buildingId: 'bldg:0117-016', buildingCondition: 'looks_vacant' as const, observedAt: '2026-11-01T10:00:00.000Z' };
    const newer = { ...base, id: 'obs:2', note: 'Workers on site', buildingId: 'bldg:0117-016', buildingCondition: 'under_construction' as const };

    const summary = buildingCheckSummary([older, newer], 'bldg:0117-016');
    expect(summary.count).toBe(2);
    expect(summary.latest?.id).toBe('obs:2');
    expect(buildingConditionLabel(summary.latest?.buildingCondition)).toBe('Work under way');
    // A check for a different parcel never leaks into this dossier.
    const other = { ...base, id: 'obs:3', note: 'Elsewhere', buildingId: 'bldg:0999-001', buildingCondition: 'boarded' as const };
    expect(buildingCheckSummary([older, newer, other], 'bldg:0117-016').count).toBe(2);

    // The schema keeps both legacy notes and building checks valid.
    expect(observationSchema.safeParse({ ...base, note: 'Legacy note' }).success).toBe(true);
    expect(observationSchema.safeParse({ ...newer }).success).toBe(true);
    expect(observationSchema.safeParse({ ...base, note: 'New lead', suggestedCategory: 'water' }).success).toBe(true);
    expect(observationSchema.safeParse({ ...base, note: 'Bad category', suggestedCategory: 'not-a-category' }).success).toBe(
      false,
    );
    expect(new Set(BUILDING_CONDITIONS.map((condition) => condition.id)).size).toBe(BUILDING_CONDITIONS.length);
  });

  it('labels every classification and never uses the word confirmed', () => {
    expect(BUILDING_STATUSES).toHaveLength(7);
    for (const status of BUILDING_STATUSES) {
      expect(status.label.length).toBeGreaterThan(3);
      expect(status.label.toLowerCase()).not.toContain('confirmed vacant');
      expect(status.note.length).toBeGreaterThan(20);
    }
    expect(buildingStatusMeta('reported_vacant').short).toBe('Vacancy reported');
    expect(formatParcel(makeDossier())).toBe('0117 / 016');
    expect(buildingRecordSummary(makeDossier())).toContain('complaint');
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_EVENTS,
  applyResolution,
  changeKindLabel,
  describeOverride,
  findDuplicate,
  initialReportStatus,
  normalizeReport,
  pendingReports,
  reportIssueLabel,
  validateReport,
  withEvent,
  type ReportDraft,
} from './verification';
import type { CorrectionReport, Place } from './types';

const NOW = new Date('2026-10-27T09:00:00Z');

const place: Place = {
  id: 'place:glide',
  name: 'GLIDE Daily Free Meals',
  category: 'food',
  geometry: { type: 'Point', coordinates: [-122.412, 37.785] },
  address: '330 Ellis Street',
  addressType: 'street_address',
  description: '',
  accessibility: { status: 'not_documented', note: '' },
  sourceIds: ['src:glide'],
  status: 'active',
  locationPrecision: 'geocoded_address',
  neighborhood: 'Tenderloin',
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
};

const draft: ReportDraft = {
  placeId: place.id,
  placeName: place.name,
  issue: 'closed',
  note: 'Doors chained shut at 8pm with a staffing notice.',
  observedAt: '2026-10-26',
};

function report(overrides: Partial<CorrectionReport> = {}): CorrectionReport {
  return {
    id: 'report:1',
    placeId: place.id,
    placeName: place.name,
    issue: 'closed',
    note: draft.note,
    observedAt: draft.observedAt,
    createdAt: '2026-10-26T21:00:00Z',
    updatedAt: '2026-10-26T21:00:00Z',
    status: 'queued',
    validation: { problems: [], warnings: [] },
    duplicateOfId: null,
    resolution: null,
    history: [
      {
        at: '2026-10-26T21:00:00Z',
        kind: 'received',
        note: 'Report received and kept on this device.',
        actor: 'this device',
      },
    ],
    channel: 'on_device',
    ...overrides,
  };
}

const context = (existingReports: CorrectionReport[] = []) => ({
  knownPlaceIds: new Set([place.id]),
  existingReports,
  now: NOW,
});

describe('validateReport', () => {
  it('accepts a report with a known record, an issue type and enough detail', () => {
    expect(validateReport(draft, context()).problems).toEqual([]);
  });

  it('rejects an unknown record and a note too short to act on', () => {
    const result = validateReport({ ...draft, placeId: 'place:missing', note: 'closed' }, context());
    expect(result.problems).toHaveLength(2);
    expect(result.problems.join(' ')).toMatch(/not in the installed dataset/);
    expect(result.problems.join(' ')).toMatch(/at least 12 characters/);
  });

  it('rejects an observation dated in the future', () => {
    const result = validateReport({ ...draft, observedAt: '2027-01-01' }, context());
    expect(result.problems.join(' ')).toMatch(/future/);
  });

  it('warns when a closure report has no observation date', () => {
    const result = validateReport({ ...draft, observedAt: null }, context());
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/how recent/);
  });

  it('warns when an open report already describes the same issue', () => {
    const result = validateReport(draft, context([report()]));
    expect(result.warnings.join(' ')).toMatch(/already describe/);
  });
});

describe('findDuplicate and status assignment', () => {
  it('flags an open report about the same issue inside the window', () => {
    const existing = report({ createdAt: '2026-10-20T09:00:00Z' });
    expect(findDuplicate(draft, [existing], NOW)?.id).toBe(existing.id);
  });

  it('ignores resolved reports, other issues and reports older than the window', () => {
    const resolved = report({ status: 'resolved', createdAt: '2026-10-20T09:00:00Z' });
    const otherIssue = report({ id: 'report:other', issue: 'hours_wrong', createdAt: '2026-10-20T09:00:00Z' });
    const old = report({ id: 'report:old', createdAt: '2026-07-01T09:00:00Z' });
    expect(findDuplicate(draft, [resolved, otherIssue, old], NOW)).toBeNull();
  });

  it('lets structural problems win over a duplicate flag', () => {
    expect(initialReportStatus({ problems: ['too short'], warnings: [] }, report())).toBe('needs_information');
    expect(initialReportStatus({ problems: [], warnings: [] }, report())).toBe('duplicate_candidate');
    expect(initialReportStatus({ problems: [], warnings: [] }, null)).toBe('queued');
  });
});

describe('applyResolution', () => {
  it('records a reported closure as a local override and leaves the bundled record alone', () => {
    const { override, change } = applyResolution(
      report(),
      'record_closure',
      'Provider page confirms the closure.',
      place,
      null,
      NOW,
    );
    expect(override?.status).toBe('temporarily_closed');
    expect(override?.verification?.status).toBe('community_reported');
    expect(override?.reportIds).toEqual([report().id]);
    expect(change.kind).toBe('closure_reported');
    expect(change.before).toBe('active');
    expect(change.after).toBe('temporarily_closed');
    expect(change.disposition).toBe('applied_as_local_override');
    expect(change.reason).toBe('Provider page confirms the closure.');
    // The dataset record itself is never mutated.
    expect(place.status).toBe('active');
  });

  it('logs a no-change review without inventing an override', () => {
    const { override, change } = applyResolution(report(), 'no_change', 'Report does not hold up.', place, null, NOW);
    expect(override).toBeNull();
    expect(change.disposition).toBe('recorded_only');
    expect(change.kind).toBe('no_change');
  });

  it('keeps the log entry when the record is missing from the dataset', () => {
    const { override, change } = applyResolution(report(), 'record_closure', 'note', undefined, null, NOW);
    expect(override).toBeNull();
    expect(change.disposition).toBe('recorded_only');
  });

  it('layers later corrections without dropping earlier fields or reports', () => {
    const first = applyResolution(report(), 'confirm_hours_note', 'Closes at 20:00.', place, null, NOW).override;
    const second = applyResolution(
      report({ id: 'report:2' }),
      'confirm_access_note',
      'Side door on Ellis Street.',
      place,
      first,
      NOW,
    ).override;
    expect(second?.hoursNote).toBe('Closes at 20:00.');
    expect(second?.accessNote).toBe('Side door on Ellis Street.');
    expect(second?.reportIds).toEqual(['report:1', 'report:2']);
  });
});

describe('withEvent', () => {
  it('appends an event and applies the patch', () => {
    const updated = withEvent(report(), { kind: 'resolved', note: 'Closure recorded.' }, { status: 'resolved' }, NOW);
    expect(updated.status).toBe('resolved');
    expect(updated.updatedAt).toBe(NOW.toISOString());
    expect(updated.history).toHaveLength(2);
    expect(updated.history[0].kind).toBe('received');
  });

  it('caps the history so a long-lived report cannot grow without bound', () => {
    let current = report();
    for (let i = 0; i < MAX_REPORT_EVENTS + 6; i += 1) {
      current = withEvent(current, { kind: 'reopened', note: `pass ${i}` }, {}, NOW);
    }
    expect(current.history).toHaveLength(MAX_REPORT_EVENTS);
  });
});

describe('normalizeReport', () => {
  it('maps the earlier queued_on_device status onto the current lifecycle', () => {
    const legacy = normalizeReport({
      id: 'report:legacy',
      placeId: place.id,
      placeName: place.name,
      issue: 'hours_wrong',
      note: 'Hours changed in September.',
      createdAt: '2026-10-01T00:00:00Z',
      status: 'queued_on_device',
    });
    expect(legacy.status).toBe('queued');
    expect(legacy.channel).toBe('on_device');
    expect(legacy.history).toHaveLength(1);
    expect(legacy.validation.problems).toEqual([]);
    expect(legacy.observedAt).toBeNull();
  });

  it('falls back to a defined issue and never loses the record name', () => {
    const unknown = normalizeReport({ placeId: place.id, issue: 'nonsense' as never });
    expect(unknown.issue).toBe('other');
    expect(unknown.placeName).toBe('Unknown record');
    expect(unknown.status).toBe('queued');
  });
});

describe('helpers', () => {
  it('labels changes and describes overrides in plain words', () => {
    expect(changeKindLabel('closure_reported')).toBe('Closure reported');
    expect(changeKindLabel('no_change')).toBe('Reviewed, record unchanged');
    expect(reportIssueLabel('service_changed')).toBe('Service has changed');
    expect(
      describeOverride({
        placeId: place.id,
        status: 'temporarily_closed',
        reportIds: ['report:1'],
        updatedAt: NOW.toISOString(),
      }),
    ).toContain('temporarily closed');
  });

  it('counts only reports that still need attention', () => {
    const open = pendingReports([
      report(),
      report({ id: 'report:r', status: 'resolved' }),
      report({ id: 'report:d', status: 'dismissed' }),
      report({ id: 'report:i', status: 'needs_information' }),
    ]);
    expect(open.map((r) => r.id)).toEqual(['report:1', 'report:i']);
  });
});

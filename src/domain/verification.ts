import type {
  ChangeRecord,
  CorrectionReport,
  Place,
  PlaceOverride,
  ReportEvent,
  ReportIssue,
  ReportResolution,
  ReportStatus,
} from './types';

/**
 * The verification workflow, as pure functions.
 *
 * Nothing here talks to a network or a database: a report is received, its
 * structure is validated, duplicates are looked for, it gets a visible status,
 * a reviewer resolves it, and every resolution leaves an immutable change record.
 *
 * Corrections are applied as local overrides so that a source value is never
 * silently replaced by a community claim.
 */

/** A report has to say enough for someone else to act on it. */
export const MIN_REPORT_NOTE = 12;
export const MAX_REPORT_NOTE = 2000;
/** Reports about the same issue at the same place inside this window are candidates for merging. */
export const DUPLICATE_WINDOW_DAYS = 30;

export const OPEN_REPORT_STATUSES: ReportStatus[] = ['queued', 'needs_information', 'duplicate_candidate'];

export interface ReportIssueDefinition {
  id: ReportIssue;
  label: string;
  help: string;
  /** What a reviewer can most usefully apply when the report checks out. */
  suggestedResolution: ReportResolution;
}

export const REPORT_ISSUES: ReportIssueDefinition[] = [
  {
    id: 'hours_wrong',
    label: 'Hours are wrong',
    help: 'Say what the hours actually were and how you know.',
    suggestedResolution: 'confirm_hours_note',
  },
  {
    id: 'closed',
    label: 'It is closed',
    help: 'Say when you saw it closed, and whether anything on site explained it.',
    suggestedResolution: 'record_closure',
  },
  {
    id: 'location_wrong',
    label: 'Location is wrong',
    help: 'Say where it actually is — a street, a cross-street, or a nearby landmark.',
    suggestedResolution: 'flag_for_verification',
  },
  {
    id: 'access_wrong',
    label: 'Access details are wrong',
    help: 'Say what the entrance, intake or eligibility situation actually is.',
    suggestedResolution: 'confirm_access_note',
  },
  {
    id: 'service_changed',
    label: 'Service has changed',
    help: 'Say what is offered now and when that changed.',
    suggestedResolution: 'flag_for_verification',
  },
  {
    id: 'other',
    label: 'Something else',
    help: 'Describe the problem in your own words.',
    suggestedResolution: 'flag_for_verification',
  },
];

export const REPORT_ISSUE_BY_ID = new Map(REPORT_ISSUES.map((issue) => [issue.id, issue]));

export const OPEN_ISSUE_IDS: ReportIssue[] = ['hours_wrong', 'closed', 'access_wrong'];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  queued: 'Queued for review',
  needs_information: 'Needs information',
  duplicate_candidate: 'Possible duplicate',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const RESOLUTIONS: { id: ReportResolution; label: string; description: string }[] = [
  {
    id: 'record_closure',
    label: 'Record a reported closure',
    description: 'Marks this record as reported closed on this device. It stays a report, not a verified fact.',
  },
  {
    id: 'confirm_hours_note',
    label: 'Attach a corrected hours note',
    description: 'Keeps the published hours and adds the local correction next to them.',
  },
  {
    id: 'confirm_access_note',
    label: 'Attach an access note',
    description: 'Records what the entrance or intake situation actually is.',
  },
  {
    id: 'flag_for_verification',
    label: 'Flag the record for verification',
    description: 'Marks the record as unconfirmed locally so it is not presented as checked.',
  },
  {
    id: 'no_change',
    label: 'Reviewed — no change to the record',
    description: 'Closes the report and keeps the log entry. Use when the report does not hold up.',
  },
];

export const RESOLUTION_BY_ID = new Map(RESOLUTIONS.map((r) => [r.id, r]));

export function reportStatusLabel(status: ReportStatus): string {
  return REPORT_STATUS_LABELS[status] ?? status;
}

export function reportIssueLabel(issue: ReportIssue): string {
  return REPORT_ISSUE_BY_ID.get(issue)?.label ?? issue.replaceAll('_', ' ');
}

export function resolutionLabel(kind: ReportResolution): string {
  return RESOLUTION_BY_ID.get(kind)?.label ?? kind.replaceAll('_', ' ');
}

export function isOpenReport(report: CorrectionReport): boolean {
  return OPEN_REPORT_STATUSES.includes(report.status);
}

export function pendingReports(reports: CorrectionReport[]): CorrectionReport[] {
  return reports.filter(isOpenReport);
}

export interface ReportDraft {
  placeId: string;
  placeName: string;
  issue: ReportIssue;
  note: string;
  observedAt: string | null;
}

export interface ValidationContext {
  /** Place ids present in the installed dataset. */
  knownPlaceIds: Set<string>;
  existingReports: CorrectionReport[];
  now?: Date;
}

export interface ValidationResult {
  problems: string[];
  warnings: string[];
}

/** Step 2 of the workflow: structure is checked before a report is queued. */
export function validateReport(draft: ReportDraft, context: ValidationContext): ValidationResult {
  const now = context.now ?? new Date();
  const problems: string[] = [];
  const warnings: string[] = [];
  const issue = REPORT_ISSUE_BY_ID.get(draft.issue);

  if (!issue) problems.push('That is not one of the defined report categories.');
  if (!context.knownPlaceIds.has(draft.placeId)) {
    problems.push('The record this report refers to is not in the installed dataset.');
  }

  const note = draft.note.trim();
  if (note.length < MIN_REPORT_NOTE) {
    problems.push(`Add at least ${MIN_REPORT_NOTE} characters of detail so the report can be acted on.`);
  }
  if (note.length > MAX_REPORT_NOTE) {
    problems.push(`Keep the report under ${MAX_REPORT_NOTE} characters and put the rest in a field note.`);
  }

  if (draft.observedAt) {
    const parsed = Date.parse(draft.observedAt);
    if (Number.isNaN(parsed)) problems.push('The date you gave for the observation could not be read.');
    else if (parsed > now.getTime() + 86_400_000) problems.push('The date you gave for the observation is in the future.');
  } else if (issue && OPEN_ISSUE_IDS.includes(issue.id)) {
    warnings.push('No date was given, so a reviewer cannot weigh how recent the observation is.');
  }

  const priorSame = context.existingReports.filter(
    (report) => report.placeId === draft.placeId && report.issue === draft.issue && isOpenReport(report),
  );
  if (priorSame.length > 0) {
    warnings.push(
      `${priorSame.length} open ${priorSame.length === 1 ? 'report already describes' : 'reports already describe'} this issue at this record.`,
    );
  }

  return { problems, warnings };
}

/** Step 3: duplicate detection against reports that are still open. */
export function findDuplicate(
  draft: ReportDraft,
  reports: CorrectionReport[],
  now = new Date(),
): CorrectionReport | null {
  const earliest = now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000;
  const candidates = reports.filter(
    (report) =>
      report.placeId === draft.placeId &&
      report.issue === draft.issue &&
      isOpenReport(report) &&
      Date.parse(report.createdAt) >= earliest,
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Step 5: the visible status a report receives on arrival. */
export function initialReportStatus(validation: ValidationResult, duplicate: CorrectionReport | null): ReportStatus {
  if (validation.problems.length > 0) return 'needs_information';
  if (duplicate) return 'duplicate_candidate';
  return 'queued';
}

export const MAX_REPORT_EVENTS = 40;

/** Appends an event and applies a patch. History is append-only. */
export function withEvent(
  report: CorrectionReport,
  event: { kind: ReportEvent['kind']; note: string },
  patch: Partial<CorrectionReport> = {},
  now = new Date(),
): CorrectionReport {
  const at = now.toISOString();
  const history: ReportEvent[] = [...report.history, { at, kind: event.kind, note: event.note, actor: 'this device' }];
  return {
    ...report,
    ...patch,
    updatedAt: at,
    history: history.slice(-MAX_REPORT_EVENTS),
  };
}

export interface ResolutionOutcome {
  override: PlaceOverride | null;
  change: ChangeRecord;
}

/** Step 7: a resolution always produces a traceable change record. */
export function applyResolution(
  report: CorrectionReport,
  resolution: ReportResolution,
  reviewNote: string,
  place: Place | undefined,
  previous: PlaceOverride | null = null,
  now = new Date(),
): ResolutionOutcome {
  const at = now.toISOString();
  const reason = reviewNote.trim() || report.note.trim() || 'No reviewer note recorded.';

  const change = (
    kind: ChangeRecord['kind'],
    field: string,
    before: string,
    after: string,
    disposition: ChangeRecord['disposition'],
    override: PlaceOverride | null,
  ): ResolutionOutcome => ({
    override,
    change: {
      id: `change:${report.id}:${at}`,
      placeId: report.placeId,
      placeName: report.placeName,
      reportId: report.id,
      kind,
      field,
      before,
      after,
      reason,
      at,
      actor: 'local reviewer (this device)',
      disposition,
    },
  });

  if (!place) {
    // The record is gone from the dataset, so the decision is logged, not applied.
    return change('no_change', 'record', 'unknown record', 'logged only', 'recorded_only', previous);
  }

  const base: PlaceOverride = {
    ...(previous ?? { placeId: place.id, reportIds: [] }),
    placeId: place.id,
    reportIds: [...new Set([...(previous?.reportIds ?? []), report.id])],
    updatedAt: at,
  };

  switch (resolution) {
    case 'record_closure': {
      const override: PlaceOverride = {
        ...base,
        status: 'temporarily_closed',
        verification: {
          status: 'community_reported',
          label: 'Closure reported on this device',
          note: reason,
        },
      };
      return change('closure_reported', 'status', place.status, 'temporarily_closed', 'applied_as_local_override', override);
    }
    case 'confirm_hours_note': {
      const override: PlaceOverride = { ...base, hoursNote: reason };
      return change(
        'hours_note_added',
        'hoursNote',
        previous?.hoursNote ?? 'No local hours note',
        reason,
        'applied_as_local_override',
        override,
      );
    }
    case 'confirm_access_note': {
      const override: PlaceOverride = { ...base, accessNote: reason };
      return change(
        'access_note_added',
        'accessNote',
        previous?.accessNote ?? 'No local access note',
        reason,
        'applied_as_local_override',
        override,
      );
    }
    case 'flag_for_verification': {
      const before = previous?.verification?.label ?? `${place.verificationOverride?.label ?? 'Bundled record'}`;
      const override: PlaceOverride = {
        ...base,
        verification: {
          status: 'unverified',
          label: 'Flagged for verification on this device',
          note: reason,
        },
      };
      return change('verification_flagged', 'verification.status', before, 'unverified', 'applied_as_local_override', override);
    }
    case 'no_change':
    default: {
      const field = previous?.status ? 'status' : 'record';
      return change('no_change', field, 'Reviewed as received', 'Unchanged', 'recorded_only', previous);
    }
  }
}

/**
 * Accepts whatever shape was actually stored, including records written by an
 * earlier release whose only status was `queued_on_device`.
 */
export interface StoredReportLike
  extends Omit<Partial<CorrectionReport>, 'status' | 'issue' | 'history' | 'validation'> {
  status?: string;
  issue?: string;
  history?: ReportEvent[];
  validation?: { problems: string[]; warnings: string[] };
}

export function normalizeReport(raw: StoredReportLike): CorrectionReport {
  const status: ReportStatus = OPEN_REPORT_STATUSES.includes(raw.status as ReportStatus) ||
    raw.status === 'resolved' ||
    raw.status === 'dismissed'
    ? (raw.status as ReportStatus)
    : 'queued';
  const createdAt = raw.createdAt ?? new Date().toISOString();
  const issue: ReportIssue = REPORT_ISSUE_BY_ID.has(raw.issue as ReportIssue) ? (raw.issue as ReportIssue) : 'other';
  const history: ReportEvent[] =
    raw.history && raw.history.length > 0
      ? raw.history
      : [{ at: createdAt, kind: 'received', note: 'Report received and stored on this device.', actor: 'this device' }];
  return {
    id: raw.id ?? `report:${createdAt}`,
    placeId: raw.placeId ?? '',
    placeName: raw.placeName ?? 'Unknown record',
    issue,
    note: raw.note ?? '',
    observedAt: raw.observedAt ?? null,
    createdAt,
    updatedAt: raw.updatedAt ?? createdAt,
    status,
    validation: raw.validation ?? { problems: [], warnings: [] },
    duplicateOfId: raw.duplicateOfId ?? null,
    resolution: raw.resolution ?? null,
    history,
    channel: 'on_device',
  };
}

export const CHANGE_KIND_LABELS: Record<ChangeRecord['kind'], string> = {
  closure_reported: 'Closure reported',
  hours_note_added: 'Hours correction attached',
  access_note_added: 'Access correction attached',
  verification_flagged: 'Flagged for verification',
  no_change: 'Reviewed, record unchanged',
};

export function changeKindLabel(kind: ChangeRecord['kind']): string {
  return CHANGE_KIND_LABELS[kind] ?? kind.replaceAll('_', ' ');
}

/** Human summary of what a local override currently changes. */
export function describeOverride(override: PlaceOverride): string {
  const parts: string[] = [];
  if (override.status) parts.push(`status: ${override.status.replaceAll('_', ' ')}`);
  if (override.verification) parts.push(override.verification.label);
  if (override.hoursNote) parts.push(`hours note: ${override.hoursNote}`);
  if (override.accessNote) parts.push(`access note: ${override.accessNote}`);
  return parts.length > 0 ? parts.join(' · ') : 'No fields set';
}

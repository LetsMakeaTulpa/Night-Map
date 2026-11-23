import { useMemo, useState } from 'react';
import type { CorrectionReport, ReportResolution, ReportStatus } from '../../domain/types';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { formatDate } from '../../domain/status';
import { EmptyState } from '../ui';
import {
  REPORT_ISSUES,
  RESOLUTIONS,
  RESOLUTION_BY_ID,
  changeKindLabel,
  describeOverride,
  isOpenReport,
  reportIssueLabel,
  reportStatusLabel,
  resolutionLabel,
} from '../../domain/verification';

type QueueFilter = 'attention' | ReportStatus | 'all';

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'queued', label: 'Queued' },
  { id: 'needs_information', label: 'Needs information' },
  { id: 'duplicate_candidate', label: 'Possible duplicates' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
];

export function ReviewWorkspace() {
  const { state, actions } = useStore();
  const [filter, setFilter] = useState<QueueFilter>('attention');

  const reports = useMemo(
    () => [...state.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.reports],
  );
  const counts: Record<ReportStatus, number> = {
    queued: reports.filter((r) => r.status === 'queued').length,
    needs_information: reports.filter((r) => r.status === 'needs_information').length,
    duplicate_candidate: reports.filter((r) => r.status === 'duplicate_candidate').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
    dismissed: reports.filter((r) => r.status === 'dismissed').length,
  };
  const openCount = reports.filter(isOpenReport).length;
  const shown = reports.filter((report) =>
    filter === 'all' ? true : filter === 'attention' ? isOpenReport(report) : report.status === filter,
  );
  const overrides = Object.values(state.overrides);

  return (
    <div className="workspace-panel review-workspace">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Verification</p>
          <h2>Review queue</h2>
          <p className="muted small">
            {openCount} open {openCount === 1 ? 'report' : 'reports'} · {state.changes.length} logged{' '}
            {state.changes.length === 1 ? 'decision' : 'decisions'} · {overrides.length} local{' '}
            {overrides.length === 1 ? 'override' : 'overrides'}
          </p>
        </div>
      </header>

      <p className="notice">
        This queue lives on this device. This release has no submission server, so reports are never sent anywhere and
        nobody else can see them. Confirming a correction applies a labelled local override; it never overwrites the City
        or provider value, which stays visible in the record’s sources and history.
      </p>

      <div className="count-chips" role="group" aria-label="Report counts">
        {(['queued', 'needs_information', 'duplicate_candidate', 'resolved', 'dismissed'] as ReportStatus[]).map(
          (status) => (
            <span key={status} className={`count-chip is-${status}`}>
              <strong>{counts[status]}</strong>
              <span>{reportStatusLabel(status)}</span>
            </span>
          ),
        )}
      </div>

      <div className="segmented wide" role="group" aria-label="Filter reports">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={filter === option.id ? 'is-active' : ''}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing in this queue">
          Report a wrong hour, a closed door, or a changed service from any record. Every report is checked for structure
          and duplicates before it lands here, and every decision you make is logged.
        </EmptyState>
      ) : (
        <ul className="report-list" aria-label="Reports">
          {shown.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </ul>
      )}

      <section className="review-overrides" aria-label="Local corrections in force">
        <h3>Local corrections in force</h3>
        {overrides.length === 0 ? (
          <p className="muted small">
            No local overrides. Every record is showing its bundled source values, unchanged.
          </p>
        ) : (
          <ul className="override-list">
            {overrides.map((override) => {
              const place = dataset.placeById.get(override.placeId);
              return (
                <li key={override.placeId}>
                  <strong>{place?.name ?? override.placeId}</strong>
                  <p>{describeOverride(override)}</p>
                  <span className="muted small">
                    Applied {formatDate(override.updatedAt)} from {override.reportIds.length} reviewed{' '}
                    {override.reportIds.length === 1 ? 'report' : 'reports'} · not a verified fact
                  </span>
                  <div className="button-row">
                    <button type="button" className="link-button" onClick={() => actions.selectPlace(override.placeId)}>
                      Open record
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void actions.removeOverride(override.placeId)}
                    >
                      Remove override
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="review-log" aria-label="Change log">
        <h3>Change log</h3>
        <p className="muted small">
          Append-only. Every review decision keeps its reason, the value before it, the value after it, and who made it.
        </p>
        {state.changes.length === 0 ? (
          <p className="muted small">No review decisions recorded yet.</p>
        ) : (
          <ol className="change-log">
            {state.changes.map((change) => (
              <li key={change.id} className="change-entry">
                <span>{formatDate(change.at)}</span>
                <strong>
                  {changeKindLabel(change.kind)} · {change.placeName}
                </strong>
                <p>
                  {change.field}: {change.before} → {change.after}
                </p>
                <span>
                  {change.reason} · {change.actor} · {change.disposition.replaceAll('_', ' ')} · report{' '}
                  {change.reportId.slice(-6)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ReportCard({ report }: { report: CorrectionReport }) {
  const { actions } = useStore();
  const [resolution, setResolution] = useState<ReportResolution>(
    () => REPORT_ISSUES.find((issue) => issue.id === report.issue)?.suggestedResolution ?? 'flag_for_verification',
  );
  const [note, setNote] = useState('');
  const place = dataset.placeById.get(report.placeId);
  const resolutionMeta = RESOLUTION_BY_ID.get(resolution);

  return (
    <li className="report-card">
      <div className="report-card-head">
        <div>
          <h4>{reportIssueLabel(report.issue)}</h4>
          <button
            type="button"
            className="link-button"
            onClick={() => actions.selectPlace(report.placeId)}
            disabled={!place}
          >
            {report.placeName}
          </button>
        </div>
        <span className={`report-status is-${report.status}`}>{reportStatusLabel(report.status)}</span>
      </div>

      <div className="report-facts">
        <span>received {formatDate(report.createdAt)}</span>
        {report.observedAt && <span>observed {formatDate(report.observedAt)}</span>}
        <span>{report.channel === 'on_device' ? 'kept on this device' : report.channel}</span>
        <span>ref {report.id.slice(-6)}</span>
        {report.duplicateOfId && <span>duplicate candidate</span>}
      </div>

      <p className="report-note">{report.note || 'No detail given.'}</p>

      {report.validation.problems.length > 0 && (
        <ul className="report-problems" aria-label="Validation problems">
          {report.validation.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {report.validation.warnings.length > 0 && (
        <ul className="report-warnings" aria-label="Validation warnings">
          {report.validation.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {report.resolution && (
        <p className="muted small">
          Resolved as {resolutionLabel(report.resolution.kind)} on {formatDate(report.resolution.at)}
          {report.resolution.note ? ` — ${report.resolution.note}` : ''}
        </p>
      )}

      <div className="review-controls">
        <label className="field">
          <span>Resolution</span>
          <select
            value={resolution}
            aria-label={`Resolution for ${report.placeName}`}
            onChange={(e) => setResolution(e.target.value as ReportResolution)}
          >
            {RESOLUTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {resolutionMeta && <p className="muted small">{resolutionMeta.description}</p>}
        <textarea
          rows={2}
          value={note}
          maxLength={1000}
          aria-label={`Review note for ${report.placeName}`}
          placeholder="What did you check, and what should the record now say?"
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="button-row">
          <button
            type="button"
            className="button primary small"
            disabled={!place}
            onClick={() => {
              void actions.resolveReport(report.id, resolution, note);
              setNote('');
            }}
          >
            Record resolution
          </button>
          {isOpenReport(report) ? (
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                void actions.dismissReport(report.id, note);
                setNote('');
              }}
            >
              Dismiss
            </button>
          ) : (
            <button type="button" className="button ghost small" onClick={() => void actions.reopenReport(report.id)}>
              Reopen
            </button>
          )}
        </div>
        {!place && (
          <p className="notice warn">
            This record is not in the installed dataset, so a correction can only be logged, not applied.
          </p>
        )}
      </div>

      <details className="report-history">
        <summary>Report history ({report.history.length})</summary>
        <ol>
          {report.history.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <span>{formatDate(event.at)}</span> {event.kind.replaceAll('_', ' ')} — {event.note}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

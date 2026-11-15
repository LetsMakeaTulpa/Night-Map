import { useMemo, useState } from 'react';
import { ZoneContextPanel } from '../zones/ZoneContextPanel';
import type { CategoryId, CorrectionReport, FrictionEntry, Observation, ReportIssue } from '../../domain/types';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { buildPlaceView } from '../../state/selectors';
import { formatDate, formatAge, sourcesFor } from '../../domain/status';
import { formatDistance } from '../../domain/geo';
import { CATEGORY_BY_ID, SERVICE_TYPE_LABELS } from '../../domain/categories';
import { FRICTION_KIND_LABELS, frictionFor } from '../../domain/friction';
import { EmptyState, EvidencePill, MetaRow, OpenState, SourceDetails, CategoryMark, PathIcon } from '../ui';
import type { ComposeTarget } from '../fieldnotes/FieldnoteComposer';
import {
  REPORT_ISSUES,
  changeKindLabel,
  describeOverride,
  reportIssueLabel,
  reportStatusLabel,
  resolutionLabel,
} from '../../domain/verification';

type Tab = 'overview' | 'access' | 'history' | 'observations' | 'sources' | 'area';

const DETAIL_LABELS: Record<string, string> = {
  meals: 'Meal service',
  eligibility: 'Eligibility',
  intake: 'Intake',
  cost: 'Cost',
  note: 'Note',
  access: 'Access label',
  maintainedBy: 'Maintained by',
  inPark: 'In park',
  waterFountain: 'Water fountain',
  bottleFiller: 'Bottle filler',
  jugFiller: 'Jug filler',
  rawHours: 'Hours as published',
  services: 'Services',
  capacity: 'Capacity',
  program: 'Program',
  emergency: 'Emergency guidance',
  facilities: 'Facilities',
  spaceType: 'POPOS type',
  cityHours: 'POPOS hours (City listing)',
  entranceDirections: 'Entrance / location notes (City listing)',
  landscaping: 'Landscaping',
  seating: 'Seating',
  seatingAvailable: 'Seating listed',
  foodService: 'Food service',
  publicArt: 'Public art listed',
  restrooms: 'Restrooms (City listing)',
  indoor: 'Indoor space',
  yearRecorded: 'Record year',
  signage: 'Public access signage (City listing)',
  sourceParcelNumber: 'City parcel reference',
};

const OBSERVATION_LABELS: Record<string, string> = {
  resource_present: 'Resource present',
  resource_not_found: 'Resource not found',
  hours_incorrect: 'Hours appear incorrect',
  open_observed: 'Observed open',
  closed_observed: 'Observed closed',
  access_issue: 'Access issue',
  infrastructure_change: 'Infrastructure change',
  new_resource: 'New or changed service',
  historical_discovery: 'Historical discovery',
  passage_discovery: 'Passage or cut-through',
  popos_observation: 'POPOS or public space candidate',
  entrance_observation: 'Entrance or access point',
  stairs_ramp_observation: 'Stairs, ramp or path',
  architectural_detail: 'Architectural detail',
  research_lead: 'Research lead · unverified',
  follow_up: 'Follow-up needed',
  other: 'Observation',
};

interface Props {
  placeId: string;
  onClose: () => void;
  onComposeNote: (target: ComposeTarget) => void;
}

export function PlaceInspector({ placeId, onClose, onComposeNote }: Props) {
  const { state, actions } = useStore();
  const place = placeId.startsWith('private:')
    ? (() => {
        const observation = state.observations.find((item) => `private:${item.id}` === placeId);
        if (!observation?.geometry) return undefined;
        const category: CategoryId = observation.type === 'passage_discovery' ? 'passage'
          : observation.type === 'popos_observation' ? 'popos'
            : observation.type === 'entrance_observation' || observation.type === 'stairs_ramp_observation' ? 'pedestrian_connection'
              : observation.type === 'research_lead' ? 'research_lead' : 'urban_clue';
        return {
          id: placeId, name: observation.placeName ?? `Private ${CATEGORY_BY_ID.get(category)?.short ?? 'field'} observation`, category,
          geometry: observation.geometry, address: null, addressType: 'point' as const,
          description: `${observation.note} Access: ${(observation.accessStatus ?? 'unknown').replaceAll('_', ' ')}. Evidence: ${(observation.confidence ?? 'unverified').replaceAll('_', ' ')}.`,
          accessibility: { status: 'not_documented' as const, note: 'Accessibility has not been independently verified.' },
          sourceIds: [], status: 'unknown' as const, locationPrecision: 'dataset_point' as const, neighborhood: null,
          createdAt: observation.recordedAt.slice(0, 10), updatedAt: observation.updatedAt.slice(0, 10),
          verificationOverride: { status: 'unverified' as const, label: 'Private · unverified', note: 'Stored on this device only.' },
        };
      })()
    : dataset.placeById.get(placeId);
  const [tab, setTab] = useState<Tab>('overview');
  const [reportOpen, setReportOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [issue, setIssue] = useState<ReportIssue>('hours_wrong');
  const [reportNote, setReportNote] = useState('');
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<CorrectionReport | null>(null);
  const [copied, setCopied] = useState(false);
  const privateObservation = placeId.startsWith('private:')
    ? state.observations.find((item) => `private:${item.id}` === placeId)
    : undefined;
  const observationTypeLabel = privateObservation ? OBSERVATION_LABELS[privateObservation.type] ?? 'Field observation' : null;

  const observations = useMemo(
    () => state.observations.filter((o) => o.placeId === placeId),
    [state.observations, placeId],
  );
  const reports = useMemo(() => state.reports.filter((r) => r.placeId === placeId), [state.reports, placeId]);
  const placeChanges = useMemo(
    () => state.changes.filter((change) => change.placeId === placeId),
    [state.changes, placeId],
  );

  if (!place) {
    return (
      <div className="inspector">
        <EmptyState title="Record not found">This place id is not in the installed dataset.</EmptyState>
      </div>
    );
  }

  const view = buildPlaceView(place, dataset, state);
  const evidence = privateObservation ? {
    ...view.evidence, tone: 'unknown' as const, label: 'Private · unverified',
    detail: 'Private observation stored on this device; not an accepted or published record.',
    openNow: null, openNote: 'Access is unknown unless verified by posted or source information.',
    checkedAt: null, recency: 'unknown' as const, days: null, hours: null, hoursNote: null, closingHint: null, canClaimOpen: false,
  } : view.evidence;
  const category = CATEGORY_BY_ID.get(place.category);
  const resources = privateObservation ? [] : dataset.resourcesByPlaceId.get(place.id) ?? [];
  const resource = resources[0];
  const sources = privateObservation ? [] : sourcesFor(place, resource, dataset.data.sources);
  const saved = state.saved.some((s) => s.placeId === place.id);
  const compareActive = state.compareIds.includes(place.id);
  // A reviewer's local correction, if a report for this record was confirmed.
  const localOverride = state.overrides[place.id] ?? null;
  const detailEntries = Object.entries(resource?.details ?? {}).filter(([, value]) => value !== null && value !== false);
  const friction = frictionFor(resources);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'area', label: 'Area' },
    { id: 'access', label: 'Access' },
    { id: 'history', label: 'History' },
    ...(observations.length ? [{ id: 'observations' as Tab, label: 'Observations', count: observations.length }] : []),
    { id: 'sources', label: 'Sources', count: sources.length },
  ];
  const externalUrl = `https://www.openstreetmap.org/?mlat=${place.geometry.coordinates[1]}&mlon=${place.geometry.coordinates[0]}#map=18/${place.geometry.coordinates[1]}/${place.geometry.coordinates[0]}`;

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/place/${encodeURIComponent(place.id)}`;
    try {
      await navigator.clipboard.writeText(`${place.name} — Night Map\n${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      actions.notify('Could not copy the link. Select the address in the browser instead.', 'warn');
    }
  };

  return (
    <article className="inspector" aria-label={`${place.name} details`}>
      <header className="inspector-head">
        <div className="inspector-title">
          <CategoryMark category={place.category} size={26} />
          <div>
            <p className="eyebrow">{category?.label ?? 'Place'}</p>
            <h2>{place.name}</h2>
          </div>
        </div>
        <button type="button" className="icon-button close" onClick={onClose} aria-label="Close place details">
          ×
        </button>
        <p className="inspector-address">
          {place.address ? (
            <>
              {place.address}
              {place.addressType === 'intersection' && <span className="chip tiny">listed as a cross-street</span>}
            </>
          ) : (
            <span className="muted">No address in the record</span>
          )}
          <span className="dot-sep">·</span>
          {formatDistance(view.distanceMeters, state.settings.units)} from {state.reference.label}
        </p>
        <div className="inspector-status">
          <EvidencePill evidence={evidence} />
          <OpenState evidence={evidence} />
          {evidence.checkedAt && (
            <span className="checked-at">
              checked {formatDate(evidence.checkedAt)} ({formatAge(evidence.days)})
            </span>
          )}
        </div>
      </header>

      <div className="primary-actions" role="group" aria-label="Primary actions">
        <button type="button" className="button primary" onClick={() => actions.startRouteTo(place)}>
          <PathIcon path="M5 19 19 5M11 5h8v8" /> GO
        </button>
        <button
          type="button"
          className={`button ${saved ? 'saved' : ''}`}
          onClick={() => void actions.toggleSaved(place.id)}
          aria-pressed={saved}
        >
          <PathIcon path="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.9-5.3 2.9 1-6L3.4 9.9l6-.9z" />
          {saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className="button" onClick={() => setReportOpen((v) => !v)} aria-expanded={reportOpen}>
          <PathIcon path="M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6ZM12 8h.01M11.2 11.6H12v5.2h1" />
          Report
        </button>
      </div>

      <div className="secondary-actions">
        <button type="button" className="link-button" onClick={() => void share()}>
          {copied ? 'Link copied' : 'Share place'}
        </button>
        <button type="button" className="link-button" onClick={() => setCollectionOpen((v) => !v)}>
          Add to collection
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() =>
            onComposeNote({
              placeId: place.id,
              placeName: place.name,
              coordinates: place.geometry.coordinates,
            })
          }
        >
          Add private note
        </button>
        <button type="button" className="link-button" onClick={() => actions.toggleCompare(place.id)} aria-pressed={compareActive}>
          {compareActive ? 'Remove from compare' : 'Compare'}
        </button>
        <a className="link-button" href={externalUrl} target="_blank" rel="noreferrer noopener">
          Open in OSM
        </a>
      </div>

      {collectionOpen && (
        <div className="inline-panel">
          {state.collections.length === 0 ? (
            <p className="muted small">
              No collections yet. Create one in the Atlas workspace, then save this place into it.
            </p>
          ) : (
            <ul className="collection-picker">
              {state.collections.map((collection) => (
                <li key={collection.id}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void actions.addToCollection(collection.id, 'place', place.id)}
                  >
                    + {collection.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reportOpen && (
        <form
          className="inline-panel report-form"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = reportNote.trim();
            if (trimmed.length < 4) {
              setFormError('Describe what you saw in a sentence — that is what makes a report useful.');
              return;
            }
            setFormError(null);
            void actions
              .addReport({
                placeId: place.id,
                placeName: place.name,
                issue,
                note: trimmed,
                observedAt: observedAt ? observedAt : null,
              })
              .then((record) => {
                setLastReport(record);
                setReportNote('');
                if (record.status === 'queued' || record.status === 'duplicate_candidate') setReportOpen(false);
              });
          }}
        >
          <h3>Report a problem with this record</h3>
          <label className="field">
            <span>What is wrong?</span>
            <select value={issue} onChange={(e) => setIssue(e.target.value as ReportIssue)}>
              {REPORT_ISSUES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">{REPORT_ISSUES.find((option) => option.id === issue)?.help}</p>
          <label className="field">
            <span>When did you see this? (optional)</span>
            <input
              type="date"
              value={observedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setObservedAt(e.target.value)}
            />
          </label>
          <label className="field">
            <span>What is wrong, and what did you see?</span>
            <textarea
              value={reportNote}
              rows={3}
              maxLength={2000}
              aria-label="Report detail"
              onChange={(e) => setReportNote(e.target.value)}
            />
          </label>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <p className="notice">
            There is no submission server in this release, so the report is stored on this device and checked here. It
            does not change the public record: the City or provider value stays as published until that source confirms
            it.
          </p>
          <div className="button-row">
            <button type="submit" className="button primary small">
              Send to review queue
            </button>
            <button type="button" className="button ghost small" onClick={() => setReportOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {lastReport && (
        <div className="inline-panel report-receipt" role="status">
          <h3>
            {reportIssueLabel(lastReport.issue)} — {reportStatusLabel(lastReport.status)}
          </h3>
          <p>
            {lastReport.status === 'queued'
              ? 'The structure checked out, so it is waiting in the review queue on this device.'
              : lastReport.status === 'duplicate_candidate'
                ? 'It looks like a repeat of a report that is already open, so it is queued as a duplicate candidate.'
                : 'Review needs more from you before this can be acted on.'}
          </p>
          {lastReport.validation.problems.map((problem) => (
            <p key={problem} className="form-error">
              {problem}
            </p>
          ))}
          {lastReport.validation.warnings.map((warning) => (
            <p key={warning} className="muted small">
              {warning}
            </p>
          ))}
          <div className="button-row">
            <button type="button" className="link-button" onClick={() => actions.setWorkspace('review')}>
              Open the review queue
            </button>
            <button type="button" className="link-button" onClick={() => setLastReport(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Place information">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {typeof t.count === 'number' ? <span className="tab-count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'area' && <ZoneContextPanel coordinates={place.geometry.coordinates} />}

        {tab === 'overview' && (
          <div className="stack">
            <p className="description">{place.description}</p>
            {privateObservation && <dl className="meta-table">
              <MetaRow label="Observation type">{observationTypeLabel}</MetaRow>
              <MetaRow label="Access">{(privateObservation.accessStatus ?? 'unknown').replaceAll('_', ' ')} — not permission to enter</MetaRow>
              <MetaRow label="Evidence">{(privateObservation.confidence ?? 'unverified').replaceAll('_', ' ')}</MetaRow>
              <MetaRow label="Observed">{formatDate(privateObservation.observedAt)}</MetaRow>
              <MetaRow label="Position">{privateObservation.geometry?.coordinates[1].toFixed(5)}, {privateObservation.geometry?.coordinates[0].toFixed(5)}</MetaRow>
            </dl>}
            {privateObservation?.photo && <figure className="photo-preview"><img src={privateObservation.photo.dataUrl} alt="Private field observation" /><figcaption>Private photo · metadata stripped</figcaption></figure>}
            {privateObservation?.sourceReference && <p><a href={privateObservation.sourceReference} target="_blank" rel="noreferrer noopener">Open observation source</a></p>}
            {privateObservation && <p className="notice">Private local observation; not an accepted or verified place record. Visible only on this device. Verify public access before entry.</p>}
            {privateObservation && <div className="button-row">
              <button type="button" className="button" onClick={() => onComposeNote({ placeId: privateObservation.placeId, placeName: privateObservation.placeName, coordinates: privateObservation.geometry?.coordinates ?? null })}>Edit fieldnote</button>
              <button type="button" className="button ghost" onClick={() => void actions.deleteObservation(privateObservation.id)}>Delete fieldnote</button>
            </div>}

            {localOverride && (
              <section className="local-override" aria-label="Local correction">
                <h3>Local correction on this device</h3>
                <p>{describeOverride(localOverride)}</p>
                <p className="muted small">
                  From {localOverride.reportIds.length} reviewed{' '}
                  {localOverride.reportIds.length === 1 ? 'report' : 'reports'}, applied{' '}
                  {formatDate(localOverride.updatedAt)}. It is a report, not a verified fact, and the source values below
                  are unchanged.
                </p>
                <button type="button" className="link-button" onClick={() => void actions.removeOverride(place.id)}>
                  Remove this override
                </button>
              </section>
            )}

            <section className="status-block">
              <h3>What we know about right now</h3>
              <OpenState evidence={evidence} />
              <p className="muted small">{evidence.openNote}</p>
              {resource?.availability.note && <p className="muted small">{resource.availability.note}</p>}
              <div className="status-foot">
                <a className="button ghost small" href={sources[0]?.url ?? '#'} target="_blank" rel="noreferrer noopener">
                  Check before going
                </a>
                {resource?.officialContact?.phone && (
                  <a className="button ghost small" href={`tel:${resource.officialContact.phone.replace(/[^\d+]/g, '')}`}>
                    Call {resource.officialContact.phone}
                  </a>
                )}
              </div>
            </section>

            <dl className="meta-table">
              <MetaRow label="Hours">
                {evidence.hours ? (
                  <ul className="hours-list">
                    {evidence.hours.lines.map((line) => (
                      <li key={`${line.days}-${line.time}`}>
                        <span className="hours-days">{line.days}</span>
                        <span className="hours-time">{line.time}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="not-confirmed">No published hours in the record</span>
                )}
              </MetaRow>
              {evidence.hoursNote && <MetaRow label="Hours caveat">{evidence.hoursNote}</MetaRow>}
              <MetaRow label="Cost">
                {resource?.cost ? (
                  <>
                    {resource.cost.kind === 'free' ? 'Free' : resource.cost.kind === 'unknown' ? <span className="not-confirmed">Not confirmed</span> : resource.cost.kind.replace('_', ' ')}
                    {resource.cost.note ? <span className="meta-note">{resource.cost.note}</span> : null}
                  </>
                ) : null}
              </MetaRow>
              <MetaRow label="Services">
                {resource?.serviceTypes?.length ? (
                  <ul className="tag-list">
                    {resource.serviceTypes.map((type) => (
                      <li key={type}>{SERVICE_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                ) : null}
              </MetaRow>
              {detailEntries.slice(0, place.category === 'popos' ? 10 : 4).map(([key, value]) => (
                <MetaRow key={key} label={DETAIL_LABELS[key] ?? key}>
                  {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                </MetaRow>
              ))}
              <MetaRow label="Contact">
                {resource?.officialContact?.website ? (
                  <a href={resource.officialContact.website} target="_blank" rel="noreferrer noopener">
                    Official page
                  </a>
                ) : resource?.officialContact?.phone ? (
                  <a href={`tel:${resource.officialContact.phone.replace(/[^\d+]/g, '')}`}>{resource.officialContact.phone}</a>
                ) : (
                  <span className="not-confirmed">No contact published in this record</span>
                )}
              </MetaRow>
              <MetaRow label="Data status">
                <EvidencePill evidence={evidence} compact />
                <span className="meta-note">{evidence.detail}</span>
              </MetaRow>
            </dl>

            {friction.length > 0 && <FrictionList entries={friction} />}

            {resources.length > 1 && (
              <section>
                <h3>Also recorded here</h3>
                <ul className="resource-stack">
                  {resources.slice(1).map((extra) => (
                    <li key={extra.id}>
                      <strong>{SERVICE_TYPE_LABELS[extra.serviceTypes[0]] ?? extra.name}</strong>
                      <span className="muted small"> · {extra.verification.label}</span>
                      <p className="muted small">{extra.verification.note}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="provenance-line">
              Record updated {formatDate(place.updatedAt)} · {place.locationPrecision.replaceAll('_', ' ')} ·{' '}
              {sources.length} source{sources.length === 1 ? '' : 's'} attached
            </p>
          </div>
        )}

        {tab === 'access' && (
          <div className="stack">
            <dl className="meta-table">
              <MetaRow label="Eligibility">{resource?.eligibility ?? null}</MetaRow>
              <MetaRow label="Intake / requirements">{resource?.intake ?? null}</MetaRow>
              <MetaRow label="Cost">
                {resource?.cost ? (
                  <>
                    {resource.cost.kind === 'free' ? 'Free' : resource.cost.kind.replace('_', ' ')}
                    {resource.cost.note ? <span className="meta-note">{resource.cost.note}</span> : null}
                  </>
                ) : null}
              </MetaRow>
              <MetaRow label="Accessibility">
                {place.accessibility.status === 'documented_accessible' ? (
                  'Documented accessible'
                ) : (
                  <span className="not-confirmed">Not documented</span>
                )}
                <span className="meta-note">{place.accessibility.note}</span>
              </MetaRow>
              {localOverride?.accessNote && (
                <MetaRow label="Local access correction">{localOverride.accessNote}</MetaRow>
              )}
              <MetaRow label="Near Muni">
                {view.isNearTransit ? (
                  'A mapped Muni stop is within about 400 m (straight line). This is not a frequency or accessibility guarantee.'
                ) : (
                  'No mapped Muni stop within about 400 m in this dataset.'
                )}
              </MetaRow>
              <MetaRow label="Hours source">
                {evidence.hours ? 'Published hours in the source record' : 'No hours available'}
                {evidence.hoursNote ? <span className="meta-note">{evidence.hoursNote}</span> : null}
              </MetaRow>
              {detailEntries.map(([key, value]) => (
                <MetaRow key={key} label={DETAIL_LABELS[key] ?? key}>
                  {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                </MetaRow>
              ))}
            </dl>
            {friction.length > 0 && <FrictionList entries={friction} />}
            <p className="notice">
              Night Map does not know whether this entrance is step-free, whether the bathroom fits a wheelchair, or
              whether staff can provide language support. Those are not fields in the source data. Call ahead when it
              matters.
            </p>
          </div>
        )}

        {tab === 'history' && (
          <div className="stack">
            <p className="muted small">
              Distinct evidence, not one merged fact. A City dataset row, a provider page and your own observation can
              disagree, and all three are kept.
            </p>
            <ol className="timeline">
              {evidence.checkedAt && (
                <li>
                  <span className="timeline-when">{formatDate(evidence.checkedAt)}</span>
                  <div>
                    <strong>{resource?.verification.label ?? 'Record verification'}</strong>
                    <p>{evidence.detail}</p>
                    <span className="timeline-meta">Recorded by {sources[0]?.provider ?? 'unknown provider'}</span>
                  </div>
                </li>
              )}
              {resource?.sourceUpdatedAt && (
                <li>
                  <span className="timeline-when">{formatDate(resource.sourceUpdatedAt)}</span>
                  <div>
                    <strong>Source dataset reported this record</strong>
                    <p>
                      City/open-data row last updated. This is the dataset’s own timestamp, not a Night Map check of the
                      location.
                    </p>
                    <span className="timeline-meta">Source: {sources[0]?.name ?? 'dataset'}</span>
                  </div>
                </li>
              )}
              {observations.map((observation) => (
                <li key={observation.id}>
                  <span className="timeline-when">{formatDate(observation.observedAt)}</span>
                  <div>
                    <strong>{OBSERVATION_LABELS[observation.type] ?? 'Observation'}</strong>
                    <p>{observation.note}</p>
                    <span className="timeline-meta">
                      Your private observation · recorded {formatDate(observation.recordedAt)} · unverified
                    </span>
                  </div>
                </li>
              ))}
              {reports.map((report) => (
                <li key={report.id}>
                  <span className="timeline-when">{formatDate(report.createdAt)}</span>
                  <div>
                    <strong>
                      {reportIssueLabel(report.issue)} · {reportStatusLabel(report.status)}
                    </strong>
                    <p>{report.note || 'No detail given.'}</p>
                    <span className="timeline-meta">
                      {report.observedAt ? `observed ${formatDate(report.observedAt)} · ` : ''}
                      report {report.id.slice(-6)} · kept on this device
                      {report.resolution
                        ? ` · resolved as ${resolutionLabel(report.resolution.kind)} on ${formatDate(report.resolution.at)}`
                        : ''}
                    </span>
                  </div>
                </li>
              ))}
              {placeChanges.map((change) => (
                <li key={change.id}>
                  <span className="timeline-when">{formatDate(change.at)}</span>
                  <div>
                    <strong>{changeKindLabel(change.kind)}</strong>
                    <p>
                      {change.field}: {change.before} → {change.after}
                    </p>
                    <span className="timeline-meta">
                      {change.reason} · {change.actor} · {change.disposition.replaceAll('_', ' ')}
                    </span>
                  </div>
                </li>
              ))}
              {sources.map((source) => (
                <li key={`src-${source.id}`}>
                  <span className="timeline-when">{formatDate(source.retrievedAt)}</span>
                  <div>
                    <strong>Source retrieved for this release</strong>
                    <p>{source.name}</p>
                    <span className="timeline-meta">
                      {source.provider} · {source.license}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {tab === 'observations' && (
          <div className="stack">
            <button
              type="button"
              className="button primary small"
              onClick={() =>
                onComposeNote({
                  placeId: place.id,
                  placeName: place.name,
                  coordinates: place.geometry.coordinates,
                })
              }
            >
              Add a private observation
            </button>
            <ul className="observation-list">
              {observations.map((observation) => (
                <ObservationRow key={observation.id} observation={observation} />
              ))}
            </ul>
          </div>
        )}

        {tab === 'sources' && (
          <div className="stack">
            <SourceDetails sources={sources} />
            <p className="notice">
              Night Map preserves the source’s own fields. Community notes are never merged into an official value; they
              appear as separate observations with their own date and status.
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function ObservationRow({ observation }: { observation: Observation }) {
  const { actions } = useStore();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="observation-card">
      <div className="observation-head">
        <strong>{OBSERVATION_LABELS[observation.type]}</strong>
        <span className="private-lock">Private</span>
      </div>
      <p>{observation.note}</p>
      {observation.photo && <img src={observation.photo.dataUrl} alt="Field note attachment" className="observation-photo" />}
      <p className="muted small">
        Observed {formatDate(observation.observedAt)} · recorded {formatDate(observation.recordedAt)} · unverified
      </p>
      {confirming ? (
        <div className="button-row">
          <button type="button" className="button danger small" onClick={() => void actions.deleteObservation(observation.id)}>
            Delete permanently
          </button>
          <button type="button" className="button ghost small" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => setConfirming(true)}>
          Delete note
        </button>
      )}
    </li>
  );
}

/**
 * Cost and friction, quoted from the page it came from. A blank value is the
 * honest part: it records that the source does not say, which is different from
 * saying there is no requirement.
 */
function FrictionList({ entries }: { entries: FrictionEntry[] }) {
  return (
    <section className="friction-block" aria-label="Cost and friction">
      <h3>Cost &amp; friction</h3>
      <p className="muted small">
        What it actually takes to use this, line by line, with the page each line came from. “Not stated in the source”
        means that page is silent on the point — it is not evidence that no requirement exists.
      </p>
      <ul className="friction-list">
        {entries.map((line) => {
          const source = dataset.sourceById.get(line.sourceId);
          return (
            <li key={`${line.kind}-${line.label}`} className="friction-item">
              <div className="friction-head">
                <strong>{line.label}</strong>
                <span className="friction-kind">{FRICTION_KIND_LABELS[line.kind]}</span>
              </div>
              {line.value ? (
                <p className="friction-value">{line.value}</p>
              ) : (
                <p className="friction-value not-confirmed">Not stated in the source</p>
              )}
              <p className="muted small">{line.note}</p>
              <p className="friction-source">
                {source ? (
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.name}
                  </a>
                ) : (
                  'Source not in the registry'
                )}
                {line.asOf ? ` · read ${formatDate(line.asOf)}` : ' · the page shows no date'}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CompareTray() {
  const { state, actions } = useStore();
  if (state.compareIds.length === 0) return null;
  const places = state.compareIds
    .map((id) => dataset.placeById.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  return (
    <section className="compare-tray">
      <div className="compare-head">
        <h3>Compare records</h3>
        <button type="button" className="link-button" onClick={actions.clearCompare}>
          Clear
        </button>
      </div>
      <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, places.length)}, 1fr)` }}>
        {places.map((place) => {
          const resource = dataset.resourceByPlaceId.get(place.id);
          const view = buildPlaceView(place, dataset, state);
          return (
            <div key={place.id} className="compare-card">
              <CategoryMark category={place.category} size={18} />
              <strong>{place.name}</strong>
              <dl>
                <dt>Status</dt>
                <dd>{view.evidence.label}</dd>
                <dt>Checked</dt>
                <dd>{formatDate(view.evidence.checkedAt)}</dd>
                <dt>Hours</dt>
                <dd>{view.evidence.hours?.lines[0]?.time ?? 'Not confirmed'}</dd>
                <dt>Cost</dt>
                <dd>{resource?.cost?.kind && resource.cost.kind !== 'unknown' ? resource.cost.kind : 'Not confirmed'}</dd>
                <dt>Walk</dt>
                <dd>{view.walkMinutes} min</dd>
              </dl>
            </div>
          );
        })}
      </div>
      {places.length < 2 && <p className="muted small">Add one more record to compare side by side.</p>}
    </section>
  );
}

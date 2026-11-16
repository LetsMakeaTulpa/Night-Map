import { useEffect, useState } from 'react';
import { buildingById, loadBuildingRegistry } from '../../data/building-registry';
import { dataset } from '../../data';
import {
  BUILDING_STATUSES,
  CONFIDENCE_LABELS,
  LOCATION_PRECISION_LABELS,
  buildingCheckSummary,
  buildingConditionLabel,
  buildingScoreInputs,
  buildingStatusMeta,
  buildingTimeline,
  formatParcel,
} from '../../domain/buildings';
import { formatDate } from '../../domain/status';
import { useStore } from '../../state/store';
import { EmptyState, MetaRow } from '../ui';
import type { BuildingDossier as Dossier } from '../../domain/types';
import type { ComposeTarget } from '../fieldnotes/FieldnoteComposer';

const TIMELINE_LABELS = {
  complaint: 'Complaint',
  notice: 'Notice',
  permit: 'Permit',
} as const;

/**
 * A parcel dossier: identification, the evidence behind its classification, the
 * preserved records, and a chronology derived from them. Nothing here overwrites
 * a source value, and every record names the dataset it came from.
 */
export function BuildingDossier({
  dossierId,
  onBack,
  onComposeCheck,
}: {
  dossierId: string;
  onBack: () => void;
  onComposeCheck?: (target: ComposeTarget) => void;
}) {
  const { state, actions } = useStore();
  const [dossier, setDossier] = useState<Dossier | null>(() => buildingById(dossierId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const held = buildingById(dossierId);
    if (held) {
      setDossier(held);
      setError(null);
      return;
    }
    let cancelled = false;
    loadBuildingRegistry()
      .then((registry) => {
        if (cancelled) return;
        setDossier(registry.dossiers.find((entry) => entry.id === dossierId) ?? null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [dossierId]);

  if (error) {
    return (
      <div className="workspace-panel dossier">
        <EmptyState title="The dossier could not be loaded">{error}</EmptyState>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="workspace-panel dossier">
        <p className="muted small" role="status">
          Loading dossier…
        </p>
      </div>
    );
  }

  const status = buildingStatusMeta(dossier.status);
  const timeline = buildingTimeline(dossier);
  const checkSummary = buildingCheckSummary(state.observations, dossier.id);
  const checks = state.observations
    .filter((observation) => observation.buildingId === dossier.id)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const sources = [...new Set([...timeline.map((event) => event.sourceId)])]
    .map((id) => dataset.sourceById.get(id))
    .filter((source): source is NonNullable<typeof source> => Boolean(source));

  const showOnMap = () => {
    actions.setLayer('building-registry', true);
    actions.selectBuilding(dossier.id);
    actions.setSheet('peek');
    actions.notify('Building registry layer on. The dossier stays open in Buildings.', 'success');
  };

  return (
    <article className="workspace-panel dossier">
      <button type="button" className="link-button" onClick={onBack}>
        ← All buildings
      </button>

      <header className="dossier-head">
        <p className="eyebrow">
          Building dossier · {dossier.neighborhood ?? 'neighbourhood not published'}
        </p>
        <h2 className="display">{dossier.address}</h2>
        <div className="dossier-badges">
          <span className={`building-status status-${dossier.status}`}>{status.label}</span>
          <span className={`confidence confidence-${dossier.confidence}`}>
            {dossier.confidence} confidence — {CONFIDENCE_LABELS[dossier.confidence]}
          </span>
          {checkSummary.latest && (
            <span className="confidence">
              Your last field verification {observationStamp(checkSummary.latest.observedAt)} —{' '}
              {buildingConditionLabel(checkSummary.latest.buildingCondition)}
            </span>
          )}
        </div>
        <p className="muted small">{status.note}</p>
      </header>

      <p className="notice small">
        A classification of City records attached to this parcel, not a field check. A building with a vacancy
        complaint can be occupied, and a boarded building can be under legitimate construction.
      </p>

      <section className="dossier-meta">
        <h3>Identification</h3>
        <dl className="meta-table">
          <MetaRow label="Parcel (block / lot)">{formatParcel(dossier)}</MetaRow>
          <MetaRow label="Assessor parcel" note={dossier.parcelNumber ? null : 'The complaints file did not carry a parcel number.'}>
            {dossier.parcelNumber ?? undefined}
          </MetaRow>
          <MetaRow
            label="Position"
            note={
              dossier.coordinates
                ? LOCATION_PRECISION_LABELS[dossier.locationPrecision]
                : 'No City dataset placed this parcel, so the dossier is searchable here but not plotted.'
            }
          >
            {dossier.coordinates
              ? `${dossier.coordinates[1].toFixed(5)}, ${dossier.coordinates[0].toFixed(5)}`
              : undefined}
          </MetaRow>
          <MetaRow label="Building" note={dossier.use ?? null}>
            {dossier.stories
              ? `${dossier.stories} store${dossier.stories === 1 ? 'y' : 's'} from the newest permit row`
              : undefined}
          </MetaRow>
          <MetaRow label="Records span">
            {dossier.firstRecordAt
              ? `${formatDate(dossier.firstRecordAt)} → ${dossier.lastRecordAt ? formatDate(dossier.lastRecordAt) : 'unknown'}`
              : 'No dated record in this extract'}
          </MetaRow>
          <MetaRow label="Record counts">
            {dossier.counts.complaints} complaints · {dossier.counts.notices} notices · {dossier.counts.permits} permits
            <span className="meta-note">
              {dossier.complaints.length + dossier.notices.length + dossier.permits.length} of those records are bundled
              with this dossier; the counts cover the full set the City returned.
            </span>
          </MetaRow>
        </dl>
      </section>

      <section className="dossier-score">
        <h3>Record priority — {dossier.score}/100</h3>
        <p className="muted small">
          A sorting hint that shows its own inputs. It is not a probability that a building is abandoned, and the app
          never converts it into one.
        </p>
        <ul className="score-inputs">
          {buildingScoreInputs(dossier).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {dossier.vacancyLatestAt && (
          <p className="muted small">Newest vacancy-related record: {formatDate(dossier.vacancyLatestAt)}.</p>
        )}
        {dossier.demolitionLatestAt && (
          <p className="muted small">Newest demolition permit: {formatDate(dossier.demolitionLatestAt)}.</p>
        )}
      </section>

      <section className="dossier-actions">
        <button type="button" className="button small" onClick={showOnMap} disabled={!dossier.coordinates}>
          Show on map
        </button>
        {!dossier.coordinates && <span className="muted small">This parcel has no published point to fly to.</span>}
        <button
          type="button"
          className="button small"
          onClick={() => {
            const payload = {
              exportedAt: new Date().toISOString(),
              note: 'One building dossier from Night Map. Underlying records remain City of San Francisco open data (PDDL).',
              dossier,
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `night-map-${dossier.block}-${dossier.lot}.json`;
            link.click();
            URL.revokeObjectURL(url);
            actions.notify('Dossier exported as JSON.', 'success');
          }}
        >
          Export dossier
        </button>
      </section>

      <RecordSection
        title="DBI complaints"
        empty="No complaint rows are bundled for this parcel."
        rows={dossier.complaints.map((row) => ({
          id: row.id,
          date: row.date,
          status: row.status,
          text: row.description,
        }))}
        sourceUrl={dataset.sourceById.get('src:sfgov-dbi-complaints')?.url}
      />

      <RecordSection
        title="Notices of violation"
        empty="No notice items are bundled for this parcel."
        rows={dossier.notices.map((row) => ({
          id: row.id,
          date: row.date,
          status: row.status,
          text: row.item,
          note: row.category,
        }))}
        sourceUrl={dataset.sourceById.get('src:sfgov-dbi-novs')?.url}
      />

      <RecordSection
        title="Permits"
        empty="No permit rows are bundled for this parcel."
        rows={dossier.permits.map((row) => ({
          id: row.id,
          date: row.date,
          status: row.status,
          text: row.description || row.type,
          note: row.type,
        }))}
        sourceUrl={dataset.sourceById.get('src:sfgov-dbi-permits')?.url}
      />

      <section className="dossier-timeline">
        <h3>Chronology</h3>
        <p className="muted small">Oldest first, derived from the records above rather than written separately.</p>
        {timeline.length === 0 ? (
          <p className="muted small">No dated record is bundled.</p>
        ) : (
          <ol className="timeline-list">
            {timeline.map((event) => (
              <li key={`${event.kind}-${event.recordId}-${event.at}`} className={`timeline-item kind-${event.kind}`}>
                <span className="timeline-date">{formatDate(event.at)}</span>
                <span className="timeline-kind">{TIMELINE_LABELS[event.kind]}</span>
                <strong>{event.title}</strong>
                <span className="timeline-detail">{event.detail}</span>
                {event.status && <span className="muted small">City status: {event.status}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="dossier-verification">
        <div className="record-section-head">
          <h3>Your private field verification</h3>
          <span className="private-lock">Private · this device</span>
        </div>
        <p className="muted small">
          A dated observation with an optional photo, kept beside the City records. It is never published or sent
          anywhere, and it never changes what the City file says.
        </p>
        {onComposeCheck && (
          <button
            type="button"
            className="button small primary"
            data-testid="add-field-verification"
            onClick={() =>
              onComposeCheck({
                placeId: null,
                placeName: dossier.address,
                coordinates: dossier.coordinates,
                buildingId: dossier.id,
                buildingAddress: dossier.address,
              })
            }
          >
            Add field verification
          </button>
        )}
        {checks.length === 0 ? (
          <p className="muted small">No field verification on this device yet.</p>
        ) : (
          <ul className="check-list">
            {checks.map((check) => (
              <li key={check.id} className="check-item" data-testid="field-verification">
                <div className="record-item-head">
                  <span>{observationStamp(check.observedAt)}</span>
                  <span className="record-status">{buildingConditionLabel(check.buildingCondition)}</span>
                </div>
                <p>{check.note}</p>
                {check.photo && (
                  <img
                    className="check-photo"
                    src={check.photo.dataUrl}
                    alt={`Private field verification at ${dossier.address}`}
                  />
                )}
                <span className="muted small">Unverified observation · recorded on this device</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dossier-sources">
        <h3>Where this comes from</h3>
        <ul className="plain-list">
          {sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {source.name}
              </a>{' '}
              — {source.provider}. {source.license}.
            </li>
          ))}
        </ul>
        <p className="coverage-foot">
          Records are joined on the City's block and lot, not on a street address, so two datasets that spell an
          address differently still land on the same dossier. Only the newest three rows of each kind are bundled; the
          counts above describe the full set.
        </p>
      </section>

      <ul className="dossier-status-key">
        {BUILDING_STATUSES.map((entry) => (
          <li key={entry.id}>
            <span className={`status-swatch status-${entry.id}`} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>
    </article>
  );
}

function observationStamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return formatDate(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(parsed);
  return `${formatDate(iso)} · ${time}`;
}

function RecordSection({
  title,
  empty,
  rows,
  sourceUrl,
}: {
  title: string;
  empty: string;
  rows: { id: string; date: string | null; status: string; text: string; note?: string }[];
  sourceUrl?: string;
}) {
  return (
    <section className="record-section">
      <div className="record-section-head">
        <h3>{title}</h3>
        {sourceUrl && (
          <a className="muted small" href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Open City dataset ↗
          </a>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="record-list">
          {rows.map((row) => (
            <li key={`${row.id}-${row.date ?? ''}`} className="record-item">
              <div className="record-item-head">
                <span>{row.date ? formatDate(row.date) : 'date not published'}</span>
                <code>{row.id}</code>
                {row.status && <span className="record-status">{row.status}</span>}
              </div>
              <p>{row.text}</p>
              {row.note && <span className="muted small">{row.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  ageInWords,
  feedSummary,
  INCIDENT_SNAPSHOT_AT,
  loadIncidentFeed,
  type IncidentCollection,
} from '../../map/incidents';
import { signalsFromPublishedRecords } from '../../domain/zone-context';
import { summarizeZone, zoneIdForPoint } from '../../domain/zone-intelligence';
import { summarizePublicRealmMaintenanceForZone } from '../../domain/public-realm-maintenance';

interface Props {
  coordinates: [number, number];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; calls: IncidentCollection; cases311: IncidentCollection }
  | { status: 'error'; message: string };

function snapshotStamp(value: string | null): string {
  if (!value) return 'No timestamp published';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Timestamp unavailable';
}

export function ZoneContextPanel({ coordinates }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setLoaded({ status: 'loading' });
    Promise.all([loadIncidentFeed('calls'), loadIncidentFeed('cases311')])
      .then(([calls, cases311]) => {
        if (active) setLoaded({ status: 'ready', calls, cases311 });
      })
      .catch((error: unknown) => {
        if (active) {
          setLoaded({
            status: 'error',
            message: error instanceof Error ? error.message : 'The published snapshots could not be loaded.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const zone = useMemo(
    () => zoneIdForPoint(coordinates[0], coordinates[1]),
    [coordinates[0], coordinates[1]],
  );

  const summary = useMemo(() => {
    if (loaded.status !== 'ready') return null;
    const calls = loaded.calls.features.map((feature) => ({
      coordinates: feature.geometry.coordinates,
      observedAt: feature.properties.at,
      category: 'published dispatched call',
    }));
    const cases311 = loaded.cases311.features.map((feature) => ({
      coordinates: feature.geometry.coordinates,
      observedAt: feature.properties.at,
      category: [feature.properties.kind, feature.properties.subtype].filter(Boolean).join(' · '),
    }));
    const signals = signalsFromPublishedRecords(calls, cases311);
    return summarizeZone(zone.id, signals, []);
  }, [loaded, zone.id]);

  const maintenanceSummary = useMemo(
    () => loaded.status === 'ready'
      ? summarizePublicRealmMaintenanceForZone(
          loaded.cases311.features.map((feature) => ({
            coordinates: feature.geometry.coordinates,
            kind: feature.properties.kind,
          })),
          zone.id,
        )
      : { total: 0, categories: [] },
    [loaded, zone.id],
  );

  const callsMeta = feedSummary('calls');
  const casesMeta = feedSummary('cases311');

  return (
    <div className="zone-context">
      <header className="zone-context-head">
        <div>
          <p className="eyebrow">Coarse area summary</p>
          <h3>{zone.label}</h3>
        </div>
        <span className="zone-scope">~250 m cell</span>
      </header>

      {loaded.status === 'loading' && (
        <p className="feed-status" role="status">Loading the published City snapshots…</p>
      )}

      {loaded.status === 'error' && (
        <div className="inline-panel" role="status">
          <strong>Area data unavailable</strong>
          <p className="muted small">{loaded.message}</p>
          <button type="button" className="button small" onClick={() => setAttempt((value) => value + 1)}>
            Retry snapshot load
          </button>
        </div>
      )}

      {summary && (
        <>
          <div className="zone-metrics" aria-label="Published reports in this grid cell">
            <article className="zone-metric">
              <span>Dispatched calls</span>
              <strong>{summary.feedCounts.dispatched_call}</strong>
              <small>matching calls in snapshot</small>
            </article>
            <article className="zone-metric">
              <span>311 service requests</span>
              <strong>{summary.feedCounts.service_request}</strong>
              <small>matching requests in snapshot</small>
            </article>
          </div>
          <section className="zone-source" data-testid="maintenance-summary">
            <div className="zone-source-head">
              <strong>Public-realm maintenance requests</strong>
              <span>{maintenanceSummary.total} in this cell</span>
            </div>
            {maintenanceSummary.categories.length > 0 ? (
              <ul className="plain-list">
                {maintenanceSummary.categories.map((entry) => (
                  <li key={entry.kind}>{entry.label}: {entry.count}</li>
                ))}
              </ul>
            ) : (
              <p>No matching public-realm maintenance request appears in this cell in the installed snapshot.</p>
            )}
            <p>Filtered from the same 7-day City 311 snapshot. A service request is not confirmation that the condition exists now or remains unresolved.</p>
          </section>

          <section className="zone-source">
            <div className="zone-source-head">
              <strong>Dispatched calls</strong>
              <span>{ageInWords(callsMeta.newest)}</span>
            </div>
            <p>{callsMeta.window}. The feed includes closed calls only.</p>
            <a href={`https://data.sf.gov/d/${callsMeta.dataset}`} target="_blank" rel="noreferrer noopener">
              Open City dataset · {callsMeta.rows.toLocaleString()} rows in this snapshot
            </a>
          </section>

          <section className="zone-source">
            <div className="zone-source-head">
              <strong>311 service requests</strong>
              <span>{ageInWords(casesMeta.newest)}</span>
            </div>
            <p>{casesMeta.window}. A request may already be resolved or scheduled.</p>
            <a href={`https://data.sf.gov/d/${casesMeta.dataset}`} target="_blank" rel="noreferrer noopener">
              Open City dataset · {casesMeta.rows.toLocaleString()} rows in this snapshot
            </a>
          </section>

          <p className="zone-snapshot">
            Snapshot built {snapshotStamp(INCIDENT_SNAPSHOT_AT)}. These are raw counts in a coarse cell, not rates;
            the two sources cover different time windows and have different reporting patterns.
          </p>
        </>
      )}

      <div className="notice zone-caveat">
        <strong>What these numbers do not mean</strong>
        <p>
          A dispatched call is not proof of a crime. A 311 case is not proof of wrongdoing and may be closed.
          Maintenance requests indicate where someone submitted a service request, not a verified outage, ongoing defect,
          neglect finding, danger level or current condition. Counts do not measure danger, predict enforcement, or tell
          you what is happening now. Zero matches means only that this snapshot contains no matching entry.
        </p>
      </div>

      <p className="muted small">
        Community comfort, low-friction and public-access ratings are not collected in this release, so no
        subjective score is shown. The grid is an approximate spatial grouping, not an exact boundary.
      </p>
    </div>
  );
}

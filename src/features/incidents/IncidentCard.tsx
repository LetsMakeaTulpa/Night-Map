import { useStore } from '../../state/store';
import type { IncidentFeed, IncidentFeature } from '../../map/incidents';
import {
  ageInWords,
  COORDINATE_PRECISION_METRES,
  INCIDENT_SNAPSHOT_AT,
  describeIncident,
  feedSummary,
} from '../../map/incidents';

interface IncidentCardProps {
  feed: IncidentFeed;
  properties: IncidentFeature['properties'];
  coordinates: [number, number];
  onClose: () => void;
}

/**
 * The information card for a reported incident.
 *
 * It shows what the City published, says how old the record is now, and states
 * its limits: these are published snapshots, never a live feed. It deliberately
 * cannot show an address or a narrative, because neither is carried into the app.
 */
export function IncidentCard({ feed, properties, coordinates, onClose }: IncidentCardProps) {
  const { actions } = useStore();
  const summary = feedSummary(feed);
  const rows = describeIncident(feed, properties, coordinates);
  const datasetUrl = `https://data.sf.gov/d/${summary.dataset}`;

  return (
    <aside className="incident-card" role="dialog" aria-label="Reported activity" data-testid="incident-card">
      <div className="incident-card-head">
        <div>
          <p className="eyebrow">
            {feed === 'calls' ? 'Dispatched call' : '311 request'} · published record
          </p>
          <h3>{properties.kind}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close reported activity card">
          ×
        </button>
      </div>

      <dl className="incident-rows">
        {rows.map((row) => (
          <div key={row.label} className="incident-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="incident-actions">
        <button
          type="button"
          className="button small"
          data-testid="incident-route"
          onClick={() => {
            actions.routeToPoint(properties.kind, coordinates);
            onClose();
          }}
        >
          Route here
        </button>
      </div>

      <details className="incident-source" data-testid="incident-provenance">
        <summary>Where this came from, and where it stops</summary>
        <p>
          <strong>{summary.name}</strong> — dataset <code>{summary.dataset}</code> via the City and County of San
          Francisco’s open data portal, covering {summary.window}. This build’s snapshot was taken{' '}
          {new Date(INCIDENT_SNAPSHOT_AT).toLocaleString()}; its newest record was {summary.lag} then, and is{' '}
          {ageInWords(summary.newest)} read now.
        </p>
        <p>{summary.notLive}</p>
        <ul>
          <li>
            Only about {COORDINATE_PRECISION_METRES} m of positional accuracy is kept, and street addresses, narratives
            and notes are dropped before the file is written.
          </li>
          <li>
            {feed === 'calls'
              ? `${summary.dropped.sensitiveCall ?? 0} calls were withheld by the City’s own sensitive-call flag, ${summary.dropped.excludedCategory ?? 0} were removed by Night Map’s category rules, and ${summary.dropped.noLocation ?? 0} had no usable position.`
              : `${summary.dropped.excludedCategory ?? 0} cases were removed by Night Map’s category rules — including anything that describes a person rather than a place.`}
          </li>
          <li>
            A record here is a report someone made. It is not a statement that anything is happening now, and it is not
            a judgement about anyone at that location.
          </li>
        </ul>
        <p>
          <a href={datasetUrl} target="_blank" rel="noreferrer noopener">
            Open the source dataset
          </a>
        </p>
      </details>

      <p className="incident-foot">
        Recorded {new Date(properties.at).toLocaleString()} · {ageInWords(properties.at)}
      </p>
    </aside>
  );
}

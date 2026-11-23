import type { TransitStop } from '../../domain/types';
import { useStore } from '../../state/store';
import {
  describeHeadway,
  formatServiceClock,
  formatServiceDate,
  isAfterMidnight,
  overnightServiceFor,
  transitServiceMeta,
} from '../../data/transit-service';

/**
 * The card for a Muni stop.
 *
 * It shows scheduled overnight service only. No part of it is a live arrival,
 * an availability claim or a judgement about waiting at this stop.
 */
export function StopCard({ stop, onClose }: { stop: TransitStop; onClose: () => void }) {
  const { actions } = useStore();
  const service = overnightServiceFor(stop.id);
  const unmatched = transitServiceMeta.unmatchedStopIds.includes(stop.id);
  const meta = transitServiceMeta;
  const serviceDate = formatServiceDate();

  return (
    <aside
      className="incident-card stop-card"
      role="dialog"
      aria-label="Muni stop and scheduled night service"
      data-testid="stop-card"
    >
      <div className="incident-card-head">
        <div>
          <p className="eyebrow">Muni stop · scheduled night service</p>
          <h3>{stop.name}</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close stop card">
          ×
        </button>
      </div>

      <p className="stop-streets">
        {[stop.onStreet, stop.atStreet].filter(Boolean).join(' at ') || 'Street location in the Muni inventory'}
      </p>

      {service ? (
        <>
          {service.owl && (
            <span className="stop-owl-badge" data-testid="stop-owl">
              Owl service · a route is scheduled between midnight and 05:00
            </span>
          )}
          <ul className="stop-routes" data-testid="stop-routes">
            {service.routes.map((route) => (
              <li key={route.route}>
                <strong>{route.route}</strong>
                <span>{describeHeadway(route)}</span>
                <span className="stop-route-last">
                  last {formatServiceClock(route.lastDeparture)}
                  {isAfterMidnight(route.lastDeparture) ? ' next day' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="stop-service-window">
            {service.departures} scheduled {service.departures === 1 ? 'departure' : 'departures'} between 22:00 and
            05:00 the following morning. Headways are an average of the scheduled gaps, not a promise of a wait.
          </p>
        </>
      ) : unmatched ? (
        <p className="stop-service-window" data-testid="stop-service-unknown">
          Night service could not be derived for this stop: it did not match a stop in the SFMTA feed.
          That is missing data, not evidence that no bus runs here.
        </p>
      ) : (
        <p className="stop-service-window" data-testid="stop-no-service">
          No Muni trip is scheduled to depart this stop between 22:00 and 05:00 on {serviceDate}.
        </p>
      )}

      <p className="stop-scheduled" data-testid="stop-scheduled">
        Scheduled data for {meta.serviceDay.toLowerCase()} {serviceDate}, from the SFMTA GTFS feed covering{' '}
        {formatServiceDate(meta.feedStartDate)} – {formatServiceDate(meta.feedEndDate)}. Not live: a scheduled trip
        can be late, diverted or cancelled, and this card cannot see any of that.
      </p>

      <div className="incident-actions">
        <button
          type="button"
          className="button small"
          onClick={() => {
            actions.routeToPoint(stop.name, stop.geometry.coordinates);
            onClose();
          }}
        >
          Route here
        </button>
      </div>

      <details className="incident-source" data-testid="stop-provenance">
        <summary>Licence and attribution</summary>
        <p>{meta.notice}</p>
        <p>
          Source: <a href={meta.sourceUrl} target="_blank" rel="noreferrer noopener">{meta.sourceName}</a>. Feed
          window {meta.feedStartDate} – {meta.feedEndDate}; sampled service date {meta.serviceDate}. Derived per stop
          by Night Map from published schedules; no SFMTA or Muni logo is used.
        </p>
      </details>
    </aside>
  );
}

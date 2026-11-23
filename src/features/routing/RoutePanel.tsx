import { useEffect, useMemo, useState } from 'react';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { searchLocal } from '../../services/search';
import { formatDistance, formatDuration } from '../../domain/geo';
import { EmptyState, OutsideCoverageTag, PathIcon, useOnline } from '../ui';
import { nearestCoveredEdge, outsideCoverageInfo } from '../../map/coverage';
import { COVERAGE_BBOX } from '../../map/style';

export function RoutePanel() {
  const { state, actions } = useStore();
  const { route, settings } = state;
  const online = useOnline();
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saveName, setSaveName] = useState('');
  const [showSteps, setShowSteps] = useState(true);

  const hits = useMemo(
    () => (query.trim().length >= 2 ? searchLocal(query, dataset.data, 6).filter((h) => h.placeId) : []),
    [query],
  );

  const origin = route.origin;
  const plan = route.plan;

  // Every route point is checked before the provider is contacted. The nearest
  // covered point is deliberately not substituted: that would invent a walk to
  // somewhere the reader did not choose.
  const outsidePoints = useMemo(() => {
    const points = [
      ...(origin ? [{ ...origin, role: 'start' as const, index: -1 }] : []),
      ...route.stops.map((stop, index) => ({ ...stop, role: 'stop' as const, index })),
    ];
    return points.flatMap((point) => {
      const outside = outsideCoverageInfo(point.coordinates, COVERAGE_BBOX);
      if (!outside) return [];
      const edge = nearestCoveredEdge(point.coordinates, COVERAGE_BBOX);
      return [{ ...point, ...outside, edgeDirection: edge?.direction ?? null }];
    });
  }, [origin, route.stops]);
  const outsideKey = outsidePoints
    .map((point) => `${point.role}:${point.index}:${point.coordinates.join(',')}`)
    .join('|');
  const [outsideWarningOpen, setOutsideWarningOpen] = useState(false);
  const [acceptedOutsideKey, setAcceptedOutsideKey] = useState<string | null>(null);

  useEffect(() => {
    setAcceptedOutsideKey(null);
    setOutsideWarningOpen(false);
  }, [outsideKey]);

  const isOutside = (coordinates: [number, number]) =>
    outsideCoverageInfo(coordinates, COVERAGE_BBOX) !== null;

  const requestPlan = () => {
    if (outsidePoints.length > 0 && acceptedOutsideKey !== outsideKey) {
      setOutsideWarningOpen(true);
      return;
    }
    setOutsideWarningOpen(false);
    void actions.planRoute();
  };

  const planOutsideAnyway = () => {
    setAcceptedOutsideKey(outsideKey);
    setOutsideWarningOpen(false);
    void actions.planRoute();
  };

  const externalDirections = () => {
    if (!origin || route.stops.length === 0) return null;
    const points = [origin, ...route.stops].map((s) => `${s.coordinates[1]},${s.coordinates[0]}`).join(';');
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${points}`;
  };

  return (
    <div className="route-panel">
      <div className="route-head">
        <div>
          <p className="eyebrow">Walking route</p>
          <h2>{plan ? 'Route planned' : route.stops.length ? 'Plan the walk' : 'Choose a destination'}</h2>
        </div>
        <button type="button" className="button ghost small" onClick={actions.clearRoute}>
          Clear
        </button>
      </div>

      <section className="route-block">
        <h3>Start</h3>
        {origin ? (
          <div className="stop-row">
            <span className="stop-badge">A</span>
            <span className="stop-label">
              <strong>{origin.label}</strong>
              {isOutside(origin.coordinates) && <OutsideCoverageTag />}
              <span className="muted small">
                {origin.coordinates[1].toFixed(5)}, {origin.coordinates[0].toFixed(5)}
              </span>
            </span>
            <button type="button" className="link-button" onClick={() => actions.setRouteOrigin(null)}>
              Change
            </button>
          </div>
        ) : (
          <div className="origin-choices">
            <button type="button" className="button" onClick={() => void actions.useCurrentLocation({ setRouteOrigin: true })}>
              <PathIcon path="M12 3.5 20 12l-8 8.5L4 12z" /> Use current location
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                actions.setPicking('origin');
                actions.notify('Tap the map to place the start.');
              }}
            >
              Pick on map
            </button>
            <button type="button" className="button ghost" onClick={() => setAddOpen(true)}>
              Choose a saved place
            </button>
          </div>
        )}
      </section>

      <section className="route-block">
        <h3>Stops</h3>
        {route.stops.length === 0 ? (
          <p className="muted small">No destinations yet. Pick a place from the map, the Nearby list, or search below.</p>
        ) : (
          <ol className="stop-list">
            {route.stops.map((stop, index) => (
              <li key={`${stop.label}-${index}`} className="stop-row">
                <span className="stop-badge">{index + 1}</span>
                <span className="stop-label">
                  <strong>{stop.label}</strong>
                  {isOutside(stop.coordinates) && <OutsideCoverageTag />}
                  <span className="muted small">
                    {stop.coordinates[1].toFixed(5)}, {stop.coordinates[0].toFixed(5)}
                  </span>
                </span>
                <span className="stop-controls">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move stop ${index + 1} earlier`}
                    disabled={index === 0}
                    onClick={() => actions.moveRouteStop(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move stop ${index + 1} later`}
                    disabled={index === route.stops.length - 1}
                    onClick={() => actions.moveRouteStop(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove stop ${index + 1}`}
                    onClick={() => actions.removeRouteStop(index)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="add-stop">
          <input
            type="search"
            value={query}
            placeholder="Add a stop from the Night Map index"
            aria-label="Search for a stop to add"
            onChange={(e) => {
              setQuery(e.target.value);
              setAddOpen(true);
            }}
            onFocus={() => setAddOpen(true)}
          />
          {addOpen && hits.length > 0 && (
            <ul className="search-results inline">
              {hits.map((hit) => {
                const place = hit.placeId ? dataset.placeById.get(hit.placeId) : null;
                const outsideCoverage = outsideCoverageInfo(hit.coordinates, COVERAGE_BBOX);
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="search-hit"
                      onClick={() => {
                        if (place) actions.addRouteStop(place);
                        setQuery('');
                        setAddOpen(false);
                      }}
                    >
                      <span className="hit-kind">PLACE</span>
                      <span>
                        <strong>{hit.title}</strong>
                        <span className="hit-sub">{hit.subtitle}</span>
                        {outsideCoverage && <OutsideCoverageTag />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              actions.setPicking('stop');
              actions.notify('Tap the map to add a stop.');
            }}
          >
            Or add a pin on the map
          </button>
        </div>
      </section>

      <section className="route-block">
        <div className="route-provider">
          <span className={`provider-dot ${online ? 'is-online' : 'is-offline'}`} aria-hidden="true" />
          <div>
            <strong>
              {settings.routingProvider === 'osrm' ? 'OSRM walking via OSM' : 'Routing disabled'}
            </strong>
            <p className="muted small">
              {settings.routingProvider === 'osrm'
                ? 'Public FOSSGIS demo service. Fair use only, no availability guarantee. Night Map sends one request per plan.'
                : 'Enable the provider in Settings to produce walking geometry.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="button primary wide"
          disabled={route.status === 'loading' || !origin || route.stops.length === 0}
          onClick={requestPlan}
        >
          {route.status === 'loading' ? 'Planning…' : plan ? 'Plan again' : 'Find walking route'}
        </button>
        {outsideWarningOpen && outsidePoints.length > 0 && (
          <div className="route-outside-warning" role="alert" data-testid="route-outside-warning">
            <p className="search-outside-eyebrow">Route leaves Night Map coverage</p>
            <h3>
              {outsidePoints.length === 1
                ? 'One route point is outside the extract'
                : `${outsidePoints.length} route points are outside the extract`}
            </h3>
            <p>
              {outsidePoints.length === 1 ? 'This point sits' : 'These points sit'} beyond the amber dashed
              boundary, where the basemap and street grid are intentionally blank. The routing service can still
              return a path, but Night Map cannot show what it crosses.
            </p>
            <ul className="route-outside-points">
              {outsidePoints.map((point) => (
                <li key={`${point.role}-${point.index}`}>
                  <strong>{point.label}</strong>{' '}
                  <span className="muted small">
                    {point.role === 'start' ? 'start' : `stop ${point.index + 1}`} ·{' '}
                    {formatDistance(point.distanceMeters, settings.units)} from the nearest covered point
                    {point.edgeDirection ? ` (edge to the ${point.edgeDirection})` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              Planning also frames the returned walk in the map, so the camera may move over blank ground outside
              the extract.
            </p>
            <div className="button-row">
              <button type="button" className="button small" onClick={planOutsideAnyway}>
                Plan anyway
              </button>
              <button
                type="button"
                className="button ghost small"
                onClick={() => setOutsideWarningOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {!online && (
          <p className="notice warn">
            You are offline. Route planning needs the routing service; saved routes and notes are still available.
          </p>
        )}
        {route.status === 'error' && (
          <div className="route-error" role="alert">
            <h3>No walking route was produced</h3>
            <p>{route.error}</p>
            {route.fallback && (
              <>
                <p className="muted small">{route.fallback.note}</p>
                <p className="straight-distance">
                  Straight-line distance: <strong>{formatDistance(route.fallback.distanceMeters, settings.units)}</strong>
                </p>
              </>
            )}
            <div className="button-row">
              <button type="button" className="button ghost small" onClick={requestPlan}>
                Retry
              </button>
              {externalDirections() && (
                <a className="button ghost small" href={externalDirections()!} target="_blank" rel="noreferrer noopener">
                  Try another directions app
                </a>
              )}
            </div>
          </div>
        )}
      </section>

      {plan && (
        <section className="route-result">
          <div className="route-metrics">
            <div>
              <span className="metric-value">{formatDistance(plan.distanceMeters, settings.units)}</span>
              <span className="metric-label">walking distance</span>
            </div>
            <div>
              <span className="metric-value">{formatDuration(plan.durationSeconds)}</span>
              <span className="metric-label">estimated time</span>
            </div>
            <div>
              <span className="metric-value">{route.stops.length}</span>
              <span className="metric-label">{route.stops.length === 1 ? 'stop' : 'stops'}</span>
            </div>
          </div>
          <p className="provider-note">{plan.providerNote}</p>
          <p className="muted small">
            Options are ranked by walking time only. Shorter ≠ safer: Night Map does not score streets for safety.
          </p>
          {route.alternatives.length > 0 && (
            <div className="alternatives">
              <h3>Alternative routes</h3>
              {[plan, ...route.alternatives].map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={`alternative ${index === 0 ? 'is-active' : ''}`}
                  onClick={() => index === 0 ? undefined : requestPlan()}
                >
                  <span>Option {index + 1}</span>
                  <span>{formatDistance(candidate.distanceMeters, settings.units)}</span>
                  <span>{formatDuration(candidate.durationSeconds)}</span>
                  <span className="muted small">shorter ≠ safer</span>
                </button>
              ))}
              <p className="muted small">
                Alternatives come from the routing service ranked by travel time. Night Map makes no safety ranking.
              </p>
            </div>
          )}
          <button type="button" className="link-button" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps}>
            {showSteps ? 'Hide' : 'Show'} step list ({plan.steps.length})
          </button>
          {showSteps && (
            <ol className="steps">
              {plan.steps.map((step, index) => (
                <li key={`${step.instruction}-${index}`}>
                  <span>{step.instruction}</span>
                  <span className="step-distance">{formatDistance(step.distanceMeters, settings.units)}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="button-row">
            <button type="button" className="button" onClick={() => actions.saveCurrentRoute(saveName || plan.name)}>
              Save route
            </button>
            <input
              className="inline-input"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={plan.name}
              aria-label="Name for saved route"
            />
            {externalDirections() && (
              <a className="button ghost" href={externalDirections()!} target="_blank" rel="noreferrer noopener">
                Open in OSM
              </a>
            )}
          </div>
          <p className="notice">
            OpenStreetMap walking geometry does not know about stairs beyond its own tagging, temporary closures,
            lighting, crowding, or accessibility. This route is not a safety recommendation.
          </p>
        </section>
      )}

      <section className="route-block">
        <h3>Saved routes</h3>
        {state.routes.length === 0 ? (
          <p className="muted small">No saved routes yet. Saved routes stay on this device.</p>
        ) : (
          <ul className="saved-routes">
            {state.routes.map((saved) => (
              <li key={saved.id}>
                <div>
                  <strong>{saved.name}</strong>
                  <span className="muted small">
                    {formatDistance(saved.distanceMeters, settings.units)} · {formatDuration(saved.durationSeconds)} · saved{' '}
                    {new Date(saved.savedAt ?? saved.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button type="button" className="link-button" onClick={() => void actions.deleteSavedRoute(saved.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {route.stops.length === 0 && !plan && (
        <EmptyState title="Routes need a destination">
          Open a place card and press GO, or search for a stop above. Night Map will not invent a route without a
          routing provider.
        </EmptyState>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { BUILDING_REGISTRY_META, cachedBuildingRegistry, loadBuildingRegistry } from '../../data/building-registry';
import {
  BUILDING_STATUSES,
  buildingFilterLabel,
  buildingMatchesFilter,
  buildingRecordSummary,
  filterBuildings,
} from '../../domain/buildings';
import { useStore } from '../../state/store';
import { EmptyState } from '../ui';
import type { BuildingFilter, BuildingRegistry } from '../../domain/types';
import { formatDate } from '../../domain/status';
import { PathIcon } from '../ui';
import { BuildingThumb } from './BuildingPhoto';

const PAGE_SIZE = 60;

/**
 * The building registry as a table first, a map second. A dossier is a parcel
 * with a municipal record history; pins alone would hide exactly the thing that
 * makes the registry useful.
 */
export function BuildingsWorkspace() {
  const { state, actions } = useStore();
  const [registry, setRegistry] = useState<BuildingRegistry | null>(() => cachedBuildingRegistry());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(registry ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<BuildingFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    if (registry) return;
    let cancelled = false;
    setStatus('loading');
    loadBuildingRegistry()
      .then((loaded) => {
        if (cancelled) return;
        setRegistry(loaded);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [registry]);

  const dossiers = registry?.dossiers ?? [];
  const results = useMemo(
    () => filterBuildings(dossiers, { query, status: statusFilter }),
    [dossiers, query, statusFilter],
  );

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [query, statusFilter]);

  if (status === 'loading') {
    return (
      <div className="workspace-panel buildings">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">Buildings</p>
            <h2>Building registry</h2>
          </div>
        </header>
        <div className="dossier-loading" role="status">
          <span className="loading-bar" aria-hidden="true" />
          <p>
            Loading {BUILDING_REGISTRY_META.counts.dossiers.toLocaleString()} parcel dossiers from the City record
            extract. The first load needs a connection; after that the service worker keeps it offline.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="workspace-panel buildings">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">Buildings</p>
            <h2>Building registry</h2>
          </div>
        </header>
        <EmptyState
          title="The registry is not available yet"
          action={
            <button
              type="button"
              className="button small"
              onClick={() => {
                setStatus('loading');
                setError(null);
                loadBuildingRegistry()
                  .then((loaded) => {
                    setRegistry(loaded);
                    setStatus('ready');
                  })
                  .catch((err: Error) => {
                    setError(err.message);
                    setStatus('error');
                  });
              }}
            >
              Try again
            </button>
          }
        >
          {error} The first load needs a network connection. Nothing else in the app depends on it.
        </EmptyState>
      </div>
    );
  }

  const counts = registry?.counts;
  const shown = results.slice(0, limit);
  const vacancyCount = dossiers.filter((dossier) => buildingMatchesFilter(dossier.status, 'vacancy')).length;
  // The map filters by classification, not by the table's search text.
  const locatedForFilter = dossiers.filter(
    (dossier) => dossier.coordinates && buildingMatchesFilter(dossier.status, statusFilter),
  ).length;

  const showOnMap = () => {
    actions.setBuildingFilter(statusFilter);
    actions.setLayer('building-registry', true);
    // The default vacancy layer would double-plot a subset of the same parcels.
    actions.setLayer('abandoned-buildings', false);
    actions.setSheet('peek');
    actions.notify(
      `${locatedForFilter.toLocaleString()} ${buildingFilterLabel(statusFilter)} dossier${locatedForFilter === 1 ? '' : 's'} with a published point on the map. The rest stay in the table.`,
      'success',
    );
  };

  return (
    <div className="workspace-panel buildings">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Buildings</p>
          <h2>Vacant &amp; derelict registry</h2>
          <p className="muted small">
            {counts?.dossiers.toLocaleString()} parcel dossiers built from DBI complaints, permits and notices of
            violation. Each one is a reading of records, never a field check.
          </p>
        </div>
      </header>

      <div className="building-controls">
        <label className="field">
          <span>Search all {dossiers.length.toLocaleString()} dossiers — address, block, lot or neighbourhood</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. 1638 Powell, 0117, Tenderloin"
          />
        </label>
        <label className="field">
          <span>Record classification</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as BuildingFilter)}
          >
            <option value="all">All classifications ({dossiers.length.toLocaleString()})</option>
            <option value="vacancy">Reported vacant / derelict ({vacancyCount.toLocaleString()})</option>
            {BUILDING_STATUSES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({counts?.byStatus[entry.id] ?? 0})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="building-map-row">
        <button type="button" className="button small" onClick={showOnMap} disabled={locatedForFilter === 0}>
          Show {locatedForFilter.toLocaleString()} located {locatedForFilter === 1 ? 'dossier' : 'dossiers'} on the map
        </button>
        <span className="muted small">
          {query.trim()
            ? 'The map shows the whole classification; the search narrows the table only.'
            : 'Only dossiers with a City-published point can be plotted; the rest stay in the table.'}
        </span>
      </div>

      <p className="muted small" aria-live="polite">
        Showing {shown.length.toLocaleString()} of {results.length.toLocaleString()} matching dossiers, ordered by
        record priority. {' '}
        {counts
          ? `${counts.withoutCoordinates.toLocaleString()} carry no City-published point and are therefore not on the map.`
          : ''}
      </p>

      <p className="notice small">{BUILDING_REGISTRY_META.classificationNote}</p>

      {results.length === 0 ? (
        <EmptyState title="No dossier matches">
          Try a block number, a street address, a neighbourhood, or clear the classification filter.
        </EmptyState>
      ) : (
        <ul className="building-list">
          {shown.map((dossier) => {
            const meta = BUILDING_STATUSES.find((entry) => entry.id === dossier.status);
            return (
              <li key={dossier.id}>
                <button
                  type="button"
                  className={`building-row ${state.selectedBuildingId === dossier.id ? 'is-selected' : ''}`}
                  onClick={() => actions.selectBuilding(dossier.id)}
                >
                  <BuildingThumb coordinates={dossier.coordinates} />
                  <span className="building-row-body">
                    <span className="building-row-head">
                      <strong>{dossier.address}</strong>
                      <span className={`building-status status-${dossier.status}`}>{meta?.short ?? dossier.status}</span>
                    </span>
                    <span className="building-row-meta">
                      Block {dossier.block} / lot {dossier.lot}
                      {dossier.neighborhood ? ` · ${dossier.neighborhood}` : ''}
                      {dossier.coordinates ? '' : ' · no published point'}
                    </span>
                    <span className="building-row-counts">{buildingRecordSummary(dossier)}</span>
                    <span className="building-row-score">
                      Record priority {dossier.score}/100 · {dossier.confidence} confidence
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {results.length > shown.length && (
        <button type="button" className="button small load-more" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
          <PathIcon path="M12 5v14M5 12l7 7 7-7" size={15} />
          Show {Math.min(PAGE_SIZE, results.length - shown.length)} more
        </button>
      )}

      <p className="coverage-foot">
        Newest record in this extract:{' '}
        {BUILDING_REGISTRY_META.newestRecordAt ? formatDate(BUILDING_REGISTRY_META.newestRecordAt) : 'unknown'}. Built{' '}
        {BUILDING_REGISTRY_META.generatedAt ? formatDate(BUILDING_REGISTRY_META.generatedAt) : 'unknown'} from the
        City's published DBI datasets. A classification is not a finding that a building is empty, unsafe or
        illegally entered.
      </p>
    </div>
  );
}

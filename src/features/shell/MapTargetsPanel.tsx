import { useMemo, useState } from 'react';
import { dataset } from '../../data';
import type { MapLiveCounts } from '../../map/MapView';
import { filteredViews } from '../../state/selectors';
import { useStore } from '../../state/store';

interface Target {
  layer: string;
  label: string;
  detail: string;
  count?: number;
}

export function MapTargetsPanel({
  onClose,
  liveCounts,
}: {
  onClose: () => void;
  liveCounts: MapLiveCounts;
}) {
  const { state, actions } = useStore();
  const [query, setQuery] = useState('');

  // The count has to describe the same set the map is drawing: the current
  // category/condition filters, with private discovery records kept out of the
  // public place total because they have their own target.
  const filteredPlaceCount = useMemo(
    () => filteredViews(state, dataset).filter((view) => !view.place.id.startsWith('private:')).length,
    [state],
  );
  const positionedNoteCount = state.observations.filter((observation) => observation.geometry).length;
  const isOn = (layer: string) => Boolean(state.layers[layer]);
  const loaded = (count: number) => (count > 0 ? count : undefined);

  const targets: Target[] = [
    {
      layer: 'resources',
      label: 'Places',
      detail: 'Food, water, restrooms, services and civic places',
      count: isOn('resources') ? filteredPlaceCount : undefined,
    },
    {
      layer: 'transit-stops',
      label: 'Muni stops',
      detail: 'Stop inventory, not live arrivals',
      count: isOn('transit-stops') ? dataset.data.transit.length : undefined,
    },
    {
      layer: 'abandoned-buildings',
      label: 'Abandoned & vacant buildings',
      detail: 'City vacancy records with a mapped position, blue glow',
      count: isOn('abandoned-buildings') ? loaded(liveCounts.abandoned) : undefined,
    },
    {
      layer: 'building-registry',
      label: 'Building dossiers',
      detail: 'All dossier dots, loaded on demand',
      count: isOn('building-registry') ? loaded(liveCounts.registry) : undefined,
    },
    {
      layer: 'calls-recent',
      label: 'Dispatched calls',
      detail: 'Live CAD extract, ten-minute delay',
      count: isOn('calls-recent') ? loaded(liveCounts.calls) : undefined,
    },
    {
      layer: 'cases-311',
      label: '311 requests',
      detail: 'Nightly service-request snapshot',
      count: isOn('cases-311') ? loaded(liveCounts.cases311) : undefined,
    },
    {
      layer: 'observations',
      label: 'Your field notes',
      detail: 'Private to this device',
      count: isOn('observations') ? positionedNoteCount : undefined,
    },
    {
      layer: 'saved',
      label: 'Saved places',
      detail: 'Private to this device',
      count: isOn('saved') ? state.saved.length : undefined,
    },
  ];

  const visible = targets.filter((target) => state.layers[target.layer]).length;
  const needle = query.trim().toLowerCase();
  const shownTargets = needle
    ? targets.filter((target) => `${target.label} ${target.detail}`.toLowerCase().includes(needle))
    : targets;

  return (
    <aside className="drawer targets-panel" aria-label="Targets on the map">
      <header className="drawer-head">
        <div>
          <p className="eyebrow">Map contents</p>
          <h2>On the map</h2>
        </div>
        <button type="button" className="icon-button close" onClick={onClose} aria-label="Close targets">
          ×
        </button>
      </header>

      <p className="targets-lede">
        {visible} of {targets.length} target groups visible. Only these receive a tap and open a card.
      </p>

      <div className="targets-search" role="search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.2" />
          <path d="m15 15 5 5" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder="Find a target…"
          aria-label="Filter target groups"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="targets-search-clear"
            aria-label="Clear target filter"
            onClick={() => setQuery('')}
          >
            ×
          </button>
        )}
      </div>

      {shownTargets.length === 0 ? (
        <p className="targets-empty">No target groups match “{query.trim()}”.</p>
      ) : (
        <ul className="target-list">
          {shownTargets.map((target) => {
            const checked = Boolean(state.layers[target.layer]);
            return (
              <li key={target.layer}>
                <label className="target-row switch">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => actions.setLayer(target.layer, event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true" />
                  <span className="target-text">
                    <strong>{target.label}</strong>
                    <span>{target.detail}</span>
                  </span>
                  <span
                    className="target-count"
                    aria-label={
                      typeof target.count === 'number' ? `${target.count} places` : 'not loaded or hidden'
                    }
                  >
                    {typeof target.count === 'number' ? target.count.toLocaleString() : '—'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="targets-foot">
        Counts describe the places available in each visible layer under your current filters. A dash means the
        layer is off or its data is still loading. Toggling a target changes only this view, and private targets never
        leave this device.
      </p>
    </aside>
  );
}

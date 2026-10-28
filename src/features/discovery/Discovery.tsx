import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CATEGORIES } from '../../domain/categories';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { activeFilterCount, filteredViews, nearbyViews } from '../../state/selectors';
import { searchLocal, type SearchHit } from '../../services/search';
import { geocodePhoton, GeocodeError } from '../../services/geocoding';
import { formatDistance } from '../../domain/geo';
import { EmptyState, EvidencePill, PathIcon, useOnline } from '../ui';
import { CATEGORY_BY_ID } from '../../domain/categories';

export function SearchBar({ autoFocus = false, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void }) {
  const { state, actions } = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [wideResults, setWideResults] = useState<SearchHit[] | null>(null);
  const [wideLoading, setWideLoading] = useState(false);
  const [wideError, setWideError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const online = useOnline();

  const localHits = useMemo(
    () => (query.trim().length >= 2 ? searchLocal(query, dataset.data) : []),
    [query],
  );

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (hit: SearchHit) => {
    setOpen(false);
    setQuery('');
    if (hit.placeId) {
      actions.selectPlace(hit.placeId);
      actions.setSheet('peek');
      onNavigate?.();
    } else {
      actions.selectExternal({ label: hit.title, detail: hit.subtitle, coordinates: hit.coordinates });
      actions.notify(`${hit.title} — map moved. No resource record is attached to this label.`);
    }
  };

  const searchWider = async () => {
    if (!query.trim() || !online) return;
    setWideLoading(true);
    setWideError(null);
    try {
      const results = await geocodePhoton(query.trim());
      setWideResults(
        results.map((r) => ({
          id: `geo:${r.coordinates.join(',')}`,
          kind: 'street' as const,
          title: r.label,
          subtitle: `${r.detail} · outside the Night Map index`,
          coordinates: r.coordinates,
        })),
      );
    } catch (err) {
      setWideError(err instanceof GeocodeError ? err.message : 'Address lookup failed.');
    } finally {
      setWideLoading(false);
    }
  };

  const results = wideResults ?? localHits;

  return (
    <div className="searchbar" ref={wrapRef}>
      <div className="search-input">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
          <circle cx="10.5" cy="10.5" r="6.2" />
          <path d="m15 15 5 5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search places, restrooms, streets…"
          aria-label="Search Night Map"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setWideResults(null);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) choose(results[0]);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              setWideResults(null);
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="search-results" role="listbox" aria-label="Search results">
          {wideResults && <p className="search-scope">Wider address search — these results carry no Night Map evidence.</p>}
          {results.slice(0, 8).map((hit) => (
            <button key={hit.id} type="button" className="search-hit" role="option" aria-selected={false} onClick={() => choose(hit)}>
              <span className={`hit-kind hit-${hit.kind}`}>{hit.kind === 'place' ? 'PLACE' : hit.kind.toUpperCase()}</span>
              <span>
                <strong>{hit.title}</strong>
                <span className="hit-sub">{hit.subtitle}</span>
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="search-empty">
              Nothing in the Night Map index. That is not proof the place does not exist — the index covers a central
              slice of the city only.
            </p>
          )}
          <div className="search-foot">
            {state.settings.geocodingProvider === 'photon' && online ? (
              <button type="button" className="link-button" onClick={() => void searchWider()} disabled={wideLoading}>
                {wideLoading ? 'Searching wider city…' : 'Search the wider city (Photon)'}
              </button>
            ) : (
              <span className="muted small">Local index only. Wider geocoding is off in Settings.</span>
            )}
          </div>
          {wideError && <p className="notice warn">{wideError}</p>}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ compact = false }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const [expanded, setExpanded] = useState(!compact);
  const active = activeFilterCount(state.filters);

  // Presets are navigation shortcuts, not claims that a service is open,
  // accessible, or safe to enter. They only change the existing local filters.
  const applyPreset = (preset: 'essentials' | 'after-dark' | 'connections') => {
    const common = {
      openNow: false,
      freeOnly: false,
      verifiedOnly: false,
      maxWalkMinutes: 0,
      nearTransit: false,
      accessibleOnly: false,
      afterDark: false,
    };
    if (preset === 'essentials') {
      actions.setFilter({
        ...common,
        categories: ['food', 'water', 'bathroom', 'shelter', 'services', 'medical', 'transit', 'civic'],
      });
    } else if (preset === 'after-dark') {
      actions.setFilter({ ...common, categories: ['popos'], afterDark: true });
    } else {
      actions.setFilter({
        ...common,
        categories: ['transit', 'pedestrian_connection'],
      });
    }
  };

  const isPresetActive = (preset: 'essentials' | 'after-dark' | 'connections') => {
    const selected = [...state.filters.categories].sort().join('|');
    const conditionsAreNeutral =
      !state.filters.openNow &&
      !state.filters.freeOnly &&
      !state.filters.verifiedOnly &&
      state.filters.maxWalkMinutes === 0 &&
      !state.filters.nearTransit &&
      !state.filters.accessibleOnly &&
      !state.filters.query.trim();
    if (!conditionsAreNeutral) return false;
    if (preset === 'essentials') {
      return selected === ['food', 'water', 'bathroom', 'shelter', 'services', 'medical', 'transit', 'civic'].sort().join('|')
        && !state.filters.afterDark;
    }
    if (preset === 'after-dark') return selected === 'popos' && state.filters.afterDark;
    return selected === ['transit', 'pedestrian_connection'].sort().join('|')
      && !state.filters.afterDark;
  };

  return (
    <div className="filterbar">
      <div className="filter-presets" aria-label="Quick map views">
        <span className="filter-presets-label">Quick views</span>
        <button type="button" className={`button ghost tiny ${isPresetActive('essentials') ? 'is-active' : ''}`} aria-pressed={isPresetActive('essentials')} onClick={() => applyPreset('essentials')}>Essentials</button>
        <button type="button" className={`button ghost tiny ${isPresetActive('after-dark') ? 'is-active' : ''}`} aria-pressed={isPresetActive('after-dark')} onClick={() => applyPreset('after-dark')}>After-dark POPOS</button>
        <button type="button" className={`button ghost tiny ${isPresetActive('connections') ? 'is-active' : ''}`} aria-pressed={isPresetActive('connections')} onClick={() => applyPreset('connections')}>Transit & connections</button>
      </div>
      <p className="filter-presets-note">Quick views change filters only; they do not confirm current hours, entry rights, or accessibility.</p>
      <div className="filter-chips">
        {CATEGORIES.map((category) => {
          const enabled = state.filters.categories.includes(category.id);
          const count = dataset.categoryCounts[category.id] ?? 0;
          return (
            <button
              key={category.id}
              type="button"
              className={`filter-chip ${enabled ? 'is-active' : ''} ${count === 0 ? 'is-empty' : ''}`}
              aria-pressed={enabled}
              onClick={() => actions.toggleCategory(category.id)}
              title={count === 0 ? category.serviceNote ?? 'No records installed in this release' : `${count} records in this release`}
              style={{ '--chip': category.color } as CSSProperties}
            >
              <span className="filter-dot" aria-hidden="true" />
              {category.short}
              <span className="filter-count">{count}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="link-button filters-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {expanded ? 'Hide conditions' : `Conditions${active ? ` (${active})` : ''}`}
      </button>
      {expanded && (
        <div className="condition-grid">
          <label className={`condition ${state.filters.openNow ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={state.filters.openNow}
              onChange={(e) => actions.setFilter({ openNow: e.target.checked })}
            />
            Open now
            <span className="condition-note">Only records with published hours and a check within 90 days can pass.</span>
          </label>
          <label className={`condition ${state.filters.freeOnly ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={state.filters.freeOnly}
              onChange={(e) => actions.setFilter({ freeOnly: e.target.checked })}
            />
            Free
            <span className="condition-note">Only where the source states the service is free.</span>
          </label>
          <label className={`condition ${state.filters.verifiedOnly ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={state.filters.verifiedOnly}
              onChange={(e) => actions.setFilter({ verifiedOnly: e.target.checked })}
            />
            Recently checked
            <span className="condition-note">Official or provider-checked within the last 90 days.</span>
          </label>
          <label className={`condition ${state.filters.nearTransit ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={state.filters.nearTransit}
              onChange={(e) => actions.setFilter({ nearTransit: e.target.checked })}
            />
            Near transit
            <span className="condition-note">Within ~400 m of a mapped Muni stop, straight line.</span>
          </label>
          <label className={`condition ${state.filters.accessibleOnly ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={state.filters.accessibleOnly}
              onChange={(e) => actions.setFilter({ accessibleOnly: e.target.checked })}
            />
            Accessibility documented
            <span className="condition-note">
              Installed records contain no documented accessibility details, so this filter returns nothing by design.
            </span>
          </label>
          <label className={`condition ${state.filters.afterDark ? 'is-active' : ''}`}>
            <input
              type="checkbox"
              checked={state.filters.afterDark}
              onChange={(e) => actions.setFilter({ afterDark: e.target.checked })}
            />
            After-dark POPOS
            <span className="condition-note">Only spaces whose City listing says “open at all times”. Published wording is not a live access check or permission to enter.</span>
          </label>
          <label className="condition walk-filter">
            Walking limit
            <span className="condition-note">Distance is straight-line, not a route.</span>
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              value={state.filters.maxWalkMinutes}
              onChange={(e) => actions.setFilter({ maxWalkMinutes: Number(e.target.value) })}
            />
            <span className="walk-value">{state.filters.maxWalkMinutes === 0 ? 'Any distance' : `≤ ${state.filters.maxWalkMinutes} min walk`}</span>
          </label>
          {active > 0 && (
            <button type="button" className="link-button" onClick={actions.resetFilters}>
              Reset {active} condition{active === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function NearbyList({ mode = 'nearby' }: { mode?: 'nearby' | 'results' }) {
  const { state, actions } = useStore();
  const views = useMemo(
    () => (mode === 'nearby' ? nearbyViews(state, dataset) : filteredViews(state, dataset)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.filters, state.reference, state.saved, state.layers.landmarks, mode],
  );

  return (
    <div className="nearby">
      <div className="nearby-head">
        <div>
          <p className="eyebrow">{mode === 'nearby' ? 'Nearby, in walking order' : 'All matching records'}</p>
          <h2>
            {views.length} {views.length === 1 ? 'record' : 'records'}
          </h2>
        </div>
        <div className="reference-pill">
          <PathIcon path="M12 3.5 20 12l-8 8.5L4 12z" />
          <span>{state.reference.label}</span>
          <button type="button" onClick={() => void actions.useCurrentLocation()} aria-label="Use my location for distances">
            Use mine
          </button>
        </div>
      </div>
      <FilterBar compact />
      {views.length === 0 ? (
        <EmptyState
          title="Nothing passes these conditions"
          action={
            <button type="button" className="button ghost small" onClick={actions.resetFilters}>
              Clear conditions
            </button>
          }
        >
          {state.filters.accessibleOnly
            ? 'The accessibility condition is currently impossible: no installed record has documented accessibility details. Night Map will not mark a place accessible without a source.'
            : 'That can be true for a reason: the release covers a central slice of the city, and some categories have no verified records at all. Widen the walking limit or turn conditions off — and do not read an empty list as “nothing exists here”.'}
        </EmptyState>
      ) : (
        <ul className="nearby-list">
          {views.map((view) => {
            const def = CATEGORY_BY_ID.get(view.place.category);
            const selected = state.selectedPlaceId === view.place.id;
            return (
              <li key={view.place.id} className={`nearby-row ${selected ? 'is-selected' : ''}`}>
                <button type="button" className="nearby-main" onClick={() => actions.selectPlace(view.place.id)}>
                  <span className="nearby-mark" style={{ background: def?.color }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={def?.icon} />
                    </svg>
                  </span>
                  <span className="nearby-body">
                    <span className="nearby-title">
                      {view.place.name}
                      {view.saved && <span className="saved-mark" title="Saved on this device">★</span>}
                    </span>
                    <span className="nearby-sub">
                      {view.place.address ?? 'No address in the record'} · {formatDistance(view.distanceMeters, state.settings.units)} · {view.walkMinutes} min walk
                    </span>
                    <span className="nearby-tags">
                      <EvidencePill evidence={view.evidence} compact />
                      {view.evidence.openNow === true && <span className="tag open">Open now</span>}
                      {view.evidence.openNow === false && <span className="tag closed">Closed now</span>}
                      {view.evidence.openNow === null && <span className="tag unknown">Open now unconfirmed</span>}
                  {view.place.category === 'popos' && /open at all times|accessible at all times/i.test(String(view.resource?.details.cityHours ?? '')) && <span className="tag free">City-listed all-hours</span>}
                      {view.resource?.cost?.kind === 'free' && <span className="tag free">Free</span>}
                      {view.isNearTransit && <span className="tag transit">Near Muni</span>}
                    </span>
                  </span>
                </button>
                <div className="nearby-actions">
                  <button type="button" className="button primary tiny" onClick={() => actions.startRouteTo(view.place)}>
                    GO
                  </button>
                  <button
                    type="button"
                    className="button ghost tiny"
                    onClick={() => {
                      actions.setFilter({ categories: [view.place.category], maxWalkMinutes: 20 });
                      actions.notify(`Showing other ${CATEGORY_BY_ID.get(view.place.category)?.label.toLowerCase()} records within a 20-minute walk. Alternatives are possible destinations, not guarantees.`);
                    }}
                  >
                    Alternatives
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="coverage-foot">
        Sorted by straight-line distance from {state.reference.label}. No popularity, sponsorship or engagement ranking.
        Distances are not walking routes.
      </p>
    </div>
  );
}

export function NearbySummary() {
  const { state, actions } = useStore();
  const closest = useMemo(() => nearbyViews(state, dataset).slice(0, 3), [
    state.filters,
    state.reference,
    state.saved,
    state.layers.landmarks,
  ]);
  return (
    <div className="sheet-summary">
      <div className="summary-head">
        <div>
          <p className="eyebrow">Nearby</p>
          <h2>
            {closest.length === 0
              ? 'Nothing passes the current conditions'
              : `${closest.length} of the closest records`}
          </h2>
        </div>
        <button type="button" className="button ghost small" onClick={() => actions.setWorkspace('nearby')}>
          See all
        </button>
      </div>
      {closest.length > 0 ? (
        <ul className="summary-list">
          {closest.map((view) => {
            const def = CATEGORY_BY_ID.get(view.place.category);
            return (
              <li key={view.place.id}>
                <button type="button" onClick={() => actions.selectPlace(view.place.id)}>
                  <span className="summary-mark" style={{ background: def?.color }} />
                  <span>
                    <strong>{view.place.name}</strong>
                    <span className="muted small">
                      {formatDistance(view.distanceMeters, state.settings.units)} · {view.walkMinutes} min
                    </span>
                  </span>
                  <span className="summary-status">{view.evidence.openNow === true ? 'Open now' : view.evidence.canClaimOpen ? 'Closed now' : 'Unconfirmed'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">Loosen the filters or move the reference point. An empty list is not evidence that no services exist.</p>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { Observation } from '../../domain/types';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { formatDate } from '../../domain/status';
import { CATEGORY_BY_ID } from '../../domain/categories';
import { buildingConditionLabel } from '../../domain/buildings';
import { EmptyState } from '../ui';
import { FieldnoteComposer, type ComposeTarget } from './FieldnoteComposer';
import { searchLocal } from '../../services/search';

const TYPE_LABELS: Record<string, string> = {
  resource_present: 'Resource exists',
  resource_not_found: 'Resource not found',
  hours_incorrect: 'Hours seem wrong',
  open_observed: 'Observed open',
  closed_observed: 'Observed closed',
  access_issue: 'Access issue',
  infrastructure_change: 'Infrastructure change',
  new_resource: 'New or changed service',
  passage_discovery: 'Passage or cut-through',
  popos_observation: 'POPOS or public space candidate',
  entrance_observation: 'Entrance or access point',
  stairs_ramp_observation: 'Stairs, ramp or path',
  follow_up: 'Follow-up needed',
  other: 'Observation',
};

export function FieldnotesWorkspace() {
  const { state, actions } = useStore();
  const [mode, setMode] = useState<'list' | 'compose' | 'edit'>('list');
  const [target, setTarget] = useState<ComposeTarget | null>(null);
  const [editing, setEditing] = useState<Observation | null>(null);
  const [filter, setFilter] = useState<'all' | 'linked' | 'pinned'>('all');
  const [placeQuery, setPlaceQuery] = useState('');

  const selectedPlace = state.selectedPlaceId ? dataset.placeById.get(state.selectedPlaceId) : null;

  const observations = useMemo(() => {
    return state.observations
      .filter((o) =>
        filter === 'linked' ? Boolean(o.placeId || o.buildingId) : filter === 'pinned' ? !o.placeId && !o.buildingId : true,
      )
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }, [state.observations, filter]);

  const placeHits = useMemo(
    () => (placeQuery.trim().length >= 2 ? searchLocal(placeQuery, dataset.data, 5).filter((h) => h.placeId) : []),
    [placeQuery],
  );

  const startCompose = (t: ComposeTarget) => {
    setTarget(t);
    setEditing(null);
    setMode('compose');
  };

  if (mode === 'compose' && target) {
    return (
      <div className="workspace-panel">
        <FieldnoteComposer target={target} onDone={() => setMode('list')} onCancel={() => setMode('list')} />
      </div>
    );
  }
  if (mode === 'edit' && editing) {
    return (
      <div className="workspace-panel">
        <FieldnoteComposer
          target={{
            placeId: editing.placeId,
            placeName: editing.placeName,
            coordinates: editing.geometry?.coordinates ?? null,
            buildingId: editing.buildingId ?? null,
          }}
          existing={editing}
          onDone={() => {
            setMode('list');
            setEditing(null);
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="workspace-panel fieldnotes">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Fieldnotes</p>
          <h2>Your observations</h2>
          <p className="muted small">
            {state.observations.length} private {state.observations.length === 1 ? 'note' : 'notes'} on this device.
            Nothing here is published, and nothing is sent anywhere.
          </p>
        </div>
      </header>

      <section className="quick-compose">
        <h3>Record something</h3>
        {selectedPlace ? (
          <button
            type="button"
            className="button primary"
            onClick={() =>
              startCompose({
                placeId: selectedPlace.id,
                placeName: selectedPlace.name,
                coordinates: selectedPlace.geometry.coordinates,
              })
            }
          >
            New note on {selectedPlace.name}
          </button>
        ) : (            <div className="button-row">
              <button
                type="button"
                className="button primary"
                onClick={() => startCompose({ placeId: null, placeName: 'Pinned note at map centre', coordinates: state.reference.coordinates })}
              >
                New pinned note
              </button>
            </div>
        )}
        <div className="place-picker">
          <input
            type="search"
            value={placeQuery}
            placeholder="Or attach a note to a place…"
            aria-label="Search for a place to attach a note"
            onChange={(e) => setPlaceQuery(e.target.value)}
          />
          {placeHits.length > 0 && (
            <ul className="search-results inline">
              {placeHits.map((hit) => {
                const place = hit.placeId ? dataset.placeById.get(hit.placeId) : null;
                if (!place) return null;
                const def = CATEGORY_BY_ID.get(place.category);
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="search-hit"
                      onClick={() =>
                        startCompose({
                          placeId: place.id,
                          placeName: place.name,
                          coordinates: place.geometry.coordinates,
                        })
                      }
                    >
                      <span className="hit-kind" style={{ borderColor: def?.color }}>
                        {def?.short ?? 'PLACE'}
                      </span>
                      <span>
                        <strong>{place.name}</strong>
                        <span className="hit-sub">{place.address ?? place.category}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="notice">
          Fast path: pick a type, add a line of text, save. Photos are optional, re-encoded to strip EXIF/GPS, and
          should never show faces, documents or belongings that could identify someone.
        </p>
      </section>

      <div className="section-head">
        <h3>All notes</h3>
        <div className="segmented" role="group" aria-label="Filter field notes">
          {(['all', 'linked', 'pinned'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'is-active' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All' : value === 'linked' ? 'Place-linked' : 'Pinned'}
            </button>
          ))}
        </div>
      </div>

      {observations.length === 0 ? (
        <EmptyState title="No field notes yet">
          Notes are private by default. Record a change you noticed, a closed door, or something worth checking next
          time — it stays on this device.
        </EmptyState>
      ) : (
        <ul className="note-list">
          {observations.map((observation) => {
            const suggestion = observation.suggestedCategory
              ? CATEGORY_BY_ID.get(observation.suggestedCategory)
              : null;
            return (
              <li key={observation.id} className="note-card">
                <div className="note-head">
                  <span className="note-type">
                    {suggestion
                      ? `Missing place · ${suggestion.short}`
                      : (TYPE_LABELS[observation.type] ?? observation.type)}
                  </span>
                  <span className="private-lock">Private</span>
                </div>
                {observation.buildingId && (
                  <p className="muted small">
                    Building check · {buildingConditionLabel(observation.buildingCondition)} ·{' '}
                    {observation.buildingId.replace('bldg:', 'parcel ')}
                  </p>
                )}
                <h4>{observation.placeName ?? 'Pinned observation'}</h4>
                <p>{observation.note}</p>
                {observation.geometry && (
                  <p className="muted small">
                    {observation.geometry.coordinates[1].toFixed(5)}, {observation.geometry.coordinates[0].toFixed(5)}
                  </p>
                )}
                {observation.photo && <img src={observation.photo.dataUrl} alt="Attached field observation" />}
                {(observation.accessStatus || observation.sourceReference) && (
                  <p className="muted small">
                    Access: {(observation.accessStatus ?? 'unknown').replaceAll('_', ' ')} · Evidence:{' '}
                    {(observation.confidence ?? 'unverified').replaceAll('_', ' ')}
                    {observation.sourceReference && (
                      <>
                        {' '}
                        ·{' '}
                        <a href={observation.sourceReference} target="_blank" rel="noreferrer noopener">
                          Source
                        </a>
                      </>
                    )}
                  </p>
                )}
                <div className="note-foot">
                  <span className="muted small">
                    Observed {formatDate(observation.observedAt)} · recorded {formatDate(observation.recordedAt)} ·
                    unverified
                  </span>
                  <div className="button-row">
                    {observation.geometry && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => actions.selectObservation(observation.id)}
                      >
                        Inspect on map
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setEditing(observation);
                        setMode('edit');
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void actions.deleteObservation(observation.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

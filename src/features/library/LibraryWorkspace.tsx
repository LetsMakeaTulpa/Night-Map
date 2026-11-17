import { useMemo, useState } from 'react';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { formatDate } from '../../domain/status';
import { EmptyState } from '../ui';

type Tab = 'collections' | 'about';

const TAB_LABELS: Record<Tab, string> = {
  collections: 'Collections',
  about: 'Privacy & limits',
};

export function LibraryWorkspace() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState<Tab>('collections');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const collection = state.collections.find((c) => c.id === collectionId) ?? null;
  const counts = dataset.data.meta.counts;

  const collectionItems = useMemo(() => {
    if (!collection) return [];
    return collection.itemRefs.map((ref) => {
      if (ref.kind === 'place') {
        const place = dataset.placeById.get(ref.id);
        return { ref, label: place?.name ?? 'Missing place record', sub: place?.address ?? '' };
      }
      if (ref.kind === 'route') {
        const route = state.routes.find((r) => r.id === ref.id);
        return { ref, label: route?.name ?? 'Saved route', sub: route ? `${Math.round(route.distanceMeters)} m` : '' };
      }
      const observation = state.observations.find((o) => o.id === ref.id);
      return { ref, label: observation?.placeName ?? 'Field note', sub: observation?.note.slice(0, 70) ?? '' };
    });
  }, [collection, state.routes, state.observations]);

  const exportCollection = () => {
    if (!collection) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      collection,
      places: collection.itemRefs
        .filter((r) => r.kind === 'place')
        .map((r) => {
          const place = dataset.placeById.get(r.id);
          const resource = dataset.resourceByPlaceId.get(r.id);
          return place
            ? {
                id: place.id,
                name: place.name,
                address: place.address,
                coordinates: place.geometry.coordinates,
                sourceIds: place.sourceIds,
                verification: resource?.verification ?? place.verificationOverride,
              }
            : { id: r.id, missing: true };
        }),
      note: 'Contains only deliberately selected public place references. Private field notes are not included unless you added them as items.',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `night-map-${collection.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    actions.notify('Collection exported as JSON.', 'success');
  };

  return (
    <div className="workspace-panel library">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Your saved places</h2>
          <p className="muted small">
            Private collections of places, routes and notes. They live on this device and are never published.
          </p>
        </div>
      </header>

      <div className="segmented wide" role="tablist" aria-label="Library sections">
        {(Object.keys(TAB_LABELS) as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => {
              setTab(value);
              if (value !== 'collections') setCollectionId(null);
            }}
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </div>

      {tab === 'collections' && !collection && (
        <div className="collections">
          <form
            className="collection-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              void actions.createCollection(newName.trim(), newDescription.trim()).then((created) => {
                setNewName('');
                setNewDescription('');
                setCollectionId(created.id);
              });
            }}
          >
            <h3>New collection</h3>
            <input
              className="inline-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name, e.g. Places to check tomorrow"
              aria-label="Collection name"
              maxLength={120}
            />
            <input
              className="inline-input"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Optional description"
              aria-label="Collection description"
              maxLength={300}
            />
            <button type="submit" className="button primary small" disabled={!newName.trim()}>
              Create private collection
            </button>
          </form>

          {state.collections.length === 0 ? (
            <EmptyState title="No collections yet">
              Collections hold places, saved routes and your own observations. They are private to this browser and
              exportable as JSON.
            </EmptyState>
          ) : (
            <ul className="collection-list">
              {state.collections.map((c) => (
                <li key={c.id}>
                  <button type="button" className="collection-card" onClick={() => setCollectionId(c.id)}>
                    <strong>{c.name}</strong>
                    <span>{c.description || 'No description'}</span>
                    <span className="muted small">
                      {c.itemRefs.length} {c.itemRefs.length === 1 ? 'item' : 'items'} · private · updated{' '}
                      {formatDate(c.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      if (confirm(`Delete collection “${c.name}”? Items are not deleted.`)) void actions.deleteCollection(c.id);
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.saved.length > 0 && (
            <p className="muted small">
              {state.saved.length} saved {state.saved.length === 1 ? 'place' : 'places'} can be added to a collection from
              its place card.
            </p>
          )}
        </div>
      )}

      {tab === 'collections' && collection && (
        <div className="collection-detail">
          <button type="button" className="link-button" onClick={() => setCollectionId(null)}>
            ← All collections
          </button>
          <h3>{collection.name}</h3>
          <p className="muted small">{collection.description || 'No description'}</p>
          {collectionItems.length === 0 ? (
            <EmptyState title="Nothing in this collection yet">
              Open a place card and choose “Add to collection”, or save a route from the route planner.
            </EmptyState>
          ) : (
            <ul className="collection-items">
              {collectionItems.map((item) => (
                <li key={`${item.ref.kind}-${item.ref.id}`}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      if (item.ref.kind === 'place') actions.selectPlace(item.ref.id);
                      if (item.ref.kind === 'observation') actions.setWorkspace('fieldnotes');
                    }}
                  >
                    {item.label}
                  </button>
                  <span className="muted small">
                    {item.ref.kind} {item.sub ? `· ${item.sub}` : ''}
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void actions.removeFromCollection(collection.id, item.ref.kind, item.ref.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row">
            <button type="button" className="button small" onClick={exportCollection}>
              Export collection JSON
            </button>
            <span className="muted small">Public place references only; your notes stay private.</span>
          </div>
        </div>
      )}

      {tab === 'about' && (
        <div className="about-tab">
          <section>
            <h3>What is installed</h3>
            <dl className="meta-table">
              <div className="meta-row">
                <dt>Footprint</dt>
                <dd>
                  {dataset.data.meta.footprint.name}
                  <span className="meta-note">{dataset.data.meta.footprint.note}</span>
                </dd>
              </div>
              <div className="meta-row">
                <dt>Installed data</dt>
                <dd>
                  {counts.places} places · {counts.resources} resources · {counts.transitStops} Muni stops ·{' '}
                  {counts.buildings} building dossiers (loaded on demand)
                </dd>
              </div>
              <div className="meta-row">
                <dt>Build</dt>
                <dd>{formatDate(dataset.data.meta.generatedAt)}</dd>
              </div>
              <div className="meta-row">
                <dt>Coverage</dt>
                <dd>{dataset.data.meta.coverageNote}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Privacy</h3>
            <ul className="plain-list">
              <li>No account, no analytics, no ads, no server.</li>
              <li>Field notes and collections are private and stored in this browser’s IndexedDB.</li>
              <li>GPS lock is opt-in and held in memory for the session; nothing is logged or shared.</li>
              <li>Photos are re-encoded locally to strip EXIF/GPS before storage.</li>
              <li>Deleting your data is a real delete from this device, not a hidden flag.</li>
            </ul>
          </section>
          <section>
            <h3>Known limits</h3>
            <ul className="plain-list">
              <li>Routing depends on a public demo service and needs a connection.</li>
              <li>No live arrivals, opening status, bed counts or stock counts.</li>
              <li>Laundry, showers and phone charging have no verified places in this release.</li>
              <li>Building dossiers classify City records, not current occupancy.</li>
              <li>No camera, kiosk or sensor locations are plotted because no official public register publishes them.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

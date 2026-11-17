import { useMemo, useState } from 'react';
import guidesJson from '../../data/guides.json';
import fieldLibraryJson from '../../data/field-library.json';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { formatDate } from '../../domain/status';
import { CATEGORY_BY_ID } from '../../domain/categories';
import { EmptyState, SourceDetails } from '../ui';
import type { Disclosure } from '../../domain/types';

interface Guide {
  id: string;
  title: string;
  neighborhood: string;
  summary: string;
  updatedAt: string;
  readingTime: string;
  orientation: { heading: string; body: string; sourceIds: string[] }[];
  stopIds: string[];
  walkingNote: string;
  limitations: string;
}

const GUIDES = guidesJson as Guide[];

const FIELD_LIBRARY = fieldLibraryJson as {
  id: string;
  title: string;
  url: string;
  category: string;
  kind: string;
  summary: string;
}[];

const FIELD_LIBRARY_GROUPS = [
  { id: 'public-amenities', label: 'Public amenities' },
  { id: 'public-spaces', label: 'POPOS & public spaces' },
  { id: 'transit', label: 'Transit' },
  { id: 'resources', label: 'Community resources' },
  { id: 'city-data', label: 'City datasets' },
  { id: 'city-records', label: 'Property & planning' },
  { id: 'history', label: 'History & infrastructure context' },
  { id: 'archives', label: 'Archives & research' },
  { id: 'community', label: 'Community organizations' },
];

type Tab = 'guides' | 'collections' | 'field-library' | 'sources' | 'disclosures' | 'about';

const TAB_LABELS: Record<Tab, string> = {
  guides: 'Guides',
  collections: 'Collections',
  'field-library': 'Field library',
  sources: 'Sources',
  disclosures: 'Disclosures',
  about: 'About',
};

const DISCLOSURE_TYPE_LABELS: Record<Disclosure['documentType'], string> = {
  inventory: 'Inventory',
  report: 'Report',
  policy: 'Policy',
  bulletin: 'Department notice',
  news_release: 'Announcement',
  privacy_statement: 'Privacy statement',
};

const DISCLOSURE_LOCATION_LABELS: Record<Disclosure['locationData'], string> = {
  none_published: 'no locations published',
  not_a_location_register: 'not a register of places',
  summary_only: 'summary only, no locations',
};

export function AtlasWorkspace() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState<Tab>('guides');
  const [guideId, setGuideId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryCategory, setLibraryCategory] = useState('all');

  const guide = GUIDES.find((g) => g.id === guideId) ?? null;
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
    <div className="workspace-panel atlas">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Atlas</p>
          <h2>Discoveries & context</h2>
          <p className="muted small">
            Curated guides, private collections and source-backed discoveries. The map now includes {dataset.categoryCounts.popos ?? 0} City-listed POPOS places in the installed footprint, with access and freshness limitations shown on each card.
          </p>
        </div>
      </header>

      <div className="segmented wide" role="tablist" aria-label="Atlas sections">
        {(['guides', 'collections', 'field-library', 'sources', 'disclosures', 'about'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => {
              setTab(value);
              if (value !== 'guides') setGuideId(null);
              if (value !== 'collections') setCollectionId(null);
            }}
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </div>

      {tab === 'guides' && !guide && (
        <div className="guide-list">
          {GUIDES.map((g) => (
            <button key={g.id} type="button" className="guide-card" onClick={() => setGuideId(g.id)}>
              <span className="eyebrow">{g.neighborhood}</span>
              <strong>{g.title}</strong>
              <span>{g.summary}</span>
              <span className="muted small">
                {g.readingTime} read · {g.stopIds.length} stops
              </span>
            </button>
          ))}
          <p className="coverage-foot">
            Guides are editorial orientation, not surveys. Each section names the source it rests on, and each stop opens
            the same place record as the map.
          </p>
        </div>
      )}

      {tab === 'guides' && guide && (
        <article className="guide-detail">
          <button type="button" className="link-button" onClick={() => setGuideId(null)}>
            ← All guides
          </button>
          <p className="eyebrow">{guide.neighborhood}</p>
          <h3 className="display">{guide.title}</h3>
          <p className="guide-summary">{guide.summary}</p>
          <p className="muted small">
            Updated {formatDate(guide.updatedAt)} · {guide.readingTime} read
          </p>
          {guide.orientation.map((section) => (
            <section key={section.heading} className="guide-section">
              <h4>{section.heading}</h4>
              <p>{section.body}</p>
              <p className="guide-sources">
                {section.sourceIds.map((id) => {
                  const source = dataset.sourceById.get(id);
                  return source ? (
                    <a key={id} href={source.url} target="_blank" rel="noreferrer noopener">
                      {source.provider}
                    </a>
                  ) : null;
                })}
              </p>
            </section>
          ))}
          <section className="guide-stops">
            <h4>Stops on this walk</h4>
            <ol>
              {guide.stopIds.map((id) => {
                const place = dataset.placeById.get(id);
                if (!place) return null;
                const def = CATEGORY_BY_ID.get(place.category);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => {
                        actions.selectPlace(place.id);
                        actions.setSheet('peek');
                      }}
                    >
                      <span className="summary-mark" style={{ background: def?.color }} />
                      <span>
                        <strong>{place.name}</strong>
                        <span className="muted small"> · {def?.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="muted small">{guide.walkingNote}</p>
          </section>
          <p className="notice">{guide.limitations}</p>
        </article>
      )}

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

      {tab === 'disclosures' && (
        <div className="disclosures-tab">
          <p className="disclosure-statement">{dataset.disclosureFile.statement}</p>
          <p className="muted small">
            {dataset.data.disclosures.length} documents, each listed with what it says and what it leaves out. Every link
            goes to the publisher's own page.
          </p>
          <ul className="disclosure-list">
            {dataset.data.disclosures.map((entry) => (
              <li key={entry.id} className="disclosure-card">
                <span className="eyebrow">
                  {DISCLOSURE_TYPE_LABELS[entry.documentType]} · {entry.publisher}
                </span>
                <h3>
                  <a href={entry.url} target="_blank" rel="noreferrer noopener">
                    {entry.title}
                  </a>
                </h3>
                <p className="muted small">
                  {entry.dateShown ? `Page dated ${formatDate(entry.dateShown)}` : 'The page displays no date'}
                  {' · '}
                  {DISCLOSURE_LOCATION_LABELS[entry.locationData]}
                </p>
                <p>{entry.whatItCovers}</p>
                <p className="disclosure-gap">
                  <strong>What it does not say.</strong> {entry.whatItDoesNotSay}
                </p>
              </li>
            ))}
          </ul>
          <p className="coverage-foot">
            Night Map plots no camera, kiosk or sensor locations. It holds no geometry for them because no official public
            register publishes any, and it will not place a dot by inferring one layer from another. The transport
            agency's terms of use and the City's website privacy policy are both scoped to websites, so neither is
            presented here as a statement about street hardware.
          </p>
        </div>
      )}

      {tab === 'field-library' && (() => {
        const normalizedQuery = libraryQuery.trim().toLowerCase();
        const filtered = FIELD_LIBRARY.filter((entry) =>
          (libraryCategory === 'all' || entry.category === libraryCategory) &&
          (!normalizedQuery || `${entry.title} ${entry.summary} ${entry.kind}`.toLowerCase().includes(normalizedQuery)),
        );
        return (
          <section className="field-library" aria-label="Field research source library">
            <p className="disclosure-statement">A curated directory for public-interest field research. Sources are starting points, not interchangeable evidence: check the publisher, dates, data license and stated limitations before relying on a claim.</p>
            <div className="field-library-controls">
              <label className="field">
                <span>Search sources</span>
                <input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search title, topic or publisher" />
              </label>
              <label className="field">
                <span>Source group</span>
                <select value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value)}>
                  <option value="all">All groups ({FIELD_LIBRARY.length})</option>
                  {FIELD_LIBRARY_GROUPS.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                </select>
              </label>
            </div>
            <p className="muted small" aria-live="polite">Showing {filtered.length} of {FIELD_LIBRARY.length} references. Primary city/data/archive sources are labeled separately from community and news sources.</p>
            {filtered.length === 0 ? <EmptyState title="No sources match">Try a different search or group.</EmptyState> : (
              <ul className="field-library-list">
                {filtered.map((entry) => (
                  <li key={entry.id} className="field-library-card">
                    <div className="field-library-card-head">
                      <span className={`source-kind source-kind-${entry.kind.toLowerCase()}`}>{entry.kind}</span>
                      <span className="eyebrow">{FIELD_LIBRARY_GROUPS.find((group) => group.id === entry.category)?.label ?? entry.category}</span>
                    </div>
                    <h3><a href={entry.url} target="_blank" rel="noreferrer noopener">{entry.title}</a></h3>
                    <p>{entry.summary}</p>
                    <a className="field-library-url" href={entry.url} target="_blank" rel="noreferrer noopener">Open publisher source ↗</a>
                  </li>
                ))}
              </ul>
            )}
            <p className="coverage-foot">No source listed here establishes private access rights, current occupancy, a crime at a specific address, or permission to enter restricted infrastructure. City complaint data records requests and reports, not adjudicated facts.</p>
          </section>
        );
      })()}

      {tab === 'sources' && (
        <div className="sources-tab">
          <p className="muted small">
            {dataset.data.sources.length} registered sources. Every imported record keeps its source id; nothing was
            scraped without checking terms.
          </p>
          <SourceDetails sources={dataset.data.sources} />
        </div>
      )}

      {tab === 'about' && (
        <div className="about-tab">
          <section>
            <h3>What this app knows</h3>
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
                  {counts.historicFeatures} historic features
                </dd>
              </div>
              <div className="meta-row">
                <dt>Disclosures</dt>
                <dd>
                  {counts.disclosures} official documents on what the City collects, each with what it does not say.
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
            <h3>What “verified” means here</h3>
            <ul className="plain-list">
              <li>
                <strong>Officially published</strong> — copied from a City open dataset. It is not a check of the door.
              </li>
              <li>
                <strong>Checked recently</strong> — a Night Map contributor read the provider page on the date shown.
              </li>
              <li>
                <strong>Community-mapped</strong> — OpenStreetMap geometry or feature names, not reviewed by Night Map.
              </li>
              <li>
                <strong>Unverified</strong> — your own observation, or a claim without a source. Never displayed as fact.
              </li>
              <li>
                <strong>Potentially outdated</strong> — the source row is older than 90 days, so Night Map refuses to say
                whether it is open now.
              </li>
            </ul>
          </section>
          <section>
            <h3>Privacy</h3>
            <ul className="plain-list">
              <li>No account, no analytics, no ads, no server.</li>
              <li>Field notes are private and stored in this browser’s IndexedDB.</li>
              <li>Location is a single, opt-in fix held in memory for the session; nothing is logged or shared.</li>
              <li>Photos are re-encoded locally to strip EXIF/GPS before storage.</li>
              <li>Deleting your data is a real delete from this device, not a hidden flag.</li>
            </ul>
          </section>
          <section>
            <h3>Known limits</h3>
            <ul className="plain-list">
              <li>Routing depends on a public demo service and needs a connection.</li>
              <li>No live arrivals, opening status, bed counts or stock counts.</li>
              <li>No accessibility data in the City asset inventory, so none is claimed.</li>
              <li>Laundry, showers and phone charging have no verified places in this release.</li>
              <li>
                Cost and friction lines are only as good as the page they name. Where a provider publishes no fee, no ID
                rule or no hours, the record says the source does not say, rather than filling the gap.
              </li>
              <li>
                No camera, kiosk or sensor locations are plotted: no official public register publishes them, so this app
                lists the City's own disclosure documents instead of placing dots it cannot justify.
              </li>
              <li>Street geometry is a snapshot; construction and closures are not reflected.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

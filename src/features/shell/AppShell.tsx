import { useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from '../../map/MapView';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { filteredViews, historyViews } from '../../state/selectors';
import { PlaceInspector, CompareTray } from '../place/PlaceInspector';
import { NearbyList, SearchBar } from '../discovery/Discovery';
import { RoutePanel } from '../routing/RoutePanel';
import { FieldnotesWorkspace } from '../fieldnotes/FieldnotesWorkspace';
import { MessagesWorkspace } from '../messages/MessagesWorkspace';
import { BuildingsWorkspace } from '../buildings/BuildingsWorkspace';
import { BuildingDossier } from '../buildings/BuildingDossier';
import { LibraryWorkspace } from '../library/LibraryWorkspace';
import { AtlasWorkspace } from '../atlas/AtlasWorkspace';
import { FeedsWorkspace } from '../feeds/FeedsWorkspace';
import { ReviewWorkspace } from '../review/ReviewWorkspace';
import { LayerDrawer } from '../layers/LayerDrawer';
import { SettingsPanel } from '../settings/SettingsPanel';
import { FieldnoteComposer, type ComposeTarget } from '../fieldnotes/FieldnoteComposer';
import { PathIcon, useDesktop, useOnline } from '../ui';
import { formatDate } from '../../domain/status';
import { isOpenReport } from '../../domain/verification';

const WORKSPACES = [
  { id: 'nearby', label: 'Nearby', icon: 'M12 3.5 20 12l-8 8.5L4 12z' },
  { id: 'messages', label: 'Messages', icon: 'M4 5h16v11H9l-5 4V5Z' },
  { id: 'fieldnotes', label: 'Field map', icon: 'M5 3.5h11l3 3v14H5zM8.5 11h7M8.5 15h5' },
  { id: 'routes', label: 'Routes', icon: 'M5 19 19 5M11 5h8v8' },
  { id: 'buildings', label: 'Buildings', icon: 'M3.5 21h17M5.5 21V8l6.5-4.5L18.5 8v13M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15' },
  { id: 'library', label: 'Library', icon: 'M4 4.5h5v15H4zM11 4.5h5v15h-5zM18 5.5l4 13.5M6.5 8h6M6.5 11.5h4' },
  { id: 'atlas', label: 'Atlas', icon: 'M3.5 21h17M6 21V10M12 21V10M18 21V10M3 10h18L12 3.5 3 10Z' },
  { id: 'review', label: 'Review', icon: 'M6.5 4.5h11v15h-11zM9 8.5h6M9 12h6M9 15.5h3.5' },
] as const;

/**
 * The feed tabs sit at the end of the phone menu. They open a status panel
 * rather than a player: there is no lawful public live camera feed or radio
 * stream for San Francisco, and a button that pretended otherwise would be the
 * one dishonest control in the app.
 */
const FEED_TABS = [
  { id: 'cctv', label: 'CCTV', icon: 'M3.5 7h10.5v10H3.5zM14 11l6.5-3.4v8.8L14 13' },
  { id: 'radio', label: 'Radio', icon: 'M4 9.5h16v9.5H4zM7 13.6h.01M10.6 13.6h.01M14.4 13.6h3.2M8.5 6.6 16.5 3.4' },
] as const;

type WorkspaceId = (typeof WORKSPACES)[number]['id'];
type NavId = WorkspaceId | (typeof FEED_TABS)[number]['id'];

/**
 * The phone bar carries the four workspaces used in the field, with the two feed
 * status panels at the end. Notes and Review are not on the bar: each keeps a
 * header button beside search so neither workspace is unreachable on a phone.
 */
const MOBILE_WORKSPACES = WORKSPACES.filter(
  (workspace) => workspace.id !== 'review' && workspace.id !== 'library',
);

export function AppShell() {
  const { state, actions } = useStore();
  const desktop = useDesktop();
  const online = useOnline();
  const [layersOpen, setLayersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composeTarget, setComposeTarget] = useState<ComposeTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [sheetDrag, setSheetDrag] = useState<{ startY: number; startHeight: number } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; currentHeight: number } | null>(null);

  const views = useMemo(
    () => [...filteredViews(state, dataset), ...historyViews(state, dataset)],
    // Camera bounds update on every pan; they must not rebuild the marker set.
    [state.filters, state.reference, state.saved, state.observations, state.overrides, state.layers.landmarks],
  );
  const selectedPlace = state.selectedPlaceId
    ? dataset.placeById.get(state.selectedPlaceId) ?? (state.selectedPlaceId.startsWith('private:')
        ? (() => {
            const observation = state.observations.find((item) => `private:${item.id}` === state.selectedPlaceId);
            if (!observation?.geometry) return null;
            const category = observation.type === 'passage_discovery' ? 'passage'
              : observation.type === 'popos_observation' ? 'popos'
                : observation.type === 'entrance_observation' || observation.type === 'stairs_ramp_observation' ? 'pedestrian_connection'
                  : observation.type === 'research_lead' ? 'research_lead' : 'urban_clue';
            return {
              id: state.selectedPlaceId,
              name: observation.placeName ?? 'Private field observation',
              category,
              geometry: observation.geometry,
              address: null,
            } as (typeof dataset.data.places)[number];
          })()
        : null)
    : null;
  const openReportCount = useMemo(() => state.reports.filter(isOpenReport).length, [state.reports]);

  // Deep link: #/place/<id>
  useEffect(() => {
    const applyHash = () => {
      const match = /^#\/place\/(.+)$/.exec(window.location.hash);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (dataset.placeById.has(id) || (id.startsWith('private:') && state.observations.some((o) => `private:${o.id}` === id))) actions.selectPlace(id);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.selectedPlaceId) {
      window.history.replaceState(null, '', `#/place/${encodeURIComponent(state.selectedPlaceId)}`);
    }
  }, [state.selectedPlaceId]);

  // Actions such as GO change the workspace in the store. On desktop that must
  // reveal the corresponding panel; otherwise the action looks like a no-op.
  useEffect(() => {
    if (desktop && state.workspace !== 'map') setDesktopPanelOpen(true);
  }, [desktop, state.workspace]);

  const openWorkspace = (id: NavId) => {
    actions.setWorkspace(id);
    actions.setSheet('peek');
    setSearchOpen(false);
  };

  // Command palette
  useEffect(() => {
    if (!desktop) return;
    const onKey = (event: KeyboardEvent) => {
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName ?? '');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (event.key === 'Escape') {
        setPaletteOpen(false);
        setLayersOpen(false);
        setSettingsOpen(false);
        setSearchOpen(false);
      } else if (!isTyping && event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.searchbar input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop]);

  const sheetHeights = {
    dismissed: 104,
    collapsed: 104,
    peek: Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.46),
    expanded: Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.86),
  };
  const sheetHeight = dragHeight ?? sheetHeights[state.sheet];

  const startSheetDrag = (event: React.PointerEvent) => {
    dragRef.current = { startY: event.clientY, startHeight: sheetHeight, currentHeight: sheetHeight };
    setSheetDrag({ startY: event.clientY, startHeight: sheetHeight });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveSheet = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    const next = Math.min(sheetHeights.expanded + 40, Math.max(sheetHeights.collapsed - 24, drag.startHeight + delta));
    drag.currentHeight = next;
    setDragHeight(next);
  };
  const endSheetDrag = (event?: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSheetDrag(null);
    setDragHeight(null);
    const options: { id: 'collapsed' | 'peek' | 'expanded'; distance: number }[] = (
      ['collapsed', 'peek', 'expanded'] as const
    ).map((id) => ({ id, distance: Math.abs(sheetHeights[id] - drag.currentHeight) }));
    options.sort((a, b) => a.distance - b.distance);
    if (options[0].id !== state.sheet) actions.setSheet(options[0].id);
  };

  const workspaceContent = () => {
    switch (state.workspace) {
      case 'cctv':
        return <FeedsWorkspace kind="cctv" />;
      case 'radio':
        return <FeedsWorkspace kind="radio" />;
      case 'routes':
        return <RoutePanel />;
      case 'messages':
        return <MessagesWorkspace />;
      case 'fieldnotes':
        return <FieldnotesWorkspace />;
      case 'buildings':
        return <BuildingsWorkspace />;
      case 'library':
        return <LibraryWorkspace />;
      case 'atlas':
        return <AtlasWorkspace />;
      case 'review':
        return <ReviewWorkspace />;
      case 'nearby':
      case 'map':
      default:
        return <NearbyList mode="nearby" />;
    }
  };

  const offlineBar = !online && (
    <div className="offline-bar" role="status">
      <strong>Offline</strong>
      <span>
        Bundled places from {formatDate(dataset.data.meta.generatedAt)} are available, with saved places and your notes.
        Routing and wider address search will not work.
      </span>
    </div>
  );

  if (desktop) {
    return (
      <div
        className={`app app-desktop ${state.workspace !== 'map' && desktopPanelOpen ? 'has-panel' : ''} ${
          selectedPlace || state.selectedBuildingId ? 'has-inspector' : ''
        } ${layersOpen || settingsOpen || searchOpen ? 'has-flyout' : ''}`}
      >
        <aside className="side-rail" aria-label="Workspaces">
          <span className="rail-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" className="brand-mark">
              <path d="M16 3.5 27 16 16 28.5 5 16Z" />
              <circle cx="16" cy="16" r="3.2" />
            </svg>
          </span>
          {WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={`rail-button ${state.workspace === workspace.id && desktopPanelOpen ? 'is-active' : ''}`}
              aria-label={workspace.label}
              aria-current={state.workspace === workspace.id ? 'page' : undefined}
              title={workspace.label}
              onClick={() => {
                actions.setWorkspace(workspace.id);
                setDesktopPanelOpen(true);
                setSearchOpen(false);
                setLayersOpen(false);
                setSettingsOpen(false);
              }}
            >
              <PathIcon path={workspace.icon} size={19} />
              <span>{workspace.label}</span>
              {workspace.id === 'review' && openReportCount > 0 && <span className="nav-badge">{openReportCount}</span>}
            </button>
          ))}
          {FEED_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rail-button ${state.workspace === tab.id && desktopPanelOpen ? 'is-active' : ''}`}
              aria-label={tab.label}
              aria-current={state.workspace === tab.id ? 'page' : undefined}
              title={tab.label}
              onClick={() => {
                actions.setWorkspace(tab.id);
                setDesktopPanelOpen(true);
                setSearchOpen(false);
                setLayersOpen(false);
                setSettingsOpen(false);
              }}
            >
              <PathIcon path={tab.icon} size={19} />
              <span>{tab.label}</span>
            </button>
          ))}
          <span
            className={`rail-status ${online ? 'is-online' : 'is-offline'}`}
            role="img"
            aria-label={online ? 'Online: network requests work' : 'Offline: bundled records only'}
            title={online ? 'Online · bundled records plus network requests' : 'Offline · bundled records and saved notes only'}
          >
            <span className="rail-status-dot" />
            <span className="rail-status-label">{online ? 'Online' : 'Offline'}</span>
          </span>
        </aside>
        {offlineBar}
        <main className="map-full">
          <MapView views={views} onOpenLayers={() => setLayersOpen(true)} />
        </main>

        {desktopPanelOpen && state.workspace !== 'map' && (
          <section className="float-panel panel-left" aria-label={state.workspace + ' workspace'}>
            <header className="float-panel-head"><div><span className="eyebrow">Workspace</span><h2>{WORKSPACES.find((item) => item.id === state.workspace)?.label ?? state.workspace}</h2></div>
              <button type="button" className="icon-button" onClick={() => setDesktopPanelOpen(false)} aria-label="Close workspace">×</button></header>
            {state.workspace === 'nearby' && <div className="desktop-panel-search"><SearchBar /></div>}
            <div className="float-panel-body">{workspaceContent()}</div>
          </section>
        )}

        {selectedPlace && (
          <section className="float-panel panel-right" aria-label="Selected place details">
            <header><div><span className="eyebrow">Selected record</span><h2>{selectedPlace.name}</h2></div>
              <button type="button" className="icon-button" onClick={() => actions.selectPlace(null)} aria-label="Close details">×</button></header>
            <div className="float-panel-body">
              <PlaceInspector placeId={selectedPlace.id} onClose={() => actions.selectPlace(null)} onComposeNote={setComposeTarget} />
              <CompareTray />
            </div>
          </section>
        )}

        {state.workspace === 'buildings' && state.selectedBuildingId && (
          <section className="float-panel panel-right" aria-label="Selected building dossier">
            <header><div><span className="eyebrow">Selected dossier</span><h2>Building record</h2></div>
              <button type="button" className="icon-button" onClick={() => actions.selectBuilding(null)} aria-label="Close dossier">×</button></header>
            <div className="float-panel-body">
              <BuildingDossier
                dossierId={state.selectedBuildingId}
                onBack={() => actions.selectBuilding(null)}
                onComposeCheck={setComposeTarget}
              />
            </div>
          </section>
        )}

        <nav className="bottom-bar" aria-label="Map tools">
          <button
            type="button"
            className={state.workspace === 'map' && !selectedPlace && !state.selectedBuildingId ? 'is-active' : ''}
            onClick={() => {
              actions.selectPlace(null);
              actions.selectBuilding(null);
              actions.setWorkspace('map');
              setDesktopPanelOpen(false);
              setSearchOpen(false);
              setLayersOpen(false);
              setSettingsOpen(false);
            }}
          >
            <PathIcon path="M12 3.5 20 12l-8 8.5L4 12z" size={19} />
            <span>Map</span>
          </button>
          <button
            type="button"
            className={searchOpen ? 'is-active' : ''}
            aria-expanded={searchOpen}
            onClick={() => { setSearchOpen((open) => !open); setLayersOpen(false); setSettingsOpen(false); }}
          >
            <PathIcon path="M10.5 4.3a6.2 6.2 0 1 0 0 12.4a6.2 6.2 0 0 0 0-12.4ZM15 15l5 5" size={19} />
            <span>Search</span>
          </button>
          <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Command palette" title="Command palette (⌘K)">
            <PathIcon path="M4 5h16v14H4zM7.5 10l2 2-2 2M12.5 14.5h4" size={19} />
            <span>Command</span>
          </button>
          <button
            type="button"
            className={layersOpen ? 'is-active' : ''}
            aria-expanded={layersOpen}
            onClick={() => { setLayersOpen((open) => !open); setSettingsOpen(false); setSearchOpen(false); }}
          >
            <PathIcon path="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" size={19} />
            <span>Layers</span>
          </button>
          <button
            type="button"
            className={settingsOpen ? 'is-active' : ''}
            aria-expanded={settingsOpen}
            onClick={() => { setSettingsOpen((open) => !open); setLayersOpen(false); setSearchOpen(false); }}
          >
            <PathIcon path="M12 8.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 0 0 0-6.4ZM12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" size={19} />
            <span>Settings</span>
          </button>
        </nav>

        {searchOpen && <div className="mobile-search desktop-search" role="dialog" aria-label="Night Map search panel">
          <div className="mobile-search-head"><SearchBar autoFocus onNavigate={() => setSearchOpen(false)} />
            <button type="button" className="button ghost small" onClick={() => setSearchOpen(false)}>Close</button></div>
          <p className="muted small">Search installed places, streets and Muni stops in the central-SF footprint.</p>
        </div>}
        {layersOpen && <Overlay side="right" onClose={() => setLayersOpen(false)}><LayerDrawer onClose={() => setLayersOpen(false)} /></Overlay>}
        {settingsOpen && <Overlay side="right" onClose={() => setSettingsOpen(false)}><SettingsPanel onClose={() => setSettingsOpen(false)} /></Overlay>}
        {composeTarget && <Overlay side="center" onClose={() => setComposeTarget(null)}><div className="composer-shell">
          <FieldnoteComposer target={composeTarget}
            existing={composeTarget?.placeId?.startsWith('private:') ? state.observations.find((o) => `private:${o.id}` === composeTarget.placeId) : undefined}
            onDone={() => setComposeTarget(null)} onCancel={() => setComposeTarget(null)} />
        </div></Overlay>}
        {paletteOpen && <CommandPalette query={paletteQuery} setQuery={setPaletteQuery} onClose={() => { setPaletteOpen(false); setPaletteQuery(''); }}
          onCommand={(command) => { setPaletteOpen(false); setPaletteQuery('');
            if (command === 'layers') setLayersOpen(true);
            else if (command === 'settings') setSettingsOpen(true);
            else if (command === 'clear') actions.resetFilters();
            else if (command === 'export') void import('../../services/storage').then((m) => m.exportPersonalData());
            else if (command === 'compose') { openWorkspace('messages'); setDesktopPanelOpen(true); }
            else { openWorkspace(command as WorkspaceId); setDesktopPanelOpen(true); }
          }} />}
        <Toast />
      </div>
    );
  }

  return (
    <div className="app app-mobile">
      <header className="mobile-top">
        <div className="brand compact">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
            <path d="M16 3.5 27 16 16 28.5 5 16Z" />
            <circle cx="16" cy="16" r="3.2" />
          </svg>
          <span className="brand-name">Night Map</span>
        </div>
        <div className="mobile-top-actions">
          <button type="button" className="map-control" onClick={() => setSearchOpen(true)} aria-label="Search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.2" />
              <path d="m15 15 5 5" />
            </svg>
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => openWorkspace('fieldnotes')}
            aria-label="Field map and notes"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 3.5h11l3 3v14H5zM8.5 11h7M8.5 15h5" />
            </svg>
            {state.observations.length > 0 && <span className="nav-badge">{state.observations.length}</span>}
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => openWorkspace('review')}
            aria-label={openReportCount > 0 ? `Review queue, ${openReportCount} open` : 'Review queue'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.5 4.5h11v15h-11zM9 8.5h6M9 12h6M9 15.5h3.5" />
            </svg>
            {openReportCount > 0 && <span className="nav-badge">{openReportCount}</span>}
          </button>
          <button type="button" className="map-control" onClick={() => setSettingsOpen(true)} aria-label="Settings and privacy">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
            </svg>
          </button>
        </div>
        <div className="mobile-status">
          {!online && <span className="offline-chip">Offline · saved data</span>}
          {online && <span className="online-chip">Field release · {dataset.data.meta.counts.places} places</span>}
          <span className="privacy-chip">No account · no tracking</span>
        </div>
      </header>

      {offlineBar}

      <main className="mobile-map">
        <MapView views={views} onOpenLayers={() => setLayersOpen(true)} />
      </main>

      <section
        className={`sheet sheet-${state.sheet} ${sheetDrag ? 'is-dragging' : ''}`}
        style={{ height: sheetHeight }}
        aria-label="Record panel"
      >
        <div
          className="sheet-handle"
          role="button"
          tabIndex={0}
          aria-label="Drag to resize panel. Use Enter to cycle collapsed, half and full."
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheet}
          onPointerUp={endSheetDrag}
          onPointerCancel={endSheetDrag}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              actions.setSheet(state.sheet === 'collapsed' ? 'peek' : state.sheet === 'peek' ? 'expanded' : 'collapsed');
            }
          }}
        >
          <span />
          <span className="sheet-grip" aria-hidden="true" />
          {state.sheet === 'collapsed' && selectedPlace && (
            <div className="sheet-collapsed-title">
              <strong>{selectedPlace.name}</strong>
              <span>{selectedPlace.address}</span>
            </div>
          )}
          {state.sheet === 'collapsed' && !selectedPlace && (
            <div className="sheet-collapsed-title">
              <strong>Nearby</strong>
              <span>{views.length} places pass the current filters</span>
            </div>
          )}
        </div>
        <div className="sheet-scroll">
          {state.workspace === 'buildings' && state.selectedBuildingId ? (
            <BuildingDossier
              dossierId={state.selectedBuildingId}
              onBack={() => actions.selectBuilding(null)}
              onComposeCheck={setComposeTarget}
            />
          ) : selectedPlace && (state.workspace === 'map' || state.workspace === 'nearby') ? (
            <PlaceInspector
              placeId={selectedPlace.id}
              onClose={() => {
                actions.selectPlace(null);
                actions.setSheet('collapsed');
              }}
              onComposeNote={(target) => setComposeTarget(target)}
            />
          ) : (
            workspaceContent()
          )}
        </div>
      </section>

      <nav className="mobile-nav" aria-label="Workspaces">
        {MOBILE_WORKSPACES.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            className={state.workspace === workspace.id ? 'is-active' : ''}
            onClick={() => openWorkspace(workspace.id)}
          >
            <PathIcon path={workspace.icon} size={20} />
            <span>{workspace.label}</span>
          </button>
        ))}
        {FEED_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={state.workspace === tab.id ? 'is-active' : ''}
            aria-current={state.workspace === tab.id ? 'page' : undefined}
            onClick={() => openWorkspace(tab.id)}
          >
            <PathIcon path={tab.icon} size={20} />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {searchOpen && (
        <div className="mobile-search" role="dialog" aria-label="Night Map search panel">
          <div className="mobile-search-head">
            <SearchBar autoFocus onNavigate={() => setSearchOpen(false)} />
            <button type="button" className="button ghost small" onClick={() => setSearchOpen(false)}>
              Close
            </button>
          </div>
          <p className="muted small">
            The index covers installed places, streets and Muni stops in central SF. It is not a citywide geocoder.
          </p>
        </div>
      )}

      {composeTarget && (
        <Overlay side="center" onClose={() => setComposeTarget(null)}>
          <div className="composer-shell">
            <FieldnoteComposer
                target={composeTarget}
                existing={composeTarget?.placeId?.startsWith('private:') ? state.observations.find((o) => `private:${o.id}` === composeTarget.placeId) : undefined}
                onDone={() => setComposeTarget(null)}
                onCancel={() => setComposeTarget(null)}
              />
          </div>
        </Overlay>
      )}
      {layersOpen && <Overlay side="center" onClose={() => setLayersOpen(false)}><LayerDrawer onClose={() => setLayersOpen(false)} /></Overlay>}
      {settingsOpen && <Overlay side="center" onClose={() => setSettingsOpen(false)}><SettingsPanel onClose={() => setSettingsOpen(false)} /></Overlay>}
      <Toast />
    </div>
  );
}

function Overlay({
  children,
  onClose,
  side,
}: {
  children: React.ReactNode;
  onClose: () => void;
  side: 'right' | 'center';
}) {
  return (
    <div className={`overlay overlay-${side}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-panel">{children}</div>
    </div>
  );
}

function Toast() {
  const { state, actions } = useStore();
  if (!state.toast) return null;
  return (
    <div className={`toast tone-${state.toast.tone}`} role="status">
      <span>{state.toast.message}</span>
      <button type="button" className="icon-button" onClick={actions.dismissToast} aria-label="Dismiss message">
        ×
      </button>
    </div>
  );
}

function CommandPalette({
  query,
  setQuery,
  onClose,
  onCommand,
}: {
  query: string;
  setQuery: (v: string) => void;
  onClose: () => void;
  onCommand: (command: string) => void;
}) {
  const commands = [
    { id: 'nearby', label: 'Go to Nearby' },
    { id: 'routes', label: 'Go to Routes' },
    { id: 'fieldnotes', label: 'Go to Fieldnotes' },
    { id: 'atlas', label: 'Go to Atlas' },
    { id: 'review', label: 'Go to Review' },
    { id: 'compose', label: 'Private messages' },
    { id: 'layers', label: 'Open layers' },
    { id: 'settings', label: 'Open settings & privacy' },
    { id: 'clear', label: 'Clear all filters' },
    { id: 'export', label: 'Download my data' },
  ].filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="overlay overlay-center" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command…"
          aria-label="Command"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && commands[0]) onCommand(commands[0].id);
            if (e.key === 'Escape') onClose();
          }}
        />
        <ul>
          {commands.map((command) => (
            <li key={command.id}>
              <button type="button" onClick={() => onCommand(command.id)}>
                {command.label}
              </button>
            </li>
          ))}
          {commands.length === 0 && <li className="muted small">No command matches.</li>}
        </ul>
        <p className="muted small">Core functions stay available through visible controls. Esc closes.</p>
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MapView, type MapLiveCounts } from '../../map/MapView';
import { dataset } from '../../data';
import { useStore } from '../../state/store';
import { filteredViews } from '../../state/selectors';
import { PlaceInspector, CompareTray } from '../place/PlaceInspector';
import { NearbyList, SearchBar } from '../discovery/Discovery';
import { BuildingsWorkspace } from '../buildings/BuildingsWorkspace';
import { BuildingDossier } from '../buildings/BuildingDossier';
import { RoutePanel } from '../routing/RoutePanel';
import { FieldnotesWorkspace } from '../fieldnotes/FieldnotesWorkspace';
import { LibraryWorkspace } from '../library/LibraryWorkspace';
import { FeedsWorkspace } from '../feeds/FeedsWorkspace';
import { ReviewWorkspace } from '../review/ReviewWorkspace';
import { LayerDrawer } from '../layers/LayerDrawer';
import { SettingsPanel } from '../settings/SettingsPanel';
import { MapTargetsPanel } from './MapTargetsPanel';
import { FieldnoteComposer, type ComposeTarget } from '../fieldnotes/FieldnoteComposer';
import { MissingPlaceComposer } from '../fieldnotes/MissingPlaceComposer';
import { PathIcon, useDesktop, useOnline } from '../ui';
import { formatDate } from '../../domain/status';
import { isOpenReport } from '../../domain/verification';

const WORKSPACES = [
  { id: 'nearby', label: 'Nearby', icon: 'M12 3.5 20 12l-8 8.5L4 12z' },
  { id: 'buildings', label: 'Buildings', icon: 'M4 21V7l8-4 8 4v14M9 21v-6h6v6M4 21h16' },
  { id: 'fieldnotes', label: 'Field map', icon: 'M5 3.5h11l3 3v14H5zM8.5 11h7M8.5 15h5' },
  { id: 'routes', label: 'Routes', icon: 'M5 19 19 5M11 5h8v8' },
  { id: 'library', label: 'Library', icon: 'M4 4.5h5v15H4zM10.5 4.5h9v15h-9zM13 8h3.5M13 11h3.5M13 14h3.5' },
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

/** Every destination in the bottom menu, in order. */
const NAV_ITEMS = [...WORKSPACES, ...FEED_TABS];

type WorkspaceId = (typeof WORKSPACES)[number]['id'];
type NavId = WorkspaceId | (typeof FEED_TABS)[number]['id'];

/**
 * The phone bar carries the four workspaces used in the field, with the two feed
 * status panels at the end. Notes and Review are not on the bar: each keeps a
 * header button beside search so neither workspace is unreachable on a phone.
 */
const MOBILE_WORKSPACES = WORKSPACES.filter(
  (workspace) => workspace.id !== 'review',
);

export function AppShell() {
  const { state, actions } = useStore();
  const desktop = useDesktop();
  const online = useOnline();
  const [layersOpen, setLayersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railPopover, setRailPopover] = useState<{
    kind: 'layers' | 'settings' | 'targets';
    top: number;
    maxHeight: number;
    caretTop: number;
  } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composeTarget, setComposeTarget] = useState<ComposeTarget | null>(null);
  const [missingPlacePoint, setMissingPlacePoint] = useState<[number, number] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [sheetDrag, setSheetDrag] = useState<{ startY: number; startHeight: number } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [liveCounts, setLiveCounts] = useState<MapLiveCounts>({ calls: 0, cases311: 0, registry: 0, abandoned: 0 });
  const dragRef = useRef<{ startY: number; startHeight: number; currentHeight: number } | null>(null);
  const layersButtonRef = useRef<HTMLButtonElement | null>(null);
  const targetsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const views = useMemo(() => filteredViews(state, dataset), [state]);
  const selectedPlace = state.selectedPlaceId
    ? dataset.placeById.get(state.selectedPlaceId) ?? (state.selectedPlaceId.startsWith('private:')
        ? (() => {
            const observation = state.observations.find((item) => `private:${item.id}` === state.selectedPlaceId);
            if (!observation?.geometry) return null;
            const category = observation.suggestedCategory ?? (observation.type === 'passage_discovery' ? 'passage'
              : observation.type === 'popos_observation' ? 'popos'
                : observation.type === 'entrance_observation' || observation.type === 'stairs_ramp_observation' ? 'pedestrian_connection'
                  : 'services');
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

  const openWorkspace = (id: NavId) => {
    actions.setWorkspace(id);
    actions.setSheet('peek');
    setSearchOpen(false);
  };

  const quickNote = () => {
    setComposeTarget({
      placeId: selectedPlace?.id ?? null,
      placeName: selectedPlace?.name ?? 'Pinned observation at map centre',
      coordinates: selectedPlace?.geometry.coordinates ?? state.reference.coordinates,
    });
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
        setTargetsOpen(false);
        setSearchOpen(false);
      } else if (!isTyping && event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.searchbar input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop]);

  // Layers and Settings are popovers, not drawers: keep each one aligned with
  // the rail button that opened it and flip above the button when the space
  // below is too cramped for a useful panel.
  useLayoutEffect(() => {
    if (!desktop || (!layersOpen && !settingsOpen && !targetsOpen)) return;
    const kind = layersOpen ? 'layers' : targetsOpen ? 'targets' : 'settings';
    const button =
      kind === 'layers'
        ? layersButtonRef.current
        : kind === 'targets'
          ? targetsButtonRef.current
          : settingsButtonRef.current;
    if (!button) return;

    const place = () => {
      const rect = button.getBoundingClientRect();
      const viewport = window.innerHeight;
      const below = viewport - rect.top - 96;
      const above = rect.bottom - 12;
      const cap = Math.round(viewport * 0.6);
      let maxHeight = Math.min(cap, below);
      let top = rect.top;
      if (maxHeight < 300 && above > maxHeight) {
        maxHeight = Math.min(cap, above);
        top = rect.bottom - maxHeight;
      }
      const buttonCenter = rect.top + rect.height / 2;
      const caretTop = Math.max(18, Math.min(maxHeight - 18, buttonCenter - top));
      setRailPopover({ kind, top, maxHeight, caretTop });
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [desktop, layersOpen, settingsOpen, targetsOpen]);

  // Side flyouts close on an outside click, but not while the rail itself is
  // being used to switch panels.
  useEffect(() => {
    if (!desktop) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.side-popover, .float-search-card, .side-rail')) return;
      setLayersOpen(false);
      setSettingsOpen(false);
      setTargetsOpen(false);
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [desktop]);

  const sheetHeights = {
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
      case 'buildings':
        return <BuildingsWorkspace />;
      case 'routes':
        return <RoutePanel />;
      case 'fieldnotes':
        return <FieldnotesWorkspace />;
      case 'library':
        return <LibraryWorkspace />;
      case 'review':
        return <ReviewWorkspace />;
      case 'nearby':
      case 'map':
      default:
        return <NearbyList mode="nearby" />;
    }
  };

  const activeWorkspaceLabel = NAV_ITEMS.find((item) => item.id === state.workspace)?.label ?? 'Map';
  const mobileCanClose = state.workspace !== 'map' || Boolean(selectedPlace) || Boolean(state.selectedBuildingId);

  const closeMobilePanels = () => {
    actions.selectPlace(null);
    actions.selectBuilding(null);
    actions.setWorkspace('map');
    actions.setSheet('collapsed');
  };

  const offlineBar = !online && (
    <div className="offline-bar" role="status">
      <strong>Offline</strong>
      <span>
        Bundled records from {formatDate(dataset.data.meta.generatedAt)} are available, with saved places and your notes.
        Routing and wider address search will not work.
      </span>
    </div>
  );

  if (desktop) {
    return (
      <div
        className={`app app-desktop ${state.workspace !== 'map' ? 'has-panel' : ''} ${
          selectedPlace || state.selectedBuildingId ? 'has-inspector' : ''
        } ${layersOpen || settingsOpen || targetsOpen || searchOpen ? 'has-flyout' : ''}`}
      >
        <aside className="side-rail" aria-label="Map tools">
          <span className="rail-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" className="brand-mark">
              <path d="M16 3.5 27 16 16 28.5 5 16Z" />
              <circle cx="16" cy="16" r="3.2" />
            </svg>
          </span>
          <button
            type="button"
            className={`rail-button ${searchOpen ? 'is-active' : ''}`}
            onClick={() => {
              setSearchOpen((open) => !open);
              setLayersOpen(false);
              setSettingsOpen(false);
              setTargetsOpen(false);
            }}
            aria-label="Search"
            aria-expanded={searchOpen}
            title="Search records, streets and stops"
          >
            <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.2" />
              <path d="m15 15 5 5" />
            </svg>
            <span>Search</span>
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Command palette"
            title="Command palette (⌘K)"
          >
            <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="14" rx="2" />
              <path d="m7.5 10 2 2-2 2M12.5 14.5h4" />
            </svg>
            <span>Command</span>
          </button>
          <button
            ref={layersButtonRef}
            type="button"
            className={`rail-button ${layersOpen ? 'is-active' : ''}`}
            onClick={() => {
              setLayersOpen((open) => !open);
              setSettingsOpen(false);
              setTargetsOpen(false);
              setSearchOpen(false);
            }}
            aria-label="Map layers"
            aria-expanded={layersOpen}
            title="Map layers"
          >
            <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
              <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5ZM3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5" />
            </svg>
            <span>Layers</span>
          </button>
          <button
            ref={targetsButtonRef}
            type="button"
            className={`rail-button ${targetsOpen ? 'is-active' : ''}`}
            onClick={() => {
              setTargetsOpen((open) => !open);
              setLayersOpen(false);
              setSettingsOpen(false);
              setSearchOpen(false);
            }}
            aria-label="Targets on the map"
            aria-expanded={targetsOpen}
            title="What is on the map and what can be tapped"
          >
            <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
              <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.5 6.5h.01M3.5 12h.01M3.5 17.5h.01" />
            </svg>
            <span>Targets</span>
          </button>
          <button
            ref={settingsButtonRef}
            type="button"
            className={`rail-button ${settingsOpen ? 'is-active' : ''}`}
            onClick={() => {
              setSettingsOpen((open) => !open);
              setLayersOpen(false);
              setTargetsOpen(false);
              setSearchOpen(false);
            }}
            aria-label="Settings and privacy"
            aria-expanded={settingsOpen}
            title="Settings and privacy"
          >
            <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
            </svg>
            <span>Settings</span>
          </button>
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

        {searchOpen && (
          <div className="float-search-card" role="dialog" aria-label="Search">
            <div className="float-search-card-head">
              <SearchBar autoFocus onNavigate={() => setSearchOpen(false)} />
              <button
                type="button"
                className="icon-button close"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
              >
                ×
              </button>
            </div>
          </div>
        )}
        {offlineBar}
        <main className="map-full">
          <MapView
            views={views}
            onLiveCountsChange={setLiveCounts}
            onAddMissingPlace={setMissingPlacePoint}
            onOpenLayers={() => {
              setLayersOpen(true);
              setSettingsOpen(false);
              setTargetsOpen(false);
              setSearchOpen(false);
            }}
          />
        </main>

        {state.workspace !== 'map' && (
          <aside className="float-panel panel-left" aria-label="Workspace">
            <header className="float-panel-head">
              <span className="eyebrow">
                {NAV_ITEMS.find((item) => item.id === state.workspace)?.label ?? 'Workspace'}
              </span>
              <button
                type="button"
                className="icon-button close"
                onClick={() => actions.setWorkspace('map')}
                aria-label="Close workspace"
              >
                ×
              </button>
            </header>
            <div className="float-panel-body">{workspaceContent()}</div>
          </aside>
        )}

        {(selectedPlace || state.selectedBuildingId) && (
          <aside className="float-panel panel-right" aria-label="Record inspector">
            <div className="float-panel-body">
              {state.workspace === 'buildings' ? (
                state.selectedBuildingId ? (
                  <BuildingDossier
                    dossierId={state.selectedBuildingId}
                    onBack={() => actions.selectBuilding(null)}
                    onComposeCheck={setComposeTarget}
                  />
                ) : (
                  <div className="inspector-empty">
                    <p className="eyebrow">Building dossier</p>
                    <h2>Select a parcel</h2>
                    <p>
                      The Buildings workspace lists parcels with a DBI complaint, notice or demolition record describing
                      a vacant, abandoned or derelict condition. Choose a row to read its identification, evidence,
                      records and chronology here.
                    </p>
                    <p className="notice">
                      A dossier is a reading of City records, not a field check. No entry here states that a building is
                      empty today.
                    </p>
                  </div>
                )
              ) : selectedPlace ? (
                <>
                  <PlaceInspector
                    placeId={selectedPlace.id}
                    onClose={() => actions.selectPlace(null)}
                    onComposeNote={(target) => setComposeTarget(target)}
                  />
                  <CompareTray />
                </>
              ) : (
                <div className="inspector-empty">
                  <p className="eyebrow">Inspector</p>
                  <h2>Select a record</h2>
                  <p>
                    Choose a marker, a Nearby row, or a search result. The inspector keeps the map position and shows
                    evidence, access and sources without losing your place.
                  </p>
                  <dl className="meta-table">
                    <div className="meta-row">
                      <dt>Records</dt>
                      <dd>{dataset.data.meta.counts.places} places</dd>
                    </div>
                    <div className="meta-row">
                      <dt>Sources</dt>
                      <dd>{dataset.data.meta.counts.sources} registered</dd>
                    </div>
                    <div className="meta-row">
                      <dt>Last build</dt>
                      <dd>{formatDate(dataset.data.meta.generatedAt)}</dd>
                    </div>
                  </dl>
                  <p className="notice">
                    Nothing here says a place is open. Every status is tied to a source and a date, and empty fields say
                    “Not confirmed”.
                  </p>
                </div>
              )}
            </div>
          </aside>
        )}

        <nav className="bottom-bar" aria-label="Main menu">
          <button
            type="button"
            className={state.workspace === 'map' && !selectedPlace && !state.selectedBuildingId ? 'is-active' : ''}
            onClick={() => {
              actions.selectPlace(null);
              actions.selectBuilding(null);
              actions.setWorkspace('map');
            }}
          >
            <PathIcon path="M12 3.5 20 12l-8 8.5L4 12z" size={19} />
            <span>Map</span>
          </button>
          {WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={state.workspace === workspace.id ? 'is-active' : ''}
              aria-current={state.workspace === workspace.id ? 'page' : undefined}
              onClick={() => openWorkspace(workspace.id)}
            >
              <PathIcon path={workspace.icon} size={19} />
              <span>{workspace.label}</span>
              {workspace.id === 'review' && openReportCount > 0 && (
                <span className="nav-badge" aria-hidden="true" title={`${openReportCount} open`}>
                  {openReportCount}
                </span>
              )}
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
              <PathIcon path={tab.icon} size={19} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {layersOpen && railPopover?.kind === 'layers' && (
          <div
            className="side-popover rail-popover"
            role="dialog"
            aria-label="Map layers"
            style={
              {
                top: railPopover.top,
                maxHeight: railPopover.maxHeight,
                '--rail-caret-top': `${railPopover.caretTop}px`,
              } as React.CSSProperties
            }
          >
            <LayerDrawer onClose={() => setLayersOpen(false)} />
          </div>
        )}
        {settingsOpen && railPopover?.kind === 'settings' && (
          <div
            className="side-popover rail-popover"
            role="dialog"
            aria-label="Settings"
            style={
              {
                top: railPopover.top,
                maxHeight: railPopover.maxHeight,
                '--rail-caret-top': `${railPopover.caretTop}px`,
              } as React.CSSProperties
            }
          >
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        )}
        {targetsOpen && railPopover?.kind === 'targets' && (
          <div
            className="side-popover rail-popover"
            role="dialog"
            aria-label="Targets on the map"
            style={
              {
                top: railPopover.top,
                maxHeight: railPopover.maxHeight,
                '--rail-caret-top': `${railPopover.caretTop}px`,
              } as React.CSSProperties
            }
          >
            <MapTargetsPanel onClose={() => setTargetsOpen(false)} liveCounts={liveCounts} />
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
        {missingPlacePoint && (
          <Overlay side="center" onClose={() => setMissingPlacePoint(null)}>
            <div className="composer-shell">
              <MissingPlaceComposer
                coordinates={missingPlacePoint}
                onDone={() => setMissingPlacePoint(null)}
                onCancel={() => setMissingPlacePoint(null)}
              />
            </div>
          </Overlay>
        )}
        {paletteOpen && (
          <CommandPalette
            query={paletteQuery}
            setQuery={setPaletteQuery}
            onClose={() => {
              setPaletteOpen(false);
              setPaletteQuery('');
            }}
            onCommand={(command) => {
              setPaletteOpen(false);
              setPaletteQuery('');
              if (command === 'layers') {
                setLayersOpen(true);
                setSettingsOpen(false);
                setTargetsOpen(false);
                setSearchOpen(false);
              } else if (command === 'settings') {
                setSettingsOpen(true);
                setLayersOpen(false);
                setTargetsOpen(false);
                setSearchOpen(false);
              }
              else if (command === 'clear') actions.resetFilters();
              else if (command === 'export') void import('../../services/storage').then((m) => m.exportPersonalData());
              else if (command === 'compose') quickNote();
              else openWorkspace(command as WorkspaceId);
            }}
          />
        )}
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
          <span className="mobile-workspace" role="status" aria-live="polite">
            <span className="eyebrow">Workspace</span>
            <strong>{activeWorkspaceLabel}</strong>
            {mobileCanClose && (
              <button
                type="button"
                className="mobile-workspace-close"
                onClick={closeMobilePanels}
                aria-label={`Close ${activeWorkspaceLabel} and return to the map`}
              >
                ×
              </button>
            )}
          </span>
          {!online && <span className="offline-chip">Offline · saved data</span>}
          {online && <span className="online-chip">Field release · {dataset.data.meta.counts.places} records</span>}
          <span className="privacy-chip">No account · no tracking</span>
        </div>
      </header>

      {offlineBar}

      <main className="mobile-map">
        <MapView
          views={views}
          onLiveCountsChange={setLiveCounts}
          onAddMissingPlace={setMissingPlacePoint}
          onOpenLayers={() => setLayersOpen(true)}
        />
        <button type="button" className="quick-note-fab" onClick={quickNote} aria-label="Quick field note">
          <PathIcon path="M5 3.5h11l3 3v14H5zM8.5 11h7M8.5 15h5" size={22} />
        </button>
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
              <span>{views.length} records pass the current filters</span>
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
            The index covers installed records, streets and Muni stops in central SF. It is not a citywide geocoder.
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
      {missingPlacePoint && (
        <Overlay side="center" onClose={() => setMissingPlacePoint(null)}>
          <div className="composer-shell">
            <MissingPlaceComposer
              coordinates={missingPlacePoint}
              onDone={() => setMissingPlacePoint(null)}
              onCancel={() => setMissingPlacePoint(null)}
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
    { id: 'library', label: 'Go to Library' },
    { id: 'review', label: 'Go to Review' },
    { id: 'compose', label: 'New field note' },
    { id: 'layers', label: 'Open layers' },
    { id: 'settings', label: 'Open settings & privacy' },
    { id: 'clear', label: 'Clear all filters' },
    { id: 'export', label: 'Download my data' },
  ].filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="overlay overlay-center" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-head">
          <span className="eyebrow">Command</span>
          <kbd>Esc</kbd>
        </div>
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
        <p className="palette-foot muted small">Every command also lives on the side rail or in the bottom menu.</p>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { dataset } from '../../data';
import { LAYERS, LAYER_PRESETS } from '../../map/layers';
import { useStore } from '../../state/store';

const GROUPS: { id: string; title: string; note: string }[] = [
  { id: 'base', title: 'Base map', note: 'Streets are bundled; terrain and 3D geometry cache on first use.' },
  { id: 'transit', title: 'Transit', note: 'Stop inventory, not live arrivals.' },
  { id: 'resources', title: 'Resources', note: 'One marker per place record, clustered at low zoom.' },
  { id: 'personal', title: 'Yours', note: 'Stored only on this device.' },
  { id: 'context', title: 'Context', note: 'Live activity, building records and crowd-sourced photo coverage.' },
];

export function LayerDrawer({ onClose }: { onClose: () => void }) {
  const { state, actions } = useStore();
  const [viewName, setViewName] = useState('');

  return (
    <aside className="drawer" aria-label="Map layers">
      <header className="drawer-head">
        <div>
          <p className="eyebrow">Map instrument</p>
          <h2>Layers</h2>
        </div>
        <button type="button" className="icon-button close" onClick={onClose} aria-label="Close layers">
          ×
        </button>
      </header>

      <section className="drawer-section">
        <h3>Presets</h3>
        <div className="preset-strip">
          {LAYER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset-chip"
              onClick={() => actions.applyPreset(preset.id)}
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      {GROUPS.map((group) => {
        const layers = LAYERS.filter((layer) => layer.group === group.id);
        if (layers.length === 0) return null;
        const active = layers.filter((layer) => state.layers[layer.id]).length;
        return (
          <details key={group.id} className="drawer-group" open={group.id === 'base'}>
            <summary>
              <span>{group.title}</span>
              <span className="group-count">
                {active}/{layers.length}
              </span>
            </summary>
            <div className="drawer-group-body">
              <p className="group-note">{group.note}</p>
              <ul className="layer-list">
                {layers.map((layer) => {
                  const sources = layer.sourceIds
                    .map((id) => dataset.sourceById.get(id))
                    .filter((source): source is NonNullable<typeof source> => Boolean(source));
                  return (
                    <li key={layer.id} className="layer-item">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={Boolean(state.layers[layer.id])}
                          onChange={(e) => actions.setLayer(layer.id, e.target.checked)}
                        />
                        <span className="switch-track" aria-hidden="true" />
                        <span className="layer-text">
                          <strong>{layer.name}</strong>
                          <span className="layer-desc" title={layer.description}>
                            {layer.description}
                          </span>
                          <span className="layer-meta">
                            {layer.id === 'mapillary-coverage' ? (
                              <a
                                href="https://www.mapillary.com/"
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                Mapillary contributors
                              </a>
                            ) : sources.length > 0 ? (
                              <a href={sources[0].url} target="_blank" rel="noreferrer noopener">
                                {sources[0].provider}
                              </a>
                            ) : (
                              'Local device data'
                            )}
                            {' · '}
                            {layer.offline === 'bundled'
                              ? 'bundled offline'
                              : layer.offline === 'cached_on_demand'
                                ? 'offline after first use'
                                : 'needs network'}
                            {layer.minZoom ? ` · z${layer.minZoom}+` : ''}
                          </span>
                        </span>
                      </label>
                      {layer.id === 'terrain' && state.layers.terrain && (
                        <label className="opacity-control">
                          <span>Shading</span>
                          <input
                            type="range"
                            min={0.1}
                            max={0.8}
                            step={0.02}
                            value={state.layerOpacity.terrain ?? 0.32}
                            onChange={(e) => actions.setLayerOpacity('terrain', Number(e.target.value))}
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        );
      })}

      <details className="drawer-group">
        <summary>
          <span>Saved views</span>
          <span className="group-count">{state.layerViews.length}</span>
        </summary>
        <div className="drawer-group-body">
          {state.layerViews.length > 0 ? (
            <ul className="saved-views">
              {state.layerViews.map((view) => (
                <li key={view.id}>
                  <button type="button" className="link-button" onClick={() => actions.applyLayerView(view.id)}>
                    {view.name}
                  </button>
                  <button
                    type="button"
                    className="link-button subtle"
                    onClick={() => void actions.deleteLayerView(view.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="group-note">No saved views. Name the current combination to reuse it.</p>
          )}
          <div className="button-row">
            <input
              className="inline-input"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="Name this combination"
              aria-label="Name for this layer view"
            />
            <button
              type="button"
              className="button small"
              disabled={!viewName.trim()}
              onClick={() => {
                void actions.saveLayerView(viewName.trim());
                setViewName('');
              }}
            >
              Save
            </button>
          </div>
        </div>
      </details>

      <details className="drawer-group drawer-fineprint">
        <summary>
          <span>Sources & licence</span>
        </summary>
        <div className="drawer-group-body">
          <p className="group-note">
            Street, park and rail geometry © OpenStreetMap contributors (ODbL), as are building footprints and tagged
            heights. Terrain uses public-domain elevation tiles. Facility and stop inventories are City and County of San
            Francisco open data (PDDL).
          </p>
        </div>
      </details>
    </aside>
  );
}

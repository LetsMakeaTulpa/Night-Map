import { useState } from 'react';
import { dataset } from '../../data';
import { LAYERS, LAYER_PRESETS } from '../../map/layers';
import { useStore } from '../../state/store';

export function LayerDrawer({ onClose }: { onClose: () => void }) {
  const { state, actions } = useStore();
  const [viewName, setViewName] = useState('');

  const groups: { id: string; title: string; note: string }[] = [
    { id: 'base', title: 'Base map', note: 'Streets ship with the app; terrain and 3D geometry are cached on first use.' },
    { id: 'transit', title: 'Transit', note: 'Stop inventory, not live arrivals.' },
    { id: 'resources', title: 'Resources', note: 'One marker per place record, clustered at low zoom.' },
    { id: 'personal', title: 'Yours', note: 'Stored only on this device.' },
    {
      id: 'context',
      title: 'Context',
      note: 'Historic features, and published City incident snapshots that are never live.',
    },
  ];

  return (
    <aside className="drawer" aria-label="Map layers">
      <header className="drawer-head">
        <div>
          <p className="eyebrow">Map instrument</p>
          <h2>Layers</h2>
          <p className="muted small">Combine what you need. Nothing is forced on screen.</p>
        </div>
        <button type="button" className="icon-button close" onClick={onClose} aria-label="Close layers">
          ×
        </button>
      </header>

      <section className="drawer-section">
        <h3>Presets</h3>
        <div className="preset-grid">
          {LAYER_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="preset" onClick={() => actions.applyPreset(preset.id)}>
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

      {groups.map((group) => {
        const layers = LAYERS.filter((l) => l.group === group.id);
        if (layers.length === 0) return null;
        return (
          <section key={group.id} className="drawer-section">
            <div className="section-head">
              <h3>{group.title}</h3>
              <span className="muted small">{group.note}</span>
            </div>
            <ul className="layer-list">
              {layers.map((layer) => {
                const sources = layer.sourceIds
                  .map((id) => dataset.sourceById.get(id))
                  .filter((s): s is NonNullable<typeof s> => Boolean(s));
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
                        <span>{layer.description}</span>
                        <span className="layer-meta">
                          {sources.length > 0 ? (
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
                          {layer.minZoom ? ` · from z${layer.minZoom}` : ''}
                        </span>
                      </span>
                    </label>
                    {layer.id === 'terrain' && state.layers.terrain && (
                      <label className="opacity-control">
                        <span>Shading strength</span>
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
                    {layer.id === 'landmarks' && state.layers.landmarks && (
                      <label className="opacity-control">
                        <span>Opacity</span>
                        <input
                          type="range"
                          min={0.2}
                          max={1}
                          step={0.05}
                          value={state.layerOpacity.landmarks ?? 0.75}
                          onChange={(e) => actions.setLayerOpacity('landmarks', Number(e.target.value))}
                        />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="drawer-section">
        <h3>Saved views</h3>
        {state.layerViews.length > 0 ? (
          <ul className="saved-views">
            {state.layerViews.map((view) => (
              <li key={view.id}>
                <button type="button" className="link-button" onClick={() => actions.applyLayerView(view.id)}>
                  Apply “{view.name}”
                </button>
                <button type="button" className="link-button" onClick={() => void actions.deleteLayerView(view.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No saved views. Name the current combination to reuse it.</p>
        )}
        <div className="button-row">
          <input
            className="inline-input"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="e.g. Night water run"
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
            Save view
          </button>
        </div>
      </section>

      <p className="coverage-foot">
        Street, park, rail and historic geometry © OpenStreetMap contributors (ODbL), as are the building footprints and
        the tagged heights on them. Terrain relief uses public-domain elevation tiles. Facility and stop inventories are
        City and County of San Francisco open data (PDDL). Full source registry is in Atlas → Sources.
      </p>
    </aside>
  );
}

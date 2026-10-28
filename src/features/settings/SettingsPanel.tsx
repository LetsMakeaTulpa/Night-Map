import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import {
  deletePersonalData,
  estimateStorage,
  exportPersonalData,
  storageMode,
} from '../../services/storage';
import { dataset } from '../../data';
import { formatBytes } from '../ui';
import { formatDate } from '../../domain/status';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { state, actions } = useStore();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cacheNames, setCacheNames] = useState<string[]>([]);

  useEffect(() => {
    void estimateStorage().then(setUsage);
    if ('caches' in window) void caches.keys().then(setCacheNames);
  }, []);

  const exportData = async () => {
    const data = await exportPersonalData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `night-map-personal-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    actions.notify('Exported your on-device records as JSON. It includes private notes — check before sharing.', 'warn');
  };

  const clearCaches = async () => {
    if (!('caches' in window)) return;
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    setCacheNames([]);
    actions.notify('Cached app files cleared. The app will need a connection on next load.', 'warn');
  };

  return (
    <aside className="drawer" aria-label="Settings">
      <header className="drawer-head">
        <div>
          <p className="eyebrow">Instrument</p>
          <h2>Settings & privacy</h2>
        </div>
        <button type="button" className="icon-button close" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </header>

      <section className="drawer-section">
        <h3>Routing & geocoding</h3>
        <label className="field">
          <span>Walking route provider</span>
          <select
            value={state.settings.routingProvider}
            onChange={(e) => void actions.setSettings({ routingProvider: e.target.value as 'osrm' | 'disabled' })}
          >
            <option value="osrm">OSRM walking (public FOSSGIS demo)</option>
            <option value="disabled">Off — straight-line distance only</option>
          </select>
          <span className="field-foot">
            The public demo has fair-use limits and no SLA. A production deployment should self-host OSRM or use a paid
            routing provider; the adapter lives behind one interface.
          </span>
        </label>
        <label className="field">
          <span>Address search</span>
          <select
            value={state.settings.geocodingProvider}
            onChange={(e) => void actions.setSettings({ geocodingProvider: e.target.value as 'local' | 'photon' })}
          >
            <option value="local">Night Map index only</option>
            <option value="photon">Also allow Photon (OpenStreetMap) citywide lookup</option>
          </select>
          <span className="field-foot">
            The wider lookup sends your typed address to photon.komoot.io. Results are map pins, not resource records.
          </span>
        </label>
        <label className="field">
          <span>Distance units</span>
          <select
            value={state.settings.units}
            onChange={(e) => void actions.setSettings({ units: e.target.value as 'metric' | 'imperial' })}
          >
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>
        </label>
      </section>

      <section className="drawer-section">
        <h3>Location</h3>
        <dl className="meta-table">
          <div className="meta-row">
            <dt>Permission</dt>
            <dd>{state.settings.locationPermission}</dd>
          </div>
          <div className="meta-row">
            <dt>This session</dt>
            <dd>{state.userLocation ? `fix ±${Math.round(state.userLocation.accuracy)} m, memory only` : 'No fix held'}</dd>
          </div>
          <div className="meta-row">
            <dt>Background location</dt>
            <dd>
              Off. Not implemented, not requested.
              <span className="meta-note">Night Map never records a track or shares your position with anyone.</span>
            </dd>
          </div>
        </dl>
        <button type="button" className="button ghost small" onClick={() => void actions.useCurrentLocation()}>
          Request a one-time location fix
        </button>
      </section>

      <section className="drawer-section">
        <h3>Offline & cache</h3>
        <p className="muted small">
          The basemap, records and sources are bundled in this build ({formatBytes(dataset.data.meta ? JSON.stringify(dataset.data.meta).length : 0)} of
          metadata). The service worker caches the app shell after the first successful load. Routing and wider address
          lookup always need a connection.
        </p>
        <dl className="meta-table">
          <div className="meta-row">
            <dt>Bundled data</dt>
            <dd>{formatDate(dataset.data.meta.generatedAt)}</dd>
          </div>
          <div className="meta-row">
            <dt>Service-worker caches</dt>
            <dd>{cacheNames.length ? cacheNames.join(', ') : 'None on this origin yet'}</dd>
          </div>
          <div className="meta-row">
            <dt>Storage used</dt>
            <dd>{usage ? `${formatBytes(usage.usage)} of ~${formatBytes(usage.quota)}` : 'Not reported by browser'}</dd>
          </div>
        </dl>
        <div className="button-row">
          <button
            type="button"
            className="button ghost small"
            onClick={() => {
              void clearCaches();
              void estimateStorage().then(setUsage);
            }}
          >
            Clear cached files
          </button>
          <button type="button" className="button ghost small" onClick={() => window.location.reload()}>
            Reload from bundled data
          </button>
        </div>
      </section>

      <section className="drawer-section">
        <h3>Your records</h3>
        <p className="muted small">
          Storage mode: {storageMode}. Saved places, field notes, collections, reports and layer views live in this
          browser only. There is no account and no server copy.
        </p>
        <div className="button-row">
          <button type="button" className="button small" onClick={() => void exportData()}>
            Export my data (JSON)
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="button danger small"
                onClick={() => {
                  void deletePersonalData().then(() => {
                    actions.notify('Deleted saved places, notes, collections, reports and layer views from this device.', 'success');
                    setConfirmDelete(false);
                  });
                }}
              >
                Yes, delete everything local
              </button>
              <button type="button" className="button ghost small" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="button ghost small" onClick={() => setConfirmDelete(true)}>
              Delete my local data
            </button>
          )}
        </div>
      </section>

      <section className="drawer-section">
        <h3>What Night Map does not do</h3>
        <ul className="plain-list">
          <li>No account, no tracking, no analytics, no ads.</li>
          <li>No public feed of people or encampments.</li>
          <li>No crime, safety or “risk” scores for streets or people.</li>
          <li>No claim that a marker means a service is open, stocked or available.</li>
          <li>No live bed availability, live arrivals, or live opening status.</li>
        </ul>
      </section>
    </aside>
  );
}

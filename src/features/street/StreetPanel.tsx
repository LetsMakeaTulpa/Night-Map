import { useEffect, useRef, useState } from 'react';
import {
  clearMapillaryToken,
  fetchStreetImages,
  mapillaryViewerUrl,
  RADIUS_METRES,
  readMapillaryToken,
  saveMapillaryToken,
  type StreetImage,
} from '../../services/mapillary';
import { formatDate } from '../../domain/status';
import { formatDistance } from '../../domain/geo';
import { useStore } from '../../state/store';

interface Props {
  center: [number, number];
  onClose: () => void;
  onCenter: (coordinates: [number, number]) => void;
}

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function StreetPanel({ center, onClose, onCenter }: Props) {
  const { state } = useStore();
  const [token, setToken] = useState<string | null>(() => readMapillaryToken());
  const [tokenDraft, setTokenDraft] = useState('');
  const [images, setImages] = useState<StreetImage[]>([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus('loading');
      setError(null);
      fetchStreetImages(center, token, controller.signal)
        .then((found) => {
          if (requestRef.current !== requestId) return;
          setImages(found);
          setIndex(0);
          setStatus(found.length ? 'ready' : 'empty');
        })
        .catch((err: Error) => {
          if (controller.signal.aborted || requestRef.current !== requestId) return;
          setStatus('error');
          setError(err.message);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [center, token]);

  const current = images[index] ?? null;
  const captured = current?.capturedAt ? formatDate(new Date(current.capturedAt).toISOString()) : null;

  const saveToken = () => {
    const trimmed = tokenDraft.trim();
    if (!trimmed) return;
    saveMapillaryToken(trimmed);
    setToken(trimmed);
    setTokenDraft('');
  };

  return (
    <section className="street-panel" aria-label="Street-level imagery">
      <header className="street-head">
        <div>
          <p className="eyebrow">Street-level</p>
          <h3>Mapillary near here</h3>
        </div>
        <button type="button" className="icon-button close" onClick={onClose} aria-label="Close street imagery">
          ×
        </button>
      </header>

      {!token ? (
        <div className="street-setup">
          <p>
            Street photos come from Mapillary, a crowd-sourced imagery service. It needs a free client token; without
            one, nothing is requested and no photos are shown.
          </p>
          <label className="field">
            <span>Mapillary client token</span>
            <input
              className="inline-input"
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Paste a client token"
              autoComplete="off"
            />
          </label>
          <div className="button-row">
            <button type="button" className="button small" onClick={saveToken} disabled={!tokenDraft.trim()}>
              Save on this device
            </button>
            <a
              className="button ghost small"
              href="https://www.mapillary.com/dashboard/developers"
              target="_blank"
              rel="noreferrer noopener"
            >
              Get a token
            </a>
          </div>
          <p className="muted small">
            The token is stored only in this browser and sent only to Mapillary. Coverage is incomplete; an empty street
            is not evidence that nothing is there.
          </p>
        </div>
      ) : (
        <div className="street-body">
          {status === 'loading' && <p className="muted small">Looking for photos within {RADIUS_METRES} m…</p>}
          {status === 'error' && (
            <>
              <p className="notice warn">{error}</p>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  clearMapillaryToken();
                  setToken(null);
                }}
              >
                Replace the token
              </button>
            </>
          )}
          {status === 'empty' && (
            <p className="muted small">
              No Mapillary photos within {RADIUS_METRES} m. Coverage is crowd-sourced, so this often means nobody has
              walked here yet, not that the street is empty.
            </p>
          )}
          {current && (
            <>
              {current.isPano ? (
                <iframe
                  className="street-frame"
                  title={`Mapillary panorama at ${current.coordinates[1].toFixed(5)}, ${current.coordinates[0].toFixed(5)}`}
                  src={`https://www.mapillary.com/embed?image_key=${current.id}&style=photo`}
                  loading="lazy"
                />
              ) : current.thumbUrl ? (
                <img
                  className="street-image"
                  src={current.thumbUrl}
                  alt={`Street-level photo captured ${captured ?? 'at an unknown date'} near this point`}
                  loading="lazy"
                />
              ) : (
                <p className="muted small">This image has no preview available.</p>
              )}
              <div className="street-meta">
                <span>{captured ? `Captured ${captured}` : 'Capture date unknown'}</span>
                <span>{formatDistance(current.distanceMeters, state.settings.units)} away</span>
              </div>
              <div className="street-meta">
                <span>
                  {current.compassAngle === null ? 'Facing unknown' : `Facing ${Math.round(current.compassAngle)}°`}
                  {current.isPano ? ' · panorama' : ''}
                </span>
                <span>
                  {index + 1} of {images.length}
                </span>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="button ghost tiny"
                  onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
                  disabled={images.length < 2}
                  aria-label="Previous nearby photo"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className="button ghost tiny"
                  onClick={() => setIndex((i) => (i + 1) % images.length)}
                  disabled={images.length < 2}
                  aria-label="Next nearby photo"
                >
                  Next →
                </button>
                <button type="button" className="button ghost tiny" onClick={() => onCenter(current.coordinates)}>
                  Centre map
                </button>
                <a
                  className="button ghost tiny"
                  href={mapillaryViewerUrl(current)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open in Mapillary
                </a>
              </div>
            </>
          )}
          <p className="street-attribution muted small">
            Imagery ©{' '}
            <a href="https://www.mapillary.com/" target="_blank" rel="noreferrer noopener">
              Mapillary
            </a>{' '}
            contributors, CC BY-SA. Photos show their capture date, not current conditions.
          </p>
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  fetchKartaviewPhotos,
  KARTAVIEW_RADIUS_METRES,
  type KartaViewPhoto,
} from '../../services/kartaview';
import { formatDate } from '../../domain/status';
import { formatDistance } from '../../domain/geo';
import { useStore } from '../../state/store';

type Status = 'unlocated' | 'loading' | 'ready' | 'empty' | 'error';

/**
 * Session-wide cap so a long registry list does not burst the public API.
 * Photos are cached by the service, so scrolling back costs no requests.
 */
const MAX_PARALLEL_PHOTO_REQUESTS = 3;
let activePhotoRequests = 0;
const waitingPhotoRequests: Array<() => void> = [];

async function nearestPhoto(center: [number, number]): Promise<KartaViewPhoto | null> {
  if (activePhotoRequests >= MAX_PARALLEL_PHOTO_REQUESTS) {
    await new Promise<void>((resolve) => waitingPhotoRequests.push(resolve));
  }
  activePhotoRequests += 1;
  try {
    const photos = await fetchKartaviewPhotos(center);
    return photos[0] ?? null;
  } finally {
    activePhotoRequests -= 1;
    waitingPhotoRequests.shift()?.();
  }
}

/**
 * The registry row's thumbnail: the nearest public street-level photo, fetched
 * only once the row approaches the viewport. A missing photo is a quiet
 * camera glyph rather than a second explanation on every row.
 */
export function BuildingThumb({ coordinates }: { coordinates: [number, number] | null }) {
  const holder = useRef<HTMLSpanElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [photo, setPhoto] = useState<KartaViewPhoto | null>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element || nearViewport) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport || !coordinates) return;
    let cancelled = false;
    nearestPhoto(coordinates)
      .then((found) => {
        if (!cancelled) setPhoto(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [nearViewport, coordinates]);

  return (
    <span className={`building-thumb${photo ? ' has-photo' : ''}`} ref={holder} aria-hidden="true">
      {photo ? (
        <img
          src={photo.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setPhoto(null)}
        />
      ) : (
        <CameraIcon />
      )}
    </span>
  );
}

/**
 * A building photo beside the dossier header.
 *
 * The registry carries no realtor or listing photography. This uses KartaView's
 * public street-level imagery instead: it is the actual block, but it may show a
 * neighbouring building and may be older than the current streetscape. The
 * caption says so rather than implying a listing photo.
 */
export function BuildingPhoto({
  address,
  coordinates,
}: {
  address: string;
  coordinates: [number, number] | null;
}) {
  const { state } = useStore();
  const [photos, setPhotos] = useState<KartaViewPhoto[]>([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>(coordinates ? 'loading' : 'unlocated');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!coordinates) {
      setStatus('unlocated');
      setPhotos([]);
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    fetchKartaviewPhotos(coordinates, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setPhotos(found);
        setIndex(0);
        setStatus(found.length ? 'ready' : 'empty');
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(err.message);
      });
    return () => controller.abort();
  }, [coordinates, retry]);

  const current = photos[index] ?? null;
  const captured = current?.capturedAt
    ? formatDate(new Date(current.capturedAt).toISOString())
    : null;

  return (
    <figure className="dossier-photo" data-testid="building-photo" aria-label={`Photo near ${address}`}>
      <div className="dossier-photo-frame">
        {status === 'ready' && current ? (
          <>
            <img
              src={current.thumbUrl}
              alt={`Street-level photo near ${address}, captured ${captured ?? 'at an unknown date'}`}
              loading="lazy"
              decoding="async"
              onError={() => {
                setStatus('error');
                setError('The photo preview could not be loaded. Try another image or retry.');
              }}
            />
            <span className="dossier-photo-kind">Street-level</span>
          </>
        ) : status === 'loading' ? (
          <div className="dossier-photo-message" role="status">
            <CameraIcon />
            <strong>Looking for a photo</strong>
            <span>Searching public street-level imagery within {KARTAVIEW_RADIUS_METRES} m…</span>
          </div>
        ) : (
          <div className="dossier-photo-message">
            <CameraIcon />
            <strong>
              {status === 'unlocated'
                ? 'No photo location'
                : status === 'error'
                  ? 'Photo unavailable'
                  : 'No photo nearby'}
            </strong>
            <span>
              {status === 'unlocated'
                ? 'This parcel has no City-published point, so no street-level photo can be located.'
                : status === 'error'
                  ? error
                  : `KartaView has no public photo within ${KARTAVIEW_RADIUS_METRES} m. Coverage is crowd-sourced and incomplete.`}
            </span>
            {status === 'error' ? (
              <button type="button" className="link-button" onClick={() => setRetry((value) => value + 1)}>
                Try again
              </button>
            ) : status === 'empty' && coordinates ? (
              <a
                className="link-button"
                href={`https://kartaview.org/map/@${coordinates[1]},${coordinates[0]},17z`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Check KartaView
              </a>
            ) : null}
          </div>
        )}
      </div>

      {status === 'ready' && current && (
        <figcaption>
          <span className="dossier-photo-label">Nearest public photo</span>
          <span>{captured ? `Captured ${captured}` : 'Capture date unknown'}</span>
          <span>
            {formatDistance(current.distanceMeters, state.settings.units)} away · may show a neighbouring
            building
          </span>
          <span className="dossier-photo-credit">
            ©{' '}
            <a href="https://kartaview.org/" target="_blank" rel="noreferrer noopener">
              KartaView
            </a>{' '}
            contributors · CC BY-SA
          </span>
          <div className="dossier-photo-controls">
            <button
              type="button"
              className="icon-button"
              onClick={() => setIndex((value) => (value - 1 + photos.length) % photos.length)}
              disabled={photos.length < 2}
              aria-label="Previous nearby photo"
            >
              ←
            </button>
            <span>
              {index + 1} / {photos.length}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setIndex((value) => (value + 1) % photos.length)}
              disabled={photos.length < 2}
              aria-label="Next nearby photo"
            >
              →
            </button>
            <a
              className="link-button"
              href={`https://kartaview.org/photo/${current.id}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open
            </a>
          </div>
        </figcaption>
      )}
    </figure>
  );
}

function CameraIcon() {
  return (
    <svg className="dossier-photo-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5h3.2l1.4-2h6.8l1.4 2H20v11H4z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

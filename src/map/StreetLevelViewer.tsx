import { useEffect, useRef, useState, type FormEvent } from 'react';

interface MapillaryImageResponse {
  data?: Array<{ id?: string }>;
}

interface MapillarySdk {
  Viewer: new (options: {
    accessToken: string;
    container: HTMLElement;
    imageId: string;
    component?: { cover?: boolean; sequence?: { visible?: boolean } };
  }) => { remove: () => void };
}

declare global {
  interface Window {
    mapillary?: MapillarySdk;
  }
}

let sdkPromise: Promise<MapillarySdk> | null = null;

function loadMapillarySdk(): Promise<MapillarySdk> {
  if (window.mapillary) return Promise.resolve(window.mapillary);
  if (sdkPromise) return sdkPromise;

  const pending = new Promise<MapillarySdk>((resolve, reject) => {
    if (!document.querySelector('link[data-night-mapillary]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.css';
      link.dataset.nightMapillary = 'true';
      document.head.append(link);
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-night-mapillary]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      if (window.mapillary) resolve(window.mapillary);
      else reject(new Error('MapillaryJS loaded but its Viewer API was not found.'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('MapillaryJS could not be loaded. Check the network connection.')), { once: true });
    if (!existing) {
      script.src = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js';
      script.async = true;
      script.dataset.nightMapillary = 'true';
      document.head.append(script);
    }
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });
  sdkPromise = pending;
  return pending;
}

export function StreetLevelViewer({
  coordinates,
  onClose,
}: {
  coordinates: [number, number];
  onClose: () => void;
}) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Enter your Mapillary access token to search for imagery near the map centre.');
  const [imageId, setImageId] = useState<string | null>(null);
  const viewerRef = useRef<{ remove: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    viewerRef.current?.remove();
    viewerRef.current = null;
  }, []);

  const findImage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const accessToken = token.trim();
    if (!accessToken) {
      setStatus('A Mapillary access token is required. Night Map does not include or borrow one.');
      return;
    }
    setLoading(true);
    setImageId(null);
    viewerRef.current?.remove();
    viewerRef.current = null;
    try {
      const url = new URL('https://graph.mapillary.com/images');
      url.searchParams.set('fields', 'id');
      url.searchParams.set('lat', String(coordinates[1]));
      url.searchParams.set('lng', String(coordinates[0]));
      url.searchParams.set('radius', '80');
      url.searchParams.set('limit', '1');
      const response = await fetch(url, { headers: { Authorization: `OAuth ${accessToken}` } });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Mapillary rejected this token. Check that it is valid and enabled for the Graph API.'
          : `Mapillary image search returned HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as MapillaryImageResponse;
      const id = payload.data?.[0]?.id;
      if (!id) {
        setStatus('No Mapillary image was returned within 80 metres of this map centre. Try moving the map to another block.');
        return;
      }
      const sdk = await loadMapillarySdk();
      if (!containerRef.current) return;
      viewerRef.current = new sdk.Viewer({
        accessToken,
        container: containerRef.current,
        imageId: String(id),
        component: { cover: false, sequence: { visible: true } },
      });
      setImageId(String(id));
      setStatus('Street-level image loaded. Imagery is community-contributed and may be older than the current streetscape.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Street-level imagery could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="street-viewer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="street-viewer" role="dialog" aria-modal="true" aria-label="Mapillary street-level imagery">
        <header className="street-viewer-head">
          <div>
            <p className="eyebrow">Street-level imagery · Mapillary</p>
            <h2>Look along the street</h2>
          </div>
          <button type="button" className="icon-button close" onClick={onClose} aria-label="Close street-level imagery">×</button>
        </header>
        <form className="street-viewer-form" onSubmit={findImage}>
          <label htmlFor="mapillary-token">Your Mapillary access token</label>
          <div className="street-viewer-token-row">
            <input id="mapillary-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste token for this session" />
            <button type="submit" className="button small" disabled={loading || !token.trim()}>
              {loading ? 'Searching…' : imageId ? 'Find another image' : 'Find nearby imagery'}
            </button>
          </div>
          <p className="muted small">The token stays in this panel's memory only. It is sent directly from your browser to Mapillary; Night Map does not save it or receive it.</p>
        </form>
        <div className="street-viewer-status" role="status">{status}</div>
        <div ref={containerRef} className="street-viewer-canvas" aria-label="Mapillary image viewer" />
        <p className="street-viewer-credit">Imagery © Mapillary contributors · <a href="https://www.mapillary.com/terms" target="_blank" rel="noreferrer noopener">terms of use</a></p>
      </section>
    </div>
  );
}

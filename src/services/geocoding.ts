export interface GeocodeResult {
  label: string;
  detail: string;
  coordinates: [number, number];
  provider: string;
}

export class GeocodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodeError';
  }
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    locality?: string;
    osm_value?: string;
    type?: string;
  };
}

/**
 * Wide-area address lookup. Only called when a person explicitly asks to search
 * beyond the bundled Night Map index. Results have no Night Map evidence attached.
 */
export async function geocodePhoton(
  query: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<GeocodeResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en&lat=37.7793&lon=-122.4193`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new GeocodeError(`Geocoder returned HTTP ${res.status}.`);
    const json = (await res.json()) as { features?: PhotonFeature[] };
    return (json.features ?? [])
      .map((f) => {
        const p = f.properties;
        const street = [p.housenumber, p.street].filter(Boolean).join(' ');
        const label = p.name || street || p.city || 'Unnamed place';
        const detail = [street, p.postcode, p.city].filter(Boolean).join(', ');
        return {
          label,
          detail: detail || 'OpenStreetMap feature',
          coordinates: f.geometry.coordinates,
          provider: 'Photon (OpenStreetMap)',
        };
      })
      .filter((r) => r.coordinates.every(Number.isFinite));
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new GeocodeError('Address lookup timed out.');
    if (err instanceof GeocodeError) throw err;
    throw new GeocodeError(`Address lookup failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Best-effort reverse lookup for a manually placed pin. */
export async function reversePhoton(
  coordinates: [number, number],
  options: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `https://photon.komoot.io/reverse?lon=${coordinates[0]}&lat=${coordinates[1]}&lang=en`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { features?: PhotonFeature[] };
    const p = json.features?.[0]?.properties;
    if (!p) return null;
    return [p.name, p.street, p.city].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

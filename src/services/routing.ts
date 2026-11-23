import type { RoutePlan, RouteStep, RouteStop } from '../domain/types';
import { haversineMeters } from '../domain/geo';

export class RoutingError extends Error {
  code: 'network' | 'provider' | 'no_route' | 'disabled';
  constructor(code: RoutingError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'RoutingError';
  }
}

export interface RouteProvider {
  id: string;
  label: string;
  requiresNetwork: boolean;
  /** Displayed next to any route produced by this provider. */
  note: string;
}

export interface RouteRequest {
  origin: RouteStop;
  stops: RouteStop[];
}

export const OSRM_PROVIDER: RouteProvider = {
  id: 'osrm-foot',
  label: 'OSRM walking (FOSSGIS public demo)',
  requiresNetwork: true,
  note: 'Walking geometry from OpenStreetMap via the FOSSGIS OSRM demo service. Distance and time are estimates. Night Map does not know about lighting, closures, stairs or accessibility on this route.',
};

export const providers: Record<string, RouteProvider> = {
  osrm: OSRM_PROVIDER,
};

interface OsrmStep {
  distance: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number] };
  mode?: string;
}

interface OsrmLeg {
  distance: number;
  duration: number;
  steps: OsrmStep[];
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  legs: OsrmLeg[];
}

const DIRECTIONS: Record<string, string> = {
  north: 'north',
  south: 'south',
  east: 'east',
  west: 'west',
  northeast: 'northeast',
  northwest: 'northwest',
  southeast: 'southeast',
  southwest: 'southwest',
};

function instructionFor(step: OsrmStep, isLastOfLeg: boolean, destination: string): string {
  const street = step.name?.trim();
  const onto = street ? ` onto ${street}` : '';
  const along = street ? ` on ${street}` : '';
  switch (step.maneuver.type) {
    case 'depart':
      return street ? `Start${along} heading ${DIRECTIONS[step.maneuver.modifier ?? ''] ?? 'ahead'}` : 'Start walking';
    case 'arrive':
      return `Arrive at ${destination}`;
    case 'turn':
      return `Turn ${step.maneuver.modifier ?? ''}${onto}`.replace(/\s+/g, ' ');
    case 'new name':
    case 'continue':
      return `Continue${along}`;
    case 'merge':
      return `Merge${onto}`;
    case 'fork':
      return `Keep ${step.maneuver.modifier ?? 'ahead'}${onto}`;
    case 'end of road':
      return `At the end of the road, turn ${step.maneuver.modifier ?? ''}${onto}`;
    case 'roundabout':
    case 'rotary':
      return `Enter the roundabout and exit${onto}`;
    default:
      if (isLastOfLeg) return `Continue${along} to ${destination}`;
      return street ? `Continue${along}` : 'Continue';
  }
}

function stepsFromRoute(route: OsrmRoute, destinationLabel: string): RouteStep[] {
  const steps: RouteStep[] = [];
  route.legs.forEach((leg, legIndex) => {
    const destination = legIndex === route.legs.length - 1 ? destinationLabel : `stop ${legIndex + 1}`;
    leg.steps.forEach((step, i) => {
      if (step.maneuver.type === 'arrive') return;
      steps.push({
        instruction: instructionFor(step, i === leg.steps.length - 1, destination),
        distanceMeters: step.distance,
        streetName: step.name?.trim() || null,
      });
    });
  });
  if (steps.length === 0) steps.push({ instruction: `Walk to ${destinationLabel}`, distanceMeters: route.distance, streetName: null });
  return steps;
}

const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

export async function fetchWalkingRoute(
  request: RouteRequest,
  options: { provider?: 'osrm' | 'disabled'; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<RoutePlan[]> {
  const providerId = options.provider ?? 'osrm';
  if (providerId === 'disabled') {
    throw new RoutingError('disabled', 'Routing is turned off in Settings.');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const stops = [request.origin, ...request.stops];
  if (stops.length < 2) throw new RoutingError('provider', 'A route needs a start and at least one destination.');
  const coords = stops
    .map((s) => `${s.coordinates[0].toFixed(6)},${s.coordinates[1].toFixed(6)}`)
    .join(';');
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=true&alternatives=${stops.length === 2 ? 'true' : 'false'}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new RoutingError('provider', `Routing provider returned HTTP ${res.status}.`);
    const json = (await res.json()) as { code?: string; routes?: OsrmRoute[]; message?: string };
    if (json.code !== 'Ok' || !json.routes?.length) {
      throw new RoutingError('no_route', json.message || 'The routing provider found no walking route between these points.');
    }
    const destinationLabel = request.stops[request.stops.length - 1]?.label ?? 'destination';
    // OSRM only returns alternatives for simple two-point requests.
    return json.routes.slice(0, 2).map((candidate, index) => ({
      id: `route:${Date.now().toString(36)}:${index}`,
      name: `${request.origin.label} → ${destinationLabel}`,
      stops,
      geometry: { type: 'LineString', coordinates: candidate.geometry.coordinates },
      distanceMeters: candidate.distance,
      durationSeconds: candidate.duration,
      steps: stepsFromRoute(candidate, destinationLabel),
      provider: OSRM_PROVIDER.label,
      providerNote:
        index === 0
          ? OSRM_PROVIDER.note
          : 'Alternative walking route from the same provider. Shorter or faster is not safer; Night Map makes no safety claim.',
      createdAt: new Date().toISOString(),
      profile: 'walking',
    }));
  } catch (err) {
    if (err instanceof RoutingError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new RoutingError('network', 'The routing request timed out after 20 seconds.');
    }
    throw new RoutingError('network', `Could not reach the routing provider: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Honest fallback: a straight-line distance, explicitly not a walking route. */
export function straightLineFallback(origin: RouteStop, destination: RouteStop) {
  const distance = haversineMeters(origin.coordinates, destination.coordinates);
  return {
    distanceMeters: distance,
    geometry: {
      type: 'LineString' as const,
      coordinates: [origin.coordinates, destination.coordinates] as [number, number][],
    },
    note: 'Straight-line distance only. No walking route was produced, and this line does not follow streets, stairs or crossings.',
  };
}

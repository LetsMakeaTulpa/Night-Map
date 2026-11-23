import { describe, expect, it, vi } from 'vitest';
import { fetchWalkingRoute, RoutingError, straightLineFallback } from './routing';

const request = {
  origin: { label: 'Start', placeId: null, coordinates: [-122.4145, 37.784] as [number, number] },
  stops: [{ label: 'GLIDE', placeId: 'place:glide', coordinates: [-122.4053, 37.7895] as [number, number] }],
};

const osrmPayload = {
  code: 'Ok',
  routes: [
    {
      distance: 1326,
      duration: 1061,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-122.4145, 37.784],
          [-122.41, 37.786],
          [-122.4053, 37.7895],
        ],
      },
      legs: [
        {
          distance: 1326,
          duration: 1061,
          steps: [
            {
              distance: 200,
              name: 'Turk Street',
              maneuver: { type: 'depart', modifier: 'west', location: [-122.4145, 37.784] },
            },
            {
              distance: 1126,
              name: 'Ellis Street',
              maneuver: { type: 'turn', modifier: 'right', location: [-122.41, 37.786] },
            },
            {
              distance: 0,
              name: '',
              maneuver: { type: 'arrive', location: [-122.4053, 37.7895] },
            },
          ],
        },
      ],
    },
  ],
};

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('fetchWalkingRoute', () => {
  it('requests the foot profile and maps geometry and steps', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => okResponse(osrmPayload));
    const [plan] = await fetchWalkingRoute(request, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('routed-foot');
    expect(url).toContain('-122.414500,37.784000;-122.405300,37.789500');
    expect(url).toContain('steps=true');
    expect(plan.distanceMeters).toBe(1326);
    expect(plan.durationSeconds).toBe(1061);
    expect(plan.geometry?.coordinates.length).toBe(3);
    expect(plan.steps.map((s) => s.instruction)).toEqual([
      'Start on Turk Street heading west',
      'Turn right onto Ellis Street',
    ]);
  });

  it('surfaces provider and network failures as typed errors', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response);
    await expect(
      fetchWalkingRoute(request, { fetchImpl: failing as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(RoutingError);

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      fetchWalkingRoute(request, { fetchImpl: offline as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('reports a no-route response without inventing a path', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({ code: 'NoRoute', routes: [], message: 'No route found' }),
    );
    await expect(
      fetchWalkingRoute(request, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'no_route' });
  });

  it('refuses to operate when routing is disabled', async () => {
    await expect(fetchWalkingRoute(request, { provider: 'disabled' })).rejects.toMatchObject({
      code: 'disabled',
    });
  });

  it('returns an explicitly labelled straight-line fallback', () => {
    const fallback = straightLineFallback(request.origin, request.stops[0]);
    expect(fallback.distanceMeters).toBeGreaterThan(1000);
    expect(fallback.note).toContain('Straight-line distance only');
    expect(fallback.note).toContain('does not follow streets');
  });
});

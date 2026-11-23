import { describe, expect, it } from 'vitest';
import type { LayerView } from '../domain/types';
import { cameraPoseFromView } from './layerViews';

const stored: LayerView = {
  id: 'view_1',
  name: 'Night water run',
  visible: { streets: true, water: true },
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('cameraPoseFromView', () => {
  it('leaves the camera alone for a view stored before cameras existed', () => {
    expect(cameraPoseFromView(stored)).toBeNull();
  });

  it('returns the camera a saved view recorded', () => {
    expect(
      cameraPoseFromView({
        ...stored,
        camera: { center: [-122.41, 37.78], zoom: 16.4, pitch: 35, bearing: 20 },
      }),
    ).toEqual({ center: [-122.41, 37.78], zoom: 16.4, pitch: 35, bearing: 20 });
  });

  it('rejects a damaged camera rather than moving somewhere arbitrary', () => {
    expect(
      cameraPoseFromView({ ...stored, camera: { center: [Number.NaN, 37.78], zoom: 16, pitch: 0, bearing: 0 } }),
    ).toBeNull();
    expect(
      cameraPoseFromView({
        ...stored,
        camera: { center: [-122.41, 37.78], zoom: '16' as unknown as number, pitch: 0, bearing: 0 },
      }),
    ).toBeNull();
  });
});

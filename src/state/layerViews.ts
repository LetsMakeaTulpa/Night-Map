import type { CameraPose, LayerView } from '../domain/types';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The camera a saved view should restore, or null when it has none.
 *
 * `camera` is optional by design: views stored before cameras were recorded
 * contain only their layer toggles, and a damaged record must behave the same
 * way rather than throwing the camera somewhere arbitrary.
 */
export function cameraPoseFromView(view: LayerView): CameraPose | null {
  const camera: unknown = view.camera;
  if (!camera || typeof camera !== 'object') return null;
  const { center, zoom, pitch, bearing } = camera as Partial<CameraPose>;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(finite)) return null;
  if (!finite(zoom) || !finite(pitch) || !finite(bearing)) return null;
  return { center: [center[0], center[1]], zoom, pitch, bearing };
}

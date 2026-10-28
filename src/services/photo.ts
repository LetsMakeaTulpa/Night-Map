import type { ObservationPhoto } from '../domain/types';

export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1280;

export class PhotoError extends Error {}

/**
 * Re-encodes a photo through a canvas. This drops EXIF, GPS, device and
 * timestamp metadata by construction: only visible pixels survive.
 */
export async function preparePhoto(file: File): Promise<ObservationPhoto> {
  if (!file.type.startsWith('image/')) throw new PhotoError('That file is not an image.');
  if (file.size > MAX_SOURCE_BYTES) throw new PhotoError('That image is larger than 12 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError('The browser could not decode that image.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('Canvas 2D is unavailable in this browser.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  return { dataUrl, width, height, metadataStripped: true };
}

export function photoSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

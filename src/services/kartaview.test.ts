import { describe, expect, it } from 'vitest';
import { kartaviewImageUrl } from './kartaview';

describe('kartaviewImageUrl', () => {
  it('maps a storage-relative path to the storage host', () => {
    expect(kartaviewImageUrl('storage2/files/photo/2020/1/2/lth/123_456.jpg')).toBe(
      'https://storage2.openstreetcam.org/files/photo/2020/1/2/lth/123_456.jpg',
    );
  });

  it('accepts an absolute storage path on the expected host', () => {
    expect(kartaviewImageUrl('storage9.openstreetcam.org/files/photo/a.jpg')).toBe(
      'https://storage9.openstreetcam.org/files/photo/a.jpg',
    );
  });

  it('rejects unrelated or empty paths', () => {
    expect(kartaviewImageUrl(null)).toBeNull();
    expect(kartaviewImageUrl('')).toBeNull();
    expect(kartaviewImageUrl('https://example.com/photo.jpg')).toBeNull();
  });
});

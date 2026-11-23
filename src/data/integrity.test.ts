import { describe, expect, it } from 'vitest';
import { checkIntegrity, dataset } from './index';
import { LAYERS } from '../map/layers';

describe('bundled dataset', () => {
  it('validates against the runtime schemas and has no referential errors', () => {
    const issues = checkIntegrity(dataset);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('keeps stable, unique ids across places and resources', () => {
    const placeIds = new Set(dataset.data.places.map((p) => p.id));
    expect(placeIds.size).toBe(dataset.data.places.length);
    expect(new Set(dataset.data.resources.map((r) => r.id)).size).toBe(dataset.data.resources.length);
    for (const resource of dataset.data.resources) {
      expect(placeIds.has(resource.placeId)).toBe(true);
    }
  });

  it('places every record inside the declared footprint', () => {
    const [west, south, east, north] = dataset.data.meta.footprint.bbox;
    for (const place of dataset.data.places) {
      const [lon, lat] = place.geometry.coordinates;
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
  });

  it('never asserts live availability without a confirmed integration', () => {
    for (const resource of dataset.data.resources) {
      expect(resource.availability.status).toBe('unknown');
      expect(resource.sourceIds.length).toBeGreaterThan(0);
    }
  });

  it('includes the City POPOS inventory as source-linked map records with conservative availability', () => {
    const popos = dataset.data.places.filter((place) => place.category === 'popos');
    expect(popos.length).toBeGreaterThan(0);
    expect(dataset.categoryCounts.popos).toBe(popos.length);
    const source = dataset.sourceById.get('src:sfgov-popos');
    expect(source?.license).toContain('PDDL');
    expect(source?.url).toContain('65ik-7wqd');
    for (const place of popos) {
      expect(place.sourceIds).toContain('src:sfgov-popos');
      const resource = dataset.resourceByPlaceId.get(place.id);
      expect(resource).toBeDefined();
      expect(resource?.availability.status).toBe('unknown');
      expect(resource?.details.spaceType).toBeTruthy();
      expect(resource?.sourceIds).toContain('src:sfgov-popos');
    }
  });

  it('keeps the two City datasets attributed', () => {
    const water = dataset.sourceById.get('src:sfgov-water-assets');
    const muni = dataset.sourceById.get('src:sfgov-muni-stops');
    expect(water?.license).toContain('PDDL');
    expect(muni?.license).toContain('PDDL');
    expect(water?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('links the library water asset to the curated library building record', () => {
    const library = dataset.placeById.get('place:curated:sfpl-main-library');
    expect(library).toBeTruthy();
    const resources = dataset.resourcesByPlaceId.get('place:curated:sfpl-main-library') ?? [];
    expect(resources.some((r) => r.serviceTypes.includes('drinking_water'))).toBe(true);
  });

  it('does not duplicate a marker for the merged City library place', () => {
    const matches = dataset.data.places.filter((p) => p.name === 'Main Library');
    expect(matches.length).toBe(0);
  });
});

describe('cost and friction lines', () => {
  const lines = dataset.data.resources.flatMap((resource) => resource.friction ?? []);

  it('attributes every line to a registered source with a date', () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(dataset.sourceById.has(line.sourceId)).toBe(true);
      expect(line.note.length).toBeGreaterThan(20);
      if (line.asOf !== null) expect(line.asOf).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('records silence rather than inventing a requirement', () => {
    const silent = lines.filter((line) => line.value === null);
    expect(silent.length).toBeGreaterThan(0);
    // Only the kind that would otherwise be filled in with an assumption.
    for (const line of silent) expect(line.kind).toBe('id_required');
  });

  it('never states a price, a payment rule or a free allowance without a value', () => {
    for (const line of lines) {
      if (line.kind === 'true_price' || line.kind === 'free_allowance' || line.kind === 'payment_methods') {
        expect(line.value).toBeTruthy();
      }
    }
  });
});

describe('hand-checked access records', () => {
  it('places every one of them at coordinates a geocoder returned, and says which match', () => {
    expect(dataset.access.places.length).toBeGreaterThan(0);
    for (const place of dataset.access.places) {
      const record = dataset.access.geocodes[place.id];
      expect(record).toBeDefined();
      expect(record.osmMatch).toMatch(/^(node|way|relation)\/\d+$/);
      expect(record.query.length).toBeGreaterThan(4);
      expect(record.coordinates).toEqual(place.geometry.coordinates);
      expect(place.locationPrecision).toBe('geocoded_address');
    }
  });

  it('counts the new categories from the records actually installed', () => {
    expect(dataset.categoryCounts.comms).toBeGreaterThan(0);
    expect(dataset.categoryCounts.tech).toBeGreaterThan(0);
    expect(dataset.data.meta.counts.places).toBe(dataset.data.places.length);
    expect(dataset.data.meta.counts.resources).toBe(dataset.data.resources.length);
  });
});

describe('published disclosures', () => {
  it('lists official documents, each with a link and a stated gap', () => {
    expect(dataset.data.disclosures.length).toBeGreaterThan(0);
    for (const entry of dataset.data.disclosures) {
      expect(entry.url.startsWith('https://')).toBe(true);
      expect(entry.whatItDoesNotSay.length).toBeGreaterThan(40);
      expect(dataset.disclosureFile.statement).toContain('no camera');
    }
    const urls = dataset.data.disclosures.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('describes surveillance systems in prose only, and never as a map layer', () => {
    const pattern = /camera|kiosk|surveillance|alpr|licence plate/i;
    for (const layer of LAYERS) {
      expect(`${layer.id} ${layer.name} ${layer.description}`).not.toMatch(pattern);
    }
    // The documents themselves are the honest substitute for a layer.
    expect(dataset.data.disclosures.some((entry) => pattern.test(entry.title))).toBe(true);
  });
});

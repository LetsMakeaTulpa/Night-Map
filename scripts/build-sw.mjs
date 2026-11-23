#!/usr/bin/env node
/**
 * Generates dist/sw.js with a precache list covering the built shell, assets,
 * fonts and icons. Runs after `vite build`. No network access required.
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

async function walk(dir, prefix = '') {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    if (entry === 'sw.js') continue;
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) files.push(...(await walk(full, `${prefix}/${entry}`)));
    else files.push(`${prefix}/${entry}`);
  }
  return files;
}

const files = await walk(DIST);
// Terrain, building tiles and incident snapshots are deliberately left out of the
// install. Together they are megabytes, and a user who never tilts the map or asks
// for reported activity should not pay for them on a phone with limited data. The
// service worker caches each one the first time it is fetched.
const onDemand = (file) =>
  file.startsWith('/terrain/') || file.startsWith('/buildings/') || file.startsWith('/incidents/');
const precache = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  ...files.filter((f) => !f.endsWith('.map') && !onDemand(f)),
];
const onDemandCount = files.filter(onDemand).length;
const template = await readFile(path.join(ROOT, 'scripts', 'sw-template.js'), 'utf8');
// The shell cache name follows the hashed asset list, so every deployment
// installs a fresh shell without clearing the stable tile or data caches.
const buildId = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 10);
const output = template
  .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
  .replaceAll('__BUILD_ID__', buildId);
await writeFile(path.join(DIST, 'sw.js'), output);
console.log(
  `wrote dist/sw.js with ${precache.length} precached entries ` +
    `(${onDemandCount} terrain, building and incident tiles cached on demand)`,
);
